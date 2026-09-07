import { StalkerPortalError, type StalkerPortalSession } from "./stalkerPortal";
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
};

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

function assertUniqueAggregateRows(rows: readonly StalkerLiveChannel[]) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.portalId)) {
      throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live aggregate returned a duplicate stable channel identifier.");
    }
    seen.add(row.portalId);
  }
}

type AggregateDecision =
  | { kind: "complete"; rows: StalkerLiveChannel[]; totalItems: number | null }
  | { kind: "fallback" };

function normalizeAggregate(
  payload: unknown,
  providerId: string,
  categories: readonly StalkerLiveCategory[],
): AggregateDecision {
  const value = unwrapKnownJs(payload);
  if (payloadLooksExplicitlyUnsupported(value)) return { kind: "fallback" };

  const page = normalizeStalkerLivePage(value, providerId, 1, categories);
  assertUniqueAggregateRows(page.items);
  const totalItems = readAdvertisedTotal(value);

  if (page.items.length === 0) {
    if (totalItems === 0) {
      throw new StalkerPortalError("INVALID_RESPONSE", "The Stalker Portal explicitly reports no live channels.");
    }
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live aggregate response is empty without completeness evidence.");
  }

  if (totalItems !== null) {
    if (totalItems > page.items.length) return { kind: "fallback" };
    if (totalItems < page.items.length) {
      throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live aggregate contains more unique rows than its advertised total.");
    }
    return { kind: "complete", rows: page.items, totalItems };
  }

  if (hasExplicitPaginationMetadata(value)) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live aggregate response contains partial pagination metadata without a total.");
  }

  return { kind: "complete", rows: page.items, totalItems: null };
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
  let aggregatePayload: unknown;
  try {
    aggregatePayload = await options.session.request(
      { type: "itv", action: "get_all_channels" },
      options.signal,
    );
  } catch (caught) {
    if (isExplicitUnsupportedHttp(caught)) {
      return discoverViaOrderedList(options);
    }
    throw caught;
  }

  const aggregate = normalizeAggregate(
    aggregatePayload,
    options.providerId,
    options.categories ?? [],
  );
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
