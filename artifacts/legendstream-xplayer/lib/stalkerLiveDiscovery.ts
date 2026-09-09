import { yieldToUi } from "./cooperative";
import { safeLog } from "./safeLog";
import { StalkerPortalError, type StalkerPortalRequestTiming, type StalkerPortalSession } from "./stalkerPortal";
import {
  MAX_STALKER_LIVE_PAGES,
  normalizeStalkerLivePage,
  normalizedStalkerLivePageCeiling,
  stalkerLivePageCeilingExceeded,
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

function hasAnyMetadata(payload: unknown, keys: readonly string[]) {
  const { root, nested } = metadataObjects(payload);
  return [root, nested].some((row) => row && keys.some((key) => row[key] !== undefined && row[key] !== null));
}

function hasExplicitPaginationMetadata(payload: unknown) {
  return hasAnyMetadata(payload, [
    "max_page_items",
    "max_page_size",
    "page",
    "p",
    "cur_page",
    "current_page",
    "total_pages",
    "pages",
  ]);
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

function logAggregateFallback(options: AggregateNormalizeOptions, reason: string) {
  safeLog.info("LS_STALKER_FALLBACK_DECISION", {
    syncRunId: options.syncRunId,
    providerId: options.providerId,
    decision: "FALLBACK_ORDERED",
    reason,
  });
}

export async function normalizeStalkerLiveAggregateCooperatively(
  options: AggregateNormalizeOptions,
): Promise<AggregateDecision> {
  const now = options.nowFn ?? Date.now;
  const yieldFn = options.yieldFn ?? yieldToUi;
  const value = unwrapKnownJs(options.payload);
  if (payloadLooksExplicitlyUnsupported(value)) {
    logAggregateFallback(options, "AGGREGATE_UNSUPPORTED");
    return { kind: "fallback" };
  }
  const rawRows = rowsFromAggregate(value);
  if (!rawRows) {
    logAggregateFallback(options, "AGGREGATE_STRUCTURALLY_UNUSABLE");
    return { kind: "fallback" };
  }

  let totalItems: number | null;
  try {
    totalItems = readAdvertisedTotal(value);
  } catch (caught) {
    if (caught instanceof StalkerPortalError && caught.code === "INVALID_RESPONSE") {
      logAggregateFallback(options, "AGGREGATE_METADATA_INVALID");
      return { kind: "fallback" };
    }
    throw caught;
  }

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
    let page;
    try {
      page = normalizeStalkerLivePage(
        { data: rawChunk },
        options.providerId,
        1,
        options.categories ?? [],
      );
    } catch (caught) {
      if (caught instanceof StalkerPortalError && caught.code === "INVALID_RESPONSE") {
        logAggregateFallback(options, "AGGREGATE_STRUCTURALLY_UNUSABLE");
        return { kind: "fallback" };
      }
      throw caught;
    }
    normalizeMs += Math.max(0, now() - normalizeStartedAt);

    const dedupeStartedAt = now();
    for (let index = 0; index < page.items.length; index += 1) {
      const row = page.items[index];
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
          firstDuplicateRowIndex: offset + index,
          firstDuplicateChunkIndex: Math.trunc(offset / STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE),
          firstDuplicateClass: duplicate.duplicateClass,
        });
        logAggregateFallback(options, "DUPLICATE_PORTAL_ID");
        return { kind: "fallback" };
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
    logAggregateFallback(options, "AGGREGATE_EMPTY");
    return { kind: "fallback" };
  }

  if (totalItems !== null && totalItems !== rows.length) {
    logAggregateFallback(options, totalItems > rows.length ? "RAW_LT_ADVERTISED" : "RAW_GT_ADVERTISED");
    return { kind: "fallback" };
  }

  if (totalItems === null && shape.hasPaginationMetadata) {
    logAggregateFallback(options, "AGGREGATE_PAGINATION_METADATA_WITHOUT_TOTAL");
    return { kind: "fallback" };
  }

  safeLog.info("LS_STALKER_FALLBACK_DECISION", {
    syncRunId: options.syncRunId,
    providerId: options.providerId,
    decision: "USE_AGGREGATE",
    reason: totalItems === null ? "NO_TOTAL_NON_EMPTY" : "COMPLETE_TOTAL",
  });
  return { kind: "complete", rows, totalItems };
}

function canonicalizeGenreChannel(
  channel: StalkerLiveChannel,
  category: StalkerLiveCategory,
): StalkerLiveChannel {
  if (channel.categoryId !== "0") return channel;
  return {
    ...channel,
    categoryId: category.id,
    categoryName: category.name,
  };
}

async function discoverViaGenreScopedOrderedList(
  options: StalkerLiveDiscoveryOptions,
  categories: readonly StalkerLiveCategory[],
): Promise<StalkerLiveDiscoveryResult> {
  const allUsableCategories = categories.filter((category) => category.id.trim());
  const concreteCategories = allUsableCategories.filter((category) => category.id.trim() !== "*");
  const usableCategories = concreteCategories.length > 0 ? concreteCategories : allUsableCategories;
  if (usableCategories.length === 0) {
    return discoverViaLegacyOrderedList(options);
  }

  const yieldFn = options.yieldFn ?? yieldToUi;
  const maxPages = normalizedStalkerLivePageCeiling(options.maxPages ?? MAX_STALKER_LIVE_PAGES);
  const canonical = new Map<string, StalkerLiveChannel>();
  let pagesFetched = 0;
  let sameCommandDuplicateCount = 0;
  let differentCommandAmbiguityCount = 0;

  safeLog.info("LS_STALKER_ORDERED_FALLBACK_START", {
    syncRunId: options.syncRunId,
    providerId: options.providerId,
    genreCount: usableCategories.length,
    maxPages,
  });

  for (let genreIndex = 0; genreIndex < usableCategories.length; genreIndex += 1) {
    const category = usableCategories[genreIndex];
    const fingerprints = new Set<string>();
    let pageNumber = 1;
    let totalItems: number | null = null;
    let maxPageItems: number | null = null;
    let acceptedWithinGenre = 0;

    while (true) {
      assertCurrent(options.signal, options.isCurrent);
      if (stalkerLivePageCeilingExceeded(pageNumber, maxPages) || pagesFetched >= maxPages) {
        throw new StalkerPortalError(
          "INVALID_RESPONSE",
          "Stalker Live genre pagination exceeded the safety ceiling without terminal evidence.",
        );
      }

      const payload = await options.session.request(
        { type: "itv", action: "get_ordered_list", genre: category.id, p: pageNumber },
        options.signal,
        undefined,
        { syncRunId: options.syncRunId, providerId: options.providerId },
      );
      pagesFetched += 1;
      assertCurrent(options.signal, options.isCurrent);

      const page = normalizeStalkerLivePage(
        payload,
        options.providerId,
        pageNumber,
        categories,
      );
      if (page.totalItems !== null) totalItems = page.totalItems;
      if (page.maxPageItems !== null) maxPageItems = page.maxPageItems;

      safeLog.info("LS_STALKER_ORDERED_GENRE_PAGE", {
        syncRunId: options.syncRunId,
        providerId: options.providerId,
        genreIndex,
        page: pageNumber,
        rawCount: page.rawCount,
        totalItems: page.totalItems,
        maxPageItems: page.maxPageItems,
      });

      if (page.rawCount === 0) break;

      const fingerprint = page.items
        .map((item) => `${item.portalId}\u001e${item.cmd}`)
        .join("\u001f");
      if (!fingerprint || fingerprints.has(fingerprint)) {
        throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live genre traversal returned a repeated or no-progress page.");
      }
      fingerprints.add(fingerprint);

      let newCanonicalThisPage = 0;
      for (const rawChannel of page.items) {
        const channel = canonicalizeGenreChannel(rawChannel, category);
        const first = canonical.get(channel.portalId);
        if (!first) {
          canonical.set(channel.portalId, channel);
          acceptedWithinGenre += 1;
          newCanonicalThisPage += 1;
          continue;
        }
        if (first.cmd !== channel.cmd) {
          differentCommandAmbiguityCount += 1;
          safeLog.info("LS_STALKER_ORDERED_DUPLICATE_SUMMARY", {
            syncRunId: options.syncRunId,
            providerId: options.providerId,
            sameCommandDuplicateCount,
            differentCommandAmbiguityCount,
          });
          throw new StalkerPortalError(
            "INVALID_RESPONSE",
            "Stalker Live ordered discovery found ambiguous playback commands for one stable channel identifier.",
          );
        }
        sameCommandDuplicateCount += 1;
      }

      if (newCanonicalThisPage === 0 && page.rawCount > 0) {
        const allKnownSameCommand = page.items.every((rawChannel) => {
          const channel = canonicalizeGenreChannel(rawChannel, category);
          const first = canonical.get(channel.portalId);
          return first?.cmd === channel.cmd;
        });
        if (!allKnownSameCommand) {
          throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live genre traversal made no canonical progress.");
        }
      }

      await yieldFn();
      assertCurrent(options.signal, options.isCurrent);

      if (totalItems !== null && maxPageItems !== null) {
        const totalPages = Math.max(1, Math.ceil(totalItems / maxPageItems));
        if (pageNumber >= totalPages) break;
      } else if (totalItems !== null && acceptedWithinGenre >= totalItems) {
        break;
      } else if (maxPageItems !== null && page.rawCount < maxPageItems) {
        break;
      }
      pageNumber += 1;
    }
  }

  const rows = [...canonical.values()];
  if (rows.length === 0) {
    throw new StalkerPortalError("INVALID_RESPONSE", "The Stalker Portal returned no live channels.");
  }

  safeLog.info("LS_STALKER_ORDERED_DUPLICATE_SUMMARY", {
    syncRunId: options.syncRunId,
    providerId: options.providerId,
    sameCommandDuplicateCount,
    differentCommandAmbiguityCount,
  });
  safeLog.info("LS_STALKER_DISCOVERY_COMPLETE", {
    syncRunId: options.syncRunId,
    providerId: options.providerId,
    source: "get_ordered_list",
    genreCount: usableCategories.length,
    pagesFetched,
    uniqueItems: rows.length,
  });

  return {
    source: "get_ordered_list",
    rows,
    totalItems: rows.length,
    pagesFetched,
    complete: true,
  };
}

async function discoverViaLegacyOrderedList(options: StalkerLiveDiscoveryOptions): Promise<StalkerLiveDiscoveryResult> {
  const rows: StalkerLiveChannel[] = [];
  const result = await traverseStalkerLivePages({
    session: options.session,
    providerId: options.providerId,
    syncRunId: options.syncRunId,
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

async function discoverViaOrderedList(options: StalkerLiveDiscoveryOptions): Promise<StalkerLiveDiscoveryResult> {
  return discoverViaGenreScopedOrderedList(options, options.categories ?? []);
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
      { syncRunId: options.syncRunId, providerId: options.providerId },
    );
  } catch (caught) {
    if (isExplicitUnsupportedHttp(caught)) {
      safeLog.info("LS_STALKER_FALLBACK_DECISION", {
        syncRunId: options.syncRunId,
        providerId: options.providerId,
        decision: "FALLBACK_ORDERED",
        reason: "AGGREGATE_HTTP_UNSUPPORTED",
      });
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
    let totalItems: number | null = null;
    try {
      totalItems = readAdvertisedTotal(value);
    } catch {
      totalItems = null;
    }
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

  safeLog.info("LS_STALKER_DISCOVERY_COMPLETE", {
    syncRunId: options.syncRunId,
    providerId: options.providerId,
    source: "get_all_channels",
    genreCount: options.categories?.length ?? 0,
    pagesFetched: 1,
    uniqueItems: aggregate.rows.length,
  });

  return {
    source: "get_all_channels",
    rows: aggregate.rows,
    totalItems: aggregate.totalItems,
    pagesFetched: 1,
    complete: true,
  };
}
