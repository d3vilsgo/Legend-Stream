import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
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
  getCachedItems,
  getCatalogCounts,
  getCatalogSyncState,
  getNewCachedItems,
  hasCatalogCache,
  initCatalogCache,
  replaceCatalogCategories,
  setCatalogSyncState,
  upsertCatalogItems,
} from "@/lib/catalogCache";
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
import type { Channel } from "@/lib/iptv";

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

type SyncMode = "initial" | "background" | "manual";

type CatalogSyncContextValue = {
  syncState: CatalogSyncState | null;
  snapshot: CatalogSnapshot;
  cacheReady: boolean;
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

const Context = createContext<CatalogSyncContextValue | null>(null);

function providerCredentials(provider: ReturnType<typeof usePlayer>["provider"]): XtreamCredentials | null {
  if (!provider || provider.type !== "xtream" || !provider.username || !provider.password) return null;
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
    type: provider.type,
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
  const { provider, channels } = usePlayer();
  const colors = useColors();
  const { language } = useI18n();
  const [syncState, setSyncStateLocal] = useState<CatalogSyncState | null>(null);
  const [snapshot, setSnapshot] = useState<CatalogSnapshot>(EMPTY_SNAPSHOT);
  const [cacheReady, setCacheReady] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const cancelRef = useRef(false);
  const runningRef = useRef<Promise<void> | null>(null);
  const generationRef = useRef(0);
  const backgroundStartedRef = useRef<string | null>(null);

  const refreshSnapshot = useCallback(async () => {
    const active = provider;
    if (!active) {
      setSnapshot(EMPTY_SNAPSHOT);
      setCacheReady(false);
      return;
    }
    await initCatalogCache();
    const [counts, state] = await Promise.all([
      getCatalogCounts(active.id),
      getCatalogSyncState(active.id),
    ]);
    const ready = state?.phase === "ready";
    const [live, movies, series, newChannels, newMovies, newSeries] = await Promise.all([
      getCachedItems<Channel>(active.id, "live", undefined, HOME_SAMPLE_LIMIT),
      getCachedItems<XtreamVodItem>(active.id, "vod", undefined, HOME_SAMPLE_LIMIT),
      getCachedItems<XtreamSeriesItem>(active.id, "series", undefined, HOME_SAMPLE_LIMIT),
      getNewCachedItems<Channel>(active.id, "live", NEW_SAMPLE_LIMIT),
      getNewCachedItems<XtreamVodItem>(active.id, "vod", NEW_SAMPLE_LIMIT),
      getNewCachedItems<XtreamSeriesItem>(active.id, "series", NEW_SAMPLE_LIMIT),
    ]);
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
    setCacheReady(ready);
    setSyncStateLocal(state);
  }, [provider]);

  const publishState = useCallback(async (
    providerId: string,
    phase: CatalogSyncState["phase"],
    completed: number,
    total: number,
    message?: string,
    stamp?: "full" | "background",
  ) => {
    const next: CatalogSyncState = {
      providerId,
      phase,
      completed,
      total,
      message,
      updatedAt: Date.now(),
    };
    setSyncStateLocal(next);
    await setCatalogSyncState(providerId, phase, completed, total, message, stamp);
  }, []);

  const runSync = useCallback(async (mode: SyncMode) => {
    if (!provider || provider.type !== "xtream") return;
    const credentials = providerCredentials(provider);
    if (!credentials) return;
    if (runningRef.current) return runningRef.current;

    const generation = ++generationRef.current;
    const isInitial = mode === "initial";
    const markNew = mode !== "initial";
    cancelRef.current = false;
    const isCancelled = () => cancelRef.current || generationRef.current !== generation;

    const task = (async () => {
      if (!isInitial) setIsRefreshing(true);
      try {
        await initCatalogCache();
        await publishState(
          provider.id,
          isInitial ? "preparing" : "syncing",
          0,
          1,
          isInitial ? "Catalogs are being prepared" : "Catalog update started",
        );

        const vodCategories = await getVodCategories(credentials);
        if (isCancelled()) return;
        await replaceCatalogCategories(provider.id, "vod", vodCategories);
        await yieldToUi();

        const seriesCategories = await getSeriesCategories(credentials);
        if (isCancelled()) return;
        await replaceCatalogCategories(provider.id, "series", seriesCategories);
        await yieldToUi();

        const total = 1 + Math.max(vodCategories.length, 1) + Math.max(seriesCategories.length, 1);
        let completed = 0;
        await publishState(provider.id, "syncing", completed, total, "Live TV");

        // Initial preparation can reuse the just-loaded PlayerContext list. Background/manual
        // refreshes deliberately hit the provider again so newly-added live channels can be found.
        const currentLive = channels.filter(
          (channel) => channel.providerId === provider.id && (channel.contentType ?? "live") === "live",
        );
        const liveRows = isInitial && currentLive.length
          ? currentLive
          : (await loadProvider(asLoadProvider(provider))).channels;
        if (isCancelled()) return;
        await upsertCatalogItems(provider.id, "live", liveRows, { markNew, isCancelled });
        completed += 1;
        await publishState(provider.id, "syncing", completed, total, "Movies");

        if (vodCategories.length) {
          for (const category of vodCategories) {
            if (isCancelled()) break;
            const rows = await getVodStreams(credentials, category.category_id);
            if (isCancelled()) break;
            await upsertCatalogItems(provider.id, "vod", rows, { markNew, isCancelled });
            completed += 1;
            await publishState(provider.id, "syncing", completed, total, `Movies · ${category.category_name}`);
            await yieldToUi();
          }
        } else if (!isCancelled()) {
          const rows = await getVodStreams(credentials);
          await upsertCatalogItems(provider.id, "vod", rows, { markNew, isCancelled });
          completed += 1;
        }

        if (isCancelled()) {
          await publishState(provider.id, "cancelled", completed, total, "Catalog preparation cancelled");
          await refreshSnapshot();
          return;
        }

        if (seriesCategories.length) {
          for (const category of seriesCategories) {
            if (isCancelled()) break;
            const rows = await getSeries(credentials, category.category_id);
            if (isCancelled()) break;
            await upsertCatalogItems(provider.id, "series", rows, { markNew, isCancelled });
            completed += 1;
            await publishState(provider.id, "syncing", completed, total, `Series · ${category.category_name}`);
            await yieldToUi();
          }
        } else if (!isCancelled()) {
          const rows = await getSeries(credentials);
          await upsertCatalogItems(provider.id, "series", rows, { markNew, isCancelled });
          completed += 1;
        }

        if (isCancelled()) {
          await publishState(provider.id, "cancelled", completed, total, "Catalog preparation cancelled");
          await refreshSnapshot();
          return;
        }

        await publishState(
          provider.id,
          "ready",
          total,
          total,
          "Catalog cache ready",
          mode === "background" ? "background" : "full",
        );
        await refreshSnapshot();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Catalog synchronization failed";
        // A silent update failure must not invalidate an already-good local catalog.
        if (isInitial || !cacheReady) {
          await publishState(provider.id, "error", 0, 1, message);
        } else {
          await publishState(provider.id, "ready", 0, 0, message);
        }
        await refreshSnapshot();
      } finally {
        if (!isInitial) setIsRefreshing(false);
      }
    })().finally(() => {
      runningRef.current = null;
    });

    runningRef.current = task;
    return task;
  }, [cacheReady, channels, provider, publishState, refreshSnapshot]);

  const refreshCatalog = useCallback(async () => {
    await runSync("manual");
  }, [runSync]);

  const cancelInitialSync = useCallback(() => {
    cancelRef.current = true;
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    cancelRef.current = true;
    runningRef.current = null;
    backgroundStartedRef.current = null;
    setSnapshot(EMPTY_SNAPSHOT);
    setCacheReady(false);
    setSyncStateLocal(null);

    const active = provider;
    if (!active) return;
    let disposed = false;
    let backgroundTimer: ReturnType<typeof setTimeout> | undefined;
    cancelRef.current = false;

    void (async () => {
      try {
        await initCatalogCache();
        const [hasCache, state] = await Promise.all([
          hasCatalogCache(active.id),
          getCatalogSyncState(active.id),
        ]);
        if (disposed) return;

        // Cache-first: publish local rows before doing any update request.
        await refreshSnapshot();
        if (disposed || active.type !== "xtream") return;

        if (!hasCache || state?.phase !== "ready") {
          await runSync("initial");
          return;
        }

        // TiviMate-style stale-while-revalidate: render cache now, check server later.
        if (backgroundStartedRef.current !== active.id) {
          backgroundStartedRef.current = active.id;
          backgroundTimer = setTimeout(() => {
            if (!disposed) void runSync("background");
          }, BACKGROUND_SYNC_DELAY_MS);
        }
      } catch {
        // SQLite/provider failures leave the legacy on-demand catalog path intact.
      }
    })();

    return () => {
      disposed = true;
      cancelRef.current = true;
      if (backgroundTimer) clearTimeout(backgroundTimer);
    };
  }, [provider?.id]); // provider switch is the lifecycle boundary.

  const value = useMemo<CatalogSyncContextValue>(() => ({
    syncState,
    snapshot,
    cacheReady,
    isRefreshing,
    refreshSnapshot,
    refreshCatalog,
    cancelInitialSync,
  }), [cacheReady, cancelInitialSync, isRefreshing, refreshCatalog, refreshSnapshot, snapshot, syncState]);

  const isInitialBlocking =
    provider?.type === "xtream" &&
    !cacheReady &&
    (syncState?.phase === "preparing" || syncState?.phase === "syncing");
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
            {syncState?.completed ?? 0} / {syncState?.total ?? 1}
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
