import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { usePlayer } from "./PlayerContext";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "./I18nContext";
import {
  CatalogCounts,
  CatalogSyncState,
  getCatalogCounts,
  getCatalogSyncState,
  initCatalogCache,
  setCatalogSyncState,
  upsertCatalogItems,
} from "@/lib/catalogCache";
import {
  abortCatalogRequest,
  freshCatalogRunState,
  hasUsableCatalogCache,
  isCatalogSyncOwnershipCurrent,
  isCatalogSyncActive,
  shouldBlockInitialCatalogSync,
  type CatalogRunState,
  type CatalogSyncMode,
  type CatalogSyncOwnership,
} from "@/lib/catalogAvailability";
import { loadProvider, Provider } from "@/lib/iptv";
import {
  getSeries,
  getSeriesCategories,
  getVodCategories,
  getVodStreams,
  XtreamCredentials,
  XtreamSeriesItem,
  XtreamVodItem,
} from "@/lib/xtreamCatalog";
import { yieldToUi } from "@/lib/cooperative";
import { projectCatalogItems } from "@/lib/catalogPersistence";
import {
  catalogErrorClass,
  runCatalogFetchPlan,
  type CatalogFetchMetrics,
} from "@/lib/catalogSyncStrategy";
import { recordCatalogSyncMeasurement } from "@/lib/catalogSyncMetrics";
import {
  getCachedLiveItems,
  getCachedSeriesItems,
  getCachedVodItems,
  getNewCachedLiveItems,
  getNewCachedSeriesItems,
  getNewCachedVodItems,
} from "@/lib/catalogRuntime";
import {
  clearProviderSwitchSnapshot,
  peekProviderSwitchSnapshot,
} from "@/lib/providerSwitchUx";
import type { Channel } from "@/lib/iptv";
import { resolvedProviderTransport } from "@/lib/m3uTransportRouting";
import {
  cleanupCatalogKindStaging,
  publishStagedCatalogKind,
  stagingCatalogProviderId,
} from "@/lib/xtreamKindCache";
import { runIndependentCatalogKinds } from "@/lib/xtreamKindSync";
import { stabilizeXtreamLiveCatalogItems } from "@/lib/xtreamIdentity";

export type CatalogSnapshot = {
  providerId?: string;
  ready: boolean;
  counts: CatalogCounts;
  live: Channel[];
  movies: XtreamVodItem[];
  series: XtreamSeriesItem[];
  newChannels: Channel[];
  newMovies: XtreamVodItem[];
  newSeries: XtreamSeriesItem[];
};

type CatalogSyncContextValue = {
  syncState: CatalogSyncState | CatalogRunState | null;
  snapshot: CatalogSnapshot;
  cacheReady: boolean;
  hasUsableCache: boolean;
  isSyncing: boolean;
  isRefreshing: boolean;
  refreshSnapshot: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
  cancelInitialSync: () => void;
};

const EMPTY_COUNTS: CatalogCounts = { live: 0, vod: 0, series: 0 };
const EMPTY_SNAPSHOT: CatalogSnapshot = {
  ready: false,
  counts: EMPTY_COUNTS,
  live: [],
  movies: [],
  series: [],
  newChannels: [],
  newMovies: [],
  newSeries: [],
};
const HOME_SAMPLE_LIMIT = 48;
const NEW_SAMPLE_LIMIT = 24;
const BACKGROUND_SYNC_DELAY_MS = 1_250;
const SYNC_STAGE_TOTAL = 4;

const Context = createContext<CatalogSyncContextValue | null>(null);

type ActiveCatalogProvider = NonNullable<ReturnType<typeof usePlayer>["provider"]>;
type RunningCatalogTask = {
  ownership: CatalogSyncOwnership;
  task: Promise<void>;
};

function providerCredentials(provider: ReturnType<typeof usePlayer>["provider"]): XtreamCredentials | null {
  if (!provider || resolvedProviderTransport(provider) !== "xtream" || !provider.username || !provider.password) return null;
  return {
    baseUrl: provider.url || provider.playlistUrl,
    username: provider.username,
    password: provider.password,
  };
}

function asLoadProvider(provider: NonNullable<ReturnType<typeof usePlayer>["provider"]>): Provider {
  return {
    id: provider.id,
    name: provider.name,
    type: resolvedProviderTransport(provider) === "xtream" ? "xtream" : provider.type,
    url: provider.url || provider.playlistUrl,
    username: provider.username,
    password: provider.password,
    mac: provider.mac,
    epgUrl: provider.epgUrl,
    createdAt: provider.createdAt,
    lastLoadedAt: provider.lastLoadedAt,
    channelCount: provider.channelCount,
    loadError: provider.loadError,
  };
}

export function CatalogSyncProvider({ children }: { children: ReactNode }) {
  const { provider, channels, m3uCatalogCommit, recoverLegacyCatalogFallback } = usePlayer();
  const colors = useColors();
  const { language } = useI18n();
  const [syncState, setSyncStateLocal] = useState<CatalogSyncState | CatalogRunState | null>(null);
  const [snapshot, setSnapshot] = useState<CatalogSnapshot>(EMPTY_SNAPSHOT);
  const [hasUsableCache, setHasUsableCache] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInitialSyncRunning, setIsInitialSyncRunning] = useState(false);
  const cancelRef = useRef(false);
  const generationRef = useRef(0);
  const latestProviderIdRef = useRef<string | null>(provider?.id ?? null);
  const latestProviderRef = useRef<ActiveCatalogProvider | null>(provider);
  const runningRef = useRef<RunningCatalogTask | null>(null);
  const activeRunIdRef = useRef<number | null>(null);
  const activeModeRef = useRef<CatalogSyncMode | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const backgroundStartedRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const committedProviderId = provider?.id ?? null;
    latestProviderRef.current = provider;
    if (latestProviderIdRef.current !== committedProviderId) {
      latestProviderIdRef.current = committedProviderId;
      generationRef.current += 1;
    }
  }, [provider?.id]);

  // Backward-compatible runtime name used by existing catalog loaders. Its meaning is now
  // "local cache is usable", not "the last synchronization finished successfully".
  const cacheReady = hasUsableCache;

  const refreshSnapshotFor = useCallback(async (
    active: ActiveCatalogProvider | null,
    ownership: CatalogSyncOwnership,
  ) => {
    if (!active) {
      if (!isCatalogSyncOwnershipCurrent(
        latestProviderIdRef.current,
        generationRef.current,
        ownership,
      )) return;
      setSnapshot(EMPTY_SNAPSHOT);
      setHasUsableCache(false);
      return;
    }
    await initCatalogCache();
    const [counts, state] = await Promise.all([
      getCatalogCounts(active.id),
      getCatalogSyncState(active.id),
    ]);
    const ready = state?.phase === "ready";
    const usable = hasUsableCatalogCache(counts);
    const [live, movies, series, newChannels, newMovies, newSeries] = await Promise.all([
      getCachedLiveItems(active, undefined, HOME_SAMPLE_LIMIT),
      getCachedVodItems(active, undefined, HOME_SAMPLE_LIMIT),
      getCachedSeriesItems(active, undefined, HOME_SAMPLE_LIMIT),
      getNewCachedLiveItems(active, NEW_SAMPLE_LIMIT),
      getNewCachedVodItems(active, NEW_SAMPLE_LIMIT),
      getNewCachedSeriesItems(active, NEW_SAMPLE_LIMIT),
    ]);
    if (!isCatalogSyncOwnershipCurrent(
      latestProviderIdRef.current,
      generationRef.current,
      ownership,
    )) return;
    setSnapshot({
      providerId: active.id,
      ready,
      counts,
      live,
      movies,
      series,
      newChannels,
      newMovies,
      newSeries,
    });
    setHasUsableCache(usable);
    // Never let persisted state from a previous run overwrite the active run's local UI state.
    if (activeRunIdRef.current === null) setSyncStateLocal(state);
  }, []);

  const refreshSnapshot = useCallback(async () => {
    const active = provider;
    await refreshSnapshotFor(active, {
      providerId: active?.id ?? null,
      generation: generationRef.current,
    });
  }, [provider, refreshSnapshotFor]);

  useEffect(() => {
    const active = latestProviderRef.current;
    if (
      !active ||
      resolvedProviderTransport(active) !== "m3u" ||
      !m3uCatalogCommit ||
      m3uCatalogCommit.providerId !== active.id
    ) return;
    const generation = ++generationRef.current;
    const ownership: CatalogSyncOwnership = {
      providerId: active.id,
      generation,
    };
    void refreshSnapshotFor(active, ownership);
  }, [m3uCatalogCommit, refreshSnapshotFor]);

  const publishState = useCallback(async (
    ownership: CatalogSyncOwnership,
    phase: CatalogSyncState["phase"],
    completed: number,
    total: number,
    message?: string,
    stamp?: "full" | "background",
  ) => {
    if (!isCatalogSyncOwnershipCurrent(
      latestProviderIdRef.current,
      generationRef.current,
      ownership,
    ) || ownership.providerId === null) return;
    const providerId = ownership.providerId;
    const base: CatalogSyncState = {
      providerId,
      phase,
      completed,
      total,
      message,
      updatedAt: Date.now(),
    };
    const next: CatalogRunState = { ...base, runId: ownership.generation };
    if (activeRunIdRef.current === ownership.generation) setSyncStateLocal(next);
    // Catalog writes are globally serialized. The ownership check and queue insertion
    // happen in the same JS turn, so a newer generation can only enqueue after this write.
    await setCatalogSyncState(providerId, phase, completed, total, message, stamp);
  }, []);

  const runSync = useCallback(async (mode: CatalogSyncMode) => {
    if (!provider || resolvedProviderTransport(provider) !== "xtream") return;
    if (provider.id !== latestProviderIdRef.current) return;
    const credentials = providerCredentials(provider);
    if (!credentials) return;
    const running = runningRef.current;
    if (running && isCatalogSyncOwnershipCurrent(
      latestProviderIdRef.current,
      generationRef.current,
      running.ownership,
    )) return running.task;

    const generation = ++generationRef.current;
    const ownership: CatalogSyncOwnership = { providerId: provider.id, generation };
    const isInitial = mode === "initial";
    const markNew = mode !== "initial";
    const syncStartedAt = Date.now();
    const controller = new AbortController();
    activeRunIdRef.current = generation;
    activeModeRef.current = mode;
    abortControllerRef.current = controller;
    cancelRef.current = false;
    setSyncStateLocal(freshCatalogRunState(provider.id, generation, mode));

    let completed = 0;
    const total = SYNC_STAGE_TOTAL;
    let liveSqliteWriteMs = 0;
    let vodMetrics: CatalogFetchMetrics | null = null;
    let seriesMetrics: CatalogFetchMetrics | null = null;
    const ownsRun = () => isCatalogSyncOwnershipCurrent(
      latestProviderIdRef.current,
      generationRef.current,
      ownership,
    );
    const isCancelled = () => cancelRef.current || controller.signal.aborted || !ownsRun();

    const task = (async () => {
      if (isInitial) setIsInitialSyncRunning(true);
      else setIsRefreshing(true);
      try {
        await initCatalogCache();
        await publishState(
          ownership,
          isInitial ? "preparing" : "syncing",
          0,
          total,
          isInitial ? "Preparing catalog sources" : "Catalog update started",
        );

        const outcomes = await runIndependentCatalogKinds([
          {
            kind: "live",
            run: async () => {
              const stagingId = stagingCatalogProviderId(provider.id, generation, "live");
              await cleanupCatalogKindStaging(stagingId, "live");
              try {
                await publishState(ownership, "syncing", completed, total, "Live TV · loading");
                const currentLive = channels.filter(
                  (channel) => channel.providerId === provider.id && (channel.contentType ?? "live") === "live",
                );
                const liveRows = isInitial && currentLive.length
                  ? currentLive
                  : (await loadProvider(asLoadProvider(provider))).channels;
                if (isCancelled()) return;

                const projected = stabilizeXtreamLiveCatalogItems(
                  provider.id,
                  projectCatalogItems(stagingId, "live", liveRows),
                );
                const remoteUniqueCount = new Set(
                  projected
                    .filter((item) => item.catalogKind === "live")
                    .map((item) => item.id),
                ).size;
                const liveWriteStartedAt = Date.now();
                await upsertCatalogItems(stagingId, "live", projected, {
                  markNew,
                  seenAt: syncStartedAt,
                  isCancelled,
                });
                liveSqliteWriteMs = Date.now() - liveWriteStartedAt;
                if (isCancelled()) return;

                const published = await publishStagedCatalogKind({
                  providerId: provider.id,
                  stagingId,
                  kind: "live",
                  expectedCount: remoteUniqueCount,
                  canPublish: () => !isCancelled(),
                });
                if (!published.published && !isCancelled()) {
                  throw new Error("Xtream Live publish ownership changed.");
                }
                if (!isCancelled()) {
                  completed += 1;
                  await refreshSnapshotFor(provider, ownership);
                  await publishState(ownership, "syncing", completed, total, "Live TV · published");
                }
              } catch (caught) {
                try {
                  await cleanupCatalogKindStaging(stagingId, "live");
                } catch {
                  // The active cache remains untouched when staging cleanup fails.
                }
                throw caught;
              }
            },
          },
          {
            kind: "vod",
            run: async () => {
              const stagingId = stagingCatalogProviderId(provider.id, generation, "vod");
              await cleanupCatalogKindStaging(stagingId, "vod");
              try {
                await publishState(ownership, "syncing", completed, total, "Movies · loading categories");
                let vodCategories: Awaited<ReturnType<typeof getVodCategories>> = [];
                let categoryMetadataDegraded = false;
                let categoryMetadataErrorClass = "none";
                try {
                  vodCategories = await getVodCategories(credentials, controller.signal);
                } catch (caught) {
                  if (isCancelled()) return;
                  categoryMetadataDegraded = true;
                  categoryMetadataErrorClass = catalogErrorClass(caught);
                  await publishState(
                    ownership,
                    "syncing",
                    completed,
                    total,
                    `Movies · stage=categories code=CATEGORY_METADATA_UNAVAILABLE errorClass=${categoryMetadataErrorClass} fallback=bulk-baseline-probe`,
                  );
                }
                if (isCancelled()) return;
                const vodUniqueIds = new Set<string>();

                vodMetrics = await runCatalogFetchPlan<XtreamVodItem, (typeof vodCategories)[number]>({
                  categories: vodCategories,
                  fetchBulk: (onParseMs) => getVodStreams(
                    credentials,
                    undefined,
                    controller.signal,
                    ({ parseMs }) => onParseMs(parseMs),
                  ),
                  fetchCategory: (category) => getVodStreams(credentials, category.category_id, controller.signal),
                  writeRows: async (rows) => {
                    for (const row of rows) vodUniqueIds.add(String(row.stream_id));
                    await upsertCatalogItems(stagingId, "vod", projectCatalogItems(stagingId, "vod", rows), {
                      markNew,
                      seenAt: syncStartedAt,
                      isCancelled,
                    });
                  },
                  categoryIdOf: (row) => row.category_id,
                  isCancelled,
                  forceCategoryFallback: true,
                  allowHealthyBulkOnCategoryFailure: true,
                  onFallbackProgress: async (done, categoryTotal, path) => {
                    await publishState(
                      ownership,
                      "syncing",
                      completed,
                      total,
                      `Movies · ${path === "parallel" ? "parallel" : "serial"} fallback ${done}/${categoryTotal}`,
                    );
                  },
                });
                if (isCancelled()) return;
                if (vodMetrics.degradedToHealthyBulk) {
                  await publishState(
                    ownership,
                    "syncing",
                    completed,
                    total,
                    "Movies · stage=category-retry code=CATEGORY_RECOVERY_FAILED errorClass=Unavailable fallback=healthy-bulk",
                  );
                } else if (categoryMetadataDegraded) {
                  await publishState(
                    ownership,
                    "syncing",
                    completed,
                    total,
                    `Movies · stage=categories code=CATEGORY_METADATA_UNAVAILABLE errorClass=${categoryMetadataErrorClass} fallback=healthy-bulk`,
                  );
                }

                const published = await publishStagedCatalogKind({
                  providerId: provider.id,
                  stagingId,
                  kind: "vod",
                  categories: vodCategories,
                  expectedCount: vodUniqueIds.size,
                  canPublish: () => !isCancelled(),
                });
                if (!published.published && !isCancelled()) {
                  throw new Error("Xtream VOD publish ownership changed.");
                }
                if (!isCancelled()) {
                  completed += 1;
                  await refreshSnapshotFor(provider, ownership);
                  await publishState(ownership, "syncing", completed, total, "Movies · published");
                }
              } catch (caught) {
                try {
                  await cleanupCatalogKindStaging(stagingId, "vod");
                } catch {
                  // The active cache remains untouched when staging cleanup fails.
                }
                throw caught;
              }
            },
          },
          {
            kind: "series",
            run: async () => {
              const stagingId = stagingCatalogProviderId(provider.id, generation, "series");
              await cleanupCatalogKindStaging(stagingId, "series");
              try {
                await publishState(ownership, "syncing", completed, total, "Series · loading categories");
                const seriesCategories = await getSeriesCategories(credentials, controller.signal);
                if (isCancelled()) return;
                const seriesUniqueIds = new Set<string>();

                seriesMetrics = await runCatalogFetchPlan<XtreamSeriesItem, (typeof seriesCategories)[number]>({
                  categories: seriesCategories,
                  fetchBulk: (onParseMs) => getSeries(
                    credentials,
                    undefined,
                    controller.signal,
                    ({ parseMs }) => onParseMs(parseMs),
                  ),
                  fetchCategory: (category) => getSeries(credentials, category.category_id, controller.signal),
                  writeRows: async (rows) => {
                    for (const row of rows) seriesUniqueIds.add(String(row.series_id));
                    await upsertCatalogItems(stagingId, "series", projectCatalogItems(stagingId, "series", rows), {
                      markNew,
                      seenAt: syncStartedAt,
                      isCancelled,
                    });
                  },
                  categoryIdOf: (row) => row.category_id,
                  isCancelled,
                  onFallbackProgress: async (done, categoryTotal, path) => {
                    await publishState(
                      ownership,
                      "syncing",
                      completed,
                      total,
                      `Series · ${path === "parallel" ? "parallel" : "serial"} fallback ${done}/${categoryTotal}`,
                    );
                  },
                });
                if (isCancelled()) return;

                const published = await publishStagedCatalogKind({
                  providerId: provider.id,
                  stagingId,
                  kind: "series",
                  categories: seriesCategories,
                  expectedCount: seriesUniqueIds.size,
                  canPublish: () => !isCancelled(),
                });
                if (!published.published && !isCancelled()) {
                  throw new Error("Xtream Series publish ownership changed.");
                }
                if (!isCancelled()) {
                  completed += 1;
                  await refreshSnapshotFor(provider, ownership);
                  await publishState(ownership, "syncing", completed, total, "Series · published");
                }
              } catch (caught) {
                try {
                  await cleanupCatalogKindStaging(stagingId, "series");
                } catch {
                  // The active cache remains untouched when staging cleanup fails.
                }
                throw caught;
              }
            },
          },
        ], { isCancelled });

        if (outcomes.cancelled || isCancelled()) {
          await publishState(ownership, "cancelled", completed, total, "Catalog preparation cancelled");
          await refreshSnapshotFor(provider, ownership);
          return;
        }

        const allSucceeded = outcomes.live === "success" && outcomes.vod === "success" && outcomes.series === "success";
        if (!allSucceeded) {
          const failureSummary = (["live", "vod", "series"] as const)
            .map((kind) => {
              const failure = outcomes.failures[kind];
              return failure
                ? `${kind}:stage=${failure.stage},code=${failure.code},errorClass=${failure.errorClass},fallback=${failure.fallbackPath}`
                : null;
            })
            .filter((value): value is string => Boolean(value))
            .join(" · ");
          await publishState(
            ownership,
            "error",
            completed,
            total,
            failureSummary
              ? `Catalog update retained failed kinds · ${failureSummary}`
              : "Catalog update completed with retained cache for failed kinds",
          );
          await refreshSnapshotFor(provider, ownership);
          return;
        }

        await publishState(ownership, "syncing", completed, total, "Finalizing catalog cache");
        await yieldToUi();
        if (isCancelled()) return;

        completed = total;
        await publishState(
          ownership,
          "ready",
          completed,
          total,
          "Catalog cache ready",
          mode === "background" ? "background" : "full",
        );
        if (vodMetrics && seriesMetrics) {
          recordCatalogSyncMeasurement({
            providerId: provider.id,
            mode,
            startedAt: syncStartedAt,
            totalMs: Date.now() - syncStartedAt,
            liveSqliteWriteMs,
            vod: vodMetrics,
            series: seriesMetrics,
          });
        }
        await refreshSnapshotFor(provider, ownership);
      } catch (caught) {
        if (isCancelled()) {
          await publishState(ownership, "cancelled", completed, total, "Catalog preparation cancelled");
          await refreshSnapshotFor(provider, ownership);
          return;
        }
        if (await recoverLegacyCatalogFallback(provider.id, caught)) return;
        const message = caught instanceof Error ? caught.message : "Catalog synchronization failed";
        await publishState(ownership, "error", completed, total, message);
        await refreshSnapshotFor(provider, ownership);
      } finally {
        if (
          activeRunIdRef.current === generation &&
          isCatalogSyncOwnershipCurrent(
            latestProviderIdRef.current,
            generationRef.current,
            ownership,
          )
        ) {
          if (isInitial) setIsInitialSyncRunning(false);
          else setIsRefreshing(false);
          activeRunIdRef.current = null;
          activeModeRef.current = null;
        }
        if (abortControllerRef.current === controller) abortControllerRef.current = null;
      }
    })();

    runningRef.current = { ownership, task };
    const releaseTaskOwnership = () => {
      if (runningRef.current?.task === task) runningRef.current = null;
    };
    void task.then(releaseTaskOwnership, releaseTaskOwnership);
    return task;
  }, [channels, provider, publishState, recoverLegacyCatalogFallback, refreshSnapshotFor]);

  const refreshCatalog = useCallback(async () => {
    await runSync("manual");
  }, [runSync]);

  const cancelInitialSync = useCallback(() => {
    if (activeModeRef.current !== "initial") return;
    cancelRef.current = true;
    abortCatalogRequest(abortControllerRef.current);
  }, []);

  useEffect(() => {
    cancelRef.current = true;
    abortCatalogRequest(abortControllerRef.current);
    abortControllerRef.current = null;
    activeRunIdRef.current = null;
    activeModeRef.current = null;
    runningRef.current = null;
    backgroundStartedRef.current = null;

    const active = provider;
    const lifecycleOwnership: CatalogSyncOwnership = {
      providerId: active?.id ?? null,
      generation: generationRef.current,
    };
    const primedSnapshot = active
      ? peekProviderSwitchSnapshot<CatalogSnapshot>(active.id)
      : null;
    if (primedSnapshot) {
      setSnapshot(primedSnapshot);
      setHasUsableCache(true);
    } else {
      setSnapshot(EMPTY_SNAPSHOT);
      setHasUsableCache(false);
    }
    setSyncStateLocal(null);
    setIsInitialSyncRunning(false);
    setIsRefreshing(false);

    if (!active) return;
    let disposed = false;
    let backgroundTimer: ReturnType<typeof setTimeout> | undefined;
    cancelRef.current = false;

    void (async () => {
      try {
        await initCatalogCache();
        const [counts, state] = await Promise.all([
          getCatalogCounts(active.id),
          getCatalogSyncState(active.id),
        ]);
        if (disposed || !isCatalogSyncOwnershipCurrent(
          latestProviderIdRef.current,
          generationRef.current,
          lifecycleOwnership,
        )) return;
        const usable = hasUsableCatalogCache(counts);

        // Cache-first: publish local rows before doing any update request. A provider-switch
        // handoff may already be showing the target cache, so never blank it first.
        await refreshSnapshotFor(active, lifecycleOwnership);
        if (disposed || !isCatalogSyncOwnershipCurrent(
          latestProviderIdRef.current,
          generationRef.current,
          lifecycleOwnership,
        )) return;
        clearProviderSwitchSnapshot(active.id);
        if (disposed || resolvedProviderTransport(active) !== "xtream") return;

        // Only a genuinely empty, never-completed cache uses the blocking initial path.
        if (!usable && state?.phase !== "ready") {
          await runSync("initial");
          return;
        }

        // Usable rows remain browsable even when the previous refresh was cancelled/errored.
        // An empty cache explicitly marked ready also stays non-blocking.
        if (backgroundStartedRef.current !== active.id) {
          backgroundStartedRef.current = active.id;
          backgroundTimer = setTimeout(() => {
            if (!disposed && isCatalogSyncOwnershipCurrent(
              latestProviderIdRef.current,
              generationRef.current,
              lifecycleOwnership,
            )) void runSync("background");
          }, BACKGROUND_SYNC_DELAY_MS);
        }
      } catch {
        if (isCatalogSyncOwnershipCurrent(
          latestProviderIdRef.current,
          generationRef.current,
          lifecycleOwnership,
        )) clearProviderSwitchSnapshot(active.id);
        // SQLite/provider failures leave the legacy on-demand catalog path intact.
      }
    })();

    return () => {
      disposed = true;
      cancelRef.current = true;
      abortCatalogRequest(abortControllerRef.current);
      if (backgroundTimer) clearTimeout(backgroundTimer);
    };
  }, [provider?.id]); // provider switch is the lifecycle boundary.

  const isSyncing = isCatalogSyncActive(syncState?.phase);
  const value = useMemo<CatalogSyncContextValue>(() => ({
    syncState,
    snapshot,
    cacheReady,
    hasUsableCache,
    isSyncing,
    isRefreshing,
    refreshSnapshot,
    refreshCatalog,
    cancelInitialSync,
  }), [cacheReady, cancelInitialSync, hasUsableCache, isRefreshing, isSyncing, refreshCatalog, refreshSnapshot, snapshot, syncState]);

  const isInitialBlocking =
    resolvedProviderTransport(provider) === "xtream" &&
    shouldBlockInitialCatalogSync(hasUsableCache, isInitialSyncRunning, syncState?.phase);
  const progress = syncState && syncState.total > 0
    ? Math.max(0, Math.min(1, syncState.completed / syncState.total))
    : 0;
  const tr = language === "tr";

  return <Context.Provider value={value}>
    {children}
    <Modal
      visible={Boolean(isInitialBlocking)}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={cancelInitialSync}
    >
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>
            {tr ? "Kataloglar hazırlanıyor…" : "Preparing catalogs…"}
          </Text>
          <Text numberOfLines={2} style={[styles.modalMessage, { color: colors.mutedForeground }]}>
            {syncState?.message || (tr ? "İçerikler cihaza kaydediliyor" : "Saving content on this device")}
          </Text>
          <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: colors.primary }]} />
          </View>
          <Text style={[styles.progressText, { color: colors.mutedForeground }]}>
            {syncState?.completed ?? 0} / {syncState?.total ?? SYNC_STAGE_TOTAL}
          </Text>
          <Pressable
            onPress={cancelInitialSync}
            style={({ pressed }) => [styles.cancelButton, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={{ color: colors.foreground, fontWeight: "700" }}>
              {tr ? "Vazgeç" : "Cancel"}
            </Text>
          </Pressable>
          <Text style={[styles.fallbackText, { color: colors.mutedForeground }]}>
            {tr
              ? "Vazgeçersen mevcut isteğe bağlı yükleme davranışı kullanılmaya devam eder."
              : "If cancelled, the existing on-demand loading path remains available."}
          </Text>
        </View>
      </View>
    </Modal>
  </Context.Provider>;
}

export function useCatalogSync() {
  const value = useContext(Context);
  if (!value) throw new Error("useCatalogSync must be used within CatalogSyncProvider");
  return value;
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2, 6, 18, 0.82)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: Platform.isTV ? 560 : 420,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 24,
    paddingVertical: 26,
    alignItems: "center",
    gap: 12,
  },
  modalTitle: {
    fontSize: Platform.isTV ? 24 : 20,
    fontWeight: "800",
    textAlign: "center",
  },
  modalMessage: {
    fontSize: 13,
    textAlign: "center",
    minHeight: 36,
  },
  progressTrack: {
    width: "100%",
    height: 6,
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  progressText: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  cancelButton: {
    minWidth: 120,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  fallbackText: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },
});
