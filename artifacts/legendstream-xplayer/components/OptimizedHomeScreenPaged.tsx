import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ContinueWatchingView } from "@/components/ContinueWatchingView";
import { CredentialDiagnosticsPanel, useCredentialDiagnosticsStartup } from "@/components/CredentialDiagnosticsPanel";
import { DownloadsView } from "@/components/DownloadsView";
import { FocusButton } from "@/components/FocusButton";
import { HomeDiscovery, type HomeContentView } from "@/components/home/HomeDiscovery";
import { NativeVideoPlayer } from "@/components/NativeVideoPlayer";
import {
  PagedLiveCatalog,
  PagedMoviesCatalog,
  PagedSeriesCatalog,
  type CatalogSortMode,
} from "@/components/catalog/PagedCatalogViews";
import { StalkerLiveCatalog } from "@/components/catalog/StalkerLiveCatalog";
import { PlayerChromeTimeoutSetting } from "@/components/PlayerChromeTimeoutSetting";
import { ProviderBackupPanel } from "@/components/ProviderBackupPanel";
import { ProviderSubscriptionChip } from "@/components/ProviderSubscriptionChip";
import {
  type Channel,
  type ProviderConfig,
  type ProviderType,
  usePlayer,
} from "@/context/PlayerContext";
import { type MediaProgress, useMediaLibrary } from "@/context/MediaLibraryContext";
import { useCatalogSync } from "@/context/CatalogSyncContext";
import { useI18n } from "@/context/I18nContext";
import { useColors } from "@/hooks/useColors";
import { useResolvedLiveIdentityChannels } from "@/hooks/useResolvedLiveIdentityChannels";
import type { DownloadedMedia } from "@/lib/downloads";
import type { LiveChannelIdentity } from "@/lib/playerLiveQueue";
import {
  loadM3USeriesInfoFromCache,
  type CatalogPlaybackIdentity,
} from "@/lib/catalogPageRepository";
import { providerListPresentation } from "@/lib/providerDisplaySecurity";
import { prepareProviderSwitchCache } from "@/lib/providerSwitchCache";
import {
  clearProviderSwitchSnapshot,
  safeProviderSwitchError,
  tryBeginProviderSwitch,
} from "@/lib/providerSwitchUx";
import { redactSensitiveText } from "@/lib/safeLog";
import {
  buildEpisodeStreamUrl,
  buildVodStreamUrl,
  getSeriesInfo,
  registerLocalEpisodeQueue,
  type XtreamCredentials,
  type XtreamEpisode,
  type XtreamSeriesInfo,
  type XtreamSeriesItem,
  type XtreamVodItem,
} from "@/lib/xtreamCatalog";
import { yieldToUi } from "@/lib/cooperative";

type ViewName = HomeContentView | "player";
type ContentView = Exclude<ViewName, "player">;
type Playable = {
  title: string;
  url: string;
  subtitle?: string;
  kind: "live" | "movie" | "episode" | "download";
  returnTo: ContentView;
  liveIdentity?: LiveChannelIdentity;
  vodIdentity?: CatalogPlaybackIdentity;
};

const CATALOG_SORT_KEY = "@legendstream/catalog-sort-v1";

const visibleErrorText = (value?: string | null) => value ? redactSensitiveText(value) : null;

const providerPresentation = (provider: ProviderConfig) => providerListPresentation({
  ...provider,
  type: provider.declaredType ?? provider.type,
});

function snapshotCount(
  providerId: string,
  snapshotProviderId: string | undefined,
  total: number,
  ready: boolean,
  usable: boolean,
) {
  const matches = snapshotProviderId === providerId;
  const countKnown = matches && (usable || ready || total > 0);
  return { totalCount: countKnown ? total : null, countKnown };
}

export default function OptimizedHomeScreenPaged() {
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
    resolveProviderForSwitch,
    setActiveProvider,
    removeProvider,
    disconnectProvider,
    clearError,
  } = usePlayer();
  const {
    snapshot,
    hasUsableCache,
    isSyncing,
    isRefreshing,
    refreshSnapshot,
    refreshCatalog,
  } = useCatalogSync();
  useCredentialDiagnosticsStartup();

  const [view, setView] = useState<ViewName>("home");
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [playable, setPlayable] = useState<Playable | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogSort, setCatalogSort] = useState<CatalogSortMode>("default");
  const [selectedSeries, setSelectedSeries] = useState<XtreamSeriesItem | null>(null);
  const [seriesInfo, setSeriesInfo] = useState<XtreamSeriesInfo | null>(null);
  const [catalogDrawerOpen, setCatalogDrawerOpen] = useState(false);
  const [switchingProviderId, setSwitchingProviderId] = useState<string | null>(null);
  const switchingProviderRef = useRef<string | null>(null);
  const activeProviderIdRef = useRef<string | null>(provider?.id ?? null);
  const seriesRequestGenerationRef = useRef(0);

  React.useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(CATALOG_SORT_KEY)
      .then((saved) => {
        if (cancelled) return;
        if (saved === "alpha") setCatalogSort("alphaAsc");
        else if (
          saved === "default" || saved === "alphaAsc" || saved === "alphaDesc" ||
          saved === "idAsc" || saved === "idDesc" || saved === "added"
        ) setCatalogSort(saved);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    activeProviderIdRef.current = provider?.id ?? null;
    seriesRequestGenerationRef.current += 1;
    setSelectedSeries(null);
    setSeriesInfo(null);
    setCatalogError(null);
    setCatalogDrawerOpen(false);
  }, [provider?.id]);

  const changeCatalogSort = (mode: CatalogSortMode) => {
    setCatalogSort(mode);
    void AsyncStorage.setItem(CATALOG_SORT_KEY, mode).catch(() => undefined);
  };

  const credentials = useMemo<XtreamCredentials | null>(() => {
    if (!provider || provider.type !== "xtream" || !provider.username || !provider.password) return null;
    return {
      baseUrl: provider.url || provider.playlistUrl,
      username: provider.username,
      password: provider.password,
    };
  }, [provider]);

  const playerLiveChannels = useMemo(
    () => provider
      ? channels.filter((channel) =>
          channel.providerId === provider.id && (channel.contentType ?? "live") === "live",
        )
      : [],
    [channels, provider],
  );
  const liveIdentityIds = useMemo(
    () => [...history, ...favorites],
    [history, favorites],
  );
  const resolvedLiveIdentityChannels = useResolvedLiveIdentityChannels(
    provider,
    liveIdentityIds,
    playerLiveChannels,
  );

  const activeSnapshot = provider && snapshot.providerId === provider.id ? snapshot : null;
  const homeChannels = activeSnapshot?.live.length ? activeSnapshot.live : playerLiveChannels.slice(0, 48);
  const homeIdentityChannels = useMemo(() => {
    const byId = new Map<string, Channel>();
    for (const channel of homeChannels) byId.set(channel.id, channel);
    for (const channel of resolvedLiveIdentityChannels) {
      if (!byId.has(channel.id)) byId.set(channel.id, channel);
    }
    return [...byId.values()];
  }, [homeChannels, resolvedLiveIdentityChannels]);
  const homeMovies = activeSnapshot?.movies ?? [];
  const homeSeries = activeSnapshot?.series ?? [];
  const liveCount = provider
    ? snapshotCount(provider.id, snapshot.providerId, snapshot.counts.live, snapshot.ready, hasUsableCache)
    : { totalCount: null, countKnown: false };
  const vodCount = provider
    ? snapshotCount(provider.id, snapshot.providerId, snapshot.counts.vod, snapshot.ready, hasUsableCache)
    : { totalCount: null, countKnown: false };
  const seriesCount = provider
    ? snapshotCount(provider.id, snapshot.providerId, snapshot.counts.series, snapshot.ready, hasUsableCache)
    : { totalCount: null, countKnown: false };

  const refreshPagedCatalog = async () => {
    if (!provider) return;
    if (provider.type === "xtream") {
      await refreshCatalog();
    } else if (provider.type === "m3u") {
      await refreshProvider();
      await yieldToUi();
      await refreshSnapshot();
    } else if (provider.type === "stalker") {
      await refreshProvider();
    }
  };

  const switchProvider = async (id: string) => {
    if (id === provider?.id) return;
    const target = providers.find((item) => item.id === id);
    if (!target) {
      setCatalogError("The saved provider could not be opened.");
      return;
    }
    if (target.needsCredentials) {
      setAdding(false);
      setEditingProviderId(id);
      return;
    }
    const gate = tryBeginProviderSwitch(switchingProviderRef.current, id);
    if (!gate.started) return;

    seriesRequestGenerationRef.current += 1;
    switchingProviderRef.current = id;
    setSwitchingProviderId(id);
    clearError();
    setCatalogError(null);
    try {
      const routedTarget = await resolveProviderForSwitch(id);
      if (!routedTarget) {
        setCatalogError("The saved provider could not be opened.");
        return;
      }
      try {
        const prepared = await prepareProviderSwitchCache(routedTarget);
        if (!prepared) clearProviderSwitchSnapshot(id);
      } catch {
        clearProviderSwitchSnapshot(id);
      }
      const ok = await setActiveProvider(id);
      if (ok) {
        await yieldToUi();
        setView("home");
      } else {
        clearProviderSwitchSnapshot(id);
      }
    } catch (caught) {
      clearProviderSwitchSnapshot(id);
      setCatalogError(safeProviderSwitchError(caught));
    } finally {
      switchingProviderRef.current = null;
      setSwitchingProviderId(null);
    }
  };

  const navigate = (target: ContentView) => {
    setView(target);
    if (target !== "series") {
      seriesRequestGenerationRef.current += 1;
      setSelectedSeries(null);
      setSeriesInfo(null);
    }
  };

  if (isHydrating) {
    return <View style={[s.centered, { backgroundColor: colors.background }]}>
      <Text style={{ color: colors.foreground }}>{t("loading")}</Text>
    </View>;
  }

  const editingProvider = editingProviderId
    ? providers.find((item) => item.id === editingProviderId) ?? null
    : null;
  const providerSwitchBusy = isLoading || switchingProviderId !== null;

  if (!provider && !adding && !editingProvider) {
    return <SavedAccounts
      providers={providers}
      busy={providerSwitchBusy}
      switchingProviderId={switchingProviderId}
      error={error}
      onOpen={(id) => void switchProvider(id)}
      onAdd={() => setAdding(true)}
      onRemove={(id) => void removeProvider(id)}
    />;
  }

  if (adding || editingProvider || !provider) {
    return <ProviderSetup
      existing={editingProvider}
      busy={isLoading}
      error={error}
      onCancel={providers.length ? () => {
        setAdding(false);
        setEditingProviderId(null);
      } : undefined}
      onSubmit={async (config) => {
        clearError();
        const ok = await connectProvider(config);
        if (ok) {
          setAdding(false);
          setEditingProviderId(null);
          setView("home");
        }
      }}
    />;
  }

  const openLive = (channel: Channel) => {
    if (!channel.streamUrl) {
      setCatalogError("The cached playback address is unavailable. Refresh Live TV and try again.");
      return;
    }
    setPlayable({
      title: channel.name,
      subtitle: channel.category,
      url: channel.streamUrl,
      kind: "live",
      returnTo: "live",
      liveIdentity: { providerId: channel.providerId, channelId: channel.id },
    });
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
        vodIdentity: { providerId: provider.id, itemId: String(item.stream_id) },
      });
      setView("player");
    } catch (caught) {
      setCatalogError(caught instanceof Error ? caught.message : t("loadingMovies"));
    }
  };

  const isCurrentSeriesRequest = (providerId: string, generation: number) =>
    activeProviderIdRef.current === providerId && seriesRequestGenerationRef.current === generation;

  const openSeries = async (item: XtreamSeriesItem) => {
    const requestProviderId = provider.id;
    const requestGeneration = ++seriesRequestGenerationRef.current;
    setSelectedSeries(item);
    setSeriesInfo(null);
    setCatalogError(null);
    try {
      if (provider.type === "m3u") {
        const info = await loadM3USeriesInfoFromCache(provider, item.series_id);
        if (!isCurrentSeriesRequest(requestProviderId, requestGeneration)) return;
        if (!info) {
          setCatalogError(t("loadingEpisodes"));
          return;
        }
        if (!isCurrentSeriesRequest(requestProviderId, requestGeneration)) return;
        registerLocalEpisodeQueue(info);
        setSeriesInfo(info);
        return;
      }
      if (!credentials) return;
      const info = await getSeriesInfo(credentials, item.series_id);
      if (!isCurrentSeriesRequest(requestProviderId, requestGeneration)) return;
      setSeriesInfo(info);
    } catch (caught) {
      if (!isCurrentSeriesRequest(requestProviderId, requestGeneration)) return;
      setCatalogError(caught instanceof Error ? caught.message : t("loadingEpisodes"));
    }
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
    setPlayable({
      title: item.title,
      subtitle: item.subtitle,
      url: item.uri,
      kind: "download",
      returnTo: "downloads",
    });
    setView("player");
  };

  const openProgress = (item: MediaProgress) => {
    setPlayable({
      title: item.title,
      subtitle: item.subtitle,
      url: item.source,
      kind: item.kind,
      returnTo: "history",
    });
    setView("player");
  };

  if (view === "player") {
    return <View style={s.fullPlayer}>
      {playable ? <NativeVideoPlayer
        source={playable.url}
        title={playable.title}
        subtitle={playable.subtitle}
        mediaKind={playable.kind}
        liveIdentity={playable.liveIdentity}
        vodIdentity={playable.vodIdentity}
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
  const countKnown = snapshot.providerId === provider.id && (hasUsableCache || snapshot.ready || snapshot.counts.live + snapshot.counts.vod + snapshot.counts.series > 0);

  return <View style={[s.screen, { backgroundColor: colors.background, paddingTop: top, paddingBottom: Math.max(insets.bottom, 10) }]}>
    <View style={[s.header, { borderColor: colors.border }, view === "home" ? s.homeHeaderPremium : null]}>
      <View style={s.headerTop}>
        <Text style={[s.brand, { color: colors.foreground }]}>LEGEND<Text style={{ color: colors.primary }}>STREAM</Text></Text>
        <ProviderSubscriptionChip provider={provider} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.nav}>
        {nav.map((item) => <FocusButton
          key={item.key}
          label={item.label}
          icon={item.icon}
          variant={view === item.key ? "secondary" : "ghost"}
          onPress={() => navigate(item.key)}
        />)}
      </ScrollView>
    </View>

    {error || catalogError ? <View style={[s.error, { borderColor: colors.destructive, backgroundColor: colors.card }]}> 
      <Text style={{ color: colors.destructive, flex: 1 }}>{visibleErrorText(error || catalogError)}</Text>
      <Pressable onPress={() => {
        clearError();
        setCatalogError(null);
      }}><Feather name="x" size={20} color={colors.mutedForeground} /></Pressable>
    </View> : null}

    {view === "live" && (provider.type === "m3u" || provider.type === "xtream") ? <PagedLiveCatalog
      provider={provider}
      snapshotCount={liveCount}
      epgByChannel={epgByChannel}
      favorites={favorites}
      epgLoading={isEpgLoading}
      refreshing={isLoading || isRefreshing || isSyncing}
      onRefresh={refreshPagedCatalog}
      onOpen={openLive}
      onFavorite={(id) => void toggleFavorite(id)}
      onDrawerVisibilityChange={setCatalogDrawerOpen}
    /> : null}

    {view === "live" && provider.type === "stalker" ? <StalkerLiveCatalog
      providerId={provider.id}
      channels={playerLiveChannels}
      epgByChannel={epgByChannel}
      favorites={favorites}
      epgLoading={isEpgLoading}
      refreshing={isLoading}
      onRefresh={refreshPagedCatalog}
      onOpen={openLive}
      onFavorite={(id) => void toggleFavorite(id)}
    /> : null}

    {view === "movies" && (provider.type === "m3u" || provider.type === "xtream") ? <PagedMoviesCatalog
      provider={provider}
      snapshotCount={vodCount}
      sortMode={catalogSort}
      onSort={changeCatalogSort}
      refreshing={isLoading || isRefreshing || isSyncing}
      onRefresh={refreshPagedCatalog}
      onOpen={openMovie}
      onDrawerVisibilityChange={setCatalogDrawerOpen}
    /> : null}

    {view === "series" && (provider.type === "m3u" || provider.type === "xtream") ? <PagedSeriesCatalog
      provider={provider}
      snapshotCount={seriesCount}
      sortMode={catalogSort}
      onSort={changeCatalogSort}
      refreshing={isLoading || isRefreshing || isSyncing}
      onRefresh={refreshPagedCatalog}
      selected={selectedSeries}
      info={seriesInfo}
      onOpen={(item) => void openSeries(item)}
      onBack={() => {
        seriesRequestGenerationRef.current += 1;
        setSelectedSeries(null);
        setSeriesInfo(null);
      }}
      onEpisode={playEpisode}
      onDrawerVisibilityChange={setCatalogDrawerOpen}
    /> : null}

    {view !== "live" && view !== "movies" && view !== "series" ? <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      scrollEnabled={!catalogDrawerOpen}
    >
      {view === "home" ? <HomeDiscovery
        provider={provider}
        live={countKnown ? snapshot.counts.live : (provider.type === "stalker" ? playerLiveChannels.length : null)}
        vod={vodCount.totalCount}
        series={seriesCount.totalCount}
        vodCategories={0}
        seriesCategories={0}
        catalogLoading={isSyncing}
        channels={homeIdentityChannels}
        history={history}
        movies={homeMovies}
        seriesItems={homeSeries}
        newChannels={activeSnapshot?.newChannels ?? []}
        newMovies={activeSnapshot?.newMovies ?? []}
        newSeries={activeSnapshot?.newSeries ?? []}
        onNavigate={navigate}
        onOpenLive={openLive}
        onOpenMovie={openMovie}
        onOpenSeries={(item) => void openSeries(item)}
        onOpenMedia={openProgress}
        onRemoveLive={(id) => void removeWatched(id)}
      /> : null}
      {view === "history" ? <HistoryView
        channels={homeIdentityChannels}
        favorites={favorites}
        history={history}
        onOpen={openLive}
        onOpenMedia={openProgress}
      /> : null}
      {view === "downloads" ? <DownloadsView onOpen={openDownload} /> : null}
      {view === "settings" ? <Settings
        provider={provider}
        providers={providers}
        busy={providerSwitchBusy}
        switchingProviderId={switchingProviderId}
        onEdit={() => setEditingProviderId(provider.id)}
        onAdd={() => setAdding(true)}
        onSwitch={(id) => void switchProvider(id)}
        onDisconnect={() => void disconnectProvider()}
        onRemove={(id) => void removeProvider(id)}
      /> : null}
    </ScrollView> : null}
  </View>;
}

function SavedAccounts({ providers, busy, switchingProviderId, error, onOpen, onAdd, onRemove }: {
  providers: ProviderConfig[];
  busy: boolean;
  switchingProviderId: string | null;
  error: string | null;
  onOpen: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={[s.setup, { paddingTop: insets.top + 30, paddingBottom: insets.bottom + 40 }]}>
    <Text style={[s.brandLarge, { color: colors.foreground }]}>LEGEND<Text style={{ color: colors.primary }}>STREAM</Text></Text>
    <Text style={[s.title, { color: colors.foreground }]}>{t("savedConnections")}</Text>
    <Text style={{ color: colors.mutedForeground }}>{t("chooseAccount")}</Text>
    {error ? <Text style={{ color: colors.destructive }}>{visibleErrorText(error)}</Text> : null}
    <View style={{ gap: 10 }}>{providers.map((item) => {
      const switching = switchingProviderId === item.id;
      return <View key={item.id} style={[s.accountCard, { borderColor: switching ? colors.primary : colors.border, backgroundColor: colors.card, opacity: busy && !switching ? 0.6 : 1 }]}> 
        <Pressable style={{ flex: 1 }} onPress={() => onOpen(item.id)} disabled={busy}>
          <View style={s.rowBetween}>
            <Text style={{ color: colors.foreground, fontWeight: "800", fontSize: 16, flex: 1 }}>{item.name}</Text>
            {switching ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          </View>
          <Text style={{ color: item.needsCredentials ? colors.destructive : switching ? colors.primary : colors.mutedForeground }}>
            {switching ? t("opening") : item.needsCredentials ? t("credentialsMissing") : providerPresentation(item).meta}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 12 }}>{providerPresentation(item).host}</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={() => onRemove(item.id)} style={s.iconButton}>
          <Feather name="trash-2" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>;
    })}</View>
    <FocusButton label={busy ? t("opening") : t("addNewAccount")} icon="plus" variant="primary" onPress={onAdd} disabled={busy} />
    <ProviderBackupPanel mode="import-only" />
  </ScrollView>;
}

function ProviderSetup({ existing, busy, error, onCancel, onSubmit }: {
  existing: ProviderConfig | null;
  busy: boolean;
  error: string | null;
  onCancel?: () => void;
  onSubmit: (config: Omit<ProviderConfig, "id" | "connectedAt" | "createdAt" | "url" | "channelCount" | "needsCredentials"> & {
    providerId?: string;
    url?: string;
    epgUrl?: string;
    mac?: string;
  }) => Promise<void>;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [name, setName] = useState(existing?.name ?? "My provider");
  const [type, setType] = useState<ProviderType>(existing?.declaredType ?? existing?.type ?? "xtream");
  const [url, setUrl] = useState(existing?.playlistUrl || existing?.url || "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState(existing?.password ?? "");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [mac, setMac] = useState(existing?.mac ?? "");
  const [epgUrl, setEpgUrl] = useState(existing?.epgUrl ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const credentialsOnly = Boolean(existing?.needsCredentials);

  const submit = async () => {
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) return setLocalError(t("invalidUrl"));
    if (type === "xtream" && (!username.trim() || !password)) return setLocalError(t("xtreamCredentials"));
    setLocalError(null);
    await onSubmit({
      providerId: existing?.id,
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
      <Text style={[s.title, { color: colors.foreground }]}>{credentialsOnly ? t("credentialsMissing") : existing ? t("editIptvSource") : t("addIptvSource")}</Text>
      <View style={s.row}>{(["xtream", "m3u", "stalker"] as ProviderType[]).map((item) => <FocusButton
        key={item}
        label={item === "xtream" ? "Xtream" : item === "m3u" ? "M3U" : "Stalker"}
        variant={type === item ? "secondary" : "ghost"}
        onPress={() => setType(item)}
        disabled={credentialsOnly}
      />)}</View>
      <Input label={t("sourceName")} value={name} onChangeText={setName} editable={!credentialsOnly} />
      <Input label={t("serverUrl")} value={url} onChangeText={setUrl} autoCapitalize="none" editable={!credentialsOnly || !url} />
      {type === "xtream" ? <>
        <Input label={t("username")} value={username} onChangeText={setUsername} autoCapitalize="none" />
        <Input
          label={t("password")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!passwordVisible}
          trailingAction={<Pressable onPress={() => setPasswordVisible((value) => !value)} style={s.iconButton}>
            <Feather name={passwordVisible ? "eye-off" : "eye"} size={20} color={colors.mutedForeground} />
          </Pressable>}
        />
      </> : null}
      {type === "stalker" ? <Input label={t("macAddress")} value={mac} onChangeText={setMac} autoCapitalize="none" /> : null}
      <Input label={t("epgOptional")} value={epgUrl} onChangeText={setEpgUrl} autoCapitalize="none" editable={!credentialsOnly} />
      {localError || error ? <Text style={{ color: colors.destructive }}>{visibleErrorText(localError || error)}</Text> : null}
      <View style={s.row}>
        <FocusButton label={busy ? t("connecting") : existing ? t("saveConnect") : t("addConnect")} icon="log-in" variant="primary" onPress={() => void submit()} disabled={busy} />
        {onCancel ? <FocusButton label={t("cancel")} variant="ghost" onPress={onCancel} /> : null}
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}

function HistoryView({ channels, favorites, history, onOpen, onOpenMedia }: {
  channels: Channel[];
  favorites: string[];
  history: string[];
  onOpen: (channel: Channel) => void;
  onOpenMedia: (item: MediaProgress) => void;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const recent = history.map((id) => channels.find((channel) => channel.id === id)).filter((item): item is Channel => Boolean(item));
  const favs = favorites.map((id) => channels.find((channel) => channel.id === id)).filter((item): item is Channel => Boolean(item));
  const section = (title: string, rows: Channel[]) => <View style={{ marginBottom: 28 }}>
    <Text style={[s.section, { color: colors.foreground, marginBottom: 10 }]}>{title}</Text>
    {rows.length ? rows.map((channel) => <Pressable key={`${title}-${channel.id}`} onPress={() => onOpen(channel)} style={[s.episode, { borderColor: colors.border, backgroundColor: colors.card }]}> 
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.foreground, fontWeight: "700" }}>{channel.name}</Text>
        <Text style={{ color: colors.mutedForeground }}>{channel.category}</Text>
      </View>
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

function Settings({ provider, providers, busy, switchingProviderId, onEdit, onAdd, onSwitch, onDisconnect, onRemove }: {
  provider: ProviderConfig;
  providers: ProviderConfig[];
  busy: boolean;
  switchingProviderId: string | null;
  onEdit: () => void;
  onAdd: () => void;
  onSwitch: (id: string) => void;
  onDisconnect: () => void;
  onRemove: (id: string) => void;
}) {
  const colors = useColors();
  const { t, language, languages, setLanguage } = useI18n();
  return <View>
    <Text style={[s.title, { color: colors.foreground }]}>{t("settings")}</Text>
    <View style={[s.settings, { borderColor: colors.border, backgroundColor: colors.card }]}> 
      <Text style={{ color: colors.foreground, fontWeight: "800", fontSize: 16 }}>{t("activeConnection")}</Text>
      <Text style={{ color: colors.foreground }}>{provider.name}</Text>
      <Text style={{ color: colors.mutedForeground }}>{(provider.declaredType ?? provider.type).toUpperCase()} · {provider.channelCount ?? 0}</Text>
      <View style={s.row}>
        <FocusButton label={t("editSource")} icon="edit-2" onPress={onEdit} />
        <FocusButton label={t("addAccount")} icon="plus" onPress={onAdd} />
        <FocusButton label={t("disconnect")} icon="log-out" variant="ghost" onPress={onDisconnect} />
      </View>
    </View>
    <View style={{ marginTop: 24 }}>
      <Text style={[s.section, { color: colors.foreground }]}>{t("language")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
        {languages.map((item) => <FocusButton key={item.code} label={item.label} variant={language === item.code ? "secondary" : "ghost"} onPress={() => void setLanguage(item.code)} />)}
      </ScrollView>
    </View>
    <PlayerChromeTimeoutSetting />
    <ProviderBackupPanel />
    <CredentialDiagnosticsPanel />
    <View style={{ marginTop: 24 }}>
      <Text style={[s.section, { color: colors.foreground }]}>{t("savedAccounts")}</Text>
      <View style={{ gap: 8 }}>{providers.map((item) => {
        const active = item.id === provider.id;
        const switching = switchingProviderId === item.id;
        return <View key={item.id} style={[s.accountCard, { borderColor: switching || active ? colors.primary : colors.border, backgroundColor: colors.card, opacity: busy && !switching && !active ? 0.6 : 1 }]}> 
          <Pressable disabled={busy} onPress={() => onSwitch(item.id)} style={{ flex: 1 }}>
            <View style={s.rowBetween}>
              <Text style={{ color: colors.foreground, fontWeight: "800", flex: 1 }}>{item.name}{active ? ` · ${t("active")}` : ""}</Text>
              {switching ? <ActivityIndicator size="small" color={colors.primary} /> : active ? <Feather name="check-circle" size={18} color={colors.primary} /> : null}
            </View>
            <Text style={{ color: item.needsCredentials ? colors.destructive : switching ? colors.primary : colors.mutedForeground }}>
              {switching ? t("opening") : item.needsCredentials ? t("credentialsMissing") : providerPresentation(item).meta}
            </Text>
            <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 12 }}>{providerPresentation(item).host}</Text>
          </Pressable>
          <Pressable disabled={busy} onPress={() => onRemove(item.id)} style={s.iconButton}>
            <Feather name="trash-2" size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>;
      })}</View>
    </View>
  </View>;
}

function Input({ label, trailingAction, ...props }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  autoCapitalize?: "none" | "sentences";
  secureTextEntry?: boolean;
  editable?: boolean;
  trailingAction?: React.ReactNode;
}) {
  const colors = useColors();
  return <View style={{ gap: 6 }}>
    <Text style={{ color: colors.mutedForeground, fontWeight: "700" }}>{label}</Text>
    <View style={{ position: "relative" }}>
      <TextInput {...props} style={[s.input, trailingAction ? { paddingRight: 52 } : null, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]} placeholderTextColor={colors.mutedForeground} />
      {trailingAction ? <View pointerEvents="box-none" style={s.inputTrailingAction}>{trailingAction}</View> : null}
    </View>
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  fullPlayer: { flex: 1, backgroundColor: "#000" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 18, paddingBottom: 40, maxWidth: 1500, width: "100%", alignSelf: "center" },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingBottom: 8 },
  homeHeaderPremium: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 10 },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  nav: { gap: 6, paddingVertical: 4 },
  brand: { fontSize: 18, fontWeight: "900", letterSpacing: 1 },
  brandLarge: { fontSize: 28, fontWeight: "900", letterSpacing: 1 },
  error: { margin: 12, borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: "row", gap: 8, alignItems: "center" },
  setup: { width: "100%", maxWidth: 720, alignSelf: "center", paddingHorizontal: 20, gap: 14 },
  title: { fontSize: 28, fontWeight: "800", marginBottom: 6 },
  section: { fontSize: 20, fontWeight: "800" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  rowBetween: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 50, paddingHorizontal: 14 },
  inputTrailingAction: { position: "absolute", right: 4, top: 0, bottom: 0, justifyContent: "center", alignItems: "center" },
  iconButton: { padding: 10 },
  accountCard: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  settings: { borderWidth: 1, borderRadius: 16, padding: 18, gap: 8 },
  rail: { gap: 6, paddingVertical: 14 },
  episode: { borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
});
