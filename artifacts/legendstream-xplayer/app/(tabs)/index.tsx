import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
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
import {
  Channel,
  ProviderConfig,
  ProviderType,
  usePlayer,
} from "@/context/PlayerContext";
import { useColors } from "@/hooks/useColors";
import {
  buildEpisodeStreamUrl,
  buildVodStreamUrl,
  getSeries,
  getSeriesCategories,
  getSeriesInfo,
  getVodCategories,
  getVodInfo,
  getVodStreams,
  XtreamCategory,
  XtreamEpisode,
  XtreamSeriesInfo,
  XtreamSeriesItem,
  XtreamVodInfo,
  XtreamVodItem,
} from "@/lib/xtreamCatalog";

type ViewName = "home" | "live" | "movies" | "series" | "library" | "settings" | "player";

type PlayableItem = {
  title: string;
  url: string;
  subtitle?: string;
  image?: string;
  kind: "live" | "movie" | "episode";
};

type XtreamCredentials = {
  baseUrl: string;
  username: string;
  password: string;
};

const navItems: Array<{
  key: Exclude<ViewName, "player">;
  label: string;
  icon: keyof typeof Feather.glyphMap;
}> = [
  { key: "home", label: "Home", icon: "home" },
  { key: "live", label: "Live TV", icon: "radio" },
  { key: "movies", label: "Movies", icon: "film" },
  { key: "series", label: "Series", icon: "tv" },
  { key: "library", label: "Library", icon: "bookmark" },
  { key: "settings", label: "Settings", icon: "settings" },
];

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const {
    provider,
    providers,
    channels,
    favorites,
    history,
    isHydrating,
    isLoading,
    error,
    refreshProvider,
    toggleFavorite,
    recordWatched,
    setActiveProvider,
    removeProvider,
    clearError,
    connectProvider,
  } = usePlayer();

  const [view, setView] = useState<ViewName>("home");
  const [editingProvider, setEditingProvider] = useState(false);
  const [playable, setPlayable] = useState<PlayableItem | null>(null);
  const [vodCategories, setVodCategories] = useState<XtreamCategory[]>([]);
  const [vod, setVod] = useState<XtreamVodItem[]>([]);
  const [seriesCategories, setSeriesCategories] = useState<XtreamCategory[]>([]);
  const [series, setSeries] = useState<XtreamSeriesItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<XtreamVodItem | null>(null);
  const [selectedMovieInfo, setSelectedMovieInfo] = useState<XtreamVodInfo | null>(null);
  const [movieInfoLoading, setMovieInfoLoading] = useState(false);
  const [selectedSeries, setSelectedSeries] = useState<XtreamSeriesItem | null>(null);
  const [selectedSeriesInfo, setSelectedSeriesInfo] = useState<XtreamSeriesInfo | null>(null);

  const credentials = useMemo<XtreamCredentials | null>(() => {
    if (!provider || provider.type !== "xtream" || !provider.username || !provider.password) return null;
    return {
      baseUrl: provider.url || provider.playlistUrl,
      username: provider.username,
      password: provider.password,
    };
  }, [provider]);

  const loadCatalogs = async () => {
    if (!credentials) {
      setVod([]);
      setSeries([]);
      setVodCategories([]);
      setSeriesCategories([]);
      return;
    }
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const [vodCats, vodItems, seriesCats, seriesItems] = await Promise.all([
        getVodCategories(credentials),
        getVodStreams(credentials),
        getSeriesCategories(credentials),
        getSeries(credentials),
      ]);
      setVodCategories(vodCats);
      setVod(vodItems);
      setSeriesCategories(seriesCats);
      setSeries(seriesItems);
    } catch (caught) {
      setCatalogError(caught instanceof Error ? caught.message : "Xtream catalog could not be loaded.");
    } finally {
      setCatalogLoading(false);
    }
  };

  useEffect(() => {
    void loadCatalogs();
  }, [credentials?.baseUrl, credentials?.username, credentials?.password]);

  if (isHydrating) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>LegendStream XPlayer</Text>
        <Text style={[styles.muted, { color: colors.mutedForeground }]}>Preparing player…</Text>
      </View>
    );
  }

  if (!provider || editingProvider) {
    return (
      <ProviderSetup
        existingProvider={editingProvider ? provider : null}
        busy={isLoading}
        error={error}
        onCancel={provider ? () => setEditingProvider(false) : undefined}
        onSubmit={async (config) => {
          clearError();
          const saved = await connectProvider(config);
          if (saved) {
            setEditingProvider(false);
            setView("home");
          }
        }}
      />
    );
  }

  const providerChannels = channels.filter((item) => item.providerId === provider.id);
  const historyChannels = history
    .map((id) => channels.find((channel) => channel.id === id))
    .filter((channel): channel is Channel => Boolean(channel));
  const topInset = Math.max(insets.top, Platform.OS === "web" ? 20 : 0);
  const bottomInset = Math.max(insets.bottom, 12);

  const openLive = (channel: Channel) => {
    setPlayable({
      title: channel.name,
      subtitle: channel.category,
      image: channel.logoUrl,
      kind: "live",
      url: channel.streamUrl,
    });
    void recordWatched(channel.id);
    setView("player");
  };

  const openMovieDetails = async (item: XtreamVodItem) => {
    if (!credentials) return;
    setSelectedMovie(item);
    setSelectedMovieInfo(null);
    setMovieInfoLoading(true);
    setCatalogError(null);
    try {
      setSelectedMovieInfo(await getVodInfo(credentials, item.stream_id));
    } catch (caught) {
      setCatalogError(caught instanceof Error ? caught.message : "Movie details could not be loaded.");
    } finally {
      setMovieInfoLoading(false);
    }
  };

  const playMovie = (item: XtreamVodItem) => {
    if (!credentials) return;
    const info = selectedMovieInfo?.info;
    setPlayable({
      title: info?.name || item.name,
      subtitle: info?.genre || item.genre || "Movie",
      image: info?.movie_image || item.stream_icon,
      kind: "movie",
      url: buildVodStreamUrl(credentials, {
        ...item,
        container_extension: selectedMovieInfo?.movie_data?.container_extension || item.container_extension,
      }),
    });
    setView("player");
  };

  const openSeries = async (item: XtreamSeriesItem) => {
    if (!credentials) return;
    setSelectedSeries(item);
    setSelectedSeriesInfo(null);
    setCatalogError(null);
    try {
      setSelectedSeriesInfo(await getSeriesInfo(credentials, item.series_id));
    } catch (caught) {
      setCatalogError(caught instanceof Error ? caught.message : "Series details could not be loaded.");
    }
  };

  const openEpisode = (episode: XtreamEpisode, seriesName: string) => {
    if (!credentials) return;
    setPlayable({
      title: episode.title || `${seriesName} · Episode ${episode.episode_num ?? ""}`,
      subtitle: seriesName,
      image: episode.info?.movie_image,
      kind: "episode",
      url: buildEpisodeStreamUrl(credentials, episode),
    });
    setView("player");
  };

  const navigate = (target: Exclude<ViewName, "player">) => {
    setView(target);
    if (target !== "movies") {
      setSelectedMovie(null);
      setSelectedMovieInfo(null);
    }
    if (target !== "series") {
      setSelectedSeries(null);
      setSelectedSeriesInfo(null);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topInset, paddingBottom: bottomInset }]}>
      <Header
        activeView={view}
        provider={provider}
        providers={providers}
        compact={width < 900}
        onNavigate={navigate}
        onProviderChange={(id) => void setActiveProvider(id)}
      />

      {error || catalogError ? (
        <View style={[styles.errorBanner, { borderColor: colors.destructive, backgroundColor: colors.card }]}>
          <Feather name="alert-circle" size={18} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.foreground }]}>{error || catalogError}</Text>
          <Pressable onPress={() => { clearError(); setCatalogError(null); }}>
            <Feather name="x" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
      ) : null}

      <ScrollView style={styles.flex} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {view === "home" ? (
          <HomeView
            provider={provider}
            liveCount={providerChannels.length}
            movieCount={vod.length}
            seriesCount={series.length}
            loading={isLoading || catalogLoading}
            onRefresh={() => {
              void refreshProvider();
              void loadCatalogs();
            }}
            onNavigate={navigate}
          />
        ) : null}

        {view === "live" ? (
          <LiveView
            channels={providerChannels}
            favorites={favorites}
            loading={isLoading}
            onRefresh={() => void refreshProvider()}
            onOpen={openLive}
            onFavorite={(id) => void toggleFavorite(id)}
          />
        ) : null}

        {view === "movies" ? (
          <MoviesView
            items={vod}
            categories={vodCategories}
            loading={catalogLoading}
            detailLoading={movieInfoLoading}
            enabled={provider.type === "xtream"}
            selected={selectedMovie}
            info={selectedMovieInfo}
            onRefresh={() => void loadCatalogs()}
            onOpen={openMovieDetails}
            onBackDetails={() => { setSelectedMovie(null); setSelectedMovieInfo(null); }}
            onPlay={playMovie}
          />
        ) : null}

        {view === "series" ? (
          <SeriesView
            items={series}
            categories={seriesCategories}
            loading={catalogLoading}
            enabled={provider.type === "xtream"}
            selected={selectedSeries}
            info={selectedSeriesInfo}
            onRefresh={() => void loadCatalogs()}
            onOpenSeries={(item) => void openSeries(item)}
            onBackDetails={() => { setSelectedSeries(null); setSelectedSeriesInfo(null); }}
            onOpenEpisode={openEpisode}
          />
        ) : null}

        {view === "library" ? (
          <LibraryView
            favorites={favorites.map((id) => channels.find((channel) => channel.id === id)).filter((channel): channel is Channel => Boolean(channel))}
            recent={historyChannels}
            onOpen={openLive}
          />
        ) : null}

        {view === "settings" ? (
          <SettingsView
            provider={provider}
            providers={providers}
            onEdit={() => setEditingProvider(true)}
            onSwitch={(id) => void setActiveProvider(id)}
            onRemove={() => void removeProvider()}
          />
        ) : null}

        {view === "player" ? (
          <PlayerView
            playable={playable}
            onBack={() => setView(playable?.kind === "movie" ? "movies" : playable?.kind === "episode" ? "series" : "live")}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function ProviderSetup({ existingProvider, busy, error, onCancel, onSubmit }: {
  existingProvider: ProviderConfig | null;
  busy: boolean;
  error: string | null;
  onCancel?: () => void;
  onSubmit: (config: Omit<ProviderConfig, "id" | "connectedAt" | "createdAt" | "url" | "channelCount"> & { url?: string; epgUrl?: string; mac?: string }) => Promise<void>;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(existingProvider?.name ?? "My provider");
  const [type, setType] = useState<ProviderType>(existingProvider?.type ?? "xtream");
  const [url, setUrl] = useState(existingProvider?.playlistUrl ?? "");
  const [username, setUsername] = useState(existingProvider?.username ?? "");
  const [password, setPassword] = useState(existingProvider?.password ?? "");
  const [mac, setMac] = useState(existingProvider?.mac ?? "");
  const [epgUrl, setEpgUrl] = useState(existingProvider?.epgUrl ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async () => {
    const cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) {
      setLocalError("Enter a full server URL beginning with http:// or https://");
      return;
    }
    if (type === "xtream" && (!username.trim() || !password)) {
      setLocalError("Xtream requires username and password.");
      return;
    }
    if (type === "stalker" && !mac.trim()) {
      setLocalError("Stalker Portal requires a MAC address.");
      return;
    }
    setLocalError(null);
    await onSubmit({
      name: name.trim() || "My provider",
      type,
      playlistUrl: cleanUrl,
      username: type === "xtream" ? username.trim() : undefined,
      password: type === "xtream" ? password : undefined,
      mac: type === "stalker" ? mac.trim() : undefined,
      epgUrl: epgUrl.trim() || undefined,
    });
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.setup, { paddingTop: insets.top + 30, paddingBottom: insets.bottom + 30 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.brand, { color: colors.foreground }]}>LEGEND<Text style={{ color: colors.primary }}>STREAM</Text></Text>
      <Text style={[styles.title, { color: colors.foreground }]}>Connect your IPTV source</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>Use only services and streams you are authorized to access.</Text>
      <View style={styles.typeRow}>
        {(["xtream", "m3u", "stalker"] as ProviderType[]).map((item) => (
          <FocusButton key={item} label={item === "xtream" ? "Xtream" : item === "m3u" ? "M3U" : "Stalker"} variant={type === item ? "secondary" : "ghost"} onPress={() => setType(item)} />
        ))}
      </View>
      <Input label="Source name" value={name} onChangeText={setName} />
      <Input label="Server / playlist URL" value={url} onChangeText={setUrl} autoCapitalize="none" />
      {type === "xtream" ? <><Input label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" /><Input label="Password" value={password} onChangeText={setPassword} secureTextEntry /></> : null}
      {type === "stalker" ? <Input label="MAC address" value={mac} onChangeText={setMac} autoCapitalize="none" /> : null}
      <Input label="EPG URL (optional)" value={epgUrl} onChangeText={setEpgUrl} autoCapitalize="none" />
      {localError || error ? <Text style={{ color: colors.destructive }}>{localError || error}</Text> : null}
      <View style={styles.actions}>
        <FocusButton label={busy ? "Connecting…" : "Connect"} icon="log-in" variant="primary" onPress={() => void submit()} disabled={busy} />
        {onCancel ? <FocusButton label="Cancel" variant="ghost" onPress={onCancel} /> : null}
      </View>
    </ScrollView>
  );
}

function Header({ activeView, provider, providers, compact, onNavigate, onProviderChange }: {
  activeView: ViewName;
  provider: ProviderConfig;
  providers: ProviderConfig[];
  compact: boolean;
  onNavigate: (view: Exclude<ViewName, "player">) => void;
  onProviderChange: (id: string) => void;
}) {
  const colors = useColors();
  return (
    <View style={[styles.header, { borderColor: colors.border }]}>
      <View style={styles.headerTop}>
        <Text style={[styles.brandSmall, { color: colors.foreground }]}>LEGEND<Text style={{ color: colors.primary }}>STREAM</Text></Text>
        <Pressable
          onPress={() => {
            if (providers.length < 2) return;
            const index = providers.findIndex((item) => item.id === provider.id);
            onProviderChange(providers[(index + 1) % providers.length].id);
          }}
          style={[styles.providerChip, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={[styles.dot, { backgroundColor: colors.primary }]} />
          <Text numberOfLines={1} style={{ color: colors.mutedForeground }}>{provider.name}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.nav}>
        {navItems.map((item) => (
          <FocusButton key={item.key} label={compact ? item.label : item.label} icon={item.icon} variant={activeView === item.key ? "secondary" : "ghost"} onPress={() => onNavigate(item.key)} />
        ))}
      </ScrollView>
    </View>
  );
}

function HomeView({ provider, liveCount, movieCount, seriesCount, loading, onRefresh, onNavigate }: {
  provider: ProviderConfig;
  liveCount: number;
  movieCount: number;
  seriesCount: number;
  loading: boolean;
  onRefresh: () => void;
  onNavigate: (view: Exclude<ViewName, "player">) => void;
}) {
  const colors = useColors();
  return (
    <View>
      <Text style={[styles.kicker, { color: colors.primary }]}>SOURCE CONNECTED / {provider.type.toUpperCase()}</Text>
      <Text style={[styles.heroTitle, { color: colors.foreground }]}>Live, movies and series. One player.</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>LegendStream reads the full Xtream catalog when the provider supports it.</Text>
      <View style={styles.statGrid}>
        <Stat label="Live TV" value={liveCount} icon="radio" onPress={() => onNavigate("live")} />
        <Stat label="Movies" value={movieCount} icon="film" onPress={() => onNavigate("movies")} />
        <Stat label="Series" value={seriesCount} icon="tv" onPress={() => onNavigate("series")} />
      </View>
      <FocusButton label={loading ? "Refreshing…" : "Refresh all"} icon="refresh-cw" variant="primary" onPress={onRefresh} disabled={loading} />
    </View>
  );
}

function LiveView({ channels, favorites, loading, onRefresh, onOpen, onFavorite }: {
  channels: Channel[];
  favorites: string[];
  loading: boolean;
  onRefresh: () => void;
  onOpen: (channel: Channel) => void;
  onFavorite: (id: string) => void;
}) {
  const colors = useColors();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const categories = useMemo(() => ["All", ...Array.from(new Set(channels.map((item) => item.category))).sort()], [channels]);
  const filtered = useMemo(() => channels.filter((item) => {
    const query = search.trim().toLowerCase();
    return (category === "All" || item.category === category) && (!query || item.name.toLowerCase().includes(query));
  }), [channels, search, category]);

  return (
    <CatalogShell title="Live TV" detail={`${channels.length.toLocaleString()} channels`} search={search} onSearch={setSearch} loading={loading} onRefresh={onRefresh}>
      <CategoryRail items={categories.map((name) => ({ id: name, name }))} selected={category} onSelect={setCategory} />
      <View style={styles.list}>
        {filtered.map((channel) => (
          <View key={channel.id} style={[styles.liveRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Pressable style={styles.liveMain} onPress={() => onOpen(channel)}>
              <Poster uri={channel.logoUrl} fallback={channel.name} small />
              <View style={styles.flex}>
                <Text numberOfLines={1} style={[styles.itemTitle, { color: colors.foreground }]}>{channel.name}</Text>
                <Text numberOfLines={1} style={[styles.muted, { color: colors.mutedForeground }]}>{channel.category}</Text>
              </View>
            </Pressable>
            <Pressable onPress={() => onFavorite(channel.id)} style={styles.iconButton}>
              <Feather name="star" size={20} color={favorites.includes(channel.id) ? colors.primary : colors.mutedForeground} />
            </Pressable>
            <Pressable onPress={() => onOpen(channel)} style={[styles.playButton, { backgroundColor: colors.primary }]}>
              <Feather name="play" size={18} color={colors.primaryForeground} />
            </Pressable>
          </View>
        ))}
      </View>
    </CatalogShell>
  );
}

function MoviesView({ items, categories, loading, detailLoading, enabled, selected, info, onRefresh, onOpen, onBackDetails, onPlay }: {
  items: XtreamVodItem[];
  categories: XtreamCategory[];
  loading: boolean;
  detailLoading: boolean;
  enabled: boolean;
  selected: XtreamVodItem | null;
  info: XtreamVodInfo | null;
  onRefresh: () => void;
  onOpen: (item: XtreamVodItem) => void;
  onBackDetails: () => void;
  onPlay: (item: XtreamVodItem) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");

  if (!enabled) return <UnsupportedCatalog name="Movies" />;
  if (selected) {
    const details = info?.info;
    return (
      <MediaDetail
        typeLabel="MOVIE"
        title={details?.name || selected.name}
        image={details?.movie_image || selected.stream_icon}
        backdrop={details?.backdrop_path?.[0]}
        plot={details?.plot || details?.description || selected.plot}
        genre={details?.genre || selected.genre}
        rating={details?.rating || selected.rating}
        releaseDate={details?.releaseDate || details?.release_date || selected.releaseDate || selected.release_date}
        duration={details?.duration}
        cast={details?.cast || selected.cast}
        director={details?.director || selected.director}
        country={details?.country}
        trailer={details?.youtube_trailer || selected.youtube_trailer}
        loading={detailLoading}
        onBack={onBackDetails}
        primaryLabel="Play movie"
        onPrimary={() => onPlay(selected)}
      />
    );
  }

  const filtered = useMemo(() => items.filter((item) => {
    const query = search.trim().toLowerCase();
    return (category === "All" || String(item.category_id) === category) && (!query || item.name.toLowerCase().includes(query));
  }), [items, search, category]);

  return (
    <CatalogShell title="Movies" detail={`${items.length.toLocaleString()} VOD titles`} search={search} onSearch={setSearch} loading={loading} onRefresh={onRefresh}>
      <CategoryRail items={[{ id: "All", name: "All" }, ...categories.map((item) => ({ id: String(item.category_id), name: item.category_name }))]} selected={category} onSelect={setCategory} />
      <MediaGrid items={filtered} getKey={(item) => String(item.stream_id)} render={(item) => (
        <MediaCard title={item.name} image={item.stream_icon} meta={item.genre || String(item.rating || "Movie")} onPress={() => onOpen(item)} />
      )} />
    </CatalogShell>
  );
}

function SeriesView({ items, categories, loading, enabled, selected, info, onRefresh, onOpenSeries, onBackDetails, onOpenEpisode }: {
  items: XtreamSeriesItem[];
  categories: XtreamCategory[];
  loading: boolean;
  enabled: boolean;
  selected: XtreamSeriesItem | null;
  info: XtreamSeriesInfo | null;
  onRefresh: () => void;
  onOpenSeries: (item: XtreamSeriesItem) => void;
  onBackDetails: () => void;
  onOpenEpisode: (episode: XtreamEpisode, seriesName: string) => void;
}) {
  const colors = useColors();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [season, setSeason] = useState<string | null>(null);

  useEffect(() => {
    const keys = Object.keys(info?.episodes || {}).sort((a, b) => Number(a) - Number(b));
    if (keys.length) setSeason(keys[0]);
  }, [info]);

  if (!enabled) return <UnsupportedCatalog name="Series" />;
  if (selected) {
    const details = info?.info;
    const seasonKeys = Object.keys(info?.episodes || {}).sort((a, b) => Number(a) - Number(b));
    const episodes = season ? info?.episodes?.[season] || [] : [];
    const totalEpisodes = Object.values(info?.episodes || {}).reduce((sum, group) => sum + group.length, 0);
    const seasonMeta = info?.seasons?.find((item) => String(item.season_number) === season);

    return (
      <View>
        <MediaDetail
          typeLabel="SERIES"
          title={details?.name || selected.name}
          image={details?.cover || selected.cover}
          backdrop={details?.backdrop_path?.[0] || selected.backdrop_path?.[0]}
          plot={details?.plot || selected.plot}
          genre={details?.genre || selected.genre}
          rating={details?.rating || selected.rating}
          releaseDate={details?.releaseDate || details?.release_date || selected.releaseDate || selected.release_date}
          cast={details?.cast || selected.cast}
          director={details?.director || selected.director}
          loading={!info}
          onBack={onBackDetails}
          extra={`${seasonKeys.length} seasons · ${totalEpisodes} episodes`}
        />
        {seasonKeys.length ? (
          <>
            <View style={styles.sectionGap}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Seasons</Text>
              <CategoryRail items={seasonKeys.map((key) => ({ id: key, name: `Season ${key}` }))} selected={season || ""} onSelect={setSeason} />
            </View>
            {seasonMeta?.overview ? <Text style={[styles.body, { color: colors.mutedForeground, marginBottom: 12 }]}>{seasonMeta.overview}</Text> : null}
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{season ? `Season ${season}` : "Episodes"} · {episodes.length} episodes</Text>
            <View style={styles.list}>
              {episodes.map((episode) => (
                <Pressable key={String(episode.id)} onPress={() => onOpenEpisode(episode, selected.name)} style={[styles.episodeRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {episode.info?.movie_image ? <Image source={{ uri: episode.info.movie_image }} style={styles.episodeThumb} resizeMode="cover" /> : (
                    <View style={[styles.episodeNumber, { backgroundColor: colors.muted }]}><Text style={{ color: colors.primary }}>{episode.episode_num ?? "▶"}</Text></View>
                  )}
                  <View style={styles.flex}>
                    <Text style={[styles.itemTitle, { color: colors.foreground }]}>{episode.title || `Episode ${episode.episode_num ?? ""}`}</Text>
                    <Text style={[styles.episodeMeta, { color: colors.mutedForeground }]}>{[episode.info?.duration, episode.info?.rating ? `★ ${episode.info.rating}` : null, episode.info?.releaseDate].filter(Boolean).join(" · ")}</Text>
                    <Text numberOfLines={3} style={[styles.muted, { color: colors.mutedForeground }]}>{episode.info?.plot || "Tap to play this episode."}</Text>
                  </View>
                  <Feather name="play-circle" size={28} color={colors.primary} />
                </Pressable>
              ))}
            </View>
          </>
        ) : !info ? <Text style={[styles.muted, { color: colors.mutedForeground }]}>Loading seasons and episodes…</Text> : <Text style={[styles.muted, { color: colors.mutedForeground }]}>No episode list was returned by this provider.</Text>}
      </View>
    );
  }

  const filtered = useMemo(() => items.filter((item) => {
    const query = search.trim().toLowerCase();
    return (category === "All" || String(item.category_id) === category) && (!query || item.name.toLowerCase().includes(query));
  }), [items, search, category]);

  return (
    <CatalogShell title="Series" detail={`${items.length.toLocaleString()} series`} search={search} onSearch={setSearch} loading={loading} onRefresh={onRefresh}>
      <CategoryRail items={[{ id: "All", name: "All" }, ...categories.map((item) => ({ id: String(item.category_id), name: item.category_name }))]} selected={category} onSelect={setCategory} />
      <MediaGrid items={filtered} getKey={(item) => String(item.series_id)} render={(item) => (
        <MediaCard title={item.name} image={item.cover} meta={item.genre || String(item.rating || "Series")} onPress={() => onOpenSeries(item)} />
      )} />
    </CatalogShell>
  );
}

function MediaDetail({ typeLabel, title, image, backdrop, plot, genre, rating, releaseDate, duration, cast, director, country, trailer, extra, loading, onBack, primaryLabel, onPrimary }: {
  typeLabel: string;
  title: string;
  image?: string;
  backdrop?: string;
  plot?: string;
  genre?: string;
  rating?: string | number;
  releaseDate?: string;
  duration?: string;
  cast?: string;
  director?: string;
  country?: string;
  trailer?: string;
  extra?: string;
  loading: boolean;
  onBack: () => void;
  primaryLabel?: string;
  onPrimary?: () => void;
}) {
  const colors = useColors();
  return (
    <View>
      <FocusButton label="Back" icon="arrow-left" variant="ghost" onPress={onBack} />
      <View style={[styles.detailHero, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {backdrop ? <Image source={{ uri: backdrop }} style={styles.backdropImage} resizeMode="cover" /> : null}
        {backdrop ? <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, opacity: 0.66 }]} /> : null}
        <View style={styles.detailHeroInner}>
          <View style={styles.detailPoster}><Poster uri={image} fallback={title} /></View>
          <View style={styles.detailCopy}>
            <Text style={[styles.kicker, { color: colors.primary }]}>{typeLabel}</Text>
            <Text style={[styles.detailTitle, { color: colors.foreground }]}>{title}</Text>
            {loading ? <Text style={[styles.muted, { color: colors.mutedForeground }]}>Loading full metadata…</Text> : null}
            <View style={styles.metaPills}>
              {releaseDate ? <MetaPill text={releaseDate.slice(0, 10)} /> : null}
              {genre ? <MetaPill text={genre} /> : null}
              {duration ? <MetaPill text={duration} /> : null}
              {rating ? <MetaPill text={`★ ${rating}`} /> : null}
              {country ? <MetaPill text={country} /> : null}
              {extra ? <MetaPill text={extra} /> : null}
              {trailer ? <MetaPill text="Trailer available" /> : null}
            </View>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>{plot || "No description was returned by the provider."}</Text>
            {cast ? <InfoLine label="Cast" value={cast} /> : null}
            {director ? <InfoLine label="Director" value={director} /> : null}
            {primaryLabel && onPrimary ? <View style={styles.actions}><FocusButton label={primaryLabel} icon="play" variant="primary" onPress={onPrimary} /></View> : null}
          </View>
        </View>
      </View>
    </View>
  );
}

function MetaPill({ text }: { text: string }) {
  const colors = useColors();
  return <View style={[styles.metaPill, { backgroundColor: colors.muted, borderColor: colors.border }]}><Text style={[styles.metaPillText, { color: colors.foreground }]}>{text}</Text></View>;
}

function InfoLine({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return <Text style={[styles.infoLine, { color: colors.mutedForeground }]}><Text style={{ color: colors.foreground, fontWeight: "800" }}>{label}: </Text>{value}</Text>;
}

function PlayerView({ playable, onBack }: { playable: PlayableItem | null; onBack: () => void }) {
  const colors = useColors();
  const { width, height } = useWindowDimensions();
  const playerHeight = Math.min(Math.max(260, width * 9 / 16), Math.max(320, height - 160));
  return (
    <View>
      <View style={styles.playerTop}>
        <FocusButton label="Back" icon="arrow-left" variant="ghost" onPress={onBack} />
        <Text style={[styles.kicker, { color: colors.primary }]}>{playable?.kind.toUpperCase() || "PLAYER"}</Text>
      </View>
      <View style={[styles.player, { height: playerHeight, borderColor: colors.border }]}>{playable ? <NativeVideoPlayer source={playable.url} title={playable.title} /> : null}</View>
      {playable ? <View style={styles.playerMeta}><Text style={[styles.title, { color: colors.foreground }]}>{playable.title}</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>{playable.subtitle || "LegendStream XPlayer"}</Text><Text numberOfLines={1} style={[styles.url, { color: colors.mutedForeground }]}>{playable.url}</Text></View> : null}
    </View>
  );
}

function LibraryView({ favorites, recent, onOpen }: { favorites: Channel[]; recent: Channel[]; onOpen: (channel: Channel) => void }) {
  const colors = useColors();
  const rows = [{ title: "Favorites", items: favorites }, { title: "Recently watched", items: recent }];
  return (
    <View>
      <Text style={[styles.title, { color: colors.foreground }]}>Library</Text>
      {rows.map((row) => <View key={row.title} style={styles.librarySection}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>{row.title}</Text>{row.items.length ? row.items.map((item) => <Pressable key={item.id} onPress={() => onOpen(item)} style={[styles.libraryRow, { borderColor: colors.border }]}><Poster uri={item.logoUrl} fallback={item.name} small /><View style={styles.flex}><Text style={[styles.itemTitle, { color: colors.foreground }]}>{item.name}</Text><Text style={[styles.muted, { color: colors.mutedForeground }]}>{item.category}</Text></View><Feather name="play" size={20} color={colors.primary} /></Pressable>) : <Text style={[styles.muted, { color: colors.mutedForeground }]}>Nothing here yet.</Text>}</View>)}
    </View>
  );
}

function SettingsView({ provider, providers, onEdit, onSwitch, onRemove }: {
  provider: ProviderConfig;
  providers: ProviderConfig[];
  onEdit: () => void;
  onSwitch: (id: string) => void;
  onRemove: () => void;
}) {
  const colors = useColors();
  return (
    <View>
      <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>
      <View style={[styles.settingsCard, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.itemTitle, { color: colors.foreground }]}>{provider.name}</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>{provider.type.toUpperCase()} · {provider.channelCount ?? 0} live channels</Text><Text numberOfLines={1} style={[styles.url, { color: colors.mutedForeground }]}>{provider.url || provider.playlistUrl}</Text><View style={styles.actions}><FocusButton label="Edit source" icon="edit-2" variant="secondary" onPress={onEdit} /><FocusButton label="Remove" icon="trash-2" variant="ghost" onPress={onRemove} /></View></View>
      {providers.length > 1 ? <View style={styles.librarySection}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Sources</Text><CategoryRail items={providers.map((item) => ({ id: item.id, name: item.name }))} selected={provider.id} onSelect={onSwitch} /></View> : null}
    </View>
  );
}

function CatalogShell({ title, detail, search, onSearch, loading, onRefresh, children }: {
  title: string;
  detail: string;
  search: string;
  onSearch: (value: string) => void;
  loading: boolean;
  onRefresh: () => void;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View>
      <View style={styles.catalogTitleRow}><View><Text style={[styles.title, { color: colors.foreground }]}>{title}</Text><Text style={[styles.muted, { color: colors.mutedForeground }]}>{detail}</Text></View><FocusButton label={loading ? "Loading…" : "Refresh"} icon="refresh-cw" variant="ghost" onPress={onRefresh} disabled={loading} /></View>
      <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}><Feather name="search" size={18} color={colors.mutedForeground} /><TextInput value={search} onChangeText={onSearch} placeholder={`Search ${title.toLowerCase()}`} placeholderTextColor={colors.mutedForeground} style={[styles.searchInput, { color: colors.foreground }]} /></View>
      {children}
    </View>
  );
}

function CategoryRail({ items, selected, onSelect }: { items: Array<{ id: string; name: string }>; selected: string; onSelect: (id: string) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRail}>{items.map((item) => <FocusButton key={item.id} label={item.name || "Other"} variant={selected === item.id ? "secondary" : "ghost"} onPress={() => onSelect(item.id)} />)}</ScrollView>;
}

function MediaGrid<T>({ items, getKey, render }: { items: T[]; getKey: (item: T) => string; render: (item: T) => React.ReactNode }) {
  const { width } = useWindowDimensions();
  const columns = width >= 1200 ? 6 : width >= 900 ? 5 : width >= 650 ? 4 : width >= 420 ? 3 : 2;
  return <View style={styles.mediaGrid}>{items.map((item) => <View key={getKey(item)} style={{ width: `${100 / columns}%`, padding: 6 }}>{render(item)}</View>)}</View>;
}

function MediaCard({ title, image, meta, onPress }: { title: string; image?: string; meta?: string; onPress: () => void }) {
  const colors = useColors();
  return <Pressable onPress={onPress} style={[styles.mediaCard, { backgroundColor: colors.card, borderColor: colors.border }]}><Poster uri={image} fallback={title} /><View style={styles.mediaCopy}><Text numberOfLines={2} style={[styles.mediaTitle, { color: colors.foreground }]}>{title}</Text><Text numberOfLines={1} style={[styles.muted, { color: colors.mutedForeground }]}>{meta || ""}</Text></View></Pressable>;
}

function Poster({ uri, fallback, small = false }: { uri?: string; fallback: string; small?: boolean }) {
  const colors = useColors();
  if (uri) return <Image source={{ uri }} style={small ? styles.logo : styles.poster} resizeMode="cover" />;
  return <View style={[small ? styles.logo : styles.poster, styles.posterFallback, { backgroundColor: colors.muted }]}><Text style={{ color: colors.primary, fontWeight: "800" }}>{fallback.slice(0, 2).toUpperCase()}</Text></View>;
}

function Stat({ label, value, icon, onPress }: { label: string; value: number; icon: keyof typeof Feather.glyphMap; onPress: () => void }) {
  const colors = useColors();
  return <Pressable onPress={onPress} style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}><Feather name={icon} size={24} color={colors.primary} /><Text style={[styles.statValue, { color: colors.foreground }]}>{value.toLocaleString()}</Text><Text style={[styles.muted, { color: colors.mutedForeground }]}>{label}</Text></Pressable>;
}

function UnsupportedCatalog({ name }: { name: string }) {
  const colors = useColors();
  return <View style={[styles.settingsCard, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.title, { color: colors.foreground }]}>{name}</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>This section is available for Xtream providers. M3U and Stalker sources continue to work for Live TV.</Text></View>;
}

function Input({ label, ...props }: { label: string; value: string; onChangeText: (value: string) => void; autoCapitalize?: "none" | "sentences"; secureTextEntry?: boolean }) {
  const colors = useColors();
  return <View style={styles.inputWrap}><Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text><TextInput {...props} placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]} /></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: 18, paddingVertical: 20, maxWidth: 1500, width: "100%", alignSelf: "center" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingBottom: 10 },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  nav: { gap: 6, paddingBottom: 2 },
  brand: { fontSize: 28, fontWeight: "900", letterSpacing: 1 },
  brandSmall: { fontSize: 18, fontWeight: "900", letterSpacing: 1 },
  providerChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, flexDirection: "row", gap: 7, alignItems: "center", maxWidth: 220 },
  dot: { width: 7, height: 7, borderRadius: 99 },
  setup: { width: "100%", maxWidth: 720, alignSelf: "center", paddingHorizontal: 20, gap: 14 },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  inputWrap: { gap: 6 },
  label: { fontSize: 12, fontWeight: "700" },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 48, paddingHorizontal: 14 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 1.2, marginBottom: 8 },
  heroTitle: { fontSize: 38, fontWeight: "900", maxWidth: 780, lineHeight: 43, marginBottom: 10 },
  title: { fontSize: 28, fontWeight: "800", marginBottom: 6 },
  detailTitle: { fontSize: 34, lineHeight: 39, fontWeight: "900" },
  sectionTitle: { fontSize: 20, fontWeight: "800", marginBottom: 10 },
  sectionGap: { marginTop: 24 },
  body: { fontSize: 15, lineHeight: 22, maxWidth: 850 },
  muted: { fontSize: 13, lineHeight: 18 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginVertical: 24 },
  stat: { borderWidth: 1, borderRadius: 16, padding: 18, minWidth: 180, flexGrow: 1, gap: 8 },
  statValue: { fontSize: 30, fontWeight: "900" },
  errorBanner: { marginHorizontal: 18, marginTop: 10, borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  errorText: { flex: 1, fontSize: 13 },
  catalogTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 },
  searchBox: { borderWidth: 1, borderRadius: 12, minHeight: 46, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8 },
  searchInput: { flex: 1, minHeight: 44 },
  categoryRail: { gap: 6, paddingVertical: 14 },
  mediaGrid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -6 },
  mediaCard: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  mediaCopy: { padding: 10, gap: 3 },
  mediaTitle: { fontSize: 14, lineHeight: 18, fontWeight: "700", minHeight: 36 },
  poster: { width: "100%", aspectRatio: 2 / 3 },
  posterFallback: { alignItems: "center", justifyContent: "center" },
  logo: { width: 52, height: 52, borderRadius: 10 },
  list: { gap: 8 },
  liveRow: { borderWidth: 1, borderRadius: 14, padding: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  liveMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  itemTitle: { fontSize: 15, fontWeight: "700" },
  iconButton: { padding: 10 },
  playButton: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  detailHero: { borderWidth: 1, borderRadius: 20, overflow: "hidden", minHeight: 360, marginTop: 14 },
  backdropImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  detailHeroInner: { flexDirection: "row", flexWrap: "wrap", gap: 22, padding: 20, alignItems: "flex-start" },
  detailPoster: { width: 190, maxWidth: "38%", borderRadius: 14, overflow: "hidden" },
  detailCopy: { flex: 1, minWidth: 260, gap: 10 },
  metaPills: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  metaPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  metaPillText: { fontSize: 12, fontWeight: "700" },
  infoLine: { fontSize: 13, lineHeight: 20 },
  episodeRow: { borderWidth: 1, borderRadius: 14, padding: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  episodeNumber: { width: 72, height: 54, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  episodeThumb: { width: 96, height: 58, borderRadius: 10 },
  episodeMeta: { fontSize: 12, lineHeight: 17, marginVertical: 2 },
  playerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  player: { width: "100%", borderWidth: 1, borderRadius: 14, overflow: "hidden", backgroundColor: "#05070d" },
  playerMeta: { paddingVertical: 16 },
  url: { fontSize: 11, marginTop: 8 },
  librarySection: { marginTop: 22 },
  libraryRow: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  settingsCard: { borderWidth: 1, borderRadius: 16, padding: 18, gap: 8 },
});