import {
  deleteProviderCatalog,
  getCachedPersistedItems,
  getCatalogCounts,
  getCatalogSyncState,
  initCatalogCache,
  pruneCatalogKind,
  replaceCatalogCategories,
  setCatalogSyncState,
  upsertCatalogItems,
} from "./catalogCache";
import {
  installM3UCatalog,
  type Channel,
  type Provider,
  type ProviderLoadResult,
} from "./iptv";
import { hasUsableM3UCacheSnapshot } from "./m3uCacheAvailability";
import { parseM3UProviderSource } from "./m3uCatalogRefs";
import {
  projectCatalogItems,
  type PersistedLiveCatalogItem,
  type PersistedSeriesCatalogItem,
  type PersistedVodCatalogItem,
} from "./catalogPersistence";
import { buildM3UDirectHydration } from "./m3uCatalogHydration";
import {
  buildM3UCacheWriteProjection,
  m3uCacheCandidateCount,
} from "./m3uCacheWriteProjection";
import {
  emptyM3UCacheCounts,
  emptyM3URefRejectionCounts,
  emptyM3UValidationScan,
  type M3UCacheCounts,
  type M3UCacheSyncPhase,
  type M3UCacheValidationScan,
  type M3UCacheWriteOutcome,
  type M3UCleanupOutcome,
  type M3UCleanupStage,
  type M3URefRejectionCounts,
} from "./m3uCacheWriteMeasurement";
import {
  noteM3UCacheHydration,
  noteM3UCacheWriteResult,
  noteM3UCacheWriteStarted,
  noteM3UNetworkCatalogCounts,
} from "./m3uSwitchMetrics";
import { safeLog } from "./safeLog";
import type { XtreamCategory } from "./xtreamCatalog";

const M3U_CACHE_STAGE_TOTAL = 3;
const activationProviders = new Set<string>();

export type M3UCatalogCacheProvider = Pick<
  Provider,
  "id" | "type" | "url" | "username" | "password" | "createdAt"
> & { playlistUrl?: string };

export type M3UCatalogCacheHydration = {
  counts: { live: number; vod: number; series: number };
  ready: boolean;
  live: Channel[];
  movies: ReturnType<typeof buildM3UDirectHydration>["movies"];
  series: ReturnType<typeof buildM3UDirectHydration>["series"];
  newChannels: Channel[];
  newMovies: ReturnType<typeof buildM3UDirectHydration>["movies"];
  newSeries: ReturnType<typeof buildM3UDirectHydration>["series"];
  vodCategories: XtreamCategory[];
  seriesCategories: XtreamCategory[];
};

function providerSource(provider: M3UCatalogCacheProvider) {
  return provider.url || provider.playlistUrl || "";
}

function categories(values: string[]): XtreamCategory[] {
  return Array.from(new Set(values.filter(Boolean))).map((name) => ({
    category_id: name,
    category_name: name,
  }));
}

export function markM3UCacheActivation(providerId: string) {
  activationProviders.add(providerId);
}

export function consumeM3UCacheActivation(providerId: string) {
  if (!activationProviders.has(providerId)) return false;
  activationProviders.delete(providerId);
  return true;
}

export async function hydrateM3UProviderCache(
  provider: M3UCatalogCacheProvider,
): Promise<M3UCatalogCacheHydration | null> {
  if (provider.type !== "m3u" || !parseM3UProviderSource(providerSource(provider))) {
    noteM3UCacheHydration({
      outcome: "null",
      reason: "unsupported-source",
      sqliteReadMs: 0,
      runtimeHydrateMs: 0,
      itemCounts: emptyM3UCacheCounts(),
      cacheRawCounts: emptyM3UCacheCounts(),
      cacheSyncPhase: "none",
    });
    return null;
  }

  let phase: "sqlite" | "runtime" = "sqlite";
  let sqliteReadMs = 0;
  let runtimeStartedAt = 0;
  let cacheRawCounts = emptyM3UCacheCounts();
  let cacheSyncPhase: M3UCacheSyncPhase = "none";
  try {
    const sqliteStartedAt = Date.now();
    await initCatalogCache();
    const [rawLive, rawVod, rawSeries, state, rawCounts] = await Promise.all([
      getCachedPersistedItems(provider.id, "live"),
      getCachedPersistedItems(provider.id, "vod"),
      getCachedPersistedItems(provider.id, "series"),
      getCatalogSyncState(provider.id),
      getCatalogCounts(provider.id),
    ]);
    sqliteReadMs = Date.now() - sqliteStartedAt;
    cacheRawCounts = rawCounts;
    cacheSyncPhase = state?.phase ?? "none";

    if (!hasUsableM3UCacheSnapshot(cacheRawCounts, cacheSyncPhase) && cacheSyncPhase === "error") {
      noteM3UCacheHydration({
        outcome: "null",
        reason: "error-state",
        sqliteReadMs,
        runtimeHydrateMs: 0,
        itemCounts: emptyM3UCacheCounts(),
        cacheRawCounts,
        cacheSyncPhase,
      });
      return null;
    }

    const liveRows = rawLive.filter(
      (row): row is PersistedLiveCatalogItem => row.catalogKind === "live",
    );
    const vodRows = rawVod.filter(
      (row): row is PersistedVodCatalogItem => row.catalogKind === "vod",
    );
    const seriesRows = rawSeries.filter(
      (row): row is PersistedSeriesCatalogItem => row.catalogKind === "series",
    );

    phase = "runtime";
    runtimeStartedAt = Date.now();
    const direct = buildM3UDirectHydration(provider, liveRows, vodRows, seriesRows);
    const runtimeHydrateMs = Date.now() - runtimeStartedAt;
    if (direct.counts.live === 0 && direct.counts.vod === 0 && direct.counts.series === 0) {
      noteM3UCacheHydration({
        outcome: "null",
        reason: "empty-cache",
        sqliteReadMs,
        runtimeHydrateMs,
        itemCounts: direct.counts,
        cacheRawCounts,
        cacheSyncPhase,
      });
      return null;
    }

    installM3UCatalog(provider.id, direct.catalog);
    noteM3UCacheHydration({
      outcome: "hit",
      reason: "none",
      sqliteReadMs,
      runtimeHydrateMs,
      itemCounts: direct.counts,
      cacheRawCounts,
      cacheSyncPhase,
    });
    return {
      counts: direct.counts,
      ready: state?.phase === "ready",
      live: direct.live,
      movies: direct.movies,
      series: direct.series,
      newChannels: direct.live.slice(0, 24),
      newMovies: direct.movies.slice(0, 24),
      newSeries: direct.series.slice(0, 24),
      vodCategories: direct.vodCategories,
      seriesCategories: direct.seriesCategories,
    };
  } catch (caught) {
    noteM3UCacheHydration({
      outcome: "error",
      reason: phase === "sqlite" ? "sqlite-read-error" : "runtime-hydrate-error",
      sqliteReadMs,
      runtimeHydrateMs: runtimeStartedAt ? Date.now() - runtimeStartedAt : 0,
      itemCounts: emptyM3UCacheCounts(),
      cacheRawCounts,
      cacheSyncPhase,
    });
    throw caught;
  }
}

async function readWriteCacheState(
  providerId: string,
  fallbackPhase: M3UCacheSyncPhase,
): Promise<{ counts: M3UCacheCounts; phase: M3UCacheSyncPhase }> {
  try {
    const [counts, state] = await Promise.all([
      getCatalogCounts(providerId),
      getCatalogSyncState(providerId),
    ]);
    return { counts, phase: state?.phase ?? fallbackPhase };
  } catch (caught) {
    safeLog.error("LS_M3U_CACHE_WRITE_STATE_READ", caught);
    return { counts: emptyM3UCacheCounts(), phase: fallbackPhase };
  }
}

async function markWriteFailureState(providerId: string, outcome: M3UCacheWriteOutcome) {
  try {
    await setCatalogSyncState(
      providerId,
      "error",
      0,
      M3U_CACHE_STAGE_TOTAL,
      `M3U cache write outcome=${outcome}`,
    );
  } catch (caught) {
    safeLog.error("LS_M3U_CACHE_WRITE_STATE", caught);
  }
}

async function publishWriteObservation(options: {
  providerId: string;
  startedAt: number;
  outcome: M3UCacheWriteOutcome;
  inputCounts: M3UCacheCounts;
  safeCounts: M3UCacheCounts;
  writtenCounts: M3UCacheCounts;
  rejectionCounts: M3URefRejectionCounts;
  scan: M3UCacheValidationScan;
  cleanupOutcome: M3UCleanupOutcome;
  cleanupStage: M3UCleanupStage;
  fallbackPhase: M3UCacheSyncPhase;
}) {
  const writeMs = Math.max(0, Date.now() - options.startedAt);
  const cacheState = await readWriteCacheState(options.providerId, options.fallbackPhase);
  await noteM3UCacheWriteResult(options.providerId, {
    startedAt: options.startedAt,
    cacheAfter: {
      rawCounts: cacheState.counts,
      syncPhase: cacheState.phase,
    },
    write: {
      writeAttempted: true,
      writeOutcome: options.outcome,
      writeMs,
      writeInputCounts: options.inputCounts,
      writeSafeCounts: options.safeCounts,
      writeWrittenCounts: options.writtenCounts,
      writeRejectCounts: options.rejectionCounts,
      scan: options.scan,
      cleanupOutcome: options.cleanupOutcome,
      cleanupStage: options.cleanupStage,
    },
  });
}

async function failClosedWrite(options: {
  providerId: string;
  startedAt: number;
  outcome: Exclude<M3UCacheWriteOutcome, "success" | "unsupported-source" | "sqlite-error">;
  inputCounts: M3UCacheCounts;
  safeCounts: M3UCacheCounts;
  rejectionCounts: M3URefRejectionCounts;
  scan: M3UCacheValidationScan;
}) {
  let cleanupOutcome: M3UCleanupOutcome = "success";
  let cleanupStage: M3UCleanupStage = "none";

  try {
    await deleteProviderCatalog(options.providerId);
  } catch (caught) {
    cleanupOutcome = "error";
    cleanupStage = "delete-catalog";
    safeLog.error("LS_M3U_CACHE_WRITE_DB", caught);
  }

  try {
    await setCatalogSyncState(
      options.providerId,
      "error",
      0,
      M3U_CACHE_STAGE_TOTAL,
      `M3U cache write outcome=${options.outcome}`,
    );
  } catch (caught) {
    cleanupOutcome = "error";
    if (cleanupStage === "none") cleanupStage = "set-error-state";
    safeLog.error("LS_M3U_CACHE_WRITE_STATE", caught);
  }

  await publishWriteObservation({
    ...options,
    writtenCounts: emptyM3UCacheCounts(),
    cleanupOutcome,
    cleanupStage,
    fallbackPhase: "error",
  });
  return false;
}

export async function persistM3UProviderCache(
  provider: M3UCatalogCacheProvider,
  loaded: ProviderLoadResult,
): Promise<boolean> {
  if (provider.type !== "m3u") return false;
  const startedAt = Date.now();
  const liveInput = loaded.liveChannels ?? loaded.channels;
  const movieInput = loaded.movieItems ?? [];
  const seriesInput = loaded.seriesGroups ?? [];
  const inputCounts = {
    live: liveInput.length,
    vod: movieInput.length,
    series: seriesInput.length,
  };
  noteM3UNetworkCatalogCounts(inputCounts, loaded.m3uDiagnostics);
  noteM3UCacheWriteStarted(provider.id);

  const projection = buildM3UCacheWriteProjection(provider, loaded);
  if (!projection) {
    await markWriteFailureState(provider.id, "unsupported-source");
    await publishWriteObservation({
      providerId: provider.id,
      startedAt,
      outcome: "unsupported-source",
      inputCounts,
      safeCounts: emptyM3UCacheCounts(),
      writtenCounts: emptyM3UCacheCounts(),
      rejectionCounts: emptyM3URefRejectionCounts(),
      scan: emptyM3UValidationScan(m3uCacheCandidateCount(loaded)),
      cleanupOutcome: "not-required",
      cleanupStage: "none",
      fallbackPhase: "error",
    });
    return false;
  }

  if (projection.unsafeOutcome) {
    return failClosedWrite({
      providerId: provider.id,
      startedAt,
      outcome: projection.unsafeOutcome,
      inputCounts: projection.inputCounts,
      safeCounts: projection.safeCounts,
      rejectionCounts: projection.rejectionCounts,
      scan: projection.scan,
    });
  }

  const persistedLive = projectCatalogItems(provider.id, "live", projection.liveRows as any);
  const persistedVod = projectCatalogItems(provider.id, "vod", projection.movieRows as any);
  const persistedSeries = projectCatalogItems(provider.id, "series", projection.seriesRows as any);
  if (
    persistedLive.length !== projection.liveRows.length ||
    persistedVod.length !== projection.movieRows.length ||
    persistedSeries.length !== projection.seriesRows.length
  ) {
    return failClosedWrite({
      providerId: provider.id,
      startedAt,
      outcome: "projection-drop",
      inputCounts: projection.inputCounts,
      safeCounts: projection.safeCounts,
      rejectionCounts: projection.rejectionCounts,
      scan: projection.scan,
    });
  }

  const writtenCounts = emptyM3UCacheCounts();
  try {
    await initCatalogCache();
    const seenAt = Date.now();
    await setCatalogSyncState(provider.id, "syncing", 0, M3U_CACHE_STAGE_TOTAL, "M3U cache update started");
    writtenCounts.live = await upsertCatalogItems(provider.id, "live", persistedLive, { seenAt, markNew: true });
    writtenCounts.vod = await upsertCatalogItems(provider.id, "vod", persistedVod, { seenAt, markNew: true });
    writtenCounts.series = await upsertCatalogItems(provider.id, "series", persistedSeries, { seenAt, markNew: true });
    await Promise.all([
      replaceCatalogCategories(provider.id, "vod", categories(movieInput.map((item) => item.category))),
      replaceCatalogCategories(provider.id, "series", categories(seriesInput.map((item) => item.category))),
    ]);
    await Promise.all([
      pruneCatalogKind(provider.id, "live", seenAt),
      pruneCatalogKind(provider.id, "vod", seenAt),
      pruneCatalogKind(provider.id, "series", seenAt),
    ]);
    await setCatalogSyncState(
      provider.id,
      "ready",
      M3U_CACHE_STAGE_TOTAL,
      M3U_CACHE_STAGE_TOTAL,
      "M3U cache ready",
      "background",
    );
    await publishWriteObservation({
      providerId: provider.id,
      startedAt,
      outcome: "success",
      inputCounts: projection.inputCounts,
      safeCounts: projection.safeCounts,
      writtenCounts,
      rejectionCounts: projection.rejectionCounts,
      scan: projection.scan,
      cleanupOutcome: "not-required",
      cleanupStage: "none",
      fallbackPhase: "ready",
    });
    return true;
  } catch (caught) {
    safeLog.error("LS_M3U_CACHE_WRITE_DB", caught);
    await markWriteFailureState(provider.id, "sqlite-error");
    await publishWriteObservation({
      providerId: provider.id,
      startedAt,
      outcome: "sqlite-error",
      inputCounts: projection.inputCounts,
      safeCounts: projection.safeCounts,
      writtenCounts,
      rejectionCounts: projection.rejectionCounts,
      scan: projection.scan,
      cleanupOutcome: "not-required",
      cleanupStage: "none",
      fallbackPhase: "error",
    });
    return false;
  }
}
