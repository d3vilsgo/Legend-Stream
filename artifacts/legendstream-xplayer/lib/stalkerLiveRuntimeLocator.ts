import { StalkerPortalError, type StalkerPortalRequestTiming, type StalkerPortalSession } from "./stalkerPortal";
import { stalkerDiagnosticNowMs } from "./stalkerDiagnostics";
import {
  normalizeStalkerLivePage,
  type StalkerLiveCategory,
  type StalkerLiveChannel,
} from "./stalkerLiveCatalog";
import { discoverStalkerLiveChannels } from "./stalkerLiveDiscovery";
import { fetchStalkerOrderedPage, type StalkerOrderedPage } from "./stalkerPagedCatalog";
import { isStalkerLiveGlobalCategoryId } from "./stalkerLiveCategoryIntent";
import { traceStalker } from "./stalkerPlaybackTrace";

type Portal = Pick<StalkerPortalSession, "request">;
type RuntimeChannel = Pick<StalkerLiveChannel, "portalId" | "cmd">;

export type StalkerLiveRuntimeLocator = {
  providerId: string;
  categoryId: string;
  page: number;
};

type LocatorScope = {
  epoch: number;
  providerId: string;
  locators: Map<string, StalkerLiveRuntimeLocator>;
};

export type StalkerLiveReacquireSource = "EXACT_PAGE" | "CATEGORY" | "FULL_DISCOVERY";
export type StalkerLiveReacquireResult = {
  channel: RuntimeChannel;
  source: StalkerLiveReacquireSource;
  rows: number;
};

type FullDiscover = (input: {
  session: Portal;
  providerId: string;
  categories: StalkerLiveCategory[];
  signal?: AbortSignal;
}) => Promise<{ rows: RuntimeChannel[] }>;

type ReacquireDependencies = {
  fetchOrderedPage?: typeof fetchStalkerOrderedPage;
  fullDiscover?: FullDiscover;
  resolveCategoryHint?: () => Promise<string | null>;
};

const MAX_LOCATORS_PER_SESSION = 2_000;
const scopes = new WeakMap<object, LocatorScope>();
let registryEpoch = 1;

function scopeFor(session: Portal, providerId: string, create: boolean) {
  const key = session as object;
  const current = scopes.get(key);
  if (current && current.epoch === registryEpoch && current.providerId === providerId) return current;
  if (!create) return null;
  const next: LocatorScope = { epoch: registryEpoch, providerId, locators: new Map() };
  scopes.set(key, next);
  return next;
}

export function registerStalkerLiveRuntimeLocators(
  session: Portal,
  providerId: string,
  categoryId: string,
  page: number,
  channels: readonly Pick<StalkerLiveChannel, "portalId">[],
) {
  const cleanProviderId = providerId.trim();
  const cleanCategoryId = categoryId.trim();
  const normalizedPage = Math.trunc(page);
  if (!cleanProviderId || !cleanCategoryId || normalizedPage < 1) return;
  const scope = scopeFor(session, cleanProviderId, true)!;
  for (const channel of channels) {
    const portalId = channel.portalId.trim();
    if (!portalId) continue;
    if (scope.locators.has(portalId)) scope.locators.delete(portalId);
    scope.locators.set(portalId, {
      providerId: cleanProviderId,
      categoryId: cleanCategoryId,
      page: normalizedPage,
    });
    while (scope.locators.size > MAX_LOCATORS_PER_SESSION) {
      const oldest = scope.locators.keys().next().value;
      if (typeof oldest !== "string") break;
      scope.locators.delete(oldest);
    }
  }
}

export function readStalkerLiveRuntimeLocator(
  session: Portal,
  providerId: string,
  portalId: string,
): StalkerLiveRuntimeLocator | null {
  const scope = scopeFor(session, providerId.trim(), false);
  if (!scope) return null;
  const locator = scope.locators.get(portalId.trim());
  return locator ? { ...locator } : null;
}

export function clearStalkerLiveRuntimeLocatorSession(session: Portal) {
  scopes.delete(session as object);
}

export function clearStalkerLiveRuntimeLocators() {
  registryEpoch += 1;
  if (registryEpoch > Number.MAX_SAFE_INTEGER - 1) registryEpoch = 1;
}

function assertCurrent(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new StalkerPortalError("CANCELLED", "Stalker Live playback reacquisition was cancelled.");
  }
}

function isCancelled(caught: unknown, signal?: AbortSignal) {
  return Boolean(signal?.aborted)
    || (caught instanceof StalkerPortalError && caught.code === "CANCELLED");
}

function exactTarget(rows: readonly RuntimeChannel[], portalId: string): RuntimeChannel | null {
  const matches = rows.filter((row) => row.portalId === portalId);
  if (!matches.length) return null;
  const cmd = matches[0].cmd;
  if (matches.some((row) => row.cmd !== cmd)) {
    throw new StalkerPortalError(
      "INVALID_RESPONSE",
      "Stalker Live targeted lookup contains an ambiguous channel identity.",
    );
  }
  return matches[0];
}

function normalizeOrdered(
  ordered: StalkerOrderedPage,
  providerId: string,
  categories: readonly StalkerLiveCategory[],
) {
  return normalizeStalkerLivePage(ordered.payload, providerId, ordered.page, categories);
}

export async function reacquireStalkerLiveChannel(
  options: {
    session: Portal;
    providerId: string;
    portalId: string;
    categories?: readonly StalkerLiveCategory[];
    signal?: AbortSignal;
    traceId?: string;
  },
  dependencies: ReacquireDependencies = {},
): Promise<StalkerLiveReacquireResult> {
  const { session, providerId, portalId, signal, traceId } = options;
  const categories = [...(options.categories ?? [])];
  let lookupSequence = 0;
  const diagnosticPortal = (lookupKind: "EXACT" | "CATEGORY" | "FULL") => {
    let lastSequence: number | null = null;
    const portal: Portal = traceId
      ? {
          request: async (...args: Parameters<Portal["request"]>) => {
            const [params, requestSignal, originalTiming, diagnostics] = args;
            const action = String((params as Record<string, unknown> | undefined)?.action ?? "");
            if (action !== "get_ordered_list" && action !== "get_all_channels") {
              return session.request(...args);
            }
            lookupSequence += 1;
            const lookupSeq = lookupSequence;
            lastSequence = lookupSeq;
            traceStalker("PLAYBACK_REACQUIRE_LOOKUP", { traceId });
            if (action === "get_all_channels") traceStalker("PLAYBACK_REACQUIRE_GET_ALL", { traceId });
            traceStalker("C3J_LOOKUP_START", { traceId, lookupSeq, lookupKind });
            const startedAt = stalkerDiagnosticNowMs();
            let networkMs = 0;
            let parseMs = 0;
            let timingSamples = 0;
            const timing = (sample: StalkerPortalRequestTiming) => {
              timingSamples += 1;
              networkMs += Math.max(0, sample.fetchWaitMs) + Math.max(0, sample.bodyReadWaitMs);
              parseMs += Math.max(0, sample.jsonParseMs);
              originalTiming?.(sample);
            };
            try {
              const payload = await session.request(
                params,
                requestSignal,
                timing,
                { ...(diagnostics ?? {}), playbackTraceId: traceId },
              );
              traceStalker("C3J_LOOKUP_DONE", {
                traceId,
                lookupSeq,
                lookupKind,
                lookupResult: "OK",
                durationMs: Math.max(0, stalkerDiagnosticNowMs() - startedAt),
                networkMs: timingSamples > 0 ? networkMs : undefined,
                parseMs: timingSamples > 0 ? parseMs : undefined,
                timingSamples,
              });
              return payload;
            } catch (caught) {
              const result =
                requestSignal?.aborted || (caught instanceof StalkerPortalError && caught.code === "CANCELLED")
                  ? "ABORTED"
                  : caught instanceof StalkerPortalError && caught.code === "TIMEOUT"
                    ? "TIMEOUT"
                    : caught instanceof StalkerPortalError && caught.code === "HTTP_ERROR"
                      && [400, 404, 405, 422].includes(caught.status ?? 0)
                        ? "UNSUPPORTED"
                        : "ERROR";
              traceStalker("C3J_LOOKUP_DONE", {
                traceId,
                lookupSeq,
                lookupKind,
                lookupResult: result,
                durationMs: Math.max(0, stalkerDiagnosticNowMs() - startedAt),
                networkMs: timingSamples > 0 ? networkMs : undefined,
                parseMs: timingSamples > 0 ? parseMs : undefined,
                timingSamples,
              });
              throw caught;
            }
          },
        }
      : session;
    return { portal, lastSequence: () => lastSequence };
  };
  const traceMatch = (lookupSeq: number | null, found: boolean) => {
    if (traceId && lookupSeq !== null) traceStalker("C3J_LOOKUP_MATCH", {
      traceId,
      lookupSeq,
      lookupResult: found ? "FOUND" : "MISS",
    });
  };
  const fetchOrdered = dependencies.fetchOrderedPage ?? fetchStalkerOrderedPage;
  const discover = dependencies.fullDiscover ?? discoverStalkerLiveChannels;
  const locator = readStalkerLiveRuntimeLocator(session, providerId, portalId);

  const fullDiscovery = async (): Promise<StalkerLiveReacquireResult> => {
    assertCurrent(signal);
    const diagnostic = diagnosticPortal("FULL");
    const result = await discover({ session: diagnostic.portal, providerId, categories, signal });
    assertCurrent(signal);
    const channel = exactTarget(result.rows, portalId);
    traceMatch(diagnostic.lastSequence(), Boolean(channel));
    if (!channel) throw new Error("Cached Stalker channel is no longer available from the active provider.");
    return { channel, source: "FULL_DISCOVERY", rows: result.rows.length };
  };

  const categoryHint = async (preferred?: string | null) => {
    const direct = preferred?.trim() ?? "";
    if (direct && !isStalkerLiveGlobalCategoryId(direct)) return direct;
    if (!dependencies.resolveCategoryHint) return null;
    try {
      const persisted = (await dependencies.resolveCategoryHint())?.trim() ?? "";
      return persisted && !isStalkerLiveGlobalCategoryId(persisted) ? persisted : null;
    } catch {
      return null;
    }
  };

  const categorySearch = async (
    categoryId: string,
    remembered?: { page: StalkerOrderedPage; normalized: ReturnType<typeof normalizeOrdered> },
  ): Promise<StalkerLiveReacquireResult | null> => {
    let page = 1;
    let rows = 0;
    const diagnostic = diagnosticPortal("CATEGORY");
    while (true) {
      assertCurrent(signal);
      const canReuse = Boolean(
        remembered &&
        remembered.page.categoryId === categoryId &&
        remembered.page.page === page
      );
      const ordered = canReuse
        ? remembered!.page
        : await fetchOrdered({
            session: diagnostic.portal,
            providerId,
            kind: "itv",
            categoryId,
            page,
            signal,
            diagnostics: { providerId },
          });
      assertCurrent(signal);
      const normalized = canReuse
        ? remembered!.normalized
        : normalizeOrdered(ordered, providerId, categories);
      rows += normalized.rawCount;
      const found = exactTarget(normalized.items, portalId);
      if (!canReuse) traceMatch(diagnostic.lastSequence(), Boolean(found));
      if (found) {
        registerStalkerLiveRuntimeLocators(session, providerId, categoryId, page, [found]);
        return { channel: found, source: "CATEGORY", rows };
      }
      if (!ordered.hasMore) return null;
      page += 1;
    }
  };

  const boundedFallback = async (
    preferredCategoryId?: string | null,
    remembered?: { page: StalkerOrderedPage; normalized: ReturnType<typeof normalizeOrdered> },
  ) => {
    const categoryId = await categoryHint(preferredCategoryId);
    if (!categoryId) return null;
    try {
      return await categorySearch(categoryId, remembered);
    } catch (caught) {
      if (isCancelled(caught, signal)) throw caught;
      return null;
    }
  };

  if (!locator) {
    const bounded = await boundedFallback();
    return bounded ?? fullDiscovery();
  }

  const exactDiagnostic = diagnosticPortal("EXACT");
  let remembered: StalkerOrderedPage;
  try {
    assertCurrent(signal);
    remembered = await fetchOrdered({
      session: exactDiagnostic.portal,
      providerId,
      kind: "itv",
      categoryId: locator.categoryId,
      page: locator.page,
      signal,
      diagnostics: { providerId },
    });
    assertCurrent(signal);
  } catch (caught) {
    if (isCancelled(caught, signal)) throw caught;
    const bounded = await boundedFallback(locator.categoryId);
    return bounded ?? fullDiscovery();
  }

  const rememberedNormalized = normalizeOrdered(remembered, providerId, categories);
  const exact = exactTarget(rememberedNormalized.items, portalId);
  traceMatch(exactDiagnostic.lastSequence(), Boolean(exact));
  if (exact) return { channel: exact, source: "EXACT_PAGE", rows: rememberedNormalized.rawCount };

  const bounded = await boundedFallback(
    locator.categoryId,
    { page: remembered, normalized: rememberedNormalized },
  );
  return bounded ?? fullDiscovery();
}
