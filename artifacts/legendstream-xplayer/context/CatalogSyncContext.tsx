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
  replaceCatalogCategories,
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
import { projectCatalogItems, type CatalogKind } from "@/lib/catalogPersistence";
import { runCatalogFetchPlan, type CatalogFetchMetrics } from "@/lib/catalogSyncStrategy";
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
import { syncStalkerLiveCatalog } from "@/lib/stalkerLiveSync";
import { runIndependentXtreamKindSync } from "@/lib/xtreamKindOrchestrator";
import {
  cleanupXtreamKindStaging,
  publishXtreamKindStaging,
  xtreamKindStagingProviderId,
} from "@/lib/xtreamKindStaging";

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
const STALKER_SYNC_STAGE_TOTAL = 1;
const XTREAM_STAGE_PROJECT_BATCH = 500;

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
  const { provider, m3uCatalogCommit, recoverLegacyCatalogFallback } = usePlayer();
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

  const runStalkerSync = useCallback(async (mode: CatalogSyncMode) => {
    if (!provider || provider.type !== "stalker") return;
    if (provider.id !== latestProviderIdRef.current) return;
    const portalUrl = provider.url || provider.playlistUrl;
    const mac = provider.mac?.trim() || "";
    if (!portalUrl || !mac) return;
    const running = runningRef.current;
    if (running && isCatalogSyncOwnershipCurrent(
      latestProviderIdRef.current,
      generationRef.current,
      running.ownership,
    )) return running.task;

    const generation = ++generationRef.current;
    const ownership: CatalogSyncOwnership = { providerId: provider.id, generation };
    const isInitial = mode === "initial";
    const controller = new AbortController();
    activeRunIdRef.current = generation;
    activeModeRef.current = mode;
    abortControllerRef.current = controller;
    cancelRef.current = false;
    setSyncStateLocal(freshCatalogRunState(provider.id, generation, mode));

    const isCancelled = () =>
      cancelRef.current ||
      controller.signal.aborted ||
      !isCatalogSyncOwnershipCurrent(
        latestProviderIdRef.current,
        generationRef.current,
        ownership,
      );

    const task = (async () => {
      if (isInitial) setIsInitialSyncRunning(true);
      else setIsRefreshing(true);
      try {
        await initCatalogCache();
        await publishState(
          ownership,
          isInitial ? "preparing" : "syncing",
          0,
          STALKER_SYNC_STAGE_TOTAL,
          isInitial ? "Preparing Stalker Live catalog" : "Stalker Live update started",
        );
        await syncStalkerLiveCatalog({
          provider: { id: provider.id, url: portalUrl, mac },
          signal: controller.signal,
          isCurrent: () => !isCancelled(),
          onProgress: async (progress) => {
            if (isCancelled()) return;
            const message = progress.phase === "categories"
              ? "Live TV · categories"
              : progress.phase === "committing"
                ? "Live TV · finalizing"
                : `Live TV · page ${progress.page ?? 1}`;
            await publishState(
              ownership,
              "syncing",
              0,
              STALKER_SYNC_STAGE_TOTAL,
              message,
            );
          },
        });
        if (isCancelled()) return;
        await publishState(
          ownership,
          "ready",
          STALKER_SYNC_STAGE_TOTAL,
          STALKER_SYNC_STAGE_TOTAL,
          "Stalker Live cache ready",
          mode === "background" ? "background" : "full",
        );
        await refreshSnapshotFor(provider, ownership);
      } catch (caught) {
        if (isCancelled()) {
          await publishState(
            ownership,
            "cancelled",
            0,
            STALKER_SYNC_STAGE_TOTAL,
            "Stalker Live preparation cancelled",
          );
          await refreshSnapshotFor(provider, ownership);
          return;
        }
        const message = caught instanceof Error ? caught.message : "Stalker Live synchronization failed";
        await publishState(
          ownership,
          "error",
          0,
          STALKER_SYNC_STAGE_TOTAL,
          message,
        );
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
  }, [provider, publishState, refreshSnapshotFor]);

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

    const stageRows = async (
      kind: CatalogKind,
      stagingId: string,
      rows: Array<Channel | XtreamVodItem | XtreamSeriesItem>,
    ) => {
      for (let start = 0; start < rows.length; start += XTREAM_STAGE_PROJECT_BATCH) {
        if (isCancelled()) return;
        const projected = projectCatalogItems(
          stagingId,
          kind,
          rows.slice(start, start + XTREAM_STAGE_PROJECT_BATCH),
        );
        const options = { markNew, seenAt: syncStartedAt, isCancelled };
        if (kind === "live") {
          await upsertCatalogItems(stagingId, "live", projected, options);
        } else if (kind === "vod") {
          await upsertCatalogItems(stagingId, "vod", projected, options);
        } else {
          await upsertCatalogItems(stagingId, "series", projected, options);
        }
        await yieldToUi();
      }
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

        const result = await runIndependentXtreamKindSync({
          isCurrent: ownsRun,
          isCancelled,
          tasks: [
            {
              kind: "live",
              cleanup: () => cleanupXtreamKindStaging(provider.id, generation, "live"),
              run: async () => {
                await cleanupXtreamKindStaging(provider.id, generation, "live");
                if (isCancelled()) return "preserved";
                await publishState(ownership, "syncing", completed, total, "Live TV · loading");
                const liveRows = (await loadProvider(asLoadProvider(provider))).channels;
                if (isCancelled()) return "preserved";
                const stagingId = xtreamKindStagingProviderId(provider.id, generation, "live");
                const writeStartedAt = Date.now();
                await stageRows("live", stagingId, liveRows);
                liveSqliteWriteMs = Date.now() - writeStartedAt;
                if (isCancelled()) return "preserved";
                await publishXtreamKindStaging(provider.id, generation, "live", () => !isCancelled());
                completed = 1;
                return "published";
              },
            },
            {
              kind: "vod",
              cleanup: () => cleanupXtreamKindStaging(provider.id, generation, "vod"),
              run: async () => {
                await cleanupXtreamKindStaging(provider.id, generation, "vod");
                if (isCancelled()) return "preserved";
                await publishState(ownership, "syncing", completed, total, "Movies · categories");
                const categories = await getVodCategories(credentials, controller.signal);
                if (isCancelled()) return "preserved";
                const stagingId = xtreamKindStagingProviderId(provider.id, generation, "vod");
                await replaceCatalogCategories(stagingId, "vod", categories);
                if (isCancelled()) return "preserved";
                await publishState(ownership, "syncing", completed, total, "Movies · bulk catalog");
                vodMetrics = await runCatalogFetchPlan<XtreamVodItem, (typeof categories)[number]>({
                  categories,
                  fetchBulk: (onParseMs) => getVodStreams(
                    credentials,
                    undefined,
                    controller.signal,
                    ({ parseMs }) => onParseMs(parseMs),
                  ),
                  fetchCategory: (category) => getVodStreams(credentials, category.category_id, controller.signal),
                  writeRows: async (rows) => stageRows("vod", stagingId, rows),
                  categoryIdOf: (row) => row.category_id,
                  isCancelled,
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
                if (isCancelled()) return "preserved";
                await publishXtreamKindStaging(provider.id, generation, "vod", () => !isCancelled());
                completed = 2;
                return "published";
              },
            },
            {
              kind: "series",
              cleanup: () => cleanupXtreamKindStaging(provider.id, generation, "series"),
              run: async () => {
                await cleanupXtreamKindStaging(provider.id, generation, "series");
                if (isCancelled()) return "preserved";
                await publishState(ownership, "syncing", completed, total, "Series · categories");
                const categories = await getSeriesCategories(credentials, controller.signal);
                if (isCancelled()) return "preserved";
                const stagingId = xtreamKindStagingProviderId(provider.id, generation, "series");
                await replaceCatalogCategories(stagingId, "series", categories);
                if (isCancelled()) return "preserved";
                await publishState(ownership, "syncing", completed, total, "Series · bulk catalog");
                seriesMetrics = await runCatalogFetchPlan<XtreamSeriesItem, (typeof categories)[number]>({
                  categories,
                  fetchBulk: (onParseMs) => getSeries(
                    credentials,
                    undefined,
                    controller.signal,
                    ({ parseMs }) => onParseMs(parseMs),
                  ),
                  fetchCategory: (category) => getSeries(credentials, category.category_id, controller.signal),
                  writeRows: async (rows) => stageRows("series", stagingId, rows),
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
                if (isCancelled()) return "preserved";
                await publishXtreamKindStaging(provider.id, generation, "series", () => !isCancelled());
                completed = 3;
                return "published";
              },
            },
          ],
        });

        if (result.cancelled || isCancelled()) {
          await Promise.all([
            cleanupXtreamKindStaging(provider.id, generation, "live"),
            cleanupXtreamKindStaging(provider.id, generation, "vod"),
            cleanupXtreamKindStaging(provider.id, generation, "series"),
          ]);
          await publishState(ownership, "cancelled", completed, total, "Catalog preparation cancelled");
          await refreshSnapshotFor(provider, ownership);
          return;
        }

        completed = 3;
        await publishState(ownership, "syncing", completed, total, "Finalizing catalog cache");
        const failed = result.outcomes.filter((outcome) => outcome.status === "preserved" && outcome.error !== undefined);
        if (failed.length === 3) {
          const firstError = failed[0]?.error;
          if (firstError && await recoverLegacyCatalogFallback(provider.id, firstError)) return;
          const message = firstError instanceof Error ? firstError.message : "Catalog synchronization failed";
          await publishState(ownership, "error", completed, total, message);
          await refreshSnapshotFor(provider, ownership);
          return;
        }

        completed = total;
        const readyMessage = failed.length
          ? `Catalog cache ready · ${3 - failed.length}/3 kinds updated`
          : "Catalog cache ready";
        await publishState(
          ownership,
          "ready",
          completed,
          total,
          readyMessage,
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
        await Promise.all([
          cleanupXtreamKindStaging(provider.id, generation, "live"),
          cleanupXtreamKindStaging(provider.id, generation, "vod"),
          cleanupXtreamKindStaging(provider.id, generation, "series"),
        ]);
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
  }, [provider, publishState, recoverLegacyCatalogFallback, refreshSnapshotFor]);

  const refreshCatalog = useCallback(async () => {
    await runSync("manual");
    if (provider?.type === "stalker") {
      await runStalkerSync("manual");
    }
  }, [provider?.type, runStalkerSync, runSync]);

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

        await refreshSnapshotFor(active, lifecycleOwnership);
        if (disposed || !isCatalogSyncOwnershipCurrent(
          latestProviderIdRef.current,
          generationRef.current,
          lifecycleOwnership,
        )) return;
        clearProviderSwitchSnapshot(active.id);
        const transport = resolvedProviderTransport(active);
        const supportsCatalogSync = transport === "xtream" || active.type === "stalker";
        if (disposed || !supportsCatalogSync) return;
        const runForActive = active.type === "stalker" ? runStalkerSync : runSync;

        if (!usable && state?.phase !== "ready") {
          await runSync("initial");
          if (active.type === "stalker") {
            await runStalkerSync("initial");
          }
          return;
        }

        if (backgroundStartedRef.current !== active.id) {
          backgroundStartedRef.current = active.id;
          backgroundTimer = setTimeout(() => {
            if (!disposed && isCatalogSyncOwnershipCurrent(
              latestProviderIdRef.current,
              generationRef.current,
              lifecycleOwnership,
            )) void runForActive("background");
          }, BACKGROUND_SYNC_DELAY_MS);
        }
      } catch {
        if (isCatalogSyncOwnershipCurrent(
          latestProviderIdRef.current,
          generationRef.current,
          lifecycleOwnership,
        )) clearProviderSwitchSnapshot(active.id);
      }
    })();

    return () => {
      disposed = true;
      cancelRef.current = true;
      abortCatalogRequest(abortControllerRef.current);
      if (backgroundTimer) clearTimeout(backgroundTimer);
    };
  }, [provider?.id]);

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

  const syncTransport = resolvedProviderTransport(provider);
  const isInitialBlocking =
    (syncTransport === "xtream" || provider?.type === "stalker") &&
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
              ? "Vazgeçersen mevcut önbellek kullanılmaya devam eder."
              : "If cancelled, the existing cache remains available."}
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