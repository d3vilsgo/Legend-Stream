import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
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
import { MediaProgress } from "@/context/MediaLibraryContext";
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
  XtreamCategory,
  XtreamEpisode,
  XtreamSeriesInfo,
  XtreamSeriesItem,
  XtreamVodItem,
} from "@/lib/xtreamCatalog";

type ViewName = "home" | "live" | "movies" | "series" | "history" | "downloads" | "settings" | "player";
type ContentView = Exclude<ViewName, "player">;
type Credentials = { baseUrl: string; username: string; password: string };
type CatalogSortMode = "default" | "alpha" | "added";
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

const sortCatalogRows = <T extends { name: string }>(
  rows: T[],
  mode: CatalogSortMode,
  addedOf: (item: T) => string | undefined,
) => {
  if (mode === "default") return rows;
  const sorted = [...rows];
  if (mode === "alpha") {
    sorted.sort((a, b) => a.name.localeCompare(b.name, "tr", { sensitivity: "base" }));
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
    setActiveProvider,
    removeProvider,
    disconnectProvider,
    clearError,
  } = usePlayer();

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
  const [catalogSort, setCatalogSort] = useState<CatalogSortMode>("default");
  const [providerTypeOverride, setProviderTypeOverride] = useState<ProviderType | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<XtreamSeriesItem | null>(null);
  const [seriesInfo, setSeriesInfo] = useState<XtreamSeriesInfo | null>(null);

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

  const providerChannels = useMemo(
    () => provider
      ? channels.filter(
          (channel) => channel.providerId === provider.id && (channel.contentType ?? "live") === "live",
        )
      : [],
    [channels, provider],
  );

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(CATALOG_SORT_KEY)
      .then((saved) => {
        if (
          !cancelled &&
          (saved === "default" || saved === "alpha" || saved === "added")
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
    setHomeVodCount(null); setHomeSeriesCount(null);
    setProviderTypeOverride(null);
    setSelectedSeries(null); setSeriesInfo(null); setCatalogError(null);
    catalogCategoryMemory.movies = "__all__";
    catalogCategoryMemory.series = "__all__";
  }, [provider?.id]);

  useEffect(() => {
    if (!effectiveProvider) return;
    if (effectiveProvider.type === "m3u") {
      const local = getM3UCatalog(effectiveProvider.id);
      setHomeVodCount(local.movieItems.length);
      setHomeSeriesCount(local.seriesGroups.length);
      return;
    }
    if (effectiveProvider.type !== "xtream" || !credentials) return;

    // A get.php/m3u_plus URL can be either a real Xtream account or a playlist
    // source that was explicitly saved as M3U. Early Home counts are read-only:
    // never probe these ambiguous legacy records in the background. The normal
    // Movies/Series path still performs its existing category request and can
    // migrate on a typed catalog-format failure.
    if (isGetPhpM3UPlusProvider(effectiveProvider)) return;

    let cancelled = false;
    void (async () => {
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
    if (!provider || (vodLoaded && !force) || vodLoading) return;
    setVodLoading(true); setCatalogError(null);
    try {
      if (effectiveProvider?.type === "m3u") {
        applyLocalVod();
        return;
      }
      if (!credentials || effectiveProvider?.type !== "xtream") return;
      if (force) {
        setVod([]);
        setVodCache({});
      }
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
    if (!provider || effectiveProvider?.type !== "xtream" || !credentials || categoryId === "__all__") return;
    if (vodCache[categoryId] && !force) return;
    setVodLoading(true); setCatalogError(null);
    try {
      const items = await getVodStreams(credentials, categoryId);
      await yieldToUi();
      setVodCache((previous) => {
        const next = { ...previous, [categoryId]: items };
        setVod(flattenCatalogCache(next));
        return next;
      });
    } catch (caught) {
      if (await tryCatalogFallbackToM3U(caught, "movies")) return;
      setVodLoaded(true);
      setCatalogError(caught instanceof Error ? caught.message : t("loadingMovies"));
    } finally { setVodLoading(false); }
  };

  const loadSeries = async (force = false) => {
    if (!provider || (seriesLoaded && !force) || seriesLoading) return;
    setSeriesLoading(true); setCatalogError(null);
    try {
      if (effectiveProvider?.type === "m3u") {
        applyLocalSeries();
        return;
      }
      if (!credentials || effectiveProvider?.type !== "xtream") return;
      if (force) {
        setSeries([]);
        setSeriesCache({});
      }
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
    if (!provider || effectiveProvider?.type !== "xtream" || !credentials || categoryId === "__all__") return;
    if (seriesCache[categoryId] && !force) return;
    setSeriesLoading(true); setCatalogError(null);
    try {
      const items = await getSeries(credentials, categoryId);
      await yieldToUi();
      setSeriesCache((previous) => {
        const next = { ...previous, [categoryId]: items };
        setSeries(flattenCatalogCache(next));
        return next;
      });
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
    <View style={[s.header, { borderColor: colors.border }]}>
      <View style={s.headerTop}>
        <Text style={[s.brand, { color: colors.foreground }]}>LEGEND<Text style={{ color: colors.primary }}>STREAM</Text></Text>
        <ProviderSubscriptionChip provider={shownProvider} />
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
      onRefresh={() => void refreshProvider()}
      onOpen={openLive}
      onFavorite={(id) => void toggleFavorite(id)}
    /> : <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {view === "home" ? <Home provider={shownProvider} providers={providers} live={providerChannels.length} vod={homeVodCount} series={homeSeriesCount} loading={isLoading} onRefresh={() => void refreshProvider()} onNavigate={navigate} onSwitch={(id) => void switchProvider(id)} onAdd={() => setAdding(true)} /> : null}
      {view === "movies" ? <Movies items={vod} cats={vodCats} providerType={shownProvider.type} sortMode={catalogSort} onSort={changeCatalogSort} loading={vodLoading} loaded={vodLoaded} onCategory={(category) => void loadVodCategory(category)} onRefresh={(category) => category === "__all__" ? void loadVod(true) : void loadVodCategory(category, true)} onOpen={openMovie} /> : null}
      {view === "series" ? <Series items={series} cats={seriesCats} providerType={shownProvider.type} sortMode={catalogSort} onSort={changeCatalogSort} loading={seriesLoading} loaded={seriesLoaded} selected={selectedSeries} info={seriesInfo} onCategory={(category) => void loadSeriesCategory(category)} onRefresh={(category) => category === "__all__" ? void loadSeries(true) : void loadSeriesCategory(category, true)} onOpen={openSeries} onBack={() => { setSelectedSeries(null); setSeriesInfo(null); }} onEpisode={playEpisode} /> : null}
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

function Home({ provider, providers, live, vod, series, loading, onRefresh, onNavigate, onSwitch, onAdd }: {
  provider: ProviderConfig; providers: ProviderConfig[]; live: number; vod: number | null; series: number | null; loading: boolean;
  onRefresh: () => void; onNavigate: (view: ContentView) => void; onSwitch: (id: string) => void; onAdd: () => void;
}) {
  const colors = useColors(); const { t } = useI18n();
  return <View>
    <Text style={[s.kicker, { color: colors.primary }]}>{t("activeConnection").toUpperCase()} / {provider.name}</Text>
    <Text style={[s.hero, { color: colors.foreground }]}>{t("liveTv")}, {t("movies").toLowerCase()} & {t("series").toLowerCase()}.</Text>
    <View style={s.stats}>
      <Stat label={t("liveTv")} value={live.toLocaleString()} onPress={() => onNavigate("live")} />
      <Stat label={t("movies")} value={vod === null ? t("tapToLoad") : vod.toLocaleString()} onPress={() => onNavigate("movies")} />
      <Stat label={t("series")} value={series === null ? t("tapToLoad") : series.toLocaleString()} onPress={() => onNavigate("series")} />
      <Stat label={t("download")} value="Offline" onPress={() => onNavigate("downloads")} />
    </View>
    <FocusButton label={loading ? t("refreshingLive") : t("refreshLive")} icon="refresh-cw" variant="primary" onPress={onRefresh} disabled={loading} />
    <View style={{ marginTop: 28 }}>
      <Text style={[s.section, { color: colors.foreground }]}>{t("savedConnections")}</Text>
      <Text style={{ color: colors.mutedForeground, marginBottom: 10 }}>{t("accountsRemembered")}</Text>
      <View style={s.accountGrid}>
        {providers.map((item) => <Pressable key={item.id} disabled={loading} onPress={() => onSwitch(item.id)} style={[s.accountTile, { borderColor: item.id === provider.id ? colors.primary : colors.border, backgroundColor: colors.card }]}>
          <View style={[s.dot, { backgroundColor: item.id === provider.id ? colors.primary : colors.mutedForeground }]} />
          <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "800" }}>{item.name}</Text>
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 12 }}>{item.username || item.type.toUpperCase()}</Text>
        </Pressable>)}
        <Pressable onPress={onAdd} style={[s.accountTile, { borderColor: colors.border, backgroundColor: colors.card }]}><Feather name="plus" size={22} color={colors.primary} /><Text style={{ color: colors.foreground, fontWeight: "800" }}>{t("addAccount")}</Text></Pressable>
      </View>
    </View>
  </View>;
}

function useCategoryDrawerSwipe(onOpen: () => void) {
  return useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dx > 18 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35,
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx > 55) onOpen();
      },
      onPanResponderTerminate: () => undefined,
    }),
    [onOpen],
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
  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true));

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

function Movies({ items, cats, providerType, sortMode, onSort, loading, loaded, onCategory, onRefresh, onOpen }: {
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
  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true));
  const effectiveSort = providerType === "m3u" && sortMode === "added" ? "default" : sortMode;

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
    return sortCatalogRows(rows, effectiveSort, (item) => item.added);
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

function Series({ items, cats, providerType, sortMode, onSort, loading, loaded, selected, info, onCategory, onRefresh, onOpen, onBack, onEpisode }: {
  items: XtreamSeriesItem[]; cats: XtreamCategory[]; providerType: ProviderType; sortMode: CatalogSortMode; onSort: (mode: CatalogSortMode) => void; loading: boolean; loaded: boolean; selected: XtreamSeriesItem | null; info: XtreamSeriesInfo | null;
  onCategory: (categoryId: string) => void; onRefresh: (categoryId: string) => void; onOpen: (item: XtreamSeriesItem) => void; onBack: () => void; onEpisode: (episode: XtreamEpisode) => void;
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
  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true));
  const effectiveSort = providerType === "m3u" && sortMode === "added" ? "default" : sortMode;

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
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dx < -18 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35,
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx < -45) closeAnimated();
      },
    }),
    [drawerWidth, translateX],
  );

  return <Modal
    visible={visible}
    transparent
    statusBarTranslucent
    animationType="fade"
    onRequestClose={closeAnimated}
  >
    <View style={s.drawerBackdrop} {...closeSwipe.panHandlers}>
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
        <View style={s.drawerHeader}>
          <Text style={[s.drawerTitle, { color: colors.foreground }]}>Kategoriler</Text>
          <Pressable onPress={closeAnimated} style={s.iconButton}>
            <Feather name="x" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.drawerList}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {items.map((item) => {
            const active = selected === item.id;
            return <Pressable
              key={item.id}
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
          })}
        </ScrollView>
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
  const options: Array<{ id: CatalogSortMode; label: string }> = [
    { id: "default", label: "Varsayılan" },
    { id: "alpha", label: "Alfabetik (A-Z)" },
    ...(supportsAdded ? [{ id: "added" as const, label: "Eklenme tarihi (yeni→eski)" }] : []),
  ];
  return <View style={s.sortRow}>
    <Feather name="sliders" size={16} color={colors.mutedForeground} />
    {options.map((option) => <Pressable
      key={option.id}
      onPress={() => onSelect(option.id)}
      style={[
        s.sortButton,
        {
          borderColor: selected === option.id ? colors.primary : colors.border,
          backgroundColor: colors.card,
        },
      ]}
    >
      <Text style={{ color: selected === option.id ? colors.primary : colors.mutedForeground, fontWeight: "700", fontSize: 12 }}>
        {option.label}
      </Text>
    </Pressable>)}
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

function Stat({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const colors = useColors();
  return <Pressable onPress={onPress} style={[s.stat, { borderColor: colors.border, backgroundColor: colors.card }]}><Text style={[s.statValue, { color: colors.foreground }]}>{value}</Text><Text style={{ color: colors.mutedForeground }}>{label}</Text></Pressable>;
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
  section: { fontSize: 20, fontWeight: "800" },
  hint: { marginBottom: 12, fontSize: 13 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginVertical: 24 },
  stat: { flexGrow: 1, minWidth: 145, borderWidth: 1, borderRadius: 16, padding: 18, gap: 8 },
  statValue: { fontSize: 28, fontWeight: "900" },
  accountGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  accountTile: { minWidth: 145, flexGrow: 1, borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
  accountCard: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  catalogHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12 },
  search: { borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  sortRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7, paddingTop: 10, paddingBottom: 10 },
  sortButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
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
  drawerBackdrop: { flex: 1, flexDirection: "row", backgroundColor: "rgba(0,0,0,0.52)" },
  drawerPanel: { height: "100%", borderRightWidth: StyleSheet.hairlineWidth, elevation: 18, shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 7, height: 0 } },
  drawerDismiss: { flex: 1 },
  drawerHeader: { minHeight: 58, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth },
  drawerTitle: { fontSize: 22, fontWeight: "900" },
  drawerList: { padding: 12, gap: 7 },
  drawerItem: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  drawerDot: { width: 8, height: 8, borderRadius: 8, borderWidth: 1 },
});
