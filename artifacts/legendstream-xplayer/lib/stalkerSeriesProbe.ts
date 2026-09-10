import { redactSensitiveText, safeLog } from "./safeLog";
import { StalkerPortalError } from "./stalkerPortal";
import type { StalkerIsolatedSession } from "./stalkerIsolatedLogin";

export type StalkerSeriesProbeClassification =
  | "SUCCESS"
  | "EMPTY"
  | "UNSUPPORTED"
  | "ERROR"
  | "EVIDENCE_REQUIRED";

export type StalkerSeriesProbeObservation = {
  classification: StalkerSeriesProbeClassification;
  httpStatus: number | null;
  payloadShape: string;
  itemCount: number;
  fieldNames: string[];
  samplePrimitives: string[];
  error?: string;
};

export type StalkerSeriesProbeCategory = {
  id: string;
  title: string;
};

export type StalkerSeriesProbeItem = {
  id: string;
  title: string;
  raw: Record<string, unknown>;
};

export type StalkerSeriesNestedContainer = {
  path: string;
  rows: Record<string, unknown>[];
};

export type StalkerSeriesDetailDiscovery = {
  classification: "SUCCESS" | "EVIDENCE_REQUIRED" | "ERROR";
  source: "SELECTED_ROW" | "EVIDENCE_REQUEST" | "NONE";
  containers: StalkerSeriesNestedContainer[];
  candidateCount: number;
  observations: StalkerSeriesProbeObservation[];
  payload?: unknown;
};

export type StalkerSeriesCreateLinkObservation = StalkerSeriesProbeObservation & {
  resolvedScheme?: string;
  wrapperPrefix: boolean;
  returnedFieldNames: string[];
  extraTransportHints: boolean;
};

const PROBE_TIMEOUT_MS = 12_000;
const MAX_EVIDENCE_CANDIDATES = 3;
const MAX_NESTED_CONTAINERS = 12;
const MAX_NESTED_ROWS = 30;
const unsupportedPattern = /\b(?:unknown|unsupported|not\s+implemented|not\s+available)\b/i;
const sensitiveSampleKey = /(?:cmd|url|uri|token|auth|cookie|mac|password|secret|credential|user)/i;

type Params = Record<string, string | number | boolean | undefined>;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function payloadShape(value: unknown) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function rowsFromEnvelope(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = asObject(payload);
  if (Array.isArray(root?.data)) return root.data;
  if (Array.isArray(root?.js)) return root.js;
  return [];
}

function textValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function safePrimitiveSamples(row: Record<string, unknown> | null) {
  if (!row) return [];
  const samples: string[] = [];
  for (const key of Object.keys(row).sort()) {
    if (sensitiveSampleKey.test(key)) continue;
    const value = row[key];
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    samples.push(`${key}=${redactSensitiveText(String(value)).slice(0, 80)}`);
    if (samples.length >= 6) break;
  }
  return samples;
}

export function observeStalkerSeriesPayload(
  payload: unknown,
  classification?: StalkerSeriesProbeClassification,
): StalkerSeriesProbeObservation {
  const rows = rowsFromEnvelope(payload);
  const first = asObject(rows[0]) ?? asObject(payload);
  const unsupported = (() => {
    if (typeof payload === "string") return unsupportedPattern.test(payload);
    const root = asObject(payload);
    return root ? [root.error, root.message, root.reason, root.status].some(
      (value) => typeof value === "string" && unsupportedPattern.test(value),
    ) : false;
  })();
  return {
    classification: classification ?? (unsupported ? "UNSUPPORTED" : rows.length ? "SUCCESS" : "EMPTY"),
    httpStatus: null,
    payloadShape: payloadShape(payload),
    itemCount: rows.length,
    fieldNames: first ? Object.keys(first).sort().slice(0, 32) : [],
    samplePrimitives: safePrimitiveSamples(first),
  };
}

function safeError(caught: unknown) {
  const message = caught instanceof Error ? caught.message : String(caught);
  return redactSensitiveText(message);
}

function errorObservation(caught: unknown): StalkerSeriesProbeObservation {
  const status = caught instanceof StalkerPortalError ? caught.status ?? null : null;
  const message = caught instanceof Error ? caught.message : String(caught);
  return {
    classification: unsupportedPattern.test(message) ? "UNSUPPORTED" : "ERROR",
    httpStatus: status,
    payloadShape: "error",
    itemCount: 0,
    fieldNames: [],
    samplePrimitives: [],
    error: safeError(caught),
  };
}

function linkedTimeoutSignal(external?: AbortSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  external?.addEventListener("abort", onAbort, { once: true });
  if (external?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

async function boundedRequest(
  session: StalkerIsolatedSession,
  params: Params,
  candidateNumber: number,
  signal?: AbortSignal,
) {
  const linked = linkedTimeoutSignal(signal);
  safeLog.info("SERIES_PROBE_REQUEST", {
    type: params.type,
    action: params.action,
    param_keys: Object.keys(params).filter((key) => key !== "type" && key !== "action").sort(),
    candidate_number: candidateNumber,
  });
  try {
    const payload = await session.request(
      params,
      linked.signal,
      undefined,
      { providerId: "r16-d-series-probe" },
    );
    const observation = observeStalkerSeriesPayload(payload);
    safeLog.info("SERIES_PROBE_RESPONSE", {
      http_status: observation.httpStatus,
      payload_shape: observation.payloadShape,
      item_count: observation.itemCount,
      field_names: observation.fieldNames,
      classification: observation.classification,
    });
    return { payload, observation };
  } catch (caught) {
    const observation = errorObservation(caught);
    safeLog.info("SERIES_PROBE_RESPONSE", {
      http_status: observation.httpStatus,
      payload_shape: observation.payloadShape,
      item_count: 0,
      field_names: [],
      classification: observation.classification,
      error: observation.error,
    });
    return { payload: undefined, observation };
  } finally {
    linked.cleanup();
  }
}

export async function probeStalkerSeriesCategories(
  session: StalkerIsolatedSession,
  signal?: AbortSignal,
) {
  const result = await boundedRequest(
    session,
    { type: "series", action: "get_categories" },
    1,
    signal,
  );
  const categories: StalkerSeriesProbeCategory[] = [];
  const seen = new Set<string>();
  for (const raw of rowsFromEnvelope(result.payload)) {
    const row = asObject(raw);
    if (!row) continue;
    const id = textValue(row.id);
    const title = textValue(row.title);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    categories.push({ id, title });
  }
  return {
    categories,
    observation: {
      ...result.observation,
      classification: result.observation.classification === "SUCCESS" && categories.length === 0
        ? "EMPTY" as const
        : result.observation.classification,
    },
  };
}

export async function probeStalkerSeriesPage(
  session: StalkerIsolatedSession,
  category: StalkerSeriesProbeCategory,
  signal?: AbortSignal,
) {
  const result = await boundedRequest(
    session,
    { type: "series", action: "get_ordered_list", category: category.id, p: 1 },
    1,
    signal,
  );
  const items: StalkerSeriesProbeItem[] = [];
  const seen = new Set<string>();
  for (const raw of rowsFromEnvelope(result.payload)) {
    const row = asObject(raw);
    if (!row) continue;
    const id = textValue(row.id) || textValue(row.series_id);
    const title = textValue(row.name) || textValue(row.title) || id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    items.push({ id, title, raw: row });
  }
  return {
    items,
    observation: {
      ...result.observation,
      classification: result.observation.classification === "SUCCESS" && items.length === 0
        ? "EMPTY" as const
        : result.observation.classification,
    },
  };
}

export function inspectStalkerSeriesNestedContainers(value: unknown) {
  const containers: StalkerSeriesNestedContainer[] = [];
  const seen = new Set<object>();
  const walk = (current: unknown, path: string, depth: number) => {
    if (depth > 3 || containers.length >= MAX_NESTED_CONTAINERS) return;
    if (Array.isArray(current)) {
      const rows = current.slice(0, MAX_NESTED_ROWS).map(asObject).filter((row): row is Record<string, unknown> => Boolean(row));
      if (rows.length) containers.push({ path: path || "$", rows });
      return;
    }
    const row = asObject(current);
    if (!row || seen.has(row)) return;
    seen.add(row);
    for (const [key, nested] of Object.entries(row)) {
      if (nested && typeof nested === "object") walk(nested, path ? `${path}.${key}` : key, depth + 1);
      if (containers.length >= MAX_NESTED_CONTAINERS) break;
    }
  };
  walk(value, "", 0);
  return containers;
}

function evidenceRequestDescriptors(value: unknown) {
  const descriptors: Params[] = [];
  const seen = new Set<object>();
  const walk = (current: unknown, depth: number) => {
    if (depth > 3 || descriptors.length >= MAX_EVIDENCE_CANDIDATES) return;
    const row = asObject(current);
    if (!row || seen.has(row)) return;
    seen.add(row);
    const type = textValue(row.type);
    const action = textValue(row.action);
    if (type === "series" && /^get_[a-z0-9_]+$/i.test(action)) {
      const descriptor: Params = { type, action };
      for (const [key, item] of Object.entries(row)) {
        if (key === "type" || key === "action" || sensitiveSampleKey.test(key)) continue;
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") descriptor[key] = item;
      }
      descriptors.push(descriptor);
    }
    for (const nested of Object.values(row)) {
      if (nested && typeof nested === "object") walk(nested, depth + 1);
      if (descriptors.length >= MAX_EVIDENCE_CANDIDATES) break;
    }
  };
  walk(value, 0);
  return descriptors;
}

export async function discoverStalkerSeriesDetails(
  session: StalkerIsolatedSession,
  item: StalkerSeriesProbeItem,
  signal?: AbortSignal,
): Promise<StalkerSeriesDetailDiscovery> {
  const direct = inspectStalkerSeriesNestedContainers(item.raw);
  if (direct.length) {
    return {
      classification: "SUCCESS",
      source: "SELECTED_ROW",
      containers: direct,
      candidateCount: 0,
      observations: [],
      payload: item.raw,
    };
  }

  const descriptors = evidenceRequestDescriptors(item.raw).slice(0, MAX_EVIDENCE_CANDIDATES);
  const observations: StalkerSeriesProbeObservation[] = [];
  for (let index = 0; index < descriptors.length; index += 1) {
    if (signal?.aborted) break;
    const result = await boundedRequest(session, descriptors[index]!, index + 1, signal);
    observations.push(result.observation);
    const containers = inspectStalkerSeriesNestedContainers(result.payload);
    if (result.observation.classification === "SUCCESS" && containers.length) {
      return {
        classification: "SUCCESS",
        source: "EVIDENCE_REQUEST",
        containers,
        candidateCount: index + 1,
        observations,
        payload: result.payload,
      };
    }
  }

  return {
    classification: "EVIDENCE_REQUIRED",
    source: "NONE",
    containers: [],
    candidateCount: descriptors.length,
    observations,
  };
}

export function seriesProbeRowLabel(row: Record<string, unknown>) {
  for (const key of ["title", "name", "season", "episode", "id"]) {
    const value = textValue(row[key]);
    if (value) return redactSensitiveText(value).slice(0, 80);
  }
  return `fields: ${Object.keys(row).sort().slice(0, 5).join(", ")}`;
}

function episodeCommand(row: Record<string, unknown>) {
  return typeof row.cmd === "string" && row.cmd.trim() ? row.cmd.trim() : "";
}

function resolvedCandidate(payload: unknown) {
  const candidates: Array<{ field: string; value: string }> = [];
  if (typeof payload === "string") candidates.push({ field: "$", value: payload });
  const root = asObject(payload);
  if (root) {
    for (const [key, value] of Object.entries(root)) {
      if (typeof value === "string") candidates.push({ field: key, value });
    }
  }
  for (const candidate of candidates) {
    const wrapperPrefix = /^ffmpeg\s+/i.test(candidate.value.trim());
    const source = candidate.value.replace(/^ffmpeg\s+/i, "").trim();
    try {
      const parsed = new URL(source);
      if (["http:", "https:", "rtsp:", "rtmp:"].includes(parsed.protocol)) {
        return { scheme: parsed.protocol.replace(":", ""), wrapperPrefix };
      }
    } catch {
      // Diagnostic discovery intentionally ignores non-URL primitive fields.
    }
  }
  return null;
}

export async function probeStalkerSeriesCreateLink(
  session: StalkerIsolatedSession,
  episode: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const cmd = episodeCommand(episode);
  if (!cmd) {
    return {
      observation: {
        classification: "EVIDENCE_REQUIRED",
        httpStatus: null,
        payloadShape: "none",
        itemCount: 0,
        fieldNames: [],
        samplePrimitives: [],
        wrapperPrefix: false,
        returnedFieldNames: [],
        extraTransportHints: false,
      } satisfies StalkerSeriesCreateLinkObservation,
    };
  }
  const result = await boundedRequest(
    session,
    { type: "series", action: "create_link", cmd },
    1,
    signal,
  );
  const resolved = resolvedCandidate(result.payload);
  const root = asObject(result.payload);
  const returnedFieldNames = root ? Object.keys(root).sort().slice(0, 32) : [];
  return {
    observation: {
      ...result.observation,
      classification: result.observation.classification === "SUCCESS" && !resolved
        ? "EMPTY"
        : result.observation.classification,
      resolvedScheme: resolved?.scheme,
      wrapperPrefix: resolved?.wrapperPrefix ?? false,
      returnedFieldNames,
      extraTransportHints: returnedFieldNames.some((key) => /header|cookie/i.test(key)),
    } satisfies StalkerSeriesCreateLinkObservation,
  };
}

export const STALKER_SERIES_PROBE_LIMITS = {
  page: 1,
  maxCategorySelections: 1,
  maxSeriesSelections: 1,
  maxEvidenceCandidates: MAX_EVIDENCE_CANDIDATES,
  maxCreateLinks: 1,
  timeoutMs: PROBE_TIMEOUT_MS,
} as const;
