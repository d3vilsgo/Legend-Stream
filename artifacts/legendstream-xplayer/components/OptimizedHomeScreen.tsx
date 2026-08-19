import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FocusButton } from "@/components/FocusButton";
import { NativeVideoPlayer } from "@/components/NativeVideoPlayer";
import { Channel, ProviderConfig, ProviderType, usePlayer } from "@/context/PlayerContext";
import { useColors } from "@/hooks/useColors";
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

type ViewName = "home" | "live" | "movies" | "series" | "library" | "settings" | "player";
type Credentials = { baseUrl: string; username: string; password: string };
type Playable = { title: string; url: string; subtitle?: string; kind: "live" | "movie" | "episode" };

const nav: Array<{ key: Exclude<ViewName, "player">; label: string; icon: keyof typeof Feather.glyphMap }> = [
  { key: "home", label: "Home", icon: "home" },
  { key: "live", label: "Live TV", icon: "radio" },
  { key: "movies", label: "Movies", icon: "film" },
  { key: "series", label: "Series", icon: "tv" },
  { key: "library", label: "Library", icon: "bookmark" },
  { key: "settings", label: "Settings", icon: "settings" },
];

export default function OptimizedHomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const {
    provider, providers, channels, favorites, history, isHydrating, isLoading, error,
    connectProvider, refreshProvider, toggleFavorite, recordWatched, setActiveProvider,
    removeProvider, clearError,
  } = usePlayer();

  const [view, setView] = useState<ViewName>("home");
  const [editing, setEditing] = useState(false);
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
  const [seriesInfo, setSeriesInfo] = useState<XtreamSeriesInfo | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<XtreamSeriesItem | null>(null);

  const credentials = useMemo<Credentials | null>(() => {
    if (!provider || provider.type !== "xtream" || !provider.username || !provider.password) return null;
    return { baseUrl: provider.url || provider.playlistUrl, username: provider.username, password: provider.password };
  }, [provider]);

  const providerChannels = useMemo(
    () => provider ? channels.filter((c) => c.providerId === provider.id) : [],
    [channels, provider],
  );

  const loadVod = async (force = false) => {
    if (!credentials || (vodLoaded && !force) || vodLoading) return;
    setVodLoading(true); setCatalogError(null);
    try {
      const [cats, items] = await Promise.all([getVodCategories(credentials), getVodStreams(credentials)]);
      setVodCats(cats); setVod(items); setVodLoaded(true);
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : "Movie catalog could not be loaded.");
    } finally { setVodLoading(false); }
  };

  const loadSeries = async (force = false) => {
    if (!credentials || (seriesLoaded && !force) || seriesLoading) return;
    setSeriesLoading(true); setCatalogError(null);
    try {
      const [cats, items] = await Promise.all([getSeriesCategories(credentials), getSeries(credentials)]);
      setSeriesCats(cats); setSeries(items); setSeriesLoaded(true);
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : "Series catalog could not be loaded.");
    } finally { setSeriesLoading(false); }
  };

  const navigate = (target: Exclude<ViewName, "player">) => {
    setView(target);
    if (target === "movies") void loadVod();
    if (target === "series") void loadSeries();
    if (target !== "series") { setSelectedSeries(null); setSeriesInfo(null); }
  };

  if (isHydrating) return <View style={[s.centered, { backgroundColor: colors.background }]}><Text style={{ color: colors.foreground }}>Preparing player…</Text></View>;

  if (!provider || editing) {
    return <ProviderSetup
      existing={editing ? provider : null}
      busy={isLoading}
      error={error}
      onCancel={provider ? () => setEditing(false) : undefined}
      onSubmit={async (config) => {
        clearError();
        const ok = await connectProvider(config);
        if (ok) { setEditing(false); setView("home"); }
      }}
    />;
  }

  const openLive = (c: Channel) => {
    setPlayable({ title: c.name, subtitle: c.category, url: c.streamUrl, kind: "live" });
    void recordWatched(c.id); setView("player");
  };

  const openMovie = (item: XtreamVodItem) => {
    if (!credentials) return;
    setPlayable({ title: item.name, subtitle: item.genre || "Movie", kind: "movie", url: buildVodStreamUrl(credentials, item) });
    setView("player");
  };

  const openSeries = async (item: XtreamSeriesItem) => {
    if (!credentials) return;
    setSelectedSeries(item); setSeriesInfo(null); setCatalogError(null);
    try { setSeriesInfo(await getSeriesInfo(credentials, item.series_id)); }
    catch (e) { setCatalogError(e instanceof Error ? e.message : "Series details could not be loaded."); }
  };

  const playEpisode = (ep: XtreamEpisode) => {
    if (!credentials || !selectedSeries) return;
    setPlayable({ title: ep.title || selectedSeries.name, subtitle: selectedSeries.name, kind: "episode", url: buildEpisodeStreamUrl(credentials, ep) });
    setView("player");
  };

  const top = Math.max(insets.top, Platform.OS === "web" ? 20 : 0);
  return <View style={[s.screen, { backgroundColor: colors.background, paddingTop: top, paddingBottom: Math.max(insets.bottom, 10) }]}>
    <View style={[s.header, { borderColor: colors.border }]}>
      <View style={s.headerTop}>
        <Text style={[s.brand, { color: colors.foreground }]}>LEGEND<Text style={{ color: colors.primary }}>STREAM</Text></Text>
        <View style={[s.chip, { borderColor: colors.border, backgroundColor: colors.card }]}><View style={[s.dot, { backgroundColor: colors.primary }]} /><Text numberOfLines={1} style={{ color: colors.mutedForeground }}>{provider.name}</Text></View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.nav}>{nav.map((n) => <FocusButton key={n.key} label={n.label} icon={n.icon} variant={view === n.key ? "secondary" : "ghost"} onPress={() => navigate(n.key)} />)}</ScrollView>
    </View>

    {error || catalogError ? <View style={[s.error, { borderColor: colors.destructive, backgroundColor: colors.card }]}><Text style={{ color: colors.destructive, flex: 1 }}>{error || catalogError}</Text><Pressable onPress={() => { clearError(); setCatalogError(null); }}><Feather name="x" size={20} color={colors.mutedForeground} /></Pressable></View> : null}

    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {view === "home" ? <Home provider={provider} live={providerChannels.length} vod={vodLoaded ? vod.length : null} series={seriesLoaded ? series.length : null} loading={isLoading} onRefresh={() => void refreshProvider()} onNavigate={navigate} /> : null}
      {view === "live" ? <Live channels={providerChannels} favorites={favorites} loading={isLoading} onRefresh={() => void refreshProvider()} onOpen={openLive} onFavorite={(id) => void toggleFavorite(id)} /> : null}
      {view === "movies" ? <Movies items={vod} cats={vodCats} loading={vodLoading} loaded={vodLoaded} onRefresh={() => void loadVod(true)} onOpen={openMovie} /> : null}
      {view === "series" ? <Series items={series} cats={seriesCats} loading={seriesLoading} loaded={seriesLoaded} selected={selectedSeries} info={seriesInfo} onRefresh={() => void loadSeries(true)} onOpen={openSeries} onBack={() => { setSelectedSeries(null); setSeriesInfo(null); }} onEpisode={playEpisode} /> : null}
      {view === "library" ? <Library channels={providerChannels} favorites={favorites} history={history} onOpen={openLive} /> : null}
      {view === "settings" ? <Settings provider={provider} providers={providers} onEdit={() => setEditing(true)} onSwitch={(id) => void setActiveProvider(id)} onRemove={() => void removeProvider()} /> : null}
      {view === "player" ? <Player playable={playable} onBack={() => setView(playable?.kind === "movie" ? "movies" : playable?.kind === "episode" ? "series" : "live")} /> : null}
    </ScrollView>
  </View>;
}

function ProviderSetup({ existing, busy, error, onCancel, onSubmit }: {
  existing: ProviderConfig | null; busy: boolean; error: string | null; onCancel?: () => void;
  onSubmit: (config: Omit<ProviderConfig, "id" | "connectedAt" | "createdAt" | "url" | "channelCount"> & { url?: string; epgUrl?: string; mac?: string }) => Promise<void>;
}) {
  const colors = useColors(); const insets = useSafeAreaInsets();
  const [name, setName] = useState(existing?.name ?? "My provider"); const [type, setType] = useState<ProviderType>(existing?.type ?? "xtream");
  const [url, setUrl] = useState(existing?.playlistUrl ?? ""); const [username, setUsername] = useState(existing?.username ?? ""); const [password, setPassword] = useState(existing?.password ?? "");
  const [mac, setMac] = useState(existing?.mac ?? ""); const [epgUrl, setEpgUrl] = useState(existing?.epgUrl ?? ""); const [localError, setLocalError] = useState<string | null>(null);
  const submit = async () => {
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) return setLocalError("Enter a full URL beginning with http:// or https://");
    if (type === "xtream" && (!username.trim() || !password)) return setLocalError("Xtream requires username and password.");
    setLocalError(null);
    await onSubmit({ name: name.trim() || "My provider", type, playlistUrl: clean, username: type === "xtream" ? username.trim() : undefined, password: type === "xtream" ? password : undefined, mac: type === "stalker" ? mac.trim() : undefined, epgUrl: epgUrl.trim() || undefined });
  };
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView contentContainerStyle={[s.setup, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 140 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}>
      <Text style={[s.brandLarge, { color: colors.foreground }]}>LEGEND<Text style={{ color: colors.primary }}>STREAM</Text></Text>
      <Text style={[s.title, { color: colors.foreground }]}>Connect your IPTV source</Text>
      <Text style={{ color: colors.mutedForeground }}>Use only services and streams you are authorized to access.</Text>
      <View style={s.row}>{(["xtream", "m3u", "stalker"] as ProviderType[]).map((t) => <FocusButton key={t} label={t === "xtream" ? "Xtream" : t === "m3u" ? "M3U" : "Stalker"} variant={type === t ? "secondary" : "ghost"} onPress={() => setType(t)} />)}</View>
      <Input label="Source name" value={name} onChangeText={setName} />
      <Input label="Server / playlist URL" value={url} onChangeText={setUrl} autoCapitalize="none" />
      {type === "xtream" ? <><Input label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" /><Input label="Password" value={password} onChangeText={setPassword} secureTextEntry /></> : null}
      {type === "stalker" ? <Input label="MAC address" value={mac} onChangeText={setMac} autoCapitalize="none" /> : null}
      <Input label="EPG URL (optional)" value={epgUrl} onChangeText={setEpgUrl} autoCapitalize="none" />
      {localError || error ? <Text style={{ color: colors.destructive }}>{localError || error}</Text> : null}
      <View style={s.row}><FocusButton label={busy ? "Connecting…" : "Connect"} icon="log-in" variant="primary" onPress={() => void submit()} disabled={busy} />{onCancel ? <FocusButton label="Cancel" variant="ghost" onPress={onCancel} /> : null}</View>
    </ScrollView>
  </KeyboardAvoidingView>;
}

function Home({ provider, live, vod, series, loading, onRefresh, onNavigate }: { provider: ProviderConfig; live: number; vod: number | null; series: number | null; loading: boolean; onRefresh: () => void; onNavigate: (v: Exclude<ViewName, "player">) => void }) {
  const colors = useColors();
  return <View><Text style={[s.kicker, { color: colors.primary }]}>SOURCE CONNECTED / {provider.type.toUpperCase()}</Text><Text style={[s.hero, { color: colors.foreground }]}>Live, movies and series. One player.</Text><Text style={{ color: colors.mutedForeground }}>Movies and Series load only when you open those sections, keeping startup fast.</Text><View style={s.stats}><Stat label="Live TV" value={String(live.toLocaleString())} onPress={() => onNavigate("live")} /><Stat label="Movies" value={vod === null ? "Tap to load" : vod.toLocaleString()} onPress={() => onNavigate("movies")} /><Stat label="Series" value={series === null ? "Tap to load" : series.toLocaleString()} onPress={() => onNavigate("series")} /></View><FocusButton label={loading ? "Refreshing live…" : "Refresh live"} icon="refresh-cw" variant="primary" onPress={onRefresh} disabled={loading} /></View>;
}

function Live({ channels, favorites, loading, onRefresh, onOpen, onFavorite }: { channels: Channel[]; favorites: string[]; loading: boolean; onRefresh: () => void; onOpen: (c: Channel) => void; onFavorite: (id: string) => void }) {
  const colors = useColors(); const [search, setSearch] = useState(""); const [category, setCategory] = useState("All"); const [limit, setLimit] = useState(120);
  const categories = useMemo(() => ["All", ...Array.from(new Set(channels.map((c) => c.category))).sort()], [channels]);
  const filtered = useMemo(() => { const q = search.trim().toLowerCase(); return channels.filter((c) => (category === "All" || c.category === category) && (!q || c.name.toLowerCase().includes(q))); }, [channels, search, category]);
  const shown = filtered.slice(0, limit);
  return <Catalog title="Live TV" detail={`${channels.length.toLocaleString()} channels`} search={search} onSearch={(v) => { setSearch(v); setLimit(120); }} loading={loading} onRefresh={onRefresh}><Rail items={categories.map((x) => ({ id: x, name: x }))} selected={category} onSelect={(x) => { setCategory(x); setLimit(120); }} /><View style={s.list}>{shown.map((c) => <View key={c.id} style={[s.liveRow, { borderColor: colors.border, backgroundColor: colors.card }]}><Pressable style={s.liveMain} onPress={() => onOpen(c)}><Poster uri={c.logoUrl} title={c.name} /><View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "700" }}>{c.name}</Text><Text numberOfLines={1} style={{ color: colors.mutedForeground }}>{c.category}</Text></View></Pressable><Pressable onPress={() => onFavorite(c.id)} style={s.icon}><Feather name="star" size={20} color={favorites.includes(c.id) ? colors.primary : colors.mutedForeground} /></Pressable></View>)}</View>{shown.length < filtered.length ? <View style={s.more}><FocusButton label={`Load ${Math.min(120, filtered.length - shown.length)} more`} onPress={() => setLimit((n) => n + 120)} /></View> : null}</Catalog>;
}

function Movies({ items, cats, loading, loaded, onRefresh, onOpen }: { items: XtreamVodItem[]; cats: XtreamCategory[]; loading: boolean; loaded: boolean; onRefresh: () => void; onOpen: (i: XtreamVodItem) => void }) {
  const [search, setSearch] = useState(""); const [cat, setCat] = useState("All"); const [limit, setLimit] = useState(60);
  const filtered = useMemo(() => { const q = search.trim().toLowerCase(); return items.filter((i) => (cat === "All" || String(i.category_id) === cat) && (!q || i.name.toLowerCase().includes(q))); }, [items, search, cat]);
  if (!loaded && loading) return <Loading text="Loading Movies…" />;
  return <Catalog title="Movies" detail={loaded ? `${items.length.toLocaleString()} titles` : "Not loaded"} search={search} onSearch={(v) => { setSearch(v); setLimit(60); }} loading={loading} onRefresh={onRefresh}><Rail items={[{ id: "All", name: "All" }, ...cats.map((c) => ({ id: String(c.category_id), name: c.category_name }))]} selected={cat} onSelect={(v) => { setCat(v); setLimit(60); }} /><Grid items={filtered.slice(0, limit)} keyOf={(i) => String(i.stream_id)} titleOf={(i) => i.name} imageOf={(i) => i.stream_icon} onOpen={onOpen} />{limit < filtered.length ? <View style={s.more}><FocusButton label="Load more" onPress={() => setLimit((n) => n + 60)} /></View> : null}</Catalog>;
}

function Series({ items, cats, loading, loaded, selected, info, onRefresh, onOpen, onBack, onEpisode }: { items: XtreamSeriesItem[]; cats: XtreamCategory[]; loading: boolean; loaded: boolean; selected: XtreamSeriesItem | null; info: XtreamSeriesInfo | null; onRefresh: () => void; onOpen: (i: XtreamSeriesItem) => void; onBack: () => void; onEpisode: (e: XtreamEpisode) => void }) {
  const colors = useColors(); const [search, setSearch] = useState(""); const [cat, setCat] = useState("All"); const [limit, setLimit] = useState(60);
  const filtered = useMemo(() => { const q = search.trim().toLowerCase(); return items.filter((i) => (cat === "All" || String(i.category_id) === cat) && (!q || i.name.toLowerCase().includes(q))); }, [items, search, cat]);
  if (selected) {
    const groups = Object.entries(info?.episodes || {});
    return <View><FocusButton label="Back" icon="arrow-left" variant="ghost" onPress={onBack} /><Text style={[s.title, { color: colors.foreground, marginTop: 14 }]}>{selected.name}</Text>{!info ? <Loading text="Loading episodes…" /> : groups.length ? groups.map(([season, eps]) => <View key={season} style={{ marginTop: 18 }}><Text style={[s.section, { color: colors.foreground }]}>Season {season}</Text><View style={s.list}>{eps.map((ep) => <Pressable key={String(ep.id)} onPress={() => onEpisode(ep)} style={[s.episode, { borderColor: colors.border, backgroundColor: colors.card }]}><Text style={{ color: colors.foreground, flex: 1 }}>{ep.title || `Episode ${ep.episode_num ?? ""}`}</Text><Feather name="play-circle" size={24} color={colors.primary} /></Pressable>)}</View></View>) : <Text style={{ color: colors.mutedForeground }}>No episodes returned.</Text>}</View>;
  }
  if (!loaded && loading) return <Loading text="Loading Series…" />;
  return <Catalog title="Series" detail={loaded ? `${items.length.toLocaleString()} series` : "Not loaded"} search={search} onSearch={(v) => { setSearch(v); setLimit(60); }} loading={loading} onRefresh={onRefresh}><Rail items={[{ id: "All", name: "All" }, ...cats.map((c) => ({ id: String(c.category_id), name: c.category_name }))]} selected={cat} onSelect={(v) => { setCat(v); setLimit(60); }} /><Grid items={filtered.slice(0, limit)} keyOf={(i) => String(i.series_id)} titleOf={(i) => i.name} imageOf={(i) => i.cover} onOpen={onOpen} />{limit < filtered.length ? <View style={s.more}><FocusButton label="Load more" onPress={() => setLimit((n) => n + 60)} /></View> : null}</Catalog>;
}

function Catalog({ title, detail, search, onSearch, loading, onRefresh, children }: { title: string; detail: string; search: string; onSearch: (v: string) => void; loading: boolean; onRefresh: () => void; children: React.ReactNode }) {
  const colors = useColors(); return <View><View style={s.catalogHead}><View><Text style={[s.title, { color: colors.foreground }]}>{title}</Text><Text style={{ color: colors.mutedForeground }}>{detail}</Text></View><FocusButton label={loading ? "Loading…" : "Refresh"} icon="refresh-cw" variant="ghost" onPress={onRefresh} disabled={loading} /></View><View style={[s.search, { borderColor: colors.border, backgroundColor: colors.card }]}><Feather name="search" size={18} color={colors.mutedForeground} /><TextInput value={search} onChangeText={onSearch} placeholder={`Search ${title.toLowerCase()}`} placeholderTextColor={colors.mutedForeground} style={{ flex: 1, color: colors.foreground, minHeight: 44 }} /></View>{children}</View>;
}
function Rail({ items, selected, onSelect }: { items: Array<{ id: string; name: string }>; selected: string; onSelect: (id: string) => void }) { return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>{items.map((i) => <FocusButton key={i.id} label={i.name || "Other"} variant={selected === i.id ? "secondary" : "ghost"} onPress={() => onSelect(i.id)} />)}</ScrollView>; }
function Grid<T>({ items, keyOf, titleOf, imageOf, onOpen }: { items: T[]; keyOf: (i: T) => string; titleOf: (i: T) => string; imageOf: (i: T) => string | undefined; onOpen: (i: T) => void }) { const colors = useColors(); const { width } = useWindowDimensions(); const cols = width >= 900 ? 5 : width >= 650 ? 4 : width >= 420 ? 3 : 2; return <View style={s.grid}>{items.map((i) => <Pressable key={keyOf(i)} onPress={() => onOpen(i)} style={[s.card, { width: `${100 / cols}%` }]}><View style={[s.media, { borderColor: colors.border, backgroundColor: colors.card }]}>{imageOf(i) ? <Image source={{ uri: imageOf(i) }} style={s.posterBig} /> : <View style={[s.posterBig, { alignItems: "center", justifyContent: "center" }]}><Feather name="film" size={30} color={colors.primary} /></View>}<Text numberOfLines={2} style={{ color: colors.foreground, fontWeight: "700", padding: 9 }}>{titleOf(i)}</Text></View></Pressable>)}</View>; }
function Library({ channels, favorites, history, onOpen }: { channels: Channel[]; favorites: string[]; history: string[]; onOpen: (c: Channel) => void }) { const colors = useColors(); const ids = [...favorites, ...history].filter((id, n, a) => a.indexOf(id) === n); const rows = ids.map((id) => channels.find((c) => c.id === id)).filter((x): x is Channel => Boolean(x)); return <View><Text style={[s.title, { color: colors.foreground }]}>Library</Text>{rows.length ? rows.map((c) => <Pressable key={c.id} onPress={() => onOpen(c)} style={[s.episode, { borderColor: colors.border }]}><Text style={{ color: colors.foreground, flex: 1 }}>{c.name}</Text><Feather name="play" size={20} color={colors.primary} /></Pressable>) : <Text style={{ color: colors.mutedForeground }}>Nothing here yet.</Text>}</View>; }
function Settings({ provider, providers, onEdit, onSwitch, onRemove }: { provider: ProviderConfig; providers: ProviderConfig[]; onEdit: () => void; onSwitch: (id: string) => void; onRemove: () => void }) { const colors = useColors(); return <View><Text style={[s.title, { color: colors.foreground }]}>Settings</Text><View style={[s.settings, { borderColor: colors.border, backgroundColor: colors.card }]}><Text style={{ color: colors.foreground, fontWeight: "800" }}>{provider.name}</Text><Text style={{ color: colors.mutedForeground }}>{provider.type.toUpperCase()} · {provider.channelCount ?? 0} live channels</Text><View style={s.row}><FocusButton label="Edit source" icon="edit-2" onPress={onEdit} /><FocusButton label="Remove" icon="trash-2" variant="ghost" onPress={onRemove} /></View></View>{providers.length > 1 ? <Rail items={providers.map((p) => ({ id: p.id, name: p.name }))} selected={provider.id} onSelect={onSwitch} /> : null}</View>; }
function Player({ playable, onBack }: { playable: Playable | null; onBack: () => void }) { const colors = useColors(); const { width } = useWindowDimensions(); return <View><FocusButton label="Back" icon="arrow-left" variant="ghost" onPress={onBack} /><View style={[s.player, { height: Math.max(240, width * 9 / 16), borderColor: colors.border }]}>{playable ? <NativeVideoPlayer source={playable.url} title={playable.title} /> : null}</View>{playable ? <><Text style={[s.title, { color: colors.foreground, marginTop: 14 }]}>{playable.title}</Text><Text style={{ color: colors.mutedForeground }}>{playable.subtitle}</Text></> : null}</View>; }
function Stat({ label, value, onPress }: { label: string; value: string; onPress: () => void }) { const colors = useColors(); return <Pressable onPress={onPress} style={[s.stat, { borderColor: colors.border, backgroundColor: colors.card }]}><Text style={[s.statValue, { color: colors.foreground }]}>{value}</Text><Text style={{ color: colors.mutedForeground }}>{label}</Text></Pressable>; }
function Loading({ text }: { text: string }) { const colors = useColors(); return <View style={{ paddingVertical: 40 }}><Text style={{ color: colors.mutedForeground, textAlign: "center" }}>{text}</Text></View>; }
function Poster({ uri, title }: { uri?: string; title: string }) { const colors = useColors(); return uri ? <Image source={{ uri }} style={s.logo} /> : <View style={[s.logo, { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }]}><Text style={{ color: colors.primary, fontWeight: "800" }}>{title.slice(0, 2).toUpperCase()}</Text></View>; }
function Input({ label, ...props }: { label: string; value: string; onChangeText: (v: string) => void; autoCapitalize?: "none" | "sentences"; secureTextEntry?: boolean }) { const colors = useColors(); return <View style={{ gap: 6 }}><Text style={{ color: colors.mutedForeground, fontWeight: "700" }}>{label}</Text><TextInput {...props} style={[s.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]} placeholderTextColor={colors.mutedForeground} /></View>; }

const s = StyleSheet.create({
  screen: { flex: 1 }, centered: { flex: 1, alignItems: "center", justifyContent: "center" }, content: { padding: 18, paddingBottom: 40, maxWidth: 1500, width: "100%", alignSelf: "center" },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingBottom: 8 }, headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 }, nav: { gap: 6, paddingVertical: 4 },
  brand: { fontSize: 18, fontWeight: "900", letterSpacing: 1 }, brandLarge: { fontSize: 28, fontWeight: "900", letterSpacing: 1 }, chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, flexDirection: "row", gap: 7, alignItems: "center", maxWidth: 210 }, dot: { width: 7, height: 7, borderRadius: 9 },
  error: { margin: 12, borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: "row", gap: 8, alignItems: "center" }, setup: { width: "100%", maxWidth: 720, alignSelf: "center", paddingHorizontal: 20, gap: 14 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }, input: { borderWidth: 1, borderRadius: 12, minHeight: 50, paddingHorizontal: 14 },
  title: { fontSize: 28, fontWeight: "800", marginBottom: 6 }, kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 1.1, marginBottom: 8 }, hero: { fontSize: 38, lineHeight: 43, fontWeight: "900" }, section: { fontSize: 20, fontWeight: "800" },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginVertical: 24 }, stat: { flexGrow: 1, minWidth: 160, borderWidth: 1, borderRadius: 16, padding: 18, gap: 8 }, statValue: { fontSize: 28, fontWeight: "900" },
  catalogHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12 }, search: { borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 }, rail: { gap: 6, paddingVertical: 14 },
  list: { gap: 8 }, liveRow: { borderWidth: 1, borderRadius: 14, padding: 8, flexDirection: "row", alignItems: "center", gap: 8 }, liveMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }, logo: { width: 50, height: 50, borderRadius: 10 }, icon: { padding: 10 },
  more: { alignItems: "center", paddingVertical: 18 }, grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -6 }, card: { padding: 6 }, media: { borderWidth: 1, borderRadius: 14, overflow: "hidden" }, posterBig: { width: "100%", aspectRatio: 2 / 3 },
  episode: { borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }, settings: { borderWidth: 1, borderRadius: 16, padding: 18, gap: 8 }, player: { marginTop: 12, width: "100%", borderWidth: 1, borderRadius: 14, overflow: "hidden", backgroundColor: "#05070d" },
});