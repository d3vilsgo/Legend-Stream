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
  syncRunId?: string;
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
  "providerId" | "syncRunId" | "categories" | "signal" | "isCurrent" | "yieldFn" | "nowFn"
> & {
  payload: unknown;
  networkWaitMs: number;
  responseParseMs?: number;
  postBodyYieldStartMs?: number;
  postBodyYieldMs?: number;
};

type AggregateShape = {
  rowCount: number;
  advertisedTotal: number | null;
  hasPaginationMetadata: boolean;
  hasMaxPageItems: boolean;
  hasPageLikeMetadata: boolean;
  hasCurrentPageLikeMetadata: boolean;
  hasCurPageMetadata: boolean;
  rawVsAdvertisedRelation: "EQUAL" | "RAW_LT_ADVERTISED" | "RAW_GT_ADVERTISED" | "NO_TOTAL";
};

export type StalkerDuplicateClass =
  | "DUPLICATE_SAME_COMMAND_SAME_METADATA"
  | "DUPLICATE_SAME_COMMAND_CATEGORY_VARIANT"
  | "DUPLICATE_SAME_COMMAND_METADATA_VARIANT"
  | "DUPLICATE_DIFFERENT_COMMAND";

type DuplicateCounters = {
  duplicateCount: number;
  duplicateSameCommandCount: number;
  duplicateDifferentCommandCount: number;
  duplicateDifferentCategoryCount: number;
  duplicateDifferentMetadataCount: number;
};

function hasAnyMetadata(payload: unknown, keys: readonly string[]) {
  const { root, nested } = metadataObjects(payload);
  return [root, nested].some((row) => row && keys.some((key) => row[key] !== undefined && row[key] !== null));
}

function aggregateShape(payload: unknown, rowCount: number, advertisedTotal: number | null): AggregateShape {
  const hasMaxPageItems = hasAnyMetadata(payload, ["max_page_items", "max_page_size"]);
  const hasPageLikeMetadata = hasAnyMetadata(payload, ["page", "p", "total_pages", "pages"]);
  const hasCurrentPageLikeMetadata = hasAnyMetadata(payload, ["current_page"]);
  const hasCurPageMetadata = hasAnyMetadata(payload, ["cur_page"]);
  const rawVsAdvertisedRelation = advertisedTotal === null
    ? "NO_TOTAL"
    : rowCount === advertisedTotal
      ? "EQUAL"
      : rowCount < advertisedTotal
        ? "RAW_LT_ADVERTISED"
        : "RAW_GT_ADVERTISED";
  return {
    rowCount,
    advertisedTotal,
    hasPaginationMetadata: hasExplicitPaginationMetadata(payload),
    hasMaxPageItems,
    hasPageLikeMetadata,
    hasCurrentPageLikeMetadata,
    hasCurPageMetadata,
    rawVsAdvertisedRelation,
  };
}

export function classifyStalkerAggregateDuplicate(
  first: StalkerLiveChannel,
  duplicate: StalkerLiveChannel,
): { duplicateClass: StalkerDuplicateClass } & DuplicateCounters {
  const sameCommand = first.cmd === duplicate.cmd;
  const sameCategory = first.categoryId === duplicate.categoryId;
  const sameName = first.name === duplicate.name;
  const sameLogo = (first.logoUrl ?? "") === (duplicate.logoUrl ?? "");
  const sameTvgId = (first.tvgId ?? "") === (duplicate.tvgId ?? "");
  const differentMetadata = !sameName || !sameLogo || !sameTvgId;
  const duplicateClass: StalkerDuplicateClass = !sameCommand
    ? "DUPLICATE_DIFFERENT_COMMAND"
    : !sameCategory
      ? "DUPLICATE_SAME_COMMAND_CATEGORY_VARIANT"
      : differentMetadata
        ? "DUPLICATE_SAME_COMMAND_METADATA_VARIANT"
        : "DUPLICATE_SAME_COMMAND_SAME_METADATA";

  return {
    duplicateClass,
    duplicateCount: 1,
    duplicateSameCommandCount: sameCommand ? 1 : 0,
    duplicateDifferentCommandCount: sameCommand ? 0 : 1,
    duplicateDifferentCategoryCount: sameCategory ? 0 : 1,
    duplicateDifferentMetadataCount: differentMetadata ? 1 : 0,
  };
}

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
  const shape = aggregateShape(value, rawRows.length, totalItems);
  safeLog.info("LS_STALKER_GET_ALL_SHAPE", {
    syncRunId: options.syncRunId,
    providerId: options.providerId,
    ...shape,
  });
  const rows: StalkerLiveChannel[] = [];
  const seen = new Map<string, StalkerLiveChannel>();
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
      const firstSeen = seen.get(row.portalId);
      if (firstSeen) {
        const duplicate = classifyStalkerAggregateDuplicate(firstSeen, row);
        safeLog.info("LS_STALKER_AGGREGATE_DUPLICATE_SUMMARY", {
          syncRunId: options.syncRunId,
          providerId: options.providerId,
          rawRowCount: rawRows.length,
          uniqueBeforeFailure: rows.length,
          duplicateCount: duplicate.duplicateCount,
          duplicateSameCommandCount: duplicate.duplicateSameCommandCount,
          duplicateDifferentCommandCount: duplicate.duplicateDifferentCommandCount,
          duplicateDifferentCategoryCount: duplicate.duplicateDifferentCategoryCount,
          duplicateDifferentMetadataCount: duplicate.duplicateDifferentMetadataCount,
          firstDuplicateRowIndex: offset + page.items.indexOf(row),
          firstDuplicateChunkIndex: Math.trunc(offset / STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE),
          firstDuplicateClass: duplicate.duplicateClass,
        });
        safeLog.info("LS_STALKER_FALLBACK_DECISION", {
          syncRunId: options.syncRunId,
          providerId: options.providerId,
          decision: "FATAL",
          reason: "DUPLICATE_PORTAL_ID",
        });
        throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live aggregate returned a duplicate stable channel identifier.");
      }
      seen.set(row.portalId, row);
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
    if (totalItems > rows.length) {
      safeLog.info("LS_STALKER_FALLBACK_DECISION", {
        syncRunId: options.syncRunId,
        providerId: options.providerId,
        decision: "FALLBACK_ORDERED",
        reason: "RAW_LT_ADVERTISED",
      });
      return { kind: "fallback" };
    }
    if (totalItems < rows.length) {
      safeLog.info("LS_STALKER_FALLBACK_DECISION", {
        syncRunId: options.syncRunId,
        providerId: options.providerId,
        decision: "FATAL",
        reason: "RAW_GT_ADVERTISED",
      });
      throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live aggregate contains more unique rows than its advertised total.");
    }
    safeLog.info("LS_STALKER_FALLBACK_DECISION", {
      syncRunId: options.syncRunId,
      providerId: options.providerId,
      decision: "USE_AGGREGATE",
      reason: "COMPLETE_TOTAL",
    });
    return { kind: "complete", rows, totalItems };
  }

  if (hasExplicitPaginationMetadata(value)) {
    safeLog.info("LS_STALKER_FALLBACK_DECISION", {
      syncRunId: options.syncRunId,
      providerId: options.providerId,
      decision: "FATAL",
      reason: "PAGINATION_METADATA_WITHOUT_TOTAL",
    });
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live aggregate response contains partial pagination metadata without a total.");
  }

  safeLog.info("LS_STALKER_FALLBACK_DECISION", {
    syncRunId: options.syncRunId,
    providerId: options.providerId,
    decision: "USE_AGGREGATE",
    reason: "NO_TOTAL_NON_EMPTY",
  });
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
  safeLog.info("LS_STALKER_DISCOVERY_GET_ALL_START", {
    syncRunId: options.syncRunId,
    providerId: options.providerId,
    timestamp: requestStartedAt,
  });
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
  const value = unwrapKnownJs(aggregatePayload);
  const rawRows = rowsFromAggregate(value);
  if (rawRows) {
    const totalItems = readAdvertisedTotal(value);
    const shape = aggregateShape(value, rawRows.length, totalItems);
    safeLog.info("LS_STALKER_DISCOVERY_GET_ALL_DONE", {
      syncRunId: options.syncRunId,
      providerId: options.providerId,
      rowCount: shape.rowCount,
      advertisedTotal: shape.advertisedTotal,
      networkWaitMs,
      responseParseMs: measuredTiming?.jsonParseMs ?? 0,
      hasPaginationMetadata: shape.hasPaginationMetadata,
      hasCurPageMetadata: shape.hasCurPageMetadata,
    });
  }

  const aggregate = await normalizeStalkerLiveAggregateCooperatively({
    payload: aggregatePayload,
    providerId: options.providerId,
    syncRunId: options.syncRunId,
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
