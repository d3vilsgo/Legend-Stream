import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
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
import { Channel, ProviderConfig, ProviderType, usePlayer } from "@/context/PlayerContext";
import { MediaProgress } from "@/context/MediaLibraryContext";
import { useI18n } from "@/context/I18nContext";
import { useColors } from "@/hooks/useColors";
import { DownloadedMedia } from "@/lib/downloads";
import {
  buildEpisodeStreamUrl,
  buildVodStreamUrl,
  getSeries,
  getSeriesCategories,
  getSeriesInfo,
  getVodCategories,
  getVodStreams,
  XtreamCategory,
  XtreamEpisode,
  XtreamSeriesInfo,
  XtreamSeriesItem,
  XtreamVodItem,
} from "@/lib/xtreamCatalog";

type ViewName = "home" | "live" | "movies" | "series" | "history" | "downloads" | "settings" | "player";
type ContentView = Exclude<ViewName, "player">;
type Credentials = { baseUrl: string; username: string; password: string };
type Playable = {
  title: string;
  url: string;
  subtitle?: string;
  kind: "live" | "movie" | "episode" | "download";
  returnTo: ContentView;
};

export default function OptimizedHomeScreenV5() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const {
    provider, providers, channels, favorites, history, isHydrating, isLoading, error,
    connectProvider, refreshProvider, toggleFavorite, recordWatched, setActiveProvider,
    removeProvider, disconnectProvider, clearError,
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
  const [seriesCats, setSeriesCats] = useState<XtreamCategory[]>([]);
  const [series, setSeries] = useState<XtreamSeriesItem[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<XtreamSeriesItem | null>(null);
  const [seriesInfo, setSeriesInfo] = useState<XtreamSeriesInfo | null>(null);

  const credentials = useMemo<Credentials | null>(() => {
    if (!provider || provider.type !== "xtream" || !provider.username || !provider.password) return null;
    return { baseUrl: provider.url || provider.playlistUrl, username: provider.username, password: provider.password };
  }, [provider]);

  const providerChannels = useMemo(
    () => provider ? channels.filter((channel) => channel.providerId === provider.id) : [],
    [channels, provider],
  );

  useEffect(() => {
    setVod([]); setVodCats([]); setVodLoaded(false); setVodLoading(false);
    setSeries([]); setSeriesCats([]); setSeriesLoaded(false); setSeriesLoading(false);
    setSelectedSeries(null); setSeriesInfo(null); setCatalogError(null);
  }, [provider?.id]);

  const loadVod = async (force = false) => {
    if (!credentials || (vodLoaded && !force) || vodLoading) return;
    setVodLoading(true); setCatalogError(null);
    try {
      const [cats, items] = await Promise.all([getVodCategories(credentials), getVodStreams(credentials)]);
      setVodCats(cats); setVod(items); setVodLoaded(true);
    } catch (caught) {
      setCatalogError(caught instanceof Error ? caught.message : t("loadingMovies"));
    } finally { setVodLoading(false); }
  };

  const loadSeries = async (force = false) => {
    if (!credentials || (seriesLoaded && !force) || seriesLoading) return;
    setSeriesLoading(true); setCatalogError(null);
    try {
      const [cats, items] = await Promise.all([getSeriesCategories(credentials), getSeries(credentials)]);
      setSeriesCats(cats); setSeries(items); setSeriesLoaded(true);
    } catch (caught) {
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
      existing={editing ? provider : null}
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
    if (!credentials) return;
    setPlayable({
      title: item.name,
      subtitle: item.genre || t("movies"),
      url: buildVodStreamUrl(credentials, item),
      kind: "movie",
      returnTo: "movies",
    });
    setView("player");
  };

  const openSeries = async (item: XtreamSeriesItem) => {
    if (!credentials) return;
    setSelectedSeries(item); setSeriesInfo(null); setCatalogError(null);
    try { setSeriesInfo(await getSeriesInfo(credentials, item.series_id)); }
    catch (caught) { setCatalogError(caught instanceof Error ? caught.message : t("loadingEpisodes")); }
  };

  const playEpisode = (episode: XtreamEpisode) => {
    if (!credentials || !selectedSeries) return;
    setPlayable({
      title: episode.title || selectedSeries.name,
      subtitle: selectedSeries.name,
      url: buildEpisodeStreamUrl(credentials, episode),
      kind: "episode",
      returnTo: "series",
    });
    setView("player");
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

  const top = Math.max(insets.top, Platform.OS === "web" ? 20 : 0);
  return <View style={[s.screen, { backgroundColor: colors.background, paddingTop: top, paddingBottom: Math.max(insets.bottom, 10) }]}>
    <View style={[s.header, { borderColor: colors.border }]}>
      <View style={s.headerTop}>
        <Text style={[s.brand, { color: colors.foreground }]}>LEGEND<Text style={{ color: colors.primary }}>STREAM</Text></Text>
        <Pressable onPress={() => setView("settings")} style={[s.chip, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={[s.dot, { backgroundColor: colors.primary }]} />
          <Text numberOfLines={1} style={{ color: colors.mutedForeground }}>{provider.name}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.nav}>
        {nav.map((item) => <FocusButton key={item.key} label={item.label} icon={item.icon} variant={view === item.key ? "secondary" : "ghost"} onPress={() => navigate(item.key)} />)}
      </ScrollView>
    </View>

    {error || catalogError ? <View style={[s.error, { borderColor: colors.destructive, backgroundColor: colors.card }]}>
      <Text style={{ color: colors.destructive, flex: 1 }}>{error || catalogError}</Text>
      <Pressable onPress={() => { clearError(); setCatalogError(null); }}><Feather name="x" size={20} color={colors.mutedForeground} /></Pressable>
    </View> : null}

    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {view === "home" ? <Home provider={provider} providers={providers} live={providerChannels.length} vod={vodLoaded ? vod.length : null} series={seriesLoaded ? series.length : null} loading={isLoading} onRefresh={() => void refreshProvider()} onNavigate={navigate} onSwitch={(id) => void switchProvider(id)} onAdd={() => setAdding(true)} /> : null}
      {view === "live" ? <Live channels={providerChannels} favorites={favorites} providerType={provider.type} loading={isLoading} onRefresh={() => void refreshProvider()} onOpen={openLive} onFavorite={(id) => void toggleFavorite(id)} /> : null}
      {view === "movies" ? <Movies items={vod} cats={vodCats} loading={vodLoading} loaded={vodLoaded} onRefresh={() => void loadVod(true)} onOpen={openMovie} /> : null}
      {view === "series" ? <Series items={series} cats={seriesCats} loading={seriesLoading} loaded={seriesLoaded} selected={selectedSeries} info={seriesInfo} onRefresh={() => void loadSeries(true)} onOpen={openSeries} onBack={() => { setSelectedSeries(null); setSeriesInfo(null); }} onEpisode={playEpisode} /> : null}
      {view === "history" ? <HistoryView channels={providerChannels} favorites={favorites} history={history} onOpen={openLive} onOpenMedia={openProgress} /> : null}
      {view === "downloads" ? <DownloadsView onOpen={openDownload} /> : null}
      {view === "settings" ? <Settings provider={provider} providers={providers} busy={isLoading} onEdit={() => setEditing(true)} onAdd={() => setAdding(true)} onSwitch={(id) => void switchProvider(id)} onDisconnect={() => void disconnectProvider()} onRemove={(id) => void removeProvider(id)} /> : null}
    </ScrollView>
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

function Live({ channels, favorites, providerType, loading, onRefresh, onOpen, onFavorite }: {
  channels: Channel[]; favorites: string[]; providerType: ProviderType; loading: boolean; onRefresh: () => void; onOpen: (channel: Channel) => void; onFavorite: (id: string) => void;
}) {
  const colors = useColors(); const { t } = useI18n();
  const [search, setSearch] = useState(""); const [category, setCategory] = useState("__all__"); const [limit, setLimit] = useState(120);
  const categoryNames = useMemo(() => Array.from(new Set(channels.map((channel) => channel.category).filter(Boolean))), [channels]);
  const hasMeaningfulGroups = categoryNames.some((name) => name !== "Uncategorized" && name !== "Live TV");
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return channels.filter((channel) => (category === "__all__" || channel.category === category) && (!query || channel.name.toLowerCase().includes(query)));
  }, [channels, search, category]);
  const shown = filtered.slice(0, limit);

  return <Catalog title={t("liveTv")} detail={t("channels", { count: channels.length.toLocaleString() })} search={search} onSearch={(value) => { setSearch(value); setLimit(120); }} loading={loading} onRefresh={onRefresh}>
    <Rail items={[{ id: "__all__", name: t("all") }, ...categoryNames.map((name) => ({ id: name, name }))]} selected={category} onSelect={(value) => { setCategory(value); setLimit(120); }} />
    {providerType === "m3u" && !hasMeaningfulGroups ? <Text style={[s.hint, { color: colors.mutedForeground }]}>{t("m3uNoGroups")}</Text> : null}
    <View style={s.list}>{shown.map((channel) => <View key={channel.id} style={[s.liveRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Pressable style={s.liveMain} onPress={() => onOpen(channel)}><Poster uri={channel.logoUrl} title={channel.name} /><View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "700" }}>{channel.name}</Text><Text numberOfLines={1} style={{ color: colors.mutedForeground }}>{channel.category}</Text></View></Pressable>
      <Pressable onPress={() => onFavorite(channel.id)} style={s.iconButton}><Feather name="star" size={20} color={favorites.includes(channel.id) ? colors.primary : colors.mutedForeground} /></Pressable>
    </View>)}</View>
    {shown.length < filtered.length ? <View style={s.more}><FocusButton label={`${t("loadMore")} · ${Math.min(120, filtered.length - shown.length)}`} onPress={() => setLimit((value) => value + 120)} /></View> : null}
  </Catalog>;
}

function Movies({ items, cats, loading, loaded, onRefresh, onOpen }: { items: XtreamVodItem[]; cats: XtreamCategory[]; loading: boolean; loaded: boolean; onRefresh: () => void; onOpen: (item: XtreamVodItem) => void }) {
  const { t } = useI18n();
  const [search, setSearch] = useState(""); const [category, setCategory] = useState("__all__"); const [limit, setLimit] = useState(60);
  const filtered = useMemo(() => { const query = search.trim().toLowerCase(); return items.filter((item) => (category === "__all__" || String(item.category_id) === category) && (!query || item.name.toLowerCase().includes(query))); }, [items, search, category]);
  if (!loaded && loading) return <Loading text={t("loadingMovies")} />;
  return <Catalog title={t("movies")} detail={loaded ? t("titles", { count: items.length.toLocaleString() }) : t("loading")} search={search} onSearch={(value) => { setSearch(value); setLimit(60); }} loading={loading} onRefresh={onRefresh}>
    <Rail items={[{ id: "__all__", name: t("all") }, ...cats.map((item) => ({ id: String(item.category_id), name: item.category_name }))]} selected={category} onSelect={(value) => { setCategory(value); setLimit(60); }} />
    <Grid items={filtered.slice(0, limit)} keyOf={(item) => String(item.stream_id)} titleOf={(item) => item.name} imageOf={(item) => item.stream_icon} onOpen={onOpen} />
    {limit < filtered.length ? <View style={s.more}><FocusButton label={t("loadMore")} onPress={() => setLimit((value) => value + 60)} /></View> : null}
  </Catalog>;
}

function Series({ items, cats, loading, loaded, selected, info, onRefresh, onOpen, onBack, onEpisode }: {
  items: XtreamSeriesItem[]; cats: XtreamCategory[]; loading: boolean; loaded: boolean; selected: XtreamSeriesItem | null; info: XtreamSeriesInfo | null;
  onRefresh: () => void; onOpen: (item: XtreamSeriesItem) => void; onBack: () => void; onEpisode: (episode: XtreamEpisode) => void;
}) {
  const colors = useColors(); const { t } = useI18n();
  const [search, setSearch] = useState(""); const [category, setCategory] = useState("__all__"); const [limit, setLimit] = useState(60);
  const filtered = useMemo(() => { const query = search.trim().toLowerCase(); return items.filter((item) => (category === "__all__" || String(item.category_id) === category) && (!query || item.name.toLowerCase().includes(query))); }, [items, search, category]);

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
  return <Catalog title={t("series")} detail={loaded ? t("seriesCount", { count: items.length.toLocaleString() }) : t("loading")} search={search} onSearch={(value) => { setSearch(value); setLimit(60); }} loading={loading} onRefresh={onRefresh}>
    <Rail items={[{ id: "__all__", name: t("all") }, ...cats.map((item) => ({ id: String(item.category_id), name: item.category_name }))]} selected={category} onSelect={(value) => { setCategory(value); setLimit(60); }} />
    <Grid items={filtered.slice(0, limit)} keyOf={(item) => String(item.series_id)} titleOf={(item) => item.name} imageOf={(item) => item.cover} onOpen={onOpen} />
    {limit < filtered.length ? <View style={s.more}><FocusButton label={t("loadMore")} onPress={() => setLimit((value) => value + 60)} /></View> : null}
  </Catalog>;
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

function Rail({ items, selected, onSelect }: { items: Array<{ id: string; name: string }>; selected: string; onSelect: (id: string) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>{items.map((item) => <FocusButton key={item.id} label={item.name || "—"} variant={selected === item.id ? "secondary" : "ghost"} onPress={() => onSelect(item.id)} />)}</ScrollView>;
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
  rail: { gap: 6, paddingVertical: 14 },
  list: { gap: 8 },
  liveRow: { borderWidth: 1, borderRadius: 14, padding: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  liveMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 50, height: 50, borderRadius: 10 },
  iconButton: { padding: 10 },
  more: { alignItems: "center", paddingVertical: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -6 },
  card: { padding: 6 },
  media: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  posterBig: { width: "100%", aspectRatio: 2 / 3 },
  episode: { borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  settings: { borderWidth: 1, borderRadius: 16, padding: 18, gap: 8 },
});
