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
import AsyncStorage from "@react-native-async-storage/async-storage";
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
import type { CatalogRefreshPolicy } from "@/lib/catalogRefreshPolicy";
import {
  DEFAULT_CATALOG_REFRESH_POLICY,
  lastSuccessfulCatalogRefresh,
  parseCatalogRefreshPolicy,
  shouldRefreshCatalogAutomatically,
} from "@/lib/catalogRefreshPolicy";
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
  shouldBlockInitialCatalogSync,
  type CatalogRunState,
  type CatalogSyncMode,
  type CatalogSyncOwnership,
} from "@/lib/catalogAvailability";
import { loadProvider, Provider } from "@/lib/iptv";
import {
  beginXtreamCatalogRun,
  getSeries,
  getSeriesCategories,
  getVodCategories,
  getVodStreams,
  releaseXtreamCatalogRun,
  XtreamCredentials,
  XtreamSeriesItem,
  XtreamVodItem,
} from "@/lib/xtreamCatalog";
import { yieldToUi } from "@/lib/cooperative";
import { projectCatalogItemsCooperatively } from "@/lib/catalogPersistence";
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
import { stableXtreamLiveId } from "@/lib/xtreamIdentity";
import { safeLog } from "@/lib/safeLog";
import {
  bindStartupProvider,
  markStartupEvent,
  observeStartupPromise,
  type ProviderKind,
} from "@/lib/performanceDiagnostics";
import { syncStalkerLiveCatalog } from "@/lib/stalkerLiveSync";
import {
  executeStalkerCatalogLifecycleSync,
  makeStalkerCatalogLifecycleState,
  runStalkerActivationLifecycle,
  safeStalkerCatalogLifecycleError,
  type StalkerCatalogLifecycleState,
} from "@/lib/stalkerCatalogLifecycle";

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

export type CatalogObservableSyncState =
  | CatalogSyncState
  | CatalogRunState
  | StalkerCatalogLifecycleState;

type CatalogSyncContextValue = {
  syncState: CatalogObservableSyncState | null;
  snapshot: CatalogSnapshot;
  cacheReady: boolean;
  hasUsableCache: boolean;
  isSyncing: boolean;
  isRefreshing: boolean;
  refreshPolicy: CatalogRefreshPolicy;
  refreshPolicyReady: boolean;
  lastSuccessfulAt: number | null;
  setRefreshPolicy: (policy: CatalogRefreshPolicy) => Promise<void>;
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
const CATALOG_REFRESH_POLICY_STORAGE_KEY = "@legendstream/catalog-refresh-policy-v1";
const SYNC_STAGE_TOTAL = 4;
const PROGRESS_BUCKETS = 10;

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
  const {
    provider,
    channels,
    isHydrating,
    m3uCatalogCommit,
    recoverLegacyCatalogFallback,
    refreshProvider,
  } = usePlayer();
  const colors = useColors();
  const { language } = useI18n();
  const [syncState, setSyncStateLocal] = useState<CatalogObservableSyncState | null>(null);
  const [snapshot, setSnapshot] = useState<CatalogSnapshot>(EMPTY_SNAPSHOT);
  const [hasUsableCache, setHasUsableCache] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInitialSyncRunning, setIsInitialSyncRunning] = useState(false);
  const [refreshPolicy, setRefreshPolicyLocal] = useState<CatalogRefreshPolicy>(DEFAULT_CATALOG_REFRESH_POLICY);
  const [refreshPolicyReady, setRefreshPolicyReady] = useState(false);
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<number | null>(null);
  const cancelRef = useRef(false);
  const generationRef = useRef(0);
  const latestProviderIdRef = useRef<string | null>(provider?.id ?? null);
  const latestProviderRef = useRef<ActiveCatalogProvider | null>(provider);
  const runningRef = useRef<RunningCatalogTask | null>(null);
  const activeRunIdRef = useRef<number | null>(null);
  const activeModeRef = useRef<CatalogSyncMode | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const automaticStartedRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(CATALOG_REFRESH_POLICY_STORAGE_KEY).then((saved) => {
      if (!active) return;
      if (saved) {
        try { setRefreshPolicyLocal(parseCatalogRefreshPolicy(JSON.parse(saved))); }
        catch { setRefreshPolicyLocal(DEFAULT_CATALOG_REFRESH_POLICY); }
      } else {
        setRefreshPolicyLocal(DEFAULT_CATALOG_REFRESH_POLICY);
        void AsyncStorage.setItem(CATALOG_REFRESH_POLICY_STORAGE_KEY, JSON.stringify(DEFAULT_CATALOG_REFRESH_POLICY)).catch(() => undefined);
      }
      setRefreshPolicyReady(true);
    }).catch(() => {
      if (active) setRefreshPolicyReady(true);
    });
    return () => { active = false; };
  }, []);

  const setRefreshPolicy = useCallback(async (next: CatalogRefreshPolicy) => {
    const normalized = parseCatalogRefreshPolicy(next);
    await AsyncStorage.setItem(CATALOG_REFRESH_POLICY_STORAGE_KEY, JSON.stringify(normalized));
    setRefreshPolicyLocal(normalized);
  }, []);

  useLayoutEffect(() => {
    const committedProviderId = provider?.id ?? null;
    latestProviderRef.current = provider;
    if (latestProviderIdRef.current !== committedProviderId) {
      latestProviderIdRef.current = committedProviderId;
      generationRef.current += 1;
    }
  }, [provider?.id]);

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
    bindStartupProvider(ownership.generation, active.type as ProviderKind);
    await initCatalogCache();
    const [counts, state] = await Promise.all([
      observeStartupPromise("COUNTS_BEGIN", "COUNTS_END", getCatalogCounts(active.id)),
      observeStartupPromise("SYNC_STATE_BEGIN", "SYNC_STATE_END", getCatalogSyncState(active.id)),
    ]);
    setLastSuccessfulAt(lastSuccessfulCatalogRefresh(state?.lastFullSyncAt, state?.lastBackgroundSyncAt));
    const ready = state?.phase === "ready";
    const usable = hasUsableCatalogCache(counts);
    const [live, movies, series, newContent] = await Promise.all([
      observeStartupPromise("HOME_LIVE_QUERY_BEGIN", "HOME_LIVE_QUERY_END", getCachedLiveItems(active, undefined, HOME_SAMPLE_LIMIT)),
      observeStartupPromise("HOME_VOD_QUERY_BEGIN", "HOME_VOD_QUERY_END", getCachedVodItems(active, undefined, HOME_SAMPLE_LIMIT)),
      observeStartupPromise("HOME_SERIES_QUERY_BEGIN", "HOME_SERIES_QUERY_END", getCachedSeriesItems(active, undefined, HOME_SAMPLE_LIMIT)),
      observeStartupPromise("HOME_NEW_CONTENT_QUERY_BEGIN", "HOME_NEW_CONTENT_QUERY_END", Promise.all([
        getNewCachedLiveItems(active, NEW_SAMPLE_LIMIT),
        getNewCachedVodItems(active, NEW_SAMPLE_LIMIT),
        getNewCachedSeriesItems(active, NEW_SAMPLE_LIMIT),
      ])),
    ]);
    const [newChannels, newMovies, newSeries] = newContent;
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
    markStartupEvent("SNAPSHOT_PUBLISH");
    setHasUsableCache(usable);
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
    const createProgressPublisher = (label: "Movies" | "Series") => {
      let lastBucket = -1;
      return async (done: number, categoryTotal: number, path: "parallel" | "serial") => {
        if (isCancelled()) return;
        const bucket = categoryTotal <= 0
          ? PROGRESS_BUCKETS
          : Math.min(PROGRESS_BUCKETS, Math.floor((done * PROGRESS_BUCKETS) / categoryTotal));
        if (bucket <= lastBucket && done < categoryTotal) return;
        lastBucket = bucket;
        await publishState(
          ownership,
          "syncing",
          completed,
          total,
          `${label} · ${path === "parallel" ? "parallel" : "serial"} fallback ${done}/${categoryTotal}`,
        );
      };
    };

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

        beginXtreamCatalogRun(credentials, controller.signal);

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

                const liveUniqueIds = new Set<string>();
                const projected = await projectCatalogItemsCooperatively(stagingId, "live", liveRows, {
                  isCancelled,
                  onProjectedItem: (item) => {
                    if (item.catalogKind !== "live") return;
                    if (item.playbackRef.type === "xtream-live") {
                      item.id = stableXtreamLiveId(provider.id, item.playbackRef.streamId);
                    }
                    liveUniqueIds.add(item.id);
                  },
                });
                if (isCancelled()) return;
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
                  expectedCount: liveUniqueIds.size,
                  canPublish: () => !isCancelled(),
                });
                if (!published.published && !isCancelled()) {
                  throw new Error("Xtream Live publish ownership changed.");
                }
                if (!isCancelled()) {
                  completed += 1;
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
                const publishVodProgress = createProgressPublisher("Movies");

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
                    const projectedRows = await projectCatalogItemsCooperatively(stagingId, "vod", rows, {
                      isCancelled,
                      onProjectedItem: (item) => {
                        if (item.catalogKind === "vod") vodUniqueIds.add(String(item.stream_id));
                      },
                    });
                    if (isCancelled()) return;
                    await upsertCatalogItems(stagingId, "vod", projectedRows, {
                      markNew,
                      seenAt: syncStartedAt,
                      isCancelled,
                    });
                  },
                  categoryIdOf: (row) => row.category_id,
                  isCancelled,
                  allowHealthyBulkOnCategoryFailure: true,
                  onFallbackProgress: publishVodProgress,
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
                const publishSeriesProgress = createProgressPublisher("Series");

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
                    const projectedRows = await projectCatalogItemsCooperatively(stagingId, "series", rows, {
                      isCancelled,
                      onProjectedItem: (item) => {
                        if (item.catalogKind === "series") seriesUniqueIds.add(String(item.series_id));
                      },
                    });
                    if (isCancelled()) return;
                    await upsertCatalogItems(stagingId, "series", projectedRows, {
                      markNew,
                      seenAt: syncStartedAt,
                      isCancelled,
                    });
                  },
                  categoryIdOf: (row) => row.category_id,
                  isCancelled,
                  onFallbackProgress: publishSeriesProgress,
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
        releaseXtreamCatalogRun(credentials, controller.signal);
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

  const runStalkerSync = useCallback(async (mode: CatalogSyncMode) => {
    const active = provider;
    if (!active || active.type !== "stalker" || active.id !== latestProviderIdRef.current) return;
    const running = runningRef.current;
    if (running && isCatalogSyncOwnershipCurrent(
      latestProviderIdRef.current,
      generationRef.current,
      running.ownership,
    )) return running.task;

    const generation = ++generationRef.current;
    const ownership: CatalogSyncOwnership = { providerId: active.id, generation };
    const controller = new AbortController();
    activeRunIdRef.current = generation;
    activeModeRef.current = mode;
    abortControllerRef.current = controller;
    cancelRef.current = false;
    if (mode === "initial") setIsInitialSyncRunning(true);
    else setIsRefreshing(true);

    if (mode === "manual" || mode === "background") {
      safeLog.info("LS_STALKER_LIFECYCLE_DECISION", {
        providerId: active.id,
        decision: mode === "manual" ? "MANUAL_REFRESH" : "BACKGROUND_REFRESH",
      });
    }

    const isCurrent = () =>
      !controller.signal.aborted &&
      isCatalogSyncOwnershipCurrent(
        latestProviderIdRef.current,
        generationRef.current,
        ownership,
      );

    const task = (async () => {
      try {
        const result = await executeStalkerCatalogLifecycleSync({
          provider: active,
          mode,
          signal: controller.signal,
          isCurrent,
          sync: syncStalkerLiveCatalog,
          refreshSnapshot: () => refreshSnapshotFor(active, ownership),
          onState: (next) => {
            if (isCurrent()) setSyncStateLocal(next);
          },
          log: (marker, payload) => safeLog.info(marker, payload),
        });
        if (result.result === "SUCCESS" && isCurrent()) {
          await setCatalogSyncState(
            active.id,
            "ready",
            1,
            1,
            "Stalker Live catalog ready",
            mode === "background" ? "background" : "full",
          );
          const committedState = await getCatalogSyncState(active.id);
          if (isCurrent()) setLastSuccessfulAt(lastSuccessfulCatalogRefresh(
            committedState?.lastFullSyncAt,
            committedState?.lastBackgroundSyncAt,
          ));
        }
      } finally {
        if (
          activeRunIdRef.current === generation &&
          isCatalogSyncOwnershipCurrent(
            latestProviderIdRef.current,
            generationRef.current,
            ownership,
          )
        ) {
          if (mode === "initial") setIsInitialSyncRunning(false);
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
  }, [provider, refreshSnapshotFor]);

  const runM3URefresh = useCallback(async () => {
    const active = provider;
    if (!active || resolvedProviderTransport(active) !== "m3u" || active.id !== latestProviderIdRef.current) return;
    const running = runningRef.current;
    if (running && isCatalogSyncOwnershipCurrent(latestProviderIdRef.current, generationRef.current, running.ownership)) {
      return running.task;
    }
    const generation = ++generationRef.current;
    const ownership: CatalogSyncOwnership = { providerId: active.id, generation };
    const task = (async () => {
      setIsRefreshing(true);
      setSyncStateLocal({ providerId: active.id, phase: "syncing", completed: 0, total: 1, message: "Catalog update started", updatedAt: Date.now() });
      try {
        const committed = await refreshProvider(active.id);
        if (!isCatalogSyncOwnershipCurrent(latestProviderIdRef.current, generationRef.current, ownership)) return;
        if (committed) {
          await refreshSnapshotFor(active, ownership);
        } else {
          await refreshSnapshotFor(active, ownership);
          if (isCatalogSyncOwnershipCurrent(latestProviderIdRef.current, generationRef.current, ownership)) {
            setSyncStateLocal({ providerId: active.id, phase: "error", completed: 0, total: 1, message: "Catalog update failed.", updatedAt: Date.now() });
          }
        }
      } finally {
        if (isCatalogSyncOwnershipCurrent(latestProviderIdRef.current, generationRef.current, ownership)) setIsRefreshing(false);
      }
    })();
    runningRef.current = { ownership, task };
    const release = () => { if (runningRef.current?.task === task) runningRef.current = null; };
    void task.then(release, release);
    return task;
  }, [provider, refreshProvider, refreshSnapshotFor]);

  const refreshCatalog = useCallback(async () => {
    if (provider && resolvedProviderTransport(provider) === "m3u") await runM3URefresh();
    else if (provider?.type === "stalker") await runStalkerSync("manual");
    else await runSync("manual");
  }, [provider, runM3URefresh, runStalkerSync, runSync]);

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
    automaticStartedRef.current = null;

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

    if (isHydrating || !active) return;
    bindStartupProvider(lifecycleOwnership.generation, active.type as ProviderKind);
    let disposed = false;
    cancelRef.current = false;
    const lifecycleIsCurrent = () =>
      !disposed &&
      isCatalogSyncOwnershipCurrent(
        latestProviderIdRef.current,
        generationRef.current,
        lifecycleOwnership,
      );

    void (async () => {
      try {
        if (active.type === "stalker") {
          const result = await runStalkerActivationLifecycle({
            provider: active,
            isCurrent: lifecycleIsCurrent,
            readLiveCount: async () => {
              await initCatalogCache();
              return (await observeStartupPromise("COUNTS_BEGIN", "COUNTS_END", getCatalogCounts(active.id))).live;
            },
            refreshSnapshot: async () => {
              await refreshSnapshotFor(active, lifecycleOwnership);
              if (lifecycleIsCurrent()) clearProviderSwitchSnapshot(active.id);
            },
            runInitialSync: async () => {
              await runStalkerSync("initial");
            },
            onState: (next) => {
              if (lifecycleIsCurrent()) setSyncStateLocal(next);
            },
            log: (marker, payload) => safeLog.info(marker, payload),
          });

          if (!lifecycleIsCurrent()) return;
          return;
        }

        await initCatalogCache();
        const [counts, state] = await Promise.all([
          observeStartupPromise("COUNTS_BEGIN", "COUNTS_END", getCatalogCounts(active.id)),
          observeStartupPromise("SYNC_STATE_BEGIN", "SYNC_STATE_END", getCatalogSyncState(active.id)),
        ]);
        if (!lifecycleIsCurrent()) return;
        const usable = hasUsableCatalogCache(counts);

        await refreshSnapshotFor(active, lifecycleOwnership);
        if (!lifecycleIsCurrent()) return;
        clearProviderSwitchSnapshot(active.id);
        if (disposed || resolvedProviderTransport(active) !== "xtream") return;

        if (!usable && state?.phase !== "ready") {
          await runSync("initial");
          return;
        }

      } catch (caught) {
        if (!lifecycleIsCurrent()) return;
        clearProviderSwitchSnapshot(active.id);
        if (active.type === "stalker") {
          const safe = safeStalkerCatalogLifecycleError(caught);
          setSyncStateLocal(makeStalkerCatalogLifecycleState(
            active.id,
            "error",
            {
              message: safe.message,
              errorCode: safe.errorCode,
              retryAvailable: true,
            },
          ));
        }
      }
    })();

    return () => {
      disposed = true;
      cancelRef.current = true;
      abortCatalogRequest(abortControllerRef.current);
    };
  }, [
    isHydrating,
    provider?.id,
    provider?.type,
    provider?.type === "stalker" ? provider.lastLoadedAt : undefined,
    provider?.type === "stalker" ? provider.needsCredentials : undefined,
  ]);

  useEffect(() => {
    const active = provider;
    const activeTransport = active ? resolvedProviderTransport(active) : null;
    if (
      !active || isHydrating || !refreshPolicyReady || isRefreshing || isInitialSyncRunning ||
      snapshot.providerId !== active.id || !refreshPolicy.automaticRefreshEnabled
    ) return;
    // Stalker's current lifecycle sync publishes Live only. VOD/Series product
    // surfaces keep their own session and request lifecycle and are not a Live-cache hit.
    const providerCacheAvailable = active.type === "stalker"
      ? snapshot.counts.live > 0
      : hasUsableCache;
    if (!providerCacheAvailable) return;

    const intervalMs = refreshPolicy.refreshIntervalHours * 60 * 60 * 1000;
    const dueAt = lastSuccessfulAt === null ? Date.now() : lastSuccessfulAt + intervalMs;
    const delay = Math.max(0, dueAt - Date.now());
    const runKey = `${active.id}:${lastSuccessfulAt ?? "never"}:${refreshPolicy.refreshIntervalHours}`;
    if (automaticStartedRef.current === runKey) return;
    const timer = setTimeout(() => {
      if (automaticStartedRef.current === runKey) return;
      if (!shouldRefreshCatalogAutomatically({
        policy: refreshPolicy,
        hasUsableCache: providerCacheAvailable,
        lastSuccessfulAt,
        now: Date.now(),
      })) return;
      automaticStartedRef.current = runKey;
      if (activeTransport === "m3u") void runM3URefresh();
      else if (active.type === "stalker") void runStalkerSync("background");
      else void runSync("background");
    }, delay);
    return () => clearTimeout(timer);
  }, [
    hasUsableCache,
    isHydrating,
    isInitialSyncRunning,
    isRefreshing,
    lastSuccessfulAt,
    provider,
    refreshPolicy,
    refreshPolicyReady,
    runM3URefresh,
    runStalkerSync,
    runSync,
    refreshPolicy.automaticRefreshEnabled,
    snapshot.counts.live,
    snapshot.providerId,
  ]);

  const isSyncing = syncState?.phase === "preparing" || syncState?.phase === "syncing";
  const value = useMemo<CatalogSyncContextValue>(() => ({
    syncState,
    snapshot,
    cacheReady,
    hasUsableCache,
    isSyncing,
    isRefreshing,
    refreshPolicy,
    refreshPolicyReady,
    lastSuccessfulAt,
    setRefreshPolicy,
    refreshSnapshot,
    refreshCatalog,
    cancelInitialSync,
  }), [cacheReady, cancelInitialSync, hasUsableCache, isRefreshing, isSyncing, lastSuccessfulAt, refreshCatalog, refreshPolicy, refreshPolicyReady, refreshSnapshot, setRefreshPolicy, snapshot, syncState]);

  const persistedSyncPhase =
    syncState?.phase === "credentials-required" || syncState?.phase === "cache-ready"
      ? undefined
      : syncState?.phase;
  const isInitialBlocking =
    resolvedProviderTransport(provider) === "xtream" &&
    shouldBlockInitialCatalogSync(hasUsableCache, isInitialSyncRunning, persistedSyncPhase);
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
