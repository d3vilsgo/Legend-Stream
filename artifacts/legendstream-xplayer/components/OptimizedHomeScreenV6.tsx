import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FocusButton } from "@/components/FocusButton";
import { NativeVideoPlayer } from "@/components/NativeVideoPlayer";
import { DownloadsView } from "@/components/DownloadsView";
import { ContinueWatchingView } from "@/components/ContinueWatchingView";
import { ProviderSubscriptionChip } from "@/components/ProviderSubscriptionChip";
import { PlayerChromeTimeoutSetting } from "@/components/PlayerChromeTimeoutSetting";
import {
  Channel,
  EpgProgram,
  ProviderConfig,
  ProviderType,
  selectProgramsAt,
  usePlayer,
} from "@/context/PlayerContext";
import { MediaProgress, useMediaLibrary } from "@/context/MediaLibraryContext";
import { useCatalogSync } from "@/context/CatalogSyncContext";
import { getCachedCategories, getCachedItems } from "@/lib/catalogCache";
import { useI18n } from "@/context/I18nContext";
import { useColors } from "@/hooks/useColors";
import { DownloadedMedia } from "@/lib/downloads";
import { getM3UCatalog } from "@/lib/iptv";
import { yieldToUi } from "@/lib/cooperative";
import {
  buildEpisodeStreamUrl,
  buildVodStreamUrl,
  getSeries,
  getSeriesCategories,
  getSeriesInfo,
  getVodCategories,
  getVodStreams,
  isXtreamCatalogFallbackError,
  registerLocalEpisodeQueue,
  registerLocalVodQueue,
  registerVodPlaybackQueue,
  XtreamCategory,
  XtreamEpisode,
  XtreamSeriesInfo,
  XtreamSeriesItem,
  XtreamVodItem,
} from "@/lib/xtreamCatalog";

type ViewName = "home" | "live" | "movies" | "series" | "history" | "downloads" | "settings" | "player";
type ContentView = Exclude<ViewName, "player">;
type Credentials = { baseUrl: string; username: string; password: string };
type CatalogSortMode = "default" | "alphaAsc" | "alphaDesc" | "idAsc" | "idDesc" | "added";
type CategoryOption = { id: string; name: string };
type Playable = {
  title: string;
  url: string;
  subtitle?: string;
  kind: "live" | "movie" | "episode" | "download";
  returnTo: ContentView;
};

const CATALOG_SORT_KEY = "@legendstream/catalog-sort-v1";
const PLAYER_STATE_STORAGE_KEY = "@legendstream/player-state-v3";
const catalogCategoryMemory = {
  live: "__all__",
  movies: "__all__",
  series: "__all__",
};

const flattenCatalogCache = <T,>(cache: Record<string, T[]>) =>
  Object.values(cache).flat();

const categoryRows = (names: string[]): XtreamCategory[] =>
  Array.from(new Set(names.filter(Boolean))).map((name) => ({
    category_id: name,
    category_name: name,
  }));

const exactCategoryTotal = (categories: XtreamCategory[]) => {
  if (!categories.length) return 0;
  const counts = categories.map((category) => {
    const row = category as XtreamCategory & {
      count?: unknown;
      stream_count?: unknown;
      items_count?: unknown;
    };
    const raw = row.count ?? row.stream_count ?? row.items_count;
    if (raw === undefined || raw === null || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
  });
  return counts.every((value): value is number => value !== null)
    ? counts.reduce((sum, value) => sum + value, 0)
    : null;
};

const addedTime = (value?: string) => {
  if (!value) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const catalogNumericId = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "");
  const direct = Number(text);
  if (Number.isFinite(direct)) return direct;
  const embeddedIndex = text.match(/:(\d+):/);
  if (embeddedIndex) return Number(embeddedIndex[1]);
  return Number.MAX_SAFE_INTEGER;
};

const sortCatalogRows = <T extends { name: string }>(
  rows: T[],
  mode: CatalogSortMode,
  addedOf: (item: T) => string | undefined,
  idOf: (item: T) => unknown,
) => {
  if (mode === "default") return rows;
  const sorted = [...rows];
  if (mode === "alphaAsc" || mode === "alphaDesc") {
    const direction = mode === "alphaAsc" ? 1 : -1;
    sorted.sort((a, b) => direction * a.name.localeCompare(b.name, "tr", { sensitivity: "base" }));
  } else if (mode === "idAsc" || mode === "idDesc") {
    const direction = mode === "idAsc" ? 1 : -1;
    sorted.sort((a, b) => {
      const delta = catalogNumericId(idOf(a)) - catalogNumericId(idOf(b));
      return delta !== 0 ? direction * delta : a.name.localeCompare(b.name, "tr", { sensitivity: "base" });
    });
  } else {
    sorted.sort((a, b) => addedTime(addedOf(b)) - addedTime(addedOf(a)));
  }
  return sorted;
};

const isGetPhpM3UPlusProvider = (provider: ProviderConfig) => {
  try {
    const source = new URL(provider.url || provider.playlistUrl);
    if (!/\/get\.php$/i.test(source.pathname)) return false;
    const type = source.searchParams.get("type")?.toLowerCase();
    return !type || type === "m3u_plus";
  } catch {
    return false;
  }
};

async function persistProviderAsM3U(providerId: string) {
  try {
    const raw = await AsyncStorage.getItem(PLAYER_STATE_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as {
      providers?: ProviderConfig[];
      provider?: ProviderConfig | null;
      [key: string]: unknown;
    };
    const rewrite = (item: ProviderConfig): ProviderConfig =>
      item.id === providerId
        ? {
            ...item,
            type: "m3u",
            username: undefined,
            password: undefined,
            loadError: undefined,
          }
        : item;
    if (Array.isArray(saved.providers)) saved.providers = saved.providers.map(rewrite);
    if (saved.provider?.id === providerId) saved.provider = rewrite(saved.provider);
    await AsyncStorage.setItem(PLAYER_STATE_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Best effort migration. The normal connectProvider path will persist again
    // after the M3U parse succeeds.
  }
}

export default function OptimizedHomeScreenV6() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const {
    provider,
    providers,
    channels,
    epgByChannel,
    favorites,
    history,
    isHydrating,
    isLoading,
    isEpgLoading,
    error,
    connectProvider,
    refreshProvider,
    toggleFavorite,
    recordWatched,
    removeWatched,
    setActiveProvider,
    removeProvider,
    disconnectProvider,
    clearError,
  } = usePlayer();
  const { snapshot, cacheReady, refreshCatalog } = useCatalogSync();

  const [view, setView] = useState<ViewName>("home");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [playable, setPlayable] = useState<Playable | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [vodLoading, setVodLoading] = useState(false);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [vodLoaded, setVodLoaded] = useState(false);
  const [seriesLoaded, setSeriesLoaded] = useState(false);
  const [vodCats, setVodCats] = useState<XtreamCategory[]>([]);
  const [vod, setVod] = useState<XtreamVodItem[]>([]);
  const [vodCache, setVodCache] = useState<Record<string, XtreamVodItem[]>>({});
  const [seriesCats, setSeriesCats] = useState<XtreamCategory[]>([]);
  const [series, setSeries] = useState<XtreamSeriesItem[]>([]);
  const [seriesCache, setSeriesCache] = useState<Record<string, XtreamSeriesItem[]>>({});
  const [homeVodCount, setHomeVodCount] = useState<number | null>(null);
  const [homeSeriesCount, setHomeSeriesCount] = useState<number | null>(null);
  const [homeCatalogLoading, setHomeCatalogLoading] = useState(false);
  const [catalogSort, setCatalogSort] = useState<CatalogSortMode>("default");
  const [providerTypeOverride, setProviderTypeOverride] = useState<ProviderType | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<XtreamSeriesItem | null>(null);
  const [seriesInfo, setSeriesInfo] = useState<XtreamSeriesInfo | null>(null);
  const [catalogDrawerOpen, setCatalogDrawerOpen] = useState(false);
  const [cachedLive, setCachedLive] = useState<Channel[]>([]);

  const effectiveProvider = useMemo<ProviderConfig | null>(() => {
    if (!provider || !providerTypeOverride) return provider;
    return {
      ...provider,
      type: providerTypeOverride,
      username: providerTypeOverride === "m3u" ? undefined : provider.username,
      password: providerTypeOverride === "m3u" ? undefined : provider.password,
    };
  }, [provider, providerTypeOverride]);

  const credentials = useMemo<Credentials | null>(() => {
    if (!effectiveProvider || effectiveProvider.type !== "xtream" || !effectiveProvider.username || !effectiveProvider.password) return null;
    return { baseUrl: effectiveProvider.url || effectiveProvider.playlistUrl, username: effectiveProvider.username, password: effectiveProvider.password };
  }, [effectiveProvider]);

  const playerLiveChannels = useMemo(
    () => provider
      ? channels.filter(
          (channel) => channel.providerId === provider.id && (channel.contentType ?? "live") === "live",
        )
      : [],
    [channels, provider],
  );

  const providerChannels = useMemo(
    () => provider && cacheReady && snapshot.providerId === provider.id && cachedLive.length
      ? cachedLive
      : playerLiveChannels,
    [cacheReady, cachedLive, playerLiveChannels, provider, snapshot.providerId],
  );

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(CATALOG_SORT_KEY)
      .then((saved) => {
        if (cancelled) return;
        if (saved === "alpha") {
          setCatalogSort("alphaAsc");
          return;
        }
        if (
          saved === "default" || saved === "alphaAsc" || saved === "alphaDesc" ||
          saved === "idAsc" || saved === "idDesc" || saved === "added"
        ) {
          setCatalogSort(saved);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const changeCatalogSort = (mode: CatalogSortMode) => {
    setCatalogSort(mode);
    void AsyncStorage.setItem(CATALOG_SORT_KEY, mode).catch(() => undefined);
  };

  useEffect(() => {
    setVod([]); setVodCats([]); setVodCache({}); setVodLoaded(false); setVodLoading(false);
    setSeries([]); setSeriesCats([]); setSeriesCache({}); setSeriesLoaded(false); setSeriesLoading(false);
    setHomeVodCount(null); setHomeSeriesCount(null); setHomeCatalogLoading(false);
    setProviderTypeOverride(null);
    setSelectedSeries(null); setSeriesInfo(null); setCatalogError(null);
    setCachedLive([]);
    catalogCategoryMemory.movies = "__all__";
    catalogCategoryMemory.series = "__all__";
  }, [provider?.id]);

  useEffect(() => {
    if (!provider || provider.type !== "xtream" || snapshot.providerId !== provider.id || !snapshot.ready) return;
    let cancelled = false;
    setHomeVodCount(snapshot.counts.vod);
    setHomeSeriesCount(snapshot.counts.series);
    setHomeCatalogLoading(false);
    void Promise.all([
      getCachedCategories(provider.id, "vod"),
      getCachedCategories(provider.id, "series"),
      getCachedItems<Channel>(provider.id, "live"),
    ]).then(([movieCategories, showCategories, liveRows]) => {
      if (cancelled) return;
      setVodCats(movieCategories);
      setSeriesCats(showCategories);
      setCachedLive(liveRows);
      setVodLoaded(true);
      setSeriesLoaded(true);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [provider?.id, snapshot.providerId, snapshot.ready, snapshot.counts.live, snapshot.counts.vod, snapshot.counts.series]);

  useEffect(() => {
    if (!effectiveProvider) {
      setHomeCatalogLoading(false);
      return;
    }
    if (effectiveProvider.type === "xtream" && cacheReady && snapshot.providerId === effectiveProvider.id) {
      setHomeVodCount(snapshot.counts.vod);
      setHomeSeriesCount(snapshot.counts.series);
      setHomeCatalogLoading(false);
      return;
    }
    if (effectiveProvider.type === "m3u") {
      const local = getM3UCatalog(effectiveProvider.id);
      setHomeVodCount(local.movieItems.length);
      setHomeSeriesCount(local.seriesGroups.length);
      setHomeCatalogLoading(false);
      return;
    }
    if (effectiveProvider.type !== "xtream" || !credentials) {
      setHomeCatalogLoading(false);
      return;
    }

    // A get.php/m3u_plus URL can be either a real Xtream account or a playlist
    // source that was explicitly saved as M3U. Early Home counts are read-only:
    // never probe these ambiguous legacy records in the background. The normal
    // Movies/Series path still performs its existing category request and can
    // migrate on a typed catalog-format failure.
    if (isGetPhpM3UPlusProvider(effectiveProvider)) {
      setHomeCatalogLoading(false);
      return;
    }

    let cancelled = false;
    setHomeCatalogLoading(true);
    void (async () => {
      try {
        const [vodResult, seriesResult] = await Promise.allSettled([
          getVodCategories(credentials),
          getSeriesCategories(credentials),
        ]);
        if (cancelled) return;

        if (vodResult.status === "fulfilled") {
          setVodCats(vodResult.value);
          setVodLoaded(true);
          setHomeVodCount(exactCategoryTotal(vodResult.value));
        }
        if (seriesResult.status === "fulfilled") {
          setSeriesCats(seriesResult.value);
          setSeriesLoaded(true);
          setHomeSeriesCount(exactCategoryTotal(seriesResult.value));
        }
      } finally {
        if (!cancelled) setHomeCatalogLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveProvider, credentials]);

  const applyLocalVod = () => {
    if (!provider) return;
    const local = getM3UCatalog(provider.id);
    const items: XtreamVodItem[] = local.movieItems.map((item) => ({
      stream_id: item.id,
      name: item.name,
      stream_icon: item.logoUrl,
      category_id: item.category,
      direct_source: item.streamUrl,
    }));
    registerLocalVodQueue(items);
    setVodCats(categoryRows(local.movieItems.map((item) => item.category)));
    setVod(items);
    setVodCache({ __m3u__: items });
    setHomeVodCount(items.length);
    setVodLoaded(true);
  };

  const applyLocalSeries = () => {
    if (!provider) return;
    const local = getM3UCatalog(provider.id);
    const items: XtreamSeriesItem[] = local.seriesGroups.map((group) => ({
      series_id: group.id,
      name: group.name,
      cover: group.coverUrl,
      category_id: group.category,
    }));
    setSeriesCats(categoryRows(local.seriesGroups.map((group) => group.category)));
    setSeries(items);
    setSeriesCache({ __m3u__: items });
    setHomeSeriesCount(items.length);
    setSeriesLoaded(true);
  };

  const tryCatalogFallbackToM3U = async (caught: unknown, target: "movies" | "series") => {
    if (
      !provider ||
      effectiveProvider?.type !== "xtream" ||
      !isGetPhpM3UPlusProvider(provider) ||
      !isXtreamCatalogFallbackError(caught)
    ) {
      return false;
    }

    // Persist the resolved type before parsing the potentially huge playlist.
    // This prevents a slow/blocked M3U parse from leaving the account stored as
    // Xtream and re-triggering the same catalog request after restart.
    await persistProviderAsM3U(provider.id);
    setProviderTypeOverride("m3u");
    clearError();
    setCatalogError(null);

    const migrated = await connectProvider({
      name: provider.name,
      type: "m3u",
      playlistUrl: provider.url || provider.playlistUrl,
      username: provider.username,
      password: provider.password,
      mac: provider.mac,
      epgUrl: provider.epgUrl,
    });

    if (migrated) {
      clearError();
      setCatalogError(null);
      if (target === "movies") applyLocalVod();
      else applyLocalSeries();
      return true;
    }

    // The storage migration is already durable even if parsing failed/timed
    // out. Do not surface the stale Xtream JSON error or leave catalog loading
    // permanently pending.
    if (target === "movies") {
      applyLocalVod();
      setVodLoaded(true);
    } else {
      applyLocalSeries();
      setSeriesLoaded(true);
    }
    return true;
  };

  const loadVod = async (force = false) => {
    if (!provider || (vodLoaded && !force && vod.length > 0) || vodLoading) return;
    setVodLoading(true); setCatalogError(null);
    try {
      if (effectiveProvider?.type === "m3u") {
        applyLocalVod();
        return;
      }
      if (!credentials || effectiveProvider?.type !== "xtream") return;
      if (cacheReady && snapshot.providerId === provider.id) {
        if (force) await refreshCatalog();
        const [cats, items] = await Promise.all([
getCachedCategories(provider.id, "vod"),
getCachedItems<XtreamVodItem>(provider.id, "vod"),
        ]);
        setVodCats(cats);
        setVod(items);
        setVodCache({ __all__: items });
        setHomeVodCount(items.length);
        registerVodPlaybackQueue(credentials, items);
        setVodLoaded(true);
        return;
      }
      if (force) { setVod([]); setVodCache({}); }
      const cats = await getVodCategories(credentials);
      setVodCats(cats);
      setHomeVodCount(exactCategoryTotal(cats));
      setVodLoaded(true);
    } catch (caught) {
      if (await tryCatalogFallbackToM3U(caught, "movies")) return;
      setVodLoaded(true);
      setCatalogError(caught instanceof Error ? caught.message : t("loadingMovies"));
    } finally { setVodLoading(false); }
  };

  const loadVodCategory = async (categoryId: string, force = false) => {
    if (!provider || effectiveProvider?.type !== "xtream" || !credentials) return;
    setVodLoading(true); setCatalogError(null);
    try {
      if (cacheReady && snapshot.providerId === provider.id) {
        if (force) await refreshCatalog();
        const items = await getCachedItems<XtreamVodItem>(provider.id, "vod", categoryId);
        if (categoryId === "__all__") registerVodPlaybackQueue(credentials, items);
        setVod(items);
        setVodCache((previous) => ({ ...previous, [categoryId]: items }));
        setHomeVodCount(snapshot.counts.vod || items.length);
        setVodLoaded(true);
        return;
      }
      if (categoryId === "__all__") return;
      if (vodCache[categoryId] && !force) { setVod(vodCache[categoryId]); return; }
      const items = await getVodStreams(credentials, categoryId);
      await yieldToUi();
      setVodCache((previous) => ({ ...previous, [categoryId]: items }));
      setVod(items);
    } catch (caught) {
      if (await tryCatalogFallbackToM3U(caught, "movies")) return;
      setVodLoaded(true);
      setCatalogError(caught instanceof Error ? caught.message : t("loadingMovies"));
    } finally { setVodLoading(false); }
  };

  const loadSeries = async (force = false) => {
    if (!provider || (seriesLoaded && !force && series.length > 0) || seriesLoading) return;
    setSeriesLoading(true); setCatalogError(null);
    try {
      if (effectiveProvider?.type === "m3u") {
        applyLocalSeries();
        return;
      }
      if (!credentials || effectiveProvider?.type !== "xtream") return;
      if (cacheReady && snapshot.providerId === provider.id) {
        if (force) await refreshCatalog();
        const [cats, items] = await Promise.all([
getCachedCategories(provider.id, "series"),
getCachedItems<XtreamSeriesItem>(provider.id, "series"),
        ]);
        setSeriesCats(cats);
        setSeries(items);
        setSeriesCache({ __all__: items });
        setHomeSeriesCount(items.length);
        setSeriesLoaded(true);
        return;
      }
      if (force) { setSeries([]); setSeriesCache({}); }
      const cats = await getSeriesCategories(credentials);
      setSeriesCats(cats);
      setHomeSeriesCount(exactCategoryTotal(cats));
      setSeriesLoaded(true);
    } catch (caught) {
      if (await tryCatalogFallbackToM3U(caught, "series")) return;
      setSeriesLoaded(true);
      setCatalogError(caught instanceof Error ? caught.message : t("loadingSeries"));
    } finally { setSeriesLoading(false); }
  };

  const loadSeriesCategory = async (categoryId: string, force = false) => {
    if (!provider || effectiveProvider?.type !== "xtream" || !credentials) return;
    setSeriesLoading(true); setCatalogError(null);
    try {
      if (cacheReady && snapshot.providerId === provider.id) {
        if (force) await refreshCatalog();
        const items = await getCachedItems<XtreamSeriesItem>(provider.id, "series", categoryId);
        setSeries(items);
        setSeriesCache((previous) => ({ ...previous, [categoryId]: items }));
        setHomeSeriesCount(snapshot.counts.series || items.length);
        setSeriesLoaded(true);
        return;
      }
      if (categoryId === "__all__") return;
      if (seriesCache[categoryId] && !force) { setSeries(seriesCache[categoryId]); return; }
      const items = await getSeries(credentials, categoryId);
      await yieldToUi();
      setSeriesCache((previous) => ({ ...previous, [categoryId]: items }));
      setSeries(items);
    } catch (caught) {
      if (await tryCatalogFallbackToM3U(caught, "series")) return;
      setSeriesLoaded(true);
      setCatalogError(caught instanceof Error ? caught.message : t("loadingSeries"));
    } finally { setSeriesLoading(false); }
  };

  const switchProvider = async (id: string) => {
    clearError(); setCatalogError(null);
    const ok = await setActiveProvider(id);
    if (ok) setView("home");
  };

  const navigate = (target: ContentView) => {
    setView(target);
    if (target === "movies") void loadVod();
    if (target === "series") void loadSeries();
    if (target !== "series") { setSelectedSeries(null); setSeriesInfo(null); }
  };

  if (isHydrating) {
    return <View style={[s.centered, { backgroundColor: colors.background }]}><Text style={{ color: colors.foreground }}>{t("loading")}</Text></View>;
  }

  if (!provider && !adding) {
    return <SavedAccounts providers={providers} busy={isLoading} error={error} onOpen={(id) => void switchProvider(id)} onAdd={() => setAdding(true)} onRemove={(id) => void removeProvider(id)} />;
  }

  if (adding || editing || !provider) {
    return <ProviderSetup
      existing={editing ? effectiveProvider : null}
      busy={isLoading}
      error={error}
      onCancel={providers.length ? () => { setAdding(false); setEditing(false); } : undefined}
      onSubmit={async (config) => {
        clearError();
        const ok = await connectProvider(config);
        if (ok) { setAdding(false); setEditing(false); setView("home"); }
      }}
    />;
  }

  const openLive = (channel: Channel) => {
    setPlayable({ title: channel.name, subtitle: channel.category, url: channel.streamUrl, kind: "live", returnTo: "live" });
    void recordWatched(channel.id);
    setView("player");
  };

  const openMovie = (item: XtreamVodItem) => {
    try {
      setPlayable({
        title: item.name,
        subtitle: item.genre || t("movies"),
        url: buildVodStreamUrl(credentials, item),
        kind: "movie",
        returnTo: "movies",
      });
      setView("player");
    } catch (caught) {
      setCatalogError(caught instanceof Error ? caught.message : t("loadingMovies"));
    }
  };

  const openSeries = async (item: XtreamSeriesItem) => {
    setSelectedSeries(item); setSeriesInfo(null); setCatalogError(null);
    if (effectiveProvider?.type === "m3u") {
      const group = getM3UCatalog(provider.id).seriesGroups.find(
        (candidate) => candidate.id === String(item.series_id),
      );
      if (!group) return;
      const info: XtreamSeriesInfo = {
        info: item,
        episodes: Object.fromEntries(
          Object.entries(group.seasons).map(([season, episodes]) => [
            season,
            episodes.map((episode) => ({
              id: episode.id,
              episode_num: episode.episode,
              title: episode.title,
              direct_source: episode.streamUrl,
            })),
          ]),
        ),
      };
      registerLocalEpisodeQueue(info);
      setSeriesInfo(info);
      return;
    }
    if (!credentials) return;
    try { setSeriesInfo(await getSeriesInfo(credentials, item.series_id)); }
    catch (caught) { setCatalogError(caught instanceof Error ? caught.message : t("loadingEpisodes")); }
  };

  const playEpisode = (episode: XtreamEpisode) => {
    if (!selectedSeries) return;
    try {
      setPlayable({
        title: episode.title || selectedSeries.name,
        subtitle: selectedSeries.name,
        url: buildEpisodeStreamUrl(credentials, episode),
        kind: "episode",
        returnTo: "series",
      });
      setView("player");
    } catch (caught) {
      setCatalogError(caught instanceof Error ? caught.message : t("loadingEpisodes"));
    }
  };

  const openDownload = (item: DownloadedMedia) => {
    setPlayable({ title: item.title, subtitle: item.subtitle, url: item.uri, kind: "download", returnTo: "downloads" });
    setView("player");
  };

  const openProgress = (item: MediaProgress) => {
    setPlayable({ title: item.title, subtitle: item.subtitle, url: item.source, kind: item.kind, returnTo: "history" });
    setView("player");
  };

  if (view === "player") {
    return <View style={s.fullPlayer}>
      {playable ? <NativeVideoPlayer
        source={playable.url}
        title={playable.title}
        autoFullscreen
        allowDownload={playable.kind === "movie" || playable.kind === "episode"}
        onFullscreenExit={() => setView(playable.returnTo)}
      /> : null}
    </View>;
  }

  const nav = [
    { key: "home" as const, label: t("home"), icon: "home" as const },
    { key: "live" as const, label: t("liveTv"), icon: "radio" as const },
    { key: "movies" as const, label: t("movies"), icon: "film" as const },
    { key: "series" as const, label: t("series"), icon: "tv" as const },
    { key: "history" as const, label: t("history"), icon: "clock" as const },
    { key: "downloads" as const, label: t("download"), icon: "download" as const },
    { key: "settings" as const, label: t("settings"), icon: "settings" as const },
  ];

  const shownProvider = effectiveProvider ?? provider;
  const top = Math.max(insets.top, Platform.OS === "web" ? 20 : 0);
  return <View style={[s.screen, { backgroundColor: colors.background, paddingTop: top, paddingBottom: Math.max(insets.bottom, 10) }]}>
    <View style={[s.header, { borderColor: colors.border }, view === "home" ? s.homeHeaderPremium : null]}>
      <View style={[s.headerTop, view === "home" ? s.homeHeaderTopPremium : null]}>
        <Text style={[s.brand, view === "home" ? s.homeBrandPremium : null, { color: colors.foreground }]}>LEGEND<Text style={{ color: colors.primary }}>STREAM</Text></Text>
        <View style={view === "home" ? [s.homeProviderGlass, { borderColor: colors.border }] : undefined}>
          <ProviderSubscriptionChip provider={shownProvider} />
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.nav}>
        {nav.map((item) => <FocusButton key={item.key} label={item.label} icon={item.icon} variant={view === item.key ? "secondary" : "ghost"} onPress={() => navigate(item.key)} />)}
      </ScrollView>
    </View>

    {error || catalogError ? <View style={[s.error, { borderColor: colors.destructive, backgroundColor: colors.card }]}>
      <Text style={{ color: colors.destructive, flex: 1 }}>{error || catalogError}</Text>
      <Pressable onPress={() => { clearError(); setCatalogError(null); }}><Feather name="x" size={20} color={colors.mutedForeground} /></Pressable>
    </View> : null}

    {view === "live" ? <Live
      channels={providerChannels}
      epgByChannel={epgByChannel}
      favorites={favorites}
      providerType={shownProvider.type}
      loading={isLoading}
      epgLoading={isEpgLoading}
      onRefresh={() => { void refreshProvider(); void refreshCatalog(); }}
      onOpen={openLive}
      onFavorite={(id) => void toggleFavorite(id)}
    /> : <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} scrollEnabled={!catalogDrawerOpen} pointerEvents={catalogDrawerOpen ? "none" : "auto"}>
      {view === "home" ? <Home
        provider={shownProvider}
        live={providerChannels.length}
        vod={homeVodCount}
        series={homeSeriesCount}
        vodCategories={vodCats.length}
        seriesCategories={seriesCats.length}
        catalogLoading={homeCatalogLoading}
        channels={providerChannels}
        history={history}
        movies={vod}
        seriesItems={series}
        onNavigate={navigate}
        onOpenLive={openLive}
        onOpenMovie={openMovie}
        onOpenSeries={openSeries}
        onOpenMedia={openProgress}
        onRemoveLive={(id) => void removeWatched(id)}
      /> : null}
      {view === "movies" ? <Movies items={vod} cats={vodCats} providerType={shownProvider.type} sortMode={catalogSort} onSort={changeCatalogSort} loading={vodLoading} loaded={vodLoaded} onCategory={(category) => void loadVodCategory(category)} onRefresh={(category) => category === "__all__" ? void loadVod(true) : void loadVodCategory(category, true)} onOpen={openMovie} onDrawerVisibilityChange={setCatalogDrawerOpen} /> : null}
      {view === "series" ? <Series items={series} cats={seriesCats} providerType={shownProvider.type} sortMode={catalogSort} onSort={changeCatalogSort} loading={seriesLoading} loaded={seriesLoaded} selected={selectedSeries} info={seriesInfo} onCategory={(category) => void loadSeriesCategory(category)} onRefresh={(category) => category === "__all__" ? void loadSeries(true) : void loadSeriesCategory(category, true)} onOpen={openSeries} onBack={() => { setSelectedSeries(null); setSeriesInfo(null); }} onEpisode={playEpisode} onDrawerVisibilityChange={setCatalogDrawerOpen} /> : null}
      {view === "history" ? <HistoryView channels={providerChannels} favorites={favorites} history={history} onOpen={openLive} onOpenMedia={openProgress} /> : null}
      {view === "downloads" ? <DownloadsView onOpen={openDownload} /> : null}
      {view === "settings" ? <Settings provider={shownProvider} providers={providers} busy={isLoading} onEdit={() => setEditing(true)} onAdd={() => setAdding(true)} onSwitch={(id) => void switchProvider(id)} onDisconnect={() => void disconnectProvider()} onRemove={(id) => void removeProvider(id)} /> : null}
    </ScrollView>}
  </View>;
}

function SavedAccounts({ providers, busy, error, onOpen, onAdd, onRemove }: { providers: ProviderConfig[]; busy: boolean; error: string | null; onOpen: (id: string) => void; onAdd: () => void; onRemove: (id: string) => void }) {
  const colors = useColors(); const insets = useSafeAreaInsets(); const { t } = useI18n();
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={[s.setup, { paddingTop: insets.top + 30, paddingBottom: insets.bottom + 40 }]}>
    <Text style={[s.brandLarge, { color: colors.foreground }]}>LEGEND<Text style={{ color: colors.primary }}>STREAM</Text></Text>
    <Text style={[s.title, { color: colors.foreground }]}>{t("savedConnections")}</Text>
    <Text style={{ color: colors.mutedForeground }}>{t("chooseAccount")}</Text>
    {error ? <Text style={{ color: colors.destructive }}>{error}</Text> : null}
    <View style={{ gap: 10 }}>{providers.map((item) => <View key={item.id} style={[s.accountCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Pressable style={{ flex: 1 }} onPress={() => onOpen(item.id)} disabled={busy}>
        <Text style={{ color: colors.foreground, fontWeight: "800", fontSize: 16 }}>{item.name}</Text>
        <Text style={{ color: colors.mutedForeground }}>{item.type.toUpperCase()} · {item.username || item.mac || item.type}</Text>
        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 12 }}>{item.url || item.playlistUrl}</Text>
      </Pressable>
      <Pressable onPress={() => onRemove(item.id)} style={s.iconButton}><Feather name="trash-2" size={20} color={colors.mutedForeground} /></Pressable>
    </View>)}</View>
    <FocusButton label={busy ? t("opening") : t("addNewAccount")} icon="plus" variant="primary" onPress={onAdd} disabled={busy} />
  </ScrollView>;
}

function ProviderSetup({ existing, busy, error, onCancel, onSubmit }: {
  existing: ProviderConfig | null;
  busy: boolean;
  error: string | null;
  onCancel?: () => void;
  onSubmit: (config: Omit<ProviderConfig, "id" | "connectedAt" | "createdAt" | "url" | "channelCount"> & { url?: string; epgUrl?: string; mac?: string }) => Promise<void>;
}) {
  const colors = useColors(); const insets = useSafeAreaInsets(); const { t } = useI18n();
  const [name, setName] = useState(existing?.name ?? "My provider");
  const [type, setType] = useState<ProviderType>(existing?.type ?? "xtream");
  const [url, setUrl] = useState(existing?.playlistUrl ?? "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState(existing?.password ?? "");
  const [mac, setMac] = useState(existing?.mac ?? "");
  const [epgUrl, setEpgUrl] = useState(existing?.epgUrl ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async () => {
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) return setLocalError(t("invalidUrl"));
    if (type === "xtream" && (!username.trim() || !password)) return setLocalError(t("xtreamCredentials"));
    setLocalError(null);
    await onSubmit({
      name: name.trim() || "My provider",
      type,
      playlistUrl: clean,
      username: type === "xtream" ? username.trim() : undefined,
      password: type === "xtream" ? password : undefined,
      mac: type === "stalker" ? mac.trim() : undefined,
      epgUrl: epgUrl.trim() || undefined,
    });
  };

  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView contentContainerStyle={[s.setup, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 140 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <Text style={[s.brandLarge, { color: colors.foreground }]}>LEGEND<Text style={{ color: colors.primary }}>STREAM</Text></Text>
      <Text style={[s.title, { color: colors.foreground }]}>{existing ? t("editIptvSource") : t("addIptvSource")}</Text>
      <View style={s.row}>{(["xtream", "m3u", "stalker"] as ProviderType[]).map((item) => <FocusButton key={item} label={item === "xtream" ? "Xtream" : item === "m3u" ? "M3U" : "Stalker"} variant={type === item ? "secondary" : "ghost"} onPress={() => setType(item)} />)}</View>
      <Input label={t("sourceName")} value={name} onChangeText={setName} />
      <Input label={t("serverUrl")} value={url} onChangeText={setUrl} autoCapitalize="none" />
      {type === "xtream" ? <><Input label={t("username")} value={username} onChangeText={setUsername} autoCapitalize="none" /><Input label={t("password")} value={password} onChangeText={setPassword} secureTextEntry /></> : null}
      {type === "stalker" ? <Input label={t("macAddress")} value={mac} onChangeText={setMac} autoCapitalize="none" /> : null}
      <Input label={t("epgOptional")} value={epgUrl} onChangeText={setEpgUrl} autoCapitalize="none" />
      {localError || error ? <Text style={{ color: colors.destructive }}>{localError || error}</Text> : null}
      <View style={s.row}>
        <FocusButton label={busy ? t("connecting") : existing ? t("saveConnect") : t("addConnect")} icon="log-in" variant="primary" onPress={() => void submit()} disabled={busy} />
        {onCancel ? <FocusButton label={t("cancel")} variant="ghost" onPress={onCancel} /> : null}
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}

type HomeHeroEntry = {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  movie?: XtreamVodItem;
  series?: XtreamSeriesItem;
};

type HomeShelfEntry = {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  progress?: number;
  onPress: () => void;
  onRemove?: () => void;
};

function Home({ provider, live, vod, series, vodCategories, seriesCategories, catalogLoading, channels, history, movies, seriesItems, onNavigate, onOpenLive, onOpenMovie, onOpenSeries, onOpenMedia, onRemoveLive }: {
  provider: ProviderConfig;
  live: number;
  vod: number | null;
  series: number | null;
  vodCategories: number;
  seriesCategories: number;
  catalogLoading: boolean;
  channels: Channel[];
  history: string[];
  movies: XtreamVodItem[];
  seriesItems: XtreamSeriesItem[];
  onNavigate: (view: ContentView) => void;
  onOpenLive: (channel: Channel) => void;
  onOpenMovie: (item: XtreamVodItem) => void;
  onOpenSeries: (item: XtreamSeriesItem) => void;
  onOpenMedia: (item: MediaProgress) => void;
  onRemoveLive: (id: string) => void;
}) {
  const colors = useColors();
  const { t, language } = useI18n();
  const { entries, loaded: mediaLibraryLoaded, removeProgress } = useMediaLibrary();
  const { snapshot, cacheReady } = useCatalogSync();
  const cached = provider.type === "xtream" && snapshot.providerId === provider.id && snapshot.ready ? snapshot : null;
  const copy = language === "tr"
    ? {
        continue: "İzlemeye Devam Et",
        recent: "Son İzlenen Kanallar",
        seeAll: "Hepsini Gör",
        discover: "Keşfetmek için dokunun",
        featured: "Öne çıkan içerikler",
        newMovies: "Yeni Filmler",
        newSeries: "Yeni Diziler",
        newChannels: "Yeni Kanallar",
      }
    : {
        continue: "Continue Watching",
        recent: "Recently Watched Channels",
        seeAll: "See All",
        discover: "Tap to discover",
        featured: "Featured picks",
        newMovies: "New Movies",
        newSeries: "New Series",
        newChannels: "New Channels",
      };

  const localCatalog = provider.type === "m3u" ? getM3UCatalog(provider.id) : null;
  const homeMovies = useMemo<XtreamVodItem[]>(() => {
    if (cached) return cached.movies;
    if (!localCatalog) return movies.slice(0, 48);
    return localCatalog.movieItems.slice(0, 48).map((item) => ({
      stream_id: item.id, name: item.name, stream_icon: item.logoUrl,
      category_id: item.category, direct_source: item.streamUrl,
    }));
  }, [cached, localCatalog, movies]);
  const homeSeries = useMemo<XtreamSeriesItem[]>(() => {
    if (cached) return cached.series;
    if (!localCatalog) return seriesItems.slice(0, 48);
    return localCatalog.seriesGroups.slice(0, 48).map((item) => ({
      series_id: item.id, name: item.name, cover: item.coverUrl, category_id: item.category,
    }));
  }, [cached, localCatalog, seriesItems]);
  const homeChannels = cached?.live.length ? cached.live : channels;

  const recentChannels = useMemo(
    () => history.map((id) => channels.find((channel) => channel.id === id)).filter((item): item is Channel => Boolean(item)).slice(0, 14),
    [channels, history],
  );
  const continueEntries = useMemo(
    () => entries.filter((item) => item.position > 0 && (item.duration <= 0 || item.position < Math.max(0, item.duration - 30))).slice(0, 14),
    [entries],
  );
  const artworkForProgress = (entry: MediaProgress) => {
    const title = entry.title.trim().toLocaleLowerCase("tr");
    const subtitle = entry.subtitle?.trim().toLocaleLowerCase("tr");
    const movie = homeMovies.find((item) => item.name.trim().toLocaleLowerCase("tr") === title);
    if (movie?.stream_icon) return movie.stream_icon;
    const show = homeSeries.find((item) => {
      const name = item.name.trim().toLocaleLowerCase("tr");
      return name === title || Boolean(subtitle && name === subtitle);
    });
    return show?.cover;
  };

  const heroItems = useMemo<HomeHeroEntry[]>(() => {
    const movieRows = homeMovies
      .filter((item) => Boolean(item.stream_icon && /^https?:\/\//i.test(item.stream_icon)))
      .map((item) => ({ id: `movie-${item.stream_id}`, title: item.name, subtitle: item.genre || t("movies"), image: item.stream_icon as string, movie: item }));
    const seriesRows = homeSeries
      .filter((item) => Boolean(item.cover && /^https?:\/\//i.test(item.cover)))
      .map((item) => ({ id: `series-${item.series_id}`, title: item.name, subtitle: t("series"), image: item.cover as string, series: item }));
    return [...movieRows, ...seriesRows].slice(0, 6);
  }, [homeMovies, homeSeries, t]);

  const effectiveLiveCount = cached ? cached.counts.live : live;
  const effectiveVodCount = cached ? cached.counts.vod : vod;
  const effectiveSeriesCount = cached ? cached.counts.series : series;
  const movieValue = effectiveVodCount === null
    ? (vodCategories > 0 ? t("categoryCount", { count: vodCategories.toLocaleString() }) : "—")
    : effectiveVodCount.toLocaleString();
  const seriesValue = effectiveSeriesCount === null
    ? (seriesCategories > 0 ? t("categoryCount", { count: seriesCategories.toLocaleString() }) : "—")
    : effectiveSeriesCount.toLocaleString();

  const continueShelf = continueEntries.map<HomeShelfEntry>((item) => ({
    id: item.id, title: item.title, subtitle: item.subtitle, image: artworkForProgress(item),
    progress: item.duration > 0 ? Math.max(0, Math.min(1, item.position / item.duration)) : undefined,
    onPress: () => onOpenMedia(item), onRemove: () => void removeProgress(item.source),
  }));
  const recentShelf = recentChannels.map<HomeShelfEntry>((channel) => ({
    id: channel.id, title: channel.name, subtitle: channel.category, image: channel.logoUrl,
    onPress: () => onOpenLive(channel), onRemove: () => onRemoveLive(channel.id),
  }));
  const liveShelf = homeChannels.slice(0, 18).map<HomeShelfEntry>((channel) => ({
    id: `live-${channel.id}`, title: channel.name, subtitle: channel.category, image: channel.logoUrl, onPress: () => onOpenLive(channel),
  }));
  const movieShelf = homeMovies.slice(0, 18).map<HomeShelfEntry>((item) => ({
    id: `movie-${item.stream_id}`, title: item.name, subtitle: item.genre || t("movies"), image: item.stream_icon, onPress: () => onOpenMovie(item),
  }));
  const seriesShelf = homeSeries.slice(0, 18).map<HomeShelfEntry>((item) => ({
    id: `series-${item.series_id}`, title: item.name, subtitle: t("series"), image: item.cover, onPress: () => onOpenSeries(item),
  }));
  const newMovieShelf = (cached?.newMovies ?? []).map<HomeShelfEntry>((item) => ({
    id: `new-movie-${item.stream_id}`, title: item.name, subtitle: item.genre || t("movies"), image: item.stream_icon, onPress: () => onOpenMovie(item),
  }));
  const newSeriesShelf = (cached?.newSeries ?? []).map<HomeShelfEntry>((item) => ({
    id: `new-series-${item.series_id}`, title: item.name, subtitle: t("series"), image: item.cover, onPress: () => onOpenSeries(item),
  }));
  const newChannelShelf = (cached?.newChannels ?? []).map<HomeShelfEntry>((channel) => ({
    id: `new-channel-${channel.id}`, title: channel.name, subtitle: channel.category, image: channel.logoUrl, onPress: () => onOpenLive(channel),
  }));
  const effectiveLoading = catalogLoading && !cacheReady;

  return <View style={s.homeDiscoveryShell}>
    <HomeHeroCarousel items={heroItems} eyebrow={copy.featured} providerName={provider.name}
      onOpen={(item) => item.movie ? onOpenMovie(item.movie) : item.series ? onOpenSeries(item.series) : undefined}
      onDiscover={() => onNavigate("movies")} discoverLabel={copy.discover} loading={effectiveLoading} />
    <View style={s.homeCompactStats}>
      <HomeCountCard icon="radio" label={t("liveTv")} value={effectiveLiveCount.toLocaleString()} accent={colors.primary} preferredFocus={!heroItems.length} onPress={() => onNavigate("live")} />
      <HomeCountCard icon="film" label={t("movies")} value={movieValue} accent="#49B9FF" onPress={() => onNavigate("movies")} />
      <HomeCountCard icon="tv" label={t("series")} value={seriesValue} accent="#8C8CFF" onPress={() => onNavigate("series")} />
    </View>
    {continueShelf.length || !mediaLibraryLoaded ? <HomeShelf title={copy.continue} seeAll={copy.seeAll} items={continueShelf} onSeeAll={() => onNavigate("history")} loading={!mediaLibraryLoaded} /> : null}
    {recentShelf.length ? <HomeShelf title={copy.recent} seeAll={copy.seeAll} items={recentShelf} onSeeAll={() => onNavigate("history")} compact /> : null}
    <HomeShelf title={t("liveTv")} seeAll={copy.seeAll} items={liveShelf} onSeeAll={() => onNavigate("live")} compact />
    <HomeShelf title={t("movies")} seeAll={copy.seeAll} items={movieShelf} onSeeAll={() => onNavigate("movies")} emptyLabel={copy.discover} loading={effectiveLoading} />
    <HomeShelf title={t("series")} seeAll={copy.seeAll} items={seriesShelf} onSeeAll={() => onNavigate("series")} emptyLabel={copy.discover} loading={effectiveLoading} />
    {newMovieShelf.length ? <HomeShelf title={copy.newMovies} seeAll={copy.seeAll} items={newMovieShelf} onSeeAll={() => onNavigate("movies")} /> : null}
    {newSeriesShelf.length ? <HomeShelf title={copy.newSeries} seeAll={copy.seeAll} items={newSeriesShelf} onSeeAll={() => onNavigate("series")} /> : null}
    {newChannelShelf.length ? <HomeShelf title={copy.newChannels} seeAll={copy.seeAll} items={newChannelShelf} onSeeAll={() => onNavigate("live")} compact /> : null}
  </View>;
}

function TvFocusPressable({ children, onPress, onLongPress, preferredFocus = false, style, onFocus }: {
  children: React.ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  preferredFocus?: boolean;
  style?: any;
  onFocus?: () => void;
}) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  return <Pressable
    focusable
    hasTVPreferredFocus={Platform.isTV && preferredFocus}
    onFocus={() => {
      if (Platform.isTV) setFocused(true);
      onFocus?.();
    }}
    onBlur={() => Platform.isTV && setFocused(false)}
    onPress={onPress}
    onLongPress={onLongPress}
    style={[
      style,
      Platform.isTV ? s.homeTvFocusBase : null,
      Platform.isTV && focused ? [s.homeTvFocusActive, { borderColor: colors.primary, shadowColor: colors.primary }] : null,
    ]}
  >{children}</Pressable>;
}

function HomeHeroCarousel({ items, eyebrow, providerName, onOpen, onDiscover, discoverLabel, loading = false }: {
  items: HomeHeroEntry[];
  eyebrow: string;
  providerName: string;
  onOpen: (item: HomeHeroEntry) => void;
  onDiscover: () => void;
  discoverLabel: string;
  loading?: boolean;
}) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const cardWidth = Math.max(280, Math.min(width - 36, 1464));
  const listRef = useRef<FlatList<HomeHeroEntry>>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(() => {
      setIndex((current) => {
        const next = (current + 1) % items.length;
        listRef.current?.scrollToIndex({ index: next, animated: true });
        return next;
      });
    }, 5600);
    return () => clearInterval(timer);
  }, [items.length]);

  if (!items.length) {
    if (loading) {
      return <View style={[s.homeHeroEmpty, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <LinearGradient colors={["rgba(0,212,255,0.10)", "rgba(5,9,20,0.02)"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={{ flex: 1, justifyContent: "flex-end", gap: 10 }}>
          <View style={[s.homeSkeletonLine, { width: "28%", backgroundColor: colors.muted }]} />
          <View style={[s.homeSkeletonLine, { width: "68%", height: 24, backgroundColor: colors.muted }]} />
          <View style={[s.homeSkeletonLine, { width: "42%", backgroundColor: colors.muted }]} />
        </View>
      </View>;
    }
    return <TvFocusPressable preferredFocus onPress={onDiscover} style={[s.homeHeroEmpty, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <LinearGradient colors={["rgba(0,212,255,0.12)", "rgba(5,9,20,0.02)"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Text style={[s.homeHeroEyebrow, { color: colors.primary }]}>{providerName}</Text>
        <Text style={[s.homeHeroTitle, { color: colors.foreground }]}>{discoverLabel}</Text>
        <Text style={[s.homeHeroMeta, { color: colors.mutedForeground }]}>{eyebrow}</Text>
      </View>
    </TvFocusPressable>;
  }

  return <View>
    <FlatList
      ref={listRef}
      data={items}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      keyExtractor={(item) => item.id}
      getItemLayout={(_data, itemIndex) => ({ length: cardWidth, offset: cardWidth * itemIndex, index: itemIndex })}
      onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / cardWidth))}
      renderItem={({ item, index: itemIndex }) => <TvFocusPressable
        preferredFocus={itemIndex === 0}
        onPress={() => onOpen(item)}
        onFocus={() => listRef.current?.scrollToIndex({ index: itemIndex, animated: true })}
        style={[s.homeHeroCard, { width: cardWidth, borderColor: "transparent" }]}
      >
        <Image source={{ uri: item.image }} resizeMode="cover" style={StyleSheet.absoluteFill} />
        <LinearGradient colors={["rgba(2,6,16,0.02)", "rgba(2,6,16,0.18)", "rgba(2,6,16,0.92)"]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={s.homeHeroCaption}>
          <Text style={[s.homeHeroEyebrow, { color: colors.primary }]}>{eyebrow}</Text>
          <Text numberOfLines={2} style={s.homeHeroImageTitle}>{item.title}</Text>
          <Text numberOfLines={1} style={s.homeHeroImageMeta}>{item.subtitle}</Text>
        </View>
      </TvFocusPressable>}
    />
    {!Platform.isTV && items.length > 1 ? <View style={s.homeHeroDots}>{items.map((item, dotIndex) => <View key={item.id} style={[s.homeHeroDot, { backgroundColor: dotIndex === index ? colors.primary : "rgba(255,255,255,0.30)" }]} />)}</View> : null}
  </View>;
}

function HomeCountCard({ icon, label, value, accent, onPress, preferredFocus = false }: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  accent: string;
  onPress: () => void;
  preferredFocus?: boolean;
}) {
  const colors = useColors();
  return <TvFocusPressable preferredFocus={preferredFocus} onPress={onPress} style={[s.homeCompactStatCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <LinearGradient colors={[`${accent}18`, "rgba(255,255,255,0.015)"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
    <View style={[s.homeCompactStatIcon, { backgroundColor: `${accent}18` }]}><Feather name={icon} size={18} color={accent} /></View>
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={[s.homeCompactStatLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.45} style={[s.homeCompactStatValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  </TvFocusPressable>;
}

function HomeShelf({ title, seeAll, items, onSeeAll, compact = false, emptyLabel, loading = false }: {
  title: string;
  seeAll: string;
  items: HomeShelfEntry[];
  onSeeAll: () => void;
  compact?: boolean;
  emptyLabel?: string;
  loading?: boolean;
}) {
  const colors = useColors();
  const listRef = useRef<FlatList<HomeShelfEntry>>(null);
  return <View style={s.homeShelfSection}>
    <View style={s.homeShelfHeader}>
      <Text style={[s.homeShelfTitle, { color: colors.foreground }]}>{title}</Text>
      <TvFocusPressable onPress={onSeeAll} style={s.homeSeeAllButton}>
        <Text style={[s.homeSeeAllText, { color: colors.primary }]}>{seeAll}</Text>
        <Feather name="arrow-right" size={15} color={colors.primary} />
      </TvFocusPressable>
    </View>
    {items.length ? <FlatList
      ref={listRef}
      horizontal
      data={items}
      keyExtractor={(item) => item.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.homeShelfList}
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={5}
      renderItem={({ item, index }) => <TvFocusPressable
        onPress={item.onPress}
        onLongPress={Platform.isTV ? item.onRemove : undefined}
        onFocus={() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.45 })}
        style={[compact ? s.homeShelfCardCompact : s.homeShelfCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View style={[compact ? s.homeShelfImageCompact : s.homeShelfImage, { backgroundColor: colors.muted }]}>
          {item.image ? <Image source={{ uri: item.image }} resizeMode="cover" style={StyleSheet.absoluteFill} /> : <View style={s.homeShelfFallback}><Feather name={compact ? "radio" : "play-circle"} size={28} color={colors.primary} /></View>}
          {!Platform.isTV && item.onRemove ? <Pressable onPress={item.onRemove} hitSlop={8} style={s.homeShelfRemove}><Feather name="x" size={14} color="#fff" /></Pressable> : null}
        </View>
        <Text numberOfLines={1} style={[s.homeShelfCardTitle, { color: colors.foreground }]}>{item.title}</Text>
        {item.subtitle ? <Text numberOfLines={1} style={[s.homeShelfCardMeta, { color: colors.mutedForeground }]}>{item.subtitle}</Text> : null}
        {item.progress !== undefined ? <View style={[s.homeProgressTrack, { backgroundColor: colors.muted }]}><View style={[s.homeProgressFill, { width: `${Math.round(item.progress * 100)}%`, backgroundColor: colors.primary }]} /></View> : null}
      </TvFocusPressable>}
    /> : loading ? <View style={s.homeShelfSkeletonRow}>{[0, 1, 2].map((index) => <View key={index} style={[s.homeShelfSkeletonCard, { borderColor: colors.border, backgroundColor: colors.card }]}><View style={[s.homeShelfSkeletonImage, { backgroundColor: colors.muted }]} /><View style={[s.homeSkeletonLine, { width: "72%", backgroundColor: colors.muted }]} /></View>)}</View> : <TvFocusPressable onPress={onSeeAll} style={[s.homeShelfEmpty, { borderColor: colors.border }]}><Text style={{ color: colors.mutedForeground }}>{emptyLabel || "—"}</Text><Feather name="arrow-right" size={17} color={colors.primary} /></TvFocusPressable>}
  </View>;
}

function useCategoryDrawerSwipe(onOpen: () => void, disabled = false) {
  return useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        !disabled &&
        gesture.dx > 18 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35,
      onPanResponderRelease: (_event, gesture) => {
        if (!disabled && gesture.dx > 55) onOpen();
      },
      onPanResponderTerminate: () => undefined,
    }),
    [disabled, onOpen],
  );
}

function Live({ channels, epgByChannel, favorites, providerType, loading, epgLoading, onRefresh, onOpen, onFavorite }: {
  channels: Channel[];
  epgByChannel: ReadonlyMap<string, readonly EpgProgram[]>;
  favorites: string[];
  providerType: ProviderType;
  loading: boolean;
  epgLoading: boolean;
  onRefresh: () => void;
  onOpen: (channel: Channel) => void;
  onFavorite: (id: string) => void;
}) {
  const colors = useColors(); const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(() => catalogCategoryMemory.live);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [epgClock, setEpgClock] = useState(() => Date.now());
  const categoryNames = useMemo(() => Array.from(new Set(channels.map((channel) => channel.category).filter(Boolean))), [channels]);
  const hasMeaningfulGroups = categoryNames.some((name) => name !== "Uncategorized" && name !== "Live TV");
  const drawerItems = useMemo<CategoryOption[]>(
    () => [{ id: "__all__", name: t("all") }, ...categoryNames.map((name) => ({ id: name, name }))],
    [categoryNames, t],
  );
  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true), drawerOpen);

  useEffect(() => {
    const timer = setInterval(() => setEpgClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setEpgClock(Date.now());
  }, [category, search]);

  useEffect(() => {
    if (category !== "__all__" && !categoryNames.includes(category)) {
      catalogCategoryMemory.live = "__all__";
      setCategory("__all__");
    }
  }, [category, categoryNames]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return channels.filter((channel) => (category === "__all__" || channel.category === category) && (!query || channel.name.toLowerCase().includes(query)));
  }, [channels, search, category]);

  const header = <View>
    <View style={s.catalogHead}>
      <View>
        <Text style={[s.title, { color: colors.foreground }]}>{t("liveTv")}</Text>
        <Text style={{ color: colors.mutedForeground }}>
          {t("channels", { count: channels.length.toLocaleString() })}{epgLoading ? " · EPG…" : ""}
        </Text>
      </View>
      <FocusButton label={loading ? t("loading") : t("refresh")} icon="refresh-cw" variant="ghost" onPress={onRefresh} disabled={loading} />
    </View>
    <View style={[s.search, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Feather name="search" size={18} color={colors.mutedForeground} />
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder={`${t("search")} ${t("liveTv").toLowerCase()}`}
        placeholderTextColor={colors.mutedForeground}
        style={{ flex: 1, color: colors.foreground, minHeight: 44 }}
      />
    </View>
    {providerType === "m3u" && !hasMeaningfulGroups ? <Text style={[s.hint, { color: colors.mutedForeground, marginTop: 12 }]}>{t("m3uNoGroups")}</Text> : null}
  </View>;

  return <View style={{ flex: 1 }} {...drawerSwipe.panHandlers}>
    <FlatList
      style={{ flex: 1 }}
      contentContainerStyle={s.liveListContent}
      data={filtered}
      keyExtractor={(channel) => channel.id}
      ListHeaderComponent={header}
      ListEmptyComponent={<Text style={{ color: colors.mutedForeground, textAlign: "center", paddingVertical: 30 }}>—</Text>}
      renderItem={({ item: channel }) => {
        const current = selectProgramsAt(epgByChannel.get(channel.id), epgClock).now;
        const endLabel = current
          ? new Date(current.end).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
          : undefined;
        return <View style={[s.liveRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Pressable style={s.liveMain} onPress={() => onOpen(channel)}>
            <Poster uri={channel.logoUrl} title={channel.name} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "700" }}>{channel.name}</Text>
              <Text numberOfLines={1} style={[s.liveProgram, { color: current ? colors.foreground : colors.mutedForeground }]}>
                {current ? `Şu an: ${current.title}${endLabel ? ` · ${endLabel}` : ""}` : "—"}
              </Text>
            </View>
          </Pressable>
          <Pressable onPress={() => onFavorite(channel.id)} style={s.iconButton}>
            <Feather name="star" size={20} color={favorites.includes(channel.id) ? colors.primary : colors.mutedForeground} />
          </Pressable>
        </View>;
      }}
      extraData={{ favorites, epgByChannel, epgClock }}
      initialNumToRender={16}
      maxToRenderPerBatch={12}
      windowSize={9}
      updateCellsBatchingPeriod={50}
      removeClippedSubviews={Platform.OS !== "web"}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    />
    <CategoryDrawer
      visible={drawerOpen}
      items={drawerItems}
      selected={category}
      onClose={() => setDrawerOpen(false)}
      onSelect={(value) => {
        catalogCategoryMemory.live = value;
        setCategory(value);
      }}
    />
  </View>;
}

function Movies({ items, cats, providerType, sortMode, onSort, loading, loaded, onCategory, onRefresh, onOpen, onDrawerVisibilityChange }: {
  items: XtreamVodItem[];
  cats: XtreamCategory[];
  providerType: ProviderType;
  sortMode: CatalogSortMode;
  onSort: (mode: CatalogSortMode) => void;
  loading: boolean;
  loaded: boolean;
  onCategory: (categoryId: string) => void;
  onRefresh: (categoryId: string) => void;
  onOpen: (item: XtreamVodItem) => void;
  onDrawerVisibilityChange: (visible: boolean) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(() => catalogCategoryMemory.movies);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [limit, setLimit] = useState(60);
  const categoryIds = useMemo(() => cats.map((item) => String(item.category_id)), [cats]);
  const drawerItems = useMemo<CategoryOption[]>(
    () => [{ id: "__all__", name: t("all") }, ...cats.map((item) => ({ id: String(item.category_id), name: item.category_name }))],
    [cats, t],
  );
  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true), drawerOpen);
  const effectiveSort = providerType === "m3u" && sortMode === "added" ? "default" : sortMode;

  useEffect(() => {
    onDrawerVisibilityChange(drawerOpen);
  }, [drawerOpen, onDrawerVisibilityChange]);

  useEffect(() => () => onDrawerVisibilityChange(false), [onDrawerVisibilityChange]);

  useEffect(() => {
    if (category !== "__all__" && cats.length > 0 && !categoryIds.includes(category)) {
      catalogCategoryMemory.movies = "__all__";
      setCategory("__all__");
    }
  }, [category, categoryIds, cats.length]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = items.filter((item) =>
      (category === "__all__" || String(item.category_id) === category) &&
      (!query || item.name.toLowerCase().includes(query)),
    );
    return sortCatalogRows(rows, effectiveSort, (item) => item.added, (item) => item.stream_id);
  }, [items, search, category, effectiveSort]);

  if (!loaded && loading) return <Loading text={t("loadingMovies")} />;
  return <View {...drawerSwipe.panHandlers}>
    <Catalog title={t("movies")} detail={loaded ? t("titles", { count: items.length.toLocaleString() }) : t("loading")} search={search} onSearch={(value) => { setSearch(value); setLimit(60); }} loading={loading} onRefresh={() => onRefresh(category)}>
      <SortControl selected={effectiveSort} supportsAdded={providerType === "xtream"} onSelect={(mode) => { setLimit(60); onSort(mode); }} />
      <Grid items={filtered.slice(0, limit)} keyOf={(item) => String(item.stream_id)} titleOf={(item) => item.name} imageOf={(item) => item.stream_icon} onOpen={onOpen} />
      {limit < filtered.length ? <View style={s.more}><FocusButton label={t("loadMore")} onPress={() => setLimit((value) => value + 60)} /></View> : null}
    </Catalog>
    <CategoryDrawer
      visible={drawerOpen}
      items={drawerItems}
      selected={category}
      onClose={() => setDrawerOpen(false)}
      onSelect={(value) => {
        catalogCategoryMemory.movies = value;
        setCategory(value);
        setLimit(60);
        onCategory(value);
      }}
    />
  </View>;
}

function Series({ items, cats, providerType, sortMode, onSort, loading, loaded, selected, info, onCategory, onRefresh, onOpen, onBack, onEpisode, onDrawerVisibilityChange }: {
  items: XtreamSeriesItem[]; cats: XtreamCategory[]; providerType: ProviderType; sortMode: CatalogSortMode; onSort: (mode: CatalogSortMode) => void; loading: boolean; loaded: boolean; selected: XtreamSeriesItem | null; info: XtreamSeriesInfo | null;
  onCategory: (categoryId: string) => void; onRefresh: (categoryId: string) => void; onOpen: (item: XtreamSeriesItem) => void; onBack: () => void; onEpisode: (episode: XtreamEpisode) => void; onDrawerVisibilityChange: (visible: boolean) => void;
}) {
  const colors = useColors(); const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(() => catalogCategoryMemory.series);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [limit, setLimit] = useState(60);
  const categoryIds = useMemo(() => cats.map((item) => String(item.category_id)), [cats]);
  const drawerItems = useMemo<CategoryOption[]>(
    () => [{ id: "__all__", name: t("all") }, ...cats.map((item) => ({ id: String(item.category_id), name: item.category_name }))],
    [cats, t],
  );
  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true), drawerOpen);
  const effectiveSort = providerType === "m3u" && sortMode === "added" ? "default" : sortMode;

  useEffect(() => {
    onDrawerVisibilityChange(drawerOpen);
  }, [drawerOpen, onDrawerVisibilityChange]);

  useEffect(() => () => onDrawerVisibilityChange(false), [onDrawerVisibilityChange]);

  useEffect(() => {
    if (category !== "__all__" && cats.length > 0 && !categoryIds.includes(category)) {
      catalogCategoryMemory.series = "__all__";
      setCategory("__all__");
    }
  }, [category, categoryIds, cats.length]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = items.filter((item) =>
      (category === "__all__" || String(item.category_id) === category) &&
      (!query || item.name.toLowerCase().includes(query)),
    );
    return sortCatalogRows(
      rows,
      effectiveSort,
      (item) => (item as XtreamSeriesItem & { added?: string }).added,
      (item) => item.series_id,
    );
  }, [items, search, category, effectiveSort]);

  if (selected) {
    const groups = Object.entries(info?.episodes || {});
    return <View>
      <FocusButton label={t("back")} icon="arrow-left" variant="ghost" onPress={onBack} />
      <Text style={[s.title, { color: colors.foreground, marginTop: 14 }]}>{selected.name}</Text>
      {!info ? <Loading text={t("loadingEpisodes")} /> : groups.length ? groups.map(([season, episodes]) => <View key={season} style={{ marginTop: 18 }}>
        <Text style={[s.section, { color: colors.foreground }]}>{t("season")} {season}</Text>
        <View style={s.list}>{episodes.map((episode) => <Pressable key={String(episode.id)} onPress={() => onEpisode(episode)} style={[s.episode, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={{ color: colors.foreground, flex: 1 }}>{episode.title || `${t("episode")} ${episode.episode_num ?? ""}`}</Text>
          <Feather name="play-circle" size={24} color={colors.primary} />
        </Pressable>)}</View>
      </View>) : <Text style={{ color: colors.mutedForeground }}>{t("noEpisodes")}</Text>}
    </View>;
  }

  if (!loaded && loading) return <Loading text={t("loadingSeries")} />;
  return <View {...drawerSwipe.panHandlers}>
    <Catalog title={t("series")} detail={loaded ? t("seriesCount", { count: items.length.toLocaleString() }) : t("loading")} search={search} onSearch={(value) => { setSearch(value); setLimit(60); }} loading={loading} onRefresh={() => onRefresh(category)}>
      <SortControl selected={effectiveSort} supportsAdded={providerType === "xtream"} onSelect={(mode) => { setLimit(60); onSort(mode); }} />
      <Grid items={filtered.slice(0, limit)} keyOf={(item) => String(item.series_id)} titleOf={(item) => item.name} imageOf={(item) => item.cover} onOpen={onOpen} />
      {limit < filtered.length ? <View style={s.more}><FocusButton label={t("loadMore")} onPress={() => setLimit((value) => value + 60)} /></View> : null}
    </Catalog>
    <CategoryDrawer
      visible={drawerOpen}
      items={drawerItems}
      selected={category}
      onClose={() => setDrawerOpen(false)}
      onSelect={(value) => {
        catalogCategoryMemory.series = value;
        setCategory(value);
        setLimit(60);
        onCategory(value);
      }}
    />
  </View>;
}

function CategoryDrawer({ visible, items, selected, onSelect, onClose }: {
  visible: boolean;
  items: CategoryOption[];
  selected: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.78, 560);
  const translateX = useRef(new Animated.Value(-drawerWidth)).current;
  const closingRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    closingRef.current = false;
    translateX.setValue(-drawerWidth);
    Animated.timing(translateX, {
      toValue: 0,
      duration: 190,
      useNativeDriver: true,
    }).start();
  }, [drawerWidth, translateX, visible]);

  const closeAnimated = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    Animated.timing(translateX, {
      toValue: -drawerWidth,
      duration: 170,
      useNativeDriver: true,
    }).start(() => {
      closingRef.current = false;
      onClose();
    });
  };

  const closeSwipe = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dx < -18 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx < -45) closeAnimated();
      },
      onPanResponderTerminationRequest: () => true,
    }),
    [drawerWidth, translateX],
  );

  const renderCategory = ({ item }: { item: CategoryOption }) => {
    const active = selected === item.id;
    return <Pressable
      onPress={() => {
        onSelect(item.id);
        closeAnimated();
      }}
      style={[
        s.drawerItem,
        {
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: colors.card,
        },
      ]}
    >
      <View style={[s.drawerDot, { backgroundColor: active ? colors.primary : "transparent", borderColor: active ? colors.primary : colors.mutedForeground }]} />
      <Text numberOfLines={2} style={{ flex: 1, color: active ? colors.primary : colors.foreground, fontWeight: active ? "800" : "600" }}>
        {item.name || "—"}
      </Text>
      {active ? <Feather name="check" size={18} color={colors.primary} /> : null}
    </Pressable>;
  };

  return <Modal
    visible={visible}
    transparent
    statusBarTranslucent
    animationType="fade"
    onRequestClose={closeAnimated}
  >
    <View style={s.drawerBackdrop}>
      <Animated.View
        style={[
          s.drawerPanel,
          {
            width: drawerWidth,
            paddingTop: Math.max(insets.top, 16),
            paddingBottom: Math.max(insets.bottom, 16),
            backgroundColor: colors.background,
            borderColor: colors.border,
            transform: [{ translateX }],
          },
        ]}
      >
        <View style={s.drawerHeader} {...closeSwipe.panHandlers}>
          <Text style={[s.drawerTitle, { color: colors.foreground }]}>Kategoriler</Text>
          <Pressable onPress={closeAnimated} style={s.iconButton}>
            <Feather name="x" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <FlatList
          style={s.drawerScroll}
          contentContainerStyle={s.drawerList}
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderCategory}
          nestedScrollEnabled
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
          initialNumToRender={16}
          maxToRenderPerBatch={20}
          windowSize={7}
        />
      </Animated.View>
      <Pressable style={s.drawerDismiss} onPress={closeAnimated} />
    </View>
  </Modal>;
}

function HistoryView({ channels, favorites, history, onOpen, onOpenMedia }: {
  channels: Channel[]; favorites: string[]; history: string[]; onOpen: (channel: Channel) => void; onOpenMedia: (item: MediaProgress) => void;
}) {
  const colors = useColors(); const { t } = useI18n();
  const recent = history.map((id) => channels.find((channel) => channel.id === id)).filter((item): item is Channel => Boolean(item));
  const favs = favorites.map((id) => channels.find((channel) => channel.id === id)).filter((item): item is Channel => Boolean(item));
  const section = (title: string, rows: Channel[]) => <View style={{ marginBottom: 28 }}>
    <Text style={[s.section, { color: colors.foreground, marginBottom: 10 }]}>{title}</Text>
    {rows.length ? rows.map((channel) => <Pressable key={`${title}-${channel.id}`} onPress={() => onOpen(channel)} style={[s.episode, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={{ flex: 1 }}><Text style={{ color: colors.foreground, fontWeight: "700" }}>{channel.name}</Text><Text style={{ color: colors.mutedForeground }}>{channel.category}</Text></View>
      <Feather name="play" size={20} color={colors.primary} />
    </Pressable>) : <Text style={{ color: colors.mutedForeground }}>{t("nothingYet")}</Text>}
  </View>;

  return <View>
    <Text style={[s.title, { color: colors.foreground }]}>{t("history")}</Text>
    <View style={{ marginBottom: 30 }}><ContinueWatchingView onOpen={onOpenMedia} /></View>
    {section(t("recentlyWatched"), recent)}
    {section(t("favorites"), favs)}
  </View>;
}

function Settings({ provider, providers, busy, onEdit, onAdd, onSwitch, onDisconnect, onRemove }: {
  provider: ProviderConfig; providers: ProviderConfig[]; busy: boolean; onEdit: () => void; onAdd: () => void; onSwitch: (id: string) => void; onDisconnect: () => void; onRemove: (id: string) => void;
}) {
  const colors = useColors(); const { t, language, languages, setLanguage } = useI18n();
  return <View>
    <Text style={[s.title, { color: colors.foreground }]}>{t("settings")}</Text>
    <View style={[s.settings, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Text style={{ color: colors.foreground, fontWeight: "800", fontSize: 16 }}>{t("activeConnection")}</Text>
      <Text style={{ color: colors.foreground }}>{provider.name}</Text>
      <Text style={{ color: colors.mutedForeground }}>{provider.type.toUpperCase()} · {provider.channelCount ?? 0}</Text>
      <View style={s.row}><FocusButton label={t("editSource")} icon="edit-2" onPress={onEdit} /><FocusButton label={t("addAccount")} icon="plus" onPress={onAdd} /><FocusButton label={t("disconnect")} icon="log-out" variant="ghost" onPress={onDisconnect} /></View>
    </View>
    <View style={{ marginTop: 24 }}>
      <Text style={[s.section, { color: colors.foreground }]}>{t("language")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>{languages.map((item) => <FocusButton key={item.code} label={item.label} variant={language === item.code ? "secondary" : "ghost"} onPress={() => void setLanguage(item.code)} />)}</ScrollView>
    </View>
    <PlayerChromeTimeoutSetting />
    <View style={{ marginTop: 24 }}>
      <Text style={[s.section, { color: colors.foreground }]}>{t("savedAccounts")}</Text>
      <View style={{ gap: 8 }}>{providers.map((item) => <View key={item.id} style={[s.accountCard, { borderColor: item.id === provider.id ? colors.primary : colors.border, backgroundColor: colors.card }]}>
        <Pressable disabled={busy} onPress={() => onSwitch(item.id)} style={{ flex: 1 }}><Text style={{ color: colors.foreground, fontWeight: "800" }}>{item.name}{item.id === provider.id ? ` · ${t("active")}` : ""}</Text><Text style={{ color: colors.mutedForeground }}>{item.username || item.type.toUpperCase()}</Text></Pressable>
        <Pressable onPress={() => onRemove(item.id)} style={s.iconButton}><Feather name="trash-2" size={20} color={colors.mutedForeground} /></Pressable>
      </View>)}</View>
    </View>
  </View>;
}

function Catalog({ title, detail, search, onSearch, loading, onRefresh, children }: {
  title: string; detail: string; search: string; onSearch: (value: string) => void; loading: boolean; onRefresh: () => void; children: React.ReactNode;
}) {
  const colors = useColors(); const { t } = useI18n();
  return <View><View style={s.catalogHead}><View><Text style={[s.title, { color: colors.foreground }]}>{title}</Text><Text style={{ color: colors.mutedForeground }}>{detail}</Text></View><FocusButton label={loading ? t("loading") : t("refresh")} icon="refresh-cw" variant="ghost" onPress={onRefresh} disabled={loading} /></View><View style={[s.search, { borderColor: colors.border, backgroundColor: colors.card }]}><Feather name="search" size={18} color={colors.mutedForeground} /><TextInput value={search} onChangeText={onSearch} placeholder={`${t("search")} ${title.toLowerCase()}`} placeholderTextColor={colors.mutedForeground} style={{ flex: 1, color: colors.foreground, minHeight: 44 }} /></View>{children}</View>;
}

function SortControl({ selected, supportsAdded, onSelect }: {
  selected: CatalogSortMode;
  supportsAdded: boolean;
  onSelect: (mode: CatalogSortMode) => void;
}) {
  const colors = useColors();
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  const options: Array<{ id: CatalogSortMode; label: string; short: string }> = [
    { id: "default", label: t("providerOrder"), short: language === "tr" ? "Varsayılan" : "Default" },
    { id: "alphaAsc", label: language === "tr" ? "Alfabetik — Artan (A-Z)" : "Alphabetical — Ascending (A-Z)", short: "A-Z ↑" },
    { id: "alphaDesc", label: language === "tr" ? "Alfabetik — Azalan (Z-A)" : "Alphabetical — Descending (Z-A)", short: "Z-A ↓" },
    { id: "idAsc", label: language === "tr" ? "ID — Artan" : "ID — Ascending", short: "ID ↑" },
    { id: "idDesc", label: language === "tr" ? "ID — Azalan" : "ID — Descending", short: "ID ↓" },
    ...(supportsAdded ? [{ id: "added" as const, label: language === "tr" ? "Son eklenen (yeni → eski)" : "Newest added", short: language === "tr" ? "Son eklenen" : "Newest" }] : []),
  ];
  const active = options.find((option) => option.id === selected) ?? options[0];
  return <View style={s.sortDropdownWrap}>
    <Pressable onPress={() => setOpen((value) => !value)} style={[s.sortDropdownButton, { borderColor: open ? colors.primary : colors.border, backgroundColor: colors.card }]}>
      <Feather name="sliders" size={16} color={open ? colors.primary : colors.mutedForeground} />
      <Text style={{ flex: 1, color: colors.foreground, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>{language === "tr" ? "Sırala" : "Sort"}: {active.short}</Text>
      <Feather name={open ? "chevron-up" : "chevron-down"} size={17} color={colors.mutedForeground} />
    </Pressable>
    {open ? <View style={[s.sortDropdownMenu, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {options.map((option) => {
        const activeOption = option.id === selected;
        return <Pressable key={option.id} onPress={() => { onSelect(option.id); setOpen(false); }} style={[s.sortDropdownItem, { borderColor: activeOption ? colors.primary : "transparent" }]}>
          <View style={[s.drawerDot, { backgroundColor: activeOption ? colors.primary : "transparent", borderColor: activeOption ? colors.primary : colors.mutedForeground }]} />
          <Text style={{ flex: 1, color: activeOption ? colors.primary : colors.foreground, fontWeight: activeOption ? "800" : "600" }}>{option.label}</Text>
          {activeOption ? <Feather name="check" size={17} color={colors.primary} /> : null}
        </Pressable>;
      })}
    </View> : null}
  </View>;
}

function Grid<T>({ items, keyOf, titleOf, imageOf, onOpen }: { items: T[]; keyOf: (item: T) => string; titleOf: (item: T) => string; imageOf: (item: T) => string | undefined; onOpen: (item: T) => void }) {
  const colors = useColors(); const { width } = useWindowDimensions();
  const columns = width >= 900 ? 5 : width >= 650 ? 4 : width >= 420 ? 3 : 2;
  return <View style={s.grid}>{items.map((item) => <Pressable key={keyOf(item)} onPress={() => onOpen(item)} style={[s.card, { width: `${100 / columns}%` }]}>
    <View style={[s.media, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {imageOf(item) ? <Image source={{ uri: imageOf(item) }} style={s.posterBig} /> : <View style={[s.posterBig, { alignItems: "center", justifyContent: "center" }]}><Feather name="film" size={30} color={colors.primary} /></View>}
      <Text numberOfLines={2} style={{ color: colors.foreground, fontWeight: "700", padding: 9 }}>{titleOf(item)}</Text>
    </View>
  </Pressable>)}</View>;
}

function Stat({ icon, label, value, accent, onPress, preferredFocus = false }: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  value: string;
  accent: string;
  onPress: () => void;
  preferredFocus?: boolean;
}) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const tvFocused = Platform.isTV && focused;
  const animateFocus = (next: boolean) => {
    setFocused(next);
    if (!Platform.isTV) return;
    Animated.spring(scale, {
      toValue: next ? 1.055 : 1,
      damping: 18,
      stiffness: 210,
      mass: 0.45,
      useNativeDriver: true,
    }).start();
  };
  return <Animated.View style={[s.statPremiumPress, tvFocused ? s.homeTvGlow : null, tvFocused ? { shadowColor: colors.primary } : null, { transform: [{ scale }] }]}>
    <Pressable
      focusable
      hasTVPreferredFocus={Platform.isTV && preferredFocus}
      onFocus={() => animateFocus(true)}
      onBlur={() => animateFocus(false)}
      onPress={onPress}
      style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.82 : 1 }]}
    >
      <LinearGradient
        colors={[`${accent}1A`, "rgba(255,255,255,0.055)", "rgba(255,255,255,0.014)"]}
        locations={[0, 0.42, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          s.statPremium,
          {
            borderColor: tvFocused ? colors.primary : "rgba(255,255,255,0.08)",
            borderWidth: tvFocused ? 2 : StyleSheet.hairlineWidth,
          },
        ]}
      >
        <View style={[s.statMotif, { borderColor: accent }]} />
        <View style={s.statTopRow}>
          <View style={[s.statIconShell, { backgroundColor: `${accent}18` }]}><Feather name={icon} size={19} color={accent} /></View>
          <View style={[s.statAccent, { backgroundColor: accent }]} />
        </View>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[s.statValuePremium, { color: colors.foreground }]}>{value}</Text>
        <Text style={[s.statLabelPremium, { color: colors.mutedForeground }]}>{label}</Text>
      </LinearGradient>
    </Pressable>
  </Animated.View>;
}

function HomeAccountTile({ item, active = false, add = false, disabled = false, onPress }: {
  item?: ProviderConfig;
  active?: boolean;
  add?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const [focused, setFocused] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const tvFocused = Platform.isTV && focused;
  const animateFocus = (next: boolean) => {
    setFocused(next);
    if (!Platform.isTV) return;
    Animated.spring(scale, {
      toValue: next ? 1.05 : 1,
      damping: 18,
      stiffness: 210,
      mass: 0.45,
      useNativeDriver: true,
    }).start();
  };
  const icon = add ? "plus" : item?.type === "xtream" ? "radio" : item?.type === "m3u" ? "list" : "server";
  return <Animated.View style={[s.accountTileAnimationWrap, tvFocused ? s.homeTvGlow : null, tvFocused ? { shadowColor: colors.primary } : null, { transform: [{ scale }] }]}>
    <Pressable
      focusable={!disabled}
      disabled={disabled}
      onFocus={() => animateFocus(true)}
      onBlur={() => animateFocus(false)}
      onPress={onPress}
      style={({ pressed }) => [
        s.accountTilePremium,
        add ? s.addAccountTilePremium : null,
        {
          borderColor: tvFocused || active ? colors.primary : "rgba(255,255,255,0.08)",
          borderWidth: tvFocused ? 2 : StyleSheet.hairlineWidth,
          backgroundColor: colors.card,
          opacity: disabled ? 0.5 : pressed ? 0.78 : 1,
        },
        active ? s.accountTileActive : null,
      ]}
    >
      {add ? <>
        <View style={[s.accountAvatar, { backgroundColor: `${colors.primary}18` }]}><Feather name="plus" size={20} color={colors.primary} /></View>
        <Text style={[s.accountNamePremium, { color: colors.foreground }]}>{t("addAccount")}</Text>
        <Text style={[s.accountMetaPremium, { color: colors.mutedForeground }]}>{t("savedConnections")}</Text>
      </> : <>
        <View style={s.accountTileTop}>
          <View style={[s.accountAvatar, { backgroundColor: active ? `${colors.primary}22` : "rgba(255,255,255,0.05)" }]}>
            <Feather name={icon as React.ComponentProps<typeof Feather>["name"]} size={18} color={active || tvFocused ? colors.primary : colors.mutedForeground} />
          </View>
          {active ? <View style={[s.accountActivePill, { backgroundColor: `${colors.primary}1C` }]}><View style={[s.dot, { backgroundColor: colors.primary }]} /><Text style={{ color: colors.primary, fontSize: 11, fontWeight: "600" }}>{t("active")}</Text></View> : null}
        </View>
        <Text numberOfLines={1} style={[s.accountNamePremium, { color: colors.foreground }]}>{item?.name}</Text>
        <Text numberOfLines={1} style={[s.accountMetaPremium, { color: colors.mutedForeground }]}>{item?.username || item?.type.toUpperCase()}</Text>
      </>}
    </Pressable>
  </Animated.View>;
}

function Loading({ text }: { text: string }) {
  const colors = useColors();
  return <View style={{ paddingVertical: 40 }}><Text style={{ color: colors.mutedForeground, textAlign: "center" }}>{text}</Text></View>;
}

function Poster({ uri, title }: { uri?: string; title: string }) {
  const colors = useColors();
  return uri ? <Image source={{ uri }} style={s.logo} /> : <View style={[s.logo, { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }]}><Text style={{ color: colors.primary, fontWeight: "800" }}>{title.slice(0, 2).toUpperCase()}</Text></View>;
}

function Input({ label, ...props }: { label: string; value: string; onChangeText: (value: string) => void; autoCapitalize?: "none" | "sentences"; secureTextEntry?: boolean }) {
  const colors = useColors();
  return <View style={{ gap: 6 }}><Text style={{ color: colors.mutedForeground, fontWeight: "700" }}>{label}</Text><TextInput {...props} style={[s.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]} placeholderTextColor={colors.mutedForeground} /></View>;
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  fullPlayer: { flex: 1, backgroundColor: "#000" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 18, paddingBottom: 40, maxWidth: 1500, width: "100%", alignSelf: "center" },
  liveListContent: { padding: 18, paddingBottom: 40, maxWidth: 1500, width: "100%", alignSelf: "center", gap: 8 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingBottom: 8 },
  homeHeaderPremium: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 10 },
  homeHeaderTopPremium: { minHeight: 54 },
  homeBrandPremium: { fontSize: 17, fontWeight: "700", letterSpacing: 2.1 },
  homeProviderGlass: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.035)", paddingHorizontal: 2, paddingVertical: 1 },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  nav: { gap: 6, paddingVertical: 4 },
  brand: { fontSize: 18, fontWeight: "900", letterSpacing: 1 },
  brandLarge: { fontSize: 28, fontWeight: "900", letterSpacing: 1 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, flexDirection: "row", gap: 7, alignItems: "center", maxWidth: 210 },
  dot: { width: 7, height: 7, borderRadius: 9 },
  error: { margin: 12, borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: "row", gap: 8, alignItems: "center" },
  setup: { width: "100%", maxWidth: 720, alignSelf: "center", paddingHorizontal: 20, gap: 14 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 50, paddingHorizontal: 14 },
  title: { fontSize: 28, fontWeight: "800", marginBottom: 6 },
  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 1.1, marginBottom: 8 },
  hero: { fontSize: 38, lineHeight: 43, fontWeight: "900" },
  homeShell: { paddingTop: 8, paddingBottom: 18 },
  homeHeroBlock: { paddingTop: 12, paddingBottom: 10, maxWidth: 900 },
  homeEyebrowRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  homeLivePip: { width: 6, height: 6, borderRadius: 6 },
  homeKickerPremium: { fontSize: 11, fontWeight: "600", letterSpacing: 1.7 },
  homeProviderName: { flexShrink: 1, fontSize: 12, fontWeight: "400" },
  homeHeroPremium: { fontSize: 40, lineHeight: 46, fontWeight: "300", letterSpacing: -0.8 },
  homeHeroSub: { fontSize: 14, lineHeight: 21, fontWeight: "400", marginTop: 10, maxWidth: 640 },
  section: { fontSize: 20, fontWeight: "800" },
  hint: { marginBottom: 12, fontSize: 13 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginVertical: 24 },
  stat: { flexGrow: 1, minWidth: 145, borderWidth: 1, borderRadius: 16, padding: 18, gap: 8 },
  statValue: { fontSize: 28, fontWeight: "900" },
  homeStatsPremium: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 24, marginBottom: 20 },
  statPremiumPress: { flexGrow: 1, flexBasis: 156, minWidth: 150, borderRadius: 24 },
  homeTvGlow: { shadowOpacity: 0.48, shadowRadius: 18, shadowOffset: { width: 0, height: 0 }, elevation: 10 },
  statPremium: { minHeight: 154, borderWidth: StyleSheet.hairlineWidth, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 17, overflow: "hidden" },
  statMotif: { position: "absolute", width: 118, height: 118, borderRadius: 59, borderWidth: 1, opacity: 0.10, right: -34, top: -36 },
  statTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 19 },
  statIconShell: { width: 38, height: 38, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  statAccent: { width: 26, height: 2, borderRadius: 2, opacity: 0.75 },
  statValuePremium: { fontSize: 29, lineHeight: 34, fontWeight: "300", letterSpacing: -0.5 },
  statLabelPremium: { fontSize: 12, lineHeight: 18, fontWeight: "500", marginTop: 5 },
  homeActionRow: { alignItems: "flex-start", marginTop: 2 },
  accountGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  accountTile: { minWidth: 145, flexGrow: 1, borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
  homeAccountsSection: { marginTop: 34 },
  homeSectionHead: { flexDirection: "row", alignItems: "flex-end", gap: 14, marginBottom: 15 },
  homeSectionTitle: { fontSize: 21, lineHeight: 27, fontWeight: "500", letterSpacing: -0.25 },
  homeSectionSub: { fontSize: 12, lineHeight: 18, fontWeight: "400", marginTop: 3 },
  homeSectionRule: { width: 34, height: 2, borderRadius: 2, opacity: 0.65, marginBottom: 5 },
  accountGridPremium: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  accountTileAnimationWrap: { minWidth: 165, flexGrow: 1, flexBasis: 190, borderRadius: 22 },
  accountTilePremium: { width: "100%", minHeight: 124, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: 15, justifyContent: "flex-end" },
  accountTileActive: { shadowColor: "#00D4FF", shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  accountTileTop: { position: "absolute", top: 14, left: 14, right: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  accountAvatar: { width: 38, height: 38, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  accountActivePill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, flexDirection: "row", alignItems: "center", gap: 6 },
  accountNamePremium: { fontSize: 15, lineHeight: 20, fontWeight: "600", marginTop: 38 },
  accountMetaPremium: { fontSize: 11, lineHeight: 16, fontWeight: "400", marginTop: 3 },
  addAccountTilePremium: { justifyContent: "flex-start", gap: 2 },
  accountCard: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  catalogHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12 },
  search: { borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  sortDropdownWrap: { paddingTop: 10, paddingBottom: 10, alignSelf: "stretch" },
  sortDropdownButton: { minHeight: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  sortDropdownMenu: { marginTop: 6, borderWidth: 1, borderRadius: 12, padding: 6, gap: 3 },
  sortDropdownItem: { minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 9 },
  rail: { gap: 6, paddingVertical: 14 },
  list: { gap: 8 },
  liveRow: { borderWidth: 1, borderRadius: 14, padding: 8, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  liveMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  liveProgram: { fontSize: 12.5, marginTop: 3 },
  logo: { width: 50, height: 50, borderRadius: 10 },
  iconButton: { padding: 10 },
  more: { alignItems: "center", paddingVertical: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -6 },
  card: { padding: 6 },
  media: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  posterBig: { width: "100%", aspectRatio: 2 / 3 },
  episode: { borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  settings: { borderWidth: 1, borderRadius: 16, padding: 18, gap: 8 },
  homeDiscoveryShell: { paddingTop: 4, paddingBottom: 26, gap: 4 },
  homeHeroCard: { aspectRatio: 2.25, minHeight: 190, maxHeight: 520, borderRadius: 24, overflow: "hidden", borderWidth: 2, justifyContent: "flex-end" },
  homeHeroEmpty: { width: "100%", aspectRatio: 2.25, minHeight: 190, maxHeight: 420, borderRadius: 24, borderWidth: 1, overflow: "hidden", padding: 24 },
  homeHeroCaption: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 70, maxWidth: 760 },
  homeHeroEyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 7 },
  homeHeroImageTitle: { color: "#FFFFFF", fontSize: 30, lineHeight: 35, fontWeight: "800", textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 8, textShadowOffset: { width: 0, height: 2 } },
  homeHeroImageMeta: { color: "rgba(255,255,255,0.78)", fontSize: 13, fontWeight: "600", marginTop: 7 },
  homeHeroTitle: { fontSize: 28, lineHeight: 34, fontWeight: "700", maxWidth: 620 },
  homeHeroMeta: { fontSize: 13, marginTop: 7 },
  homeHeroDots: { flexDirection: "row", justifyContent: "center", gap: 6, paddingTop: 10 },
  homeHeroDot: { width: 6, height: 6, borderRadius: 6 },
  homeCompactStats: { flexDirection: "row", gap: 10, marginTop: 18, marginBottom: 14 },
  homeCompactStatCard: { flex: 1, minWidth: 0, minHeight: 76, borderWidth: 1, borderRadius: 16, paddingHorizontal: 9, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 7, overflow: "hidden" },
  homeCompactStatIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  homeCompactStatLabel: { fontSize: 10, lineHeight: 13, fontWeight: "600" },
  homeCompactStatValue: { fontSize: 17, lineHeight: 21, fontWeight: "800", marginTop: 1, flexShrink: 1 },
  homeShelfSection: { marginTop: 24 },
  homeShelfHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 },
  homeShelfTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700", letterSpacing: -0.25 },
  homeSeeAllButton: { borderWidth: 2, borderColor: "transparent", borderRadius: 9, paddingHorizontal: 7, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 5 },
  homeSeeAllText: { fontSize: 12, fontWeight: "700" },
  homeShelfList: { gap: 11, paddingVertical: 3, paddingHorizontal: 2 },
  homeShelfCard: { width: 142, borderWidth: 2, borderRadius: 16, padding: 7, overflow: "hidden" },
  homeShelfCardCompact: { width: 154, borderWidth: 2, borderRadius: 16, padding: 7, overflow: "hidden" },
  homeShelfImage: { width: "100%", aspectRatio: 2 / 3, borderRadius: 11, overflow: "hidden" },
  homeShelfImageCompact: { width: "100%", aspectRatio: 16 / 10, borderRadius: 11, overflow: "hidden" },
  homeShelfFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  homeShelfRemove: { position: "absolute", top: 6, right: 6, width: 25, height: 25, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.70)" },
  homeShelfCardTitle: { fontSize: 13, lineHeight: 18, fontWeight: "700", marginTop: 7 },
  homeShelfCardMeta: { fontSize: 11, lineHeight: 15, marginTop: 1 },
  homeProgressTrack: { height: 3, borderRadius: 3, overflow: "hidden", marginTop: 7 },
  homeProgressFill: { height: "100%", borderRadius: 3 },
  homeShelfEmpty: { minHeight: 58, borderWidth: 1, borderRadius: 14, borderStyle: "dashed", paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  homeSkeletonLine: { height: 12, borderRadius: 8, opacity: 0.72 },
  homeShelfSkeletonRow: { flexDirection: "row", gap: 11, paddingVertical: 3 },
  homeShelfSkeletonCard: { width: 142, borderWidth: 1, borderRadius: 16, padding: 7, gap: 9 },
  homeShelfSkeletonImage: { width: "100%", aspectRatio: 2 / 3, borderRadius: 11, opacity: 0.72 },
  homeTvFocusBase: { borderWidth: 2, borderColor: "transparent" },
  homeTvFocusActive: { borderWidth: 3, shadowOpacity: 0.78, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8, transform: [{ scale: 1.025 }] },
  drawerBackdrop: { flex: 1, flexDirection: "row", backgroundColor: "rgba(0,0,0,0.52)" },
  drawerPanel: { height: "100%", minHeight: 0, borderRightWidth: StyleSheet.hairlineWidth, elevation: 18, shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 7, height: 0 } },
  drawerScroll: { flex: 1, minHeight: 0 },
  drawerDismiss: { flex: 1 },
  drawerHeader: { minHeight: 58, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth },
  drawerTitle: { fontSize: 22, fontWeight: "900" },
  drawerList: { padding: 12, gap: 7, paddingBottom: 24 },
  drawerItem: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  drawerDot: { width: 8, height: 8, borderRadius: 8, borderWidth: 1 },
});
