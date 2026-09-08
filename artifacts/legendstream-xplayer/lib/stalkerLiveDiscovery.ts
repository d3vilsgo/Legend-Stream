import { yieldToUi } from "./cooperative";
import { safeLog } from "./safeLog";
import { StalkerPortalError, type StalkerPortalRequestTiming, type StalkerPortalSession } from "./stalkerPortal";
import {
  normalizeStalkerLivePage,
  traverseStalkerLivePages,
  type StalkerLiveCategory,
  type StalkerLiveChannel,
} from "./stalkerLiveCatalog";

type Portal = Pick<StalkerPortalSession, "request">;

export type StalkerLiveDiscoverySource = "get_all_channels" | "get_ordered_list";

export type StalkerLiveDiscoveryResult = {
  source: StalkerLiveDiscoverySource;
  rows: StalkerLiveChannel[];
  totalItems: number | null;
  pagesFetched: number;
  complete: true;
};

export type StalkerLiveDiscoveryOptions = {
  session: Portal;
  providerId: string;
  categories?: readonly StalkerLiveCategory[];
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  yieldFn?: () => void | Promise<void>;
  maxPages?: number;
  nowFn?: () => number;
};

export const STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE = 250;

const EXPLICIT_UNSUPPORTED_PATTERNS = [
  /\bunknown\s+(?:action|method|command)\b/i,
  /\bunsupported\s+(?:action|method|command)\b/i,
  /\b(?:action|method|command)\s+(?:is\s+)?(?:unknown|unsupported)\b/i,
  /\bnot\s+implemented\b/i,
] as const;

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

function unwrapKnownJs(payload: unknown) {
  const root = asObject(payload);
  return root && "js" in root ? root.js : payload;
}

function rowsFromAggregate(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  const root = asObject(payload);
  if (!root) return null;
  for (const key of ["data", "items", "channels"] as const) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  const nested = asObject(root.data);
  if (nested) {
    for (const key of ["data", "items", "channels"] as const) {
      if (Array.isArray(nested[key])) return nested[key] as unknown[];
    }
  }
  return null;
}

function textLooksExplicitlyUnsupported(value: unknown) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return Boolean(text) && EXPLICIT_UNSUPPORTED_PATTERNS.some((pattern) => pattern.test(text));
}

function payloadLooksExplicitlyUnsupported(payload: unknown) {
  const value = unwrapKnownJs(payload);
  if (textLooksExplicitlyUnsupported(value)) return true;
  const row = asObject(value);
  if (!row) return false;
  return [row.error, row.message, row.reason].some(textLooksExplicitlyUnsupported);
}

function isExplicitUnsupportedHttp(caught: unknown) {
  return caught instanceof StalkerPortalError &&
    caught.code === "HTTP_ERROR" &&
    (caught.status === 404 || caught.status === 405);
}

function metadataObjects(payload: unknown) {
  const value = unwrapKnownJs(payload);
  const root = asObject(value);
  const nested = asObject(root?.data);
  return { value, root, nested };
}

function parseNonNegativeInteger(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || !Number.isInteger(number)) {
    throw new StalkerPortalError("INVALID_RESPONSE", `Stalker Live ${label} metadata is invalid.`);
  }
  return number;
}

function readAdvertisedTotal(payload: unknown) {
  const { root, nested } = metadataObjects(payload);
  const values: number[] = [];
  for (const row of [root, nested]) {
    if (!row) continue;
    for (const key of ["total_items", "total"] as const) {
      if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
        values.push(parseNonNegativeInteger(row[key], key));
      }
    }
  }
  if (values.length === 0) return null;
  const first = values[0];
  if (values.some((value) => value !== first)) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live aggregate totals are inconsistent.");
  }
  return first;
}

function hasExplicitPaginationMetadata(payload: unknown) {
  const { root, nested } = metadataObjects(payload);
  const keys = [
    "max_page_items",
    "max_page_size",
    "page",
    "p",
    "current_page",
    "total_pages",
    "pages",
  ] as const;
  return [root, nested].some((row) => row && keys.some((key) => row[key] !== undefined && row[key] !== null));
}

function assertCurrent(signal?: AbortSignal, isCurrent?: () => boolean) {
  if (signal?.aborted || (isCurrent && !isCurrent())) {
    throw new StalkerPortalError("CANCELLED", "Stalker portal request was cancelled.");
  }
}

type AggregateDecision =
  | { kind: "complete"; rows: StalkerLiveChannel[]; totalItems: number | null }
  | { kind: "fallback" };

type AggregateNormalizeOptions = Pick<StalkerLiveDiscoveryOptions,
  "providerId" | "categories" | "signal" | "isCurrent" | "yieldFn" | "nowFn"
> & {
  payload: unknown;
  networkWaitMs: number;
  responseParseMs?: number;
  postBodyYieldStartMs?: number;
  postBodyYieldMs?: number;
};

export async function normalizeStalkerLiveAggregateCooperatively(
  options: AggregateNormalizeOptions,
): Promise<AggregateDecision> {
  const now = options.nowFn ?? Date.now;
  const yieldFn = options.yieldFn ?? yieldToUi;
  const value = unwrapKnownJs(options.payload);
  if (payloadLooksExplicitlyUnsupported(value)) return { kind: "fallback" };
  const rawRows = rowsFromAggregate(value);
  if (!rawRows) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live page has an invalid shape.");
  }

  const totalItems = readAdvertisedTotal(value);
  const rows: StalkerLiveChannel[] = [];
  const seen = new Set<string>();
  let normalizeMs = 0;
  let dedupeMs = 0;
  let yieldCount = 0;
  let firstNormalizeYieldAfterParseMs: number | null = null;
  const cpuStartedAt = now();

  for (let offset = 0; offset < rawRows.length; offset += STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE) {
    assertCurrent(options.signal, options.isCurrent);
    const rawChunk = rawRows.slice(offset, offset + STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE);

    const normalizeStartedAt = now();
    const page = normalizeStalkerLivePage(
      { data: rawChunk },
      options.providerId,
      1,
      options.categories ?? [],
    );
    normalizeMs += Math.max(0, now() - normalizeStartedAt);

    const dedupeStartedAt = now();
    for (const row of page.items) {
      if (seen.has(row.portalId)) {
        throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live aggregate returned a duplicate stable channel identifier.");
      }
      seen.add(row.portalId);
      rows.push(row);
    }
    dedupeMs += Math.max(0, now() - dedupeStartedAt);

    assertCurrent(options.signal, options.isCurrent);
    await yieldFn();
    yieldCount += 1;
    if (firstNormalizeYieldAfterParseMs === null) {
      firstNormalizeYieldAfterParseMs = Math.max(0, now() - cpuStartedAt);
    }
    assertCurrent(options.signal, options.isCurrent);
  }

  safeLog.info("LS_STALKER_AGGREGATE_CPU", {
    rowCount: rawRows.length,
    networkWaitMs: Math.max(0, options.networkWaitMs),
    responseParseMs: Math.max(0, options.responseParseMs ?? 0),
    postBodyYieldStartMs: Math.max(0, options.postBodyYieldStartMs ?? 0),
    postBodyYieldMs: Math.max(0, options.postBodyYieldMs ?? 0),
    normalizeMs,
    dedupeMs,
    firstNormalizeYieldAfterParseMs: firstNormalizeYieldAfterParseMs ?? 0,
    yieldCount,
    chunkSize: STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE,
  });

  if (rows.length === 0) {
    if (totalItems === 0) {
      throw new StalkerPortalError("INVALID_RESPONSE", "The Stalker Portal explicitly reports no live channels.");
    }
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live aggregate response is empty without completeness evidence.");
  }

  if (totalItems !== null) {
    if (totalItems > rows.length) return { kind: "fallback" };
    if (totalItems < rows.length) {
      throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live aggregate contains more unique rows than its advertised total.");
    }
    return { kind: "complete", rows, totalItems };
  }

  if (hasExplicitPaginationMetadata(value)) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live aggregate response contains partial pagination metadata without a total.");
  }

  return { kind: "complete", rows, totalItems: null };
}

async function discoverViaOrderedList(options: StalkerLiveDiscoveryOptions): Promise<StalkerLiveDiscoveryResult> {
  const rows: StalkerLiveChannel[] = [];
  const result = await traverseStalkerLivePages({
    session: options.session,
    providerId: options.providerId,
    categories: options.categories,
    signal: options.signal,
    isCurrent: options.isCurrent,
    yieldFn: options.yieldFn,
    maxPages: options.maxPages,
    persistPage: async (_projected, page) => {
      rows.push(...page.items);
    },
  });

  if (result.uniqueItems === 0) {
    throw new StalkerPortalError("INVALID_RESPONSE", "The Stalker Portal returned no live channels.");
  }
  if (rows.length !== result.uniqueItems) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live ordered traversal cardinality is inconsistent.");
  }
  if (result.totalItems !== null && result.uniqueItems !== result.totalItems) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live ordered traversal did not exactly satisfy total_items.");
  }

  return {
    source: "get_ordered_list",
    rows,
    totalItems: result.totalItems,
    pagesFetched: result.pagesFetched,
    complete: true,
  };
}

export async function discoverStalkerLiveChannels(
  options: StalkerLiveDiscoveryOptions,
): Promise<StalkerLiveDiscoveryResult> {
  const now = options.nowFn ?? Date.now;
  let aggregatePayload: unknown;
  const timingHolder: { current?: StalkerPortalRequestTiming } = {};
  const requestStartedAt = now();
  try {
    aggregatePayload = await options.session.request(
      { type: "itv", action: "get_all_channels" },
      options.signal,
      (timing) => { timingHolder.current = timing; },
    );
  } catch (caught) {
    if (isExplicitUnsupportedHttp(caught)) {
      return discoverViaOrderedList(options);
    }
    throw caught;
  }
  const requestRoundTripMs = Math.max(0, now() - requestStartedAt);
  const measuredTiming = timingHolder.current;
  const networkWaitMs = measuredTiming
    ? measuredTiming.fetchWaitMs + measuredTiming.bodyReadWaitMs
    : requestRoundTripMs;

  const aggregate = await normalizeStalkerLiveAggregateCooperatively({
    payload: aggregatePayload,
    providerId: options.providerId,
    categories: options.categories ?? [],
    signal: options.signal,
    isCurrent: options.isCurrent,
    yieldFn: options.yieldFn,
    nowFn: options.nowFn,
    networkWaitMs,
    responseParseMs: measuredTiming?.jsonParseMs ?? 0,
    postBodyYieldStartMs: measuredTiming?.postBodyYieldStartMs ?? 0,
    postBodyYieldMs: measuredTiming?.postBodyYieldMs ?? 0,
  });
  if (aggregate.kind === "fallback") {
    return discoverViaOrderedList(options);
  }

  return {
    source: "get_all_channels",
    rows: aggregate.rows,
    totalItems: aggregate.totalItems,
    pagesFetched: 1,
    complete: true,
  };
}
