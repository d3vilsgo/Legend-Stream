import { redactSensitiveText, safeLog } from "./safeLog";
import { StalkerPortalError } from "./stalkerPortal";
import type { StalkerIsolatedSession } from "./stalkerIsolatedLogin";

export type StalkerSeriesProbeClassification =
  | "SUCCESS"
  | "EMPTY"
  | "UNSUPPORTED"
  | "ERROR"
  | "EVIDENCE_REQUIRED";

export type StalkerSeriesHierarchyClassification =
  | "SEASONS_FOUND"
  | "EPISODES_FOUND"
  | "SERIES_DETAIL_FOUND"
  | "EMPTY"
  | "UNSUPPORTED"
  | "ERROR"
  | "EVIDENCE_REQUIRED";

export type StalkerSeriesProbeObservation = {
  classification: StalkerSeriesProbeClassification;
  httpStatus: number | null;
  payloadShape: string;
  itemCount: number;
  totalItems?: number;
  maxPageItems?: number;
  currentPage?: number;
  fieldNames: string[];
  samplePrimitives: string[];
  error?: string;
};

export type StalkerSeriesProbeCategory = { id: string; title: string };

export type StalkerSeriesProbeItem = {
  id: string;
  title: string;
  raw: Record<string, unknown>;
};

export type StalkerSeriesNestedContainer = {
  path: string;
  rows: Record<string, unknown>[];
};

export type StalkerSeriesSeason = {
  id: string;
  label: string;
  rows: Record<string, unknown>[];
};

export type StalkerSeriesEpisode = {
  id: string;
  label: string;
  seasonId: string;
  row: Record<string, unknown>;
};

export type StalkerSeriesCandidateObservation = {
  candidateNumber: number;
  type: string;
  action: string;
  paramKeys: string[];
  observation: StalkerSeriesProbeObservation;
  hierarchyClassification: StalkerSeriesHierarchyClassification;
  nestedContainerPaths: string[];
};

export type StalkerSeriesDetailDiscovery = {
  classification: StalkerSeriesHierarchyClassification;
  source: "SELECTED_ROW" | "CANDIDATE_1" | "CANDIDATE_2" | "EVIDENCE_REQUEST" | "NONE";
  containers: StalkerSeriesNestedContainer[];
  seasons: StalkerSeriesSeason[];
  episodes: StalkerSeriesEpisode[];
  candidateCount: number;
  candidateNumberUsed: number | null;
  observations: StalkerSeriesCandidateObservation[];
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
const episodeSignalKeys = ["episode", "episode_id", "episode_num", "episode_number"] as const;
const seasonSignalKeys = ["season_id", "season", "season_number", "season_num", "season_name"] as const;

type Params = Record<string, string | number | boolean | undefined>;
type BoundedResult = { payload: unknown; observation: StalkerSeriesProbeObservation };

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
  const nestedData = asObject(root?.data);
  if (Array.isArray(nestedData?.data)) return nestedData.data;
  if (Array.isArray(nestedData?.items)) return nestedData.items;
  return [];
}

function textValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
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
  const root = asObject(payload);
  const nestedData = asObject(root?.data);
  const first = asObject(rows[0]) ?? root;
  const unsupported = (() => {
    if (typeof payload === "string") return unsupportedPattern.test(payload);
    return root ? [root.error, root.message, root.reason, root.status].some(
      (value) => typeof value === "string" && unsupportedPattern.test(value),
    ) : false;
  })();
  const read = (key: string) => root?.[key] ?? nestedData?.[key];
  const totalItems = finiteNumber(read("total_items") ?? read("total"));
  const maxPageItems = finiteNumber(read("max_page_items") ?? read("max_page_size"));
  const currentPage = finiteNumber(read("cur_page") ?? read("current_page") ?? read("page") ?? read("p"));
  return {
    classification: classification ?? (unsupported ? "UNSUPPORTED" : rows.length ? "SUCCESS" : "EMPTY"),
    httpStatus: null,
    payloadShape: payloadShape(payload),
    itemCount: rows.length,
    ...(totalItems === undefined ? {} : { totalItems }),
    ...(maxPageItems === undefined ? {} : { maxPageItems }),
    ...(currentPage === undefined ? {} : { currentPage }),
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
): Promise<BoundedResult> {
  const linked = linkedTimeoutSignal(signal);
  safeLog.info("SERIES_PROBE_REQUEST", {
    type: params.type,
    action: params.action,
    param_keys: Object.keys(params).filter((key) => key !== "type" && key !== "action").sort(),
    candidate_number: candidateNumber,
  });
  try {
    const payload = await session.request(params, linked.signal, undefined, { providerId: "r16-d2-series-probe" });
    const observation = observeStalkerSeriesPayload(payload);
    safeLog.info("SERIES_PROBE_RESPONSE", {
      http_status: observation.httpStatus,
      payload_shape: observation.payloadShape,
      item_count: observation.itemCount,
      total_items: observation.totalItems,
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

export async function probeStalkerSeriesCategories(session: StalkerIsolatedSession, signal?: AbortSignal) {
  const result = await boundedRequest(session, { type: "series", action: "get_categories" }, 1, signal);
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
      classification: result.observation.classification === "SUCCESS" && categories.length === 0 ? "EMPTY" as const : result.observation.classification,
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
      classification: result.observation.classification === "SUCCESS" && items.length === 0 ? "EMPTY" as const : result.observation.classification,
    },
  };
}

export function inspectStalkerSeriesNestedContainers(value: unknown) {
  const containers: StalkerSeriesNestedContainer[] = [];
  const seen = new Set<object>();
  const walk = (current: unknown, path: string, depth: number) => {
    if (depth > 4 || containers.length >= MAX_NESTED_CONTAINERS) return;
    if (Array.isArray(current)) {
      const rows = current.slice(0, MAX_NESTED_ROWS).map(asObject).filter((row): row is Record<string, unknown> => Boolean(row));
      if (rows.length) containers.push({ path: path || "$", rows });
      for (const [index, row] of rows.slice(0, 6).entries()) walk(row, `${path || "$"}[${index}]`, depth + 1);
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

function rowHasAny(row: Record<string, unknown>, keys: readonly string[]) {
  return keys.some((key) => textValue(row[key]) !== "");
}

function seasonIdForRow(row: Record<string, unknown>) {
  for (const key of seasonSignalKeys) {
    const value = textValue(row[key]);
    if (value) return value;
  }
  return "unassigned";
}

function rowLabel(row: Record<string, unknown>) {
  for (const key of ["title", "name", "episode", "episode_number", "episode_num", "id"]) {
    const value = textValue(row[key]);
    if (value) return redactSensitiveText(value).slice(0, 80);
  }
  return `fields: ${Object.keys(row).sort().slice(0, 5).join(", ")}`;
}

function collectHierarchyRows(payload: unknown) {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<Record<string, unknown>>();
  const append = (row: Record<string, unknown>) => {
    if (seen.has(row) || rows.length >= MAX_NESTED_ROWS) return;
    seen.add(row);
    rows.push(row);
  };
  for (const raw of rowsFromEnvelope(payload)) {
    const row = asObject(raw);
    if (row) append(row);
  }
  for (const container of inspectStalkerSeriesNestedContainers(payload)) {
    for (const row of container.rows) append(row);
  }
  return rows;
}

export function extractStalkerSeriesHierarchy(payload: unknown) {
  const rows = collectHierarchyRows(payload);
  const episodeRows = rows.filter((row) => {
    const hasCmd = typeof row.cmd === "string" && row.cmd.trim().length > 0;
    return rowHasAny(row, episodeSignalKeys) || (hasCmd && (rowHasAny(row, seasonSignalKeys) || Boolean(textValue(row.name) || textValue(row.title))));
  });
  const seasonRows = rows.filter((row) => rowHasAny(row, seasonSignalKeys));
  const seasonMap = new Map<string, Record<string, unknown>[]>();
  for (const row of [...seasonRows, ...episodeRows]) {
    const id = seasonIdForRow(row);
    const bucket = seasonMap.get(id) ?? [];
    if (!bucket.includes(row)) bucket.push(row);
    seasonMap.set(id, bucket);
  }
  const seasons: StalkerSeriesSeason[] = [...seasonMap.entries()].slice(0, MAX_NESTED_ROWS).map(([id, seasonRowsForId]) => ({
    id,
    label: id === "unassigned" ? "Season grouping unavailable" : `Season ${redactSensitiveText(id).slice(0, 40)}`,
    rows: seasonRowsForId.slice(0, MAX_NESTED_ROWS),
  }));
  const episodes: StalkerSeriesEpisode[] = episodeRows.slice(0, MAX_NESTED_ROWS).map((row, index) => ({
    id: textValue(row.episode_id) || textValue(row.id) || `episode-${index + 1}`,
    label: rowLabel(row),
    seasonId: seasonIdForRow(row),
    row,
  }));
  return { seasons, episodes };
}

function hierarchyClassification(payload: unknown, observation: StalkerSeriesProbeObservation): StalkerSeriesHierarchyClassification {
  if (observation.classification === "UNSUPPORTED") return "UNSUPPORTED";
  if (observation.classification === "ERROR") return "ERROR";
  const hierarchy = extractStalkerSeriesHierarchy(payload);
  if (hierarchy.episodes.length) return "EPISODES_FOUND";
  if (hierarchy.seasons.length) return "SEASONS_FOUND";
  if (observation.classification === "EMPTY") return "EMPTY";
  const containers = inspectStalkerSeriesNestedContainers(payload);
  if (containers.length || observation.fieldNames.length) return "SERIES_DETAIL_FOUND";
  return "EVIDENCE_REQUIRED";
}

const allowedEvidenceKeys = new Set(["movie_id", "series_id", "season_id", "episode_id", "season", "id", "p"]);

function evidenceRequestDescriptor(value: unknown): Params | null {
  const seen = new Set<object>();
  let found: Params | null = null;
  const walk = (current: unknown, depth: number) => {
    if (found || depth > 4) return;
    if (Array.isArray(current)) {
      for (const item of current.slice(0, 8)) walk(item, depth + 1);
      return;
    }
    const row = asObject(current);
    if (!row || seen.has(row)) return;
    seen.add(row);
    const type = textValue(row.type);
    const action = textValue(row.action);
    if ((type === "series" || type === "vod") && /^get_[a-z0-9_]+$/i.test(action)) {
      const descriptor: Params = { type, action };
      let safe = true;
      for (const [key, item] of Object.entries(row)) {
        if (key === "type" || key === "action") continue;
        if (!allowedEvidenceKeys.has(key)) continue;
        if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") continue;
        if (key === "p" && Number(item) !== 1) { safe = false; break; }
        descriptor[key] = item;
      }
      if (safe) found = descriptor;
    }
    for (const nested of Object.values(row)) {
      if (found) break;
      if (nested && typeof nested === "object") walk(nested, depth + 1);
    }
  };
  walk(value, 0);
  return found;
}

function paramsFingerprint(params: Params) {
  return Object.keys(params).sort().map((key) => `${key}=${String(params[key])}`).join("&");
}

function candidateRecord(candidateNumber: number, params: Params, result: BoundedResult): StalkerSeriesCandidateObservation {
  return {
    candidateNumber,
    type: textValue(params.type),
    action: textValue(params.action),
    paramKeys: Object.keys(params).filter((key) => key !== "type" && key !== "action").sort(),
    observation: result.observation,
    hierarchyClassification: hierarchyClassification(result.payload, result.observation),
    nestedContainerPaths: inspectStalkerSeriesNestedContainers(result.payload).map((item) => item.path),
  };
}

function discoveryFromPayload(
  source: StalkerSeriesDetailDiscovery["source"],
  payload: unknown,
  candidateCount: number,
  candidateNumberUsed: number | null,
  observations: StalkerSeriesCandidateObservation[],
): StalkerSeriesDetailDiscovery {
  const containers = inspectStalkerSeriesNestedContainers(payload);
  const hierarchy = extractStalkerSeriesHierarchy(payload);
  const observation = candidateNumberUsed == null ? observeStalkerSeriesPayload(payload) : observations.at(-1)?.observation ?? observeStalkerSeriesPayload(payload);
  return {
    classification: hierarchyClassification(payload, observation),
    source,
    containers,
    seasons: hierarchy.seasons,
    episodes: hierarchy.episodes,
    candidateCount,
    candidateNumberUsed,
    observations,
    payload,
  };
}

function isHierarchySuccess(classification: StalkerSeriesHierarchyClassification) {
  return classification === "SEASONS_FOUND" || classification === "EPISODES_FOUND";
}

export async function discoverStalkerSeriesDetails(
  session: StalkerIsolatedSession,
  item: StalkerSeriesProbeItem,
  signal?: AbortSignal,
): Promise<StalkerSeriesDetailDiscovery> {
  const direct = discoveryFromPayload("SELECTED_ROW", item.raw, 0, null, []);
  if (isHierarchySuccess(direct.classification)) return direct;

  // Candidate 1: stay inside the physically proven Series ordered-list family and preserve the raw provider ID byte-for-byte.
  const candidate1: Params = { type: "series", action: "get_ordered_list", movie_id: item.id, p: 1 };
  // Candidate 2: bounded diagnostic-only MAG middleware compatibility probe supplied by the R16-D2 discovery contract.
  const candidate2: Params = { type: "vod", action: "get_ordered_list", movie_id: item.id, season_id: 0, episode_id: 0, p: 1 };
  const observations: StalkerSeriesCandidateObservation[] = [];
  const payloads: unknown[] = [item.raw];
  const tried = new Set<string>();

  for (const [index, params] of [candidate1, candidate2].entries()) {
    if (signal?.aborted) break;
    const candidateNumber = index + 1;
    tried.add(paramsFingerprint(params));
    const result = await boundedRequest(session, params, candidateNumber, signal);
    payloads.push(result.payload);
    observations.push(candidateRecord(candidateNumber, params, result));
    const discovery = discoveryFromPayload(
      candidateNumber === 1 ? "CANDIDATE_1" : "CANDIDATE_2",
      result.payload,
      candidateNumber,
      candidateNumber,
      observations,
    );
    if (isHierarchySuccess(discovery.classification)) return discovery;
  }

  // Candidate 3 is never invented: it is attempted only when selected-row or earlier response metadata contains an explicit bounded get_* descriptor.
  let candidate3: Params | null = null;
  for (const payload of payloads) {
    const descriptor = evidenceRequestDescriptor(payload);
    if (descriptor && !tried.has(paramsFingerprint(descriptor))) {
      candidate3 = descriptor;
      break;
    }
  }
  if (candidate3 && observations.length < MAX_EVIDENCE_CANDIDATES && !signal?.aborted) {
    const result = await boundedRequest(session, candidate3, 3, signal);
    observations.push(candidateRecord(3, candidate3, result));
    const discovery = discoveryFromPayload("EVIDENCE_REQUEST", result.payload, 3, 3, observations);
    if (isHierarchySuccess(discovery.classification)) return discovery;
  }

  const last = observations.at(-1);
  const terminal = signal?.aborted
    ? "ERROR"
    : last?.hierarchyClassification === "UNSUPPORTED" ? "UNSUPPORTED"
    : last?.hierarchyClassification === "ERROR" ? "ERROR"
    : last?.hierarchyClassification === "EMPTY" ? "EMPTY"
    : "EVIDENCE_REQUIRED";
  return {
    classification: terminal,
    source: "NONE",
    containers: [],
    seasons: [],
    episodes: [],
    candidateCount: observations.length,
    candidateNumberUsed: null,
    observations,
  };
}

export function seriesProbeRowLabel(row: Record<string, unknown>) {
  return rowLabel(row);
}

function episodeCommand(row: Record<string, unknown>) {
  return typeof row.cmd === "string" && row.cmd.trim() ? row.cmd.trim() : "";
}

function resolvedCandidate(payload: unknown) {
  const candidates: string[] = [];
  if (typeof payload === "string") candidates.push(payload);
  const root = asObject(payload);
  if (root) {
    for (const value of Object.values(root)) if (typeof value === "string") candidates.push(value);
  }
  for (const value of candidates) {
    const wrapperPrefix = /^ffmpeg\s+/i.test(value.trim());
    const source = value.replace(/^ffmpeg\s+/i, "").trim();
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
): Promise<{ observation: StalkerSeriesCreateLinkObservation }> {
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
  const result = await boundedRequest(session, { type: "series", action: "create_link", cmd }, 1, signal);
  const resolved = resolvedCandidate(result.payload);
  const root = asObject(result.payload);
  const returnedFieldNames = root ? Object.keys(root).sort().slice(0, 32) : [];
  return {
    observation: {
      ...result.observation,
      classification: result.observation.classification === "SUCCESS" && !resolved ? "EMPTY" : result.observation.classification,
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
  maxSeasonSelections: 1,
  maxEpisodeSelections: 1,
  maxCreateLinks: 1,
  timeoutMs: PROBE_TIMEOUT_MS,
} as const;
