import {
  cleanupStagingCatalog,
  deleteProviderCatalog,
  getCachedPersistedItems,
  getCatalogCounts,
  getCatalogItemsSchemaFingerprint,
  getCatalogSyncState,
  initCatalogCache,
  setCatalogSyncState,
  swapStagingToProvider,
  upsertCatalogItemsBulkNonCancellable,
} from "./catalogCache";
import {
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
import {
  buildM3UDirectHydration,
  buildM3UDirectHydrationCooperatively,
} from "./m3uCatalogHydration";
import {
  buildM3UCacheWriteProjectionCooperatively,
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
  classifyM3USqliteError,
  createM3USqliteBatchProgress,
  failedM3USqliteBatchIndex,
  noteM3USqliteBatchCommitted,
  noteM3USqliteBatchStarted,
  snapshotM3USqliteBatchProgress,
  type M3UCacheAfterReadOutcome,
  type M3USqliteErrorIdentity,
  type M3USqliteSchemaFingerprint,
  type M3USqliteStage,
  type M3USqliteWriteKind,
} from "./sqliteWriteDiagnostics";
import {
  noteM3UCacheHydration,
  noteM3UCacheWriteResult,
  noteM3UCacheWriteStarted,
  noteM3UNetworkCatalogCounts,
} from "./m3uSwitchMetrics";
import { safeLog } from "./safeLog";
import { yieldToUi } from "./cooperative";
import type { XtreamCategory } from "./xtreamCatalog";

const M3U_CACHE_STAGE_TOTAL = 3;
export const M3U_HOME_PREVIEW_LIMIT = 48;
const activationProviders = new Set<string>();

export type M3UCatalogCacheProvider = Omit<Pick<
  Provider,
  "id" | "type" | "url" | "username" | "password" | "createdAt"
>, "url"> & { url?: string; playlistUrl?: string };

export type M3UCatalogCacheHydration = {
  scope: "preview";
  counts: { live: number; vod: number; series: number };
  hydratedCounts: { live: number; vod: number; series: number };
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
      getCachedPersistedItems(provider.id, "live", undefined, M3U_HOME_PREVIEW_LIMIT),
      getCachedPersistedItems(provider.id, "vod", undefined, M3U_HOME_PREVIEW_LIMIT),
      getCachedPersistedItems(provider.id, "series", undefined, M3U_HOME_PREVIEW_LIMIT),
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
    const direct = await buildM3UDirectHydrationCooperatively(
      provider,
      liveRows,
      vodRows,
      seriesRows,
      { yieldFn: yieldToUi },
    );
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

    noteM3UCacheHydration({
      outcome: "hit",
      reason: "none",
      sqliteReadMs,
      runtimeHydrateMs,
      itemCounts: cacheRawCounts,
      cacheRawCounts,
      cacheSyncPhase,
    });
    return {
      scope: "preview",
      counts: cacheRawCounts,
      hydratedCounts: direct.counts,
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
): Promise<{
  counts: M3UCacheCounts;
  phase: M3UCacheSyncPhase;
  readOutcome: M3UCacheAfterReadOutcome;
}> {
  try {
    const [counts, state] = await Promise.all([
      getCatalogCounts(providerId),
      getCatalogSyncState(providerId),
    ]);
    return { counts, phase: state?.phase ?? fallbackPhase, readOutcome: "success" };
  } catch (caught) {
    safeLog.error("LS_M3U_CACHE_WRITE_STATE_READ", caught);
    return { counts: emptyM3UCacheCounts(), phase: fallbackPhase, readOutcome: "error" };
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

type SqliteFailureObservation = M3USqliteErrorIdentity &
  Partial<M3USqliteSchemaFingerprint> & {
    sqliteStage: M3USqliteStage;
  };

async function publishWriteObservation(options: {
  providerId: string;
  startedAt: number;
  outcome: M3UCacheWriteOutcome;
  inputCounts: M3UCacheCounts;
  safeCounts: M3UCacheCounts;
  writtenCounts: M3UCacheCounts;
  completedBatchCount?: M3UCacheCounts;
  committedRows?: M3UCacheCounts;
  failedBatchIndex?: number;
  sqliteFailure?: SqliteFailureObservation;
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
      completedBatchCount: options.completedBatchCount ?? emptyM3UCacheCounts(),
      committedRows: options.committedRows ?? emptyM3UCacheCounts(),
      failedBatchIndex: options.failedBatchIndex ?? 0,
      cacheAfterReadOutcome: cacheState.readOutcome,
      ...(options.sqliteFailure ?? {}),
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

  const projection = await buildM3UCacheWriteProjectionCooperatively(provider, loaded, {
    batchSize: 200,
    yieldFn: yieldToUi,
  });
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

  const stagingProviderId = `__staging__${provider.id}`;
  const stagedLive = persistedLive.map((item) => ({ ...item, providerId: stagingProviderId }));
  const stagedVod = persistedVod.map((item) => ({ ...item, providerId: stagingProviderId }));
  const stagedSeries = persistedSeries.map((item) => ({ ...item, providerId: stagingProviderId }));
  const stagedCounts = emptyM3UCacheCounts();
  const writtenCounts = emptyM3UCacheCounts();
  const batchProgress = createM3USqliteBatchProgress();
  let sqliteStage: M3USqliteStage = "set-syncing";

  try {
    await initCatalogCache();
    await cleanupStagingCatalog(provider.id);
    await setCatalogSyncState(
      provider.id,
      "preparing",
      0,
      M3U_CACHE_STAGE_TOTAL,
      "M3U cache preparing",
    );
    const seenAt = Date.now();

    stagedCounts.live = await upsertCatalogItemsBulkNonCancellable(stagingProviderId, "live", stagedLive, {
      seenAt,
      markNew: true,
      onBatchStarted: (batchIndex) => {
        noteM3USqliteBatchStarted(batchProgress, "live", batchIndex);
      },
      onSqliteStage: (stage) => {
        sqliteStage = stage;
      },
    });
    stagedCounts.vod = await upsertCatalogItemsBulkNonCancellable(stagingProviderId, "vod", stagedVod, {
      seenAt,
      markNew: true,
      onBatchStarted: (batchIndex) => {
        noteM3USqliteBatchStarted(batchProgress, "vod", batchIndex);
      },
      onSqliteStage: (stage) => {
        sqliteStage = stage;
      },
    });
    stagedCounts.series = await upsertCatalogItemsBulkNonCancellable(stagingProviderId, "series", stagedSeries, {
      seenAt,
      markNew: true,
      onBatchStarted: (batchIndex) => {
        noteM3USqliteBatchStarted(batchProgress, "series", batchIndex);
      },
      onSqliteStage: (stage) => {
        sqliteStage = stage;
      },
    });

    sqliteStage = "set-ready";
    const committedCounts = await swapStagingToProvider({
      providerId: provider.id,
      vodCategories: categories(movieInput.map((item) => item.category)),
      seriesCategories: categories(seriesInput.map((item) => item.category)),
      readyMessage: "M3U cache ready",
      readyStamp: "background",
      syncTotal: M3U_CACHE_STAGE_TOTAL,
      committedCounts: stagedCounts,
      onBatchCommitted: (kind, observation) => {
        noteM3USqliteBatchCommitted(
          batchProgress,
          kind as M3USqliteWriteKind,
          observation.batchIndex,
          observation.committedRows,
        );
      },
    });
    writtenCounts.live = committedCounts.live;
    writtenCounts.vod = committedCounts.vod;
    writtenCounts.series = committedCounts.series;

    const progress = snapshotM3USqliteBatchProgress(batchProgress);
    await publishWriteObservation({
      providerId: provider.id,
      startedAt,
      outcome: "success",
      inputCounts: projection.inputCounts,
      safeCounts: projection.safeCounts,
      writtenCounts,
      completedBatchCount: progress.completedBatchCount,
      committedRows: progress.committedRows,
      rejectionCounts: projection.rejectionCounts,
      scan: projection.scan,
      cleanupOutcome: "not-required",
      cleanupStage: "none",
      fallbackPhase: "ready",
    });
    return true;
  } catch (caught) {
    try {
      await cleanupStagingCatalog(provider.id);
    } catch (cleanupCaught) {
      safeLog.error("LS_M3U_CACHE_STAGING_CLEANUP", cleanupCaught);
    }
    const progress = snapshotM3USqliteBatchProgress(batchProgress);
    let schemaFingerprint: Partial<M3USqliteSchemaFingerprint> = {};
    try {
      schemaFingerprint = await getCatalogItemsSchemaFingerprint();
    } catch {
      safeLog.warn("LS_M3U_CACHE_SCHEMA_FINGERPRINT", { result: "unavailable" });
    }
    const sqliteFailure: SqliteFailureObservation = {
      ...classifyM3USqliteError(caught),
      sqliteStage,
      ...schemaFingerprint,
    };
    const failedBatchIndex = failedM3USqliteBatchIndex(batchProgress, sqliteStage);
    safeLog.error("LS_M3U_CACHE_WRITE_DB", caught);
    // Staging writes never replace the active provider rows until the final swap.
    // A failed batch or swap therefore leaves the previous cache rows usable;
    // cleanup above removes only the private staging namespace.
    await publishWriteObservation({
      providerId: provider.id,
      startedAt,
      outcome: "sqlite-error",
      inputCounts: projection.inputCounts,
      safeCounts: projection.safeCounts,
      writtenCounts,
      completedBatchCount: progress.completedBatchCount,
      committedRows: progress.committedRows,
      failedBatchIndex,
      sqliteFailure,
      rejectionCounts: projection.rejectionCounts,
      scan: projection.scan,
      cleanupOutcome: "not-required",
      cleanupStage: "none",
      fallbackPhase: "error",
    });
    return false;
  }
}
