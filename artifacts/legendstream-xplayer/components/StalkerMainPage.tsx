import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ContinueWatchingView } from "@/components/ContinueWatchingView";
import {
  CredentialDiagnosticsPanel,
  useCredentialDiagnosticsStartup,
} from "@/components/CredentialDiagnosticsPanel";
import { DownloadsView } from "@/components/DownloadsView";
import { FocusButton } from "@/components/FocusButton";
import { HomeDiscovery, type HomeContentView } from "@/components/home/HomeDiscovery";
import { NativeVideoPlayer } from "@/components/NativeVideoPlayer";
import { PagedLiveCatalog } from "@/components/catalog/PagedCatalogViews";
import {
  StalkerGoldenMoviesCatalog,
  type StalkerMoviePlayable,
} from "@/components/stalker/StalkerGoldenMoviesCatalog";
import { StalkerProductErrorBoundary } from "@/components/stalker/StalkerProductErrorBoundary";
import { StalkerSeriesProductSurface } from "@/components/stalker/StalkerSeriesProductSurface";
import { PlayerChromeTimeoutSetting } from "@/components/PlayerChromeTimeoutSetting";
import { ProviderBackupPanel } from "@/components/ProviderBackupPanel";
import { ProviderSubscriptionChip } from "@/components/ProviderSubscriptionChip";
import {
  type Channel,
  type ProviderConfig,
  usePlayer,
} from "@/context/PlayerContext";
import { useMediaLibrary, type MediaProgress } from "@/context/MediaLibraryContext";
import type { MediaPlaybackRef } from "@/lib/mediaProgress";
import { useI18n } from "@/context/I18nContext";
import { useColors } from "@/hooks/useColors";
import { useStalkerLiveCatalogSync } from "@/hooks/useStalkerLiveCatalogSync";
import { useStalkerProductCounts } from "@/hooks/useStalkerProductCounts";
import { useStalkerHomeSummary } from "@/hooks/useStalkerHomeSummary";
import { useResolvedLiveIdentityChannels } from "@/hooks/useResolvedLiveIdentityChannels";
import type { DownloadedMedia } from "@/lib/downloads";
import {
  indexLiveChannelsByProviderAndId,
  resolveLiveIdentityPresentationRows,
} from "@/lib/historyFavoritesPresentation";
import type { LiveChannelIdentity } from "@/lib/playerLiveQueue";
import type { CatalogPlaybackIdentity } from "@/lib/catalogPageRepository";
import { providerListPresentation } from "@/lib/providerDisplaySecurity";
import { prepareProviderSwitchCache } from "@/lib/providerSwitchCache";
import {
  clearProviderSwitchSnapshot,
  safeProviderSwitchError,
  tryBeginProviderSwitch,
} from "@/lib/providerSwitchUx";
import { redactSensitiveText } from "@/lib/safeLog";
import {
  readCurrentStalkerProductSession,
  type StalkerProductProviderIdentity,
} from "@/lib/stalkerProductSession";
import { resolveStalkerVodHistoryLink } from "@/lib/stalkerVod";
import { clearStalkerLiveRuntimeLocators } from "@/lib/stalkerLiveRuntimeLocator";
import {
  resolveStalkerSeriesHistoryEpisode,
  type StalkerSeriesEpisodeIdentity,
  type StalkerSeriesPlayableIntent,
} from "@/lib/stalkerSeriesProduct";
import { yieldToUi } from "@/lib/cooperative";
import { beginStalkerPlaybackTrace, classifyPlaybackSource, getActiveStalkerTraceId, nextStalkerMountGeneration, shortSafeId, traceStalker } from "@/lib/stalkerPlaybackTrace";

type StalkerViewName = HomeContentView | "player";
type StalkerContentView = Exclude<StalkerViewName, "player">;

type Playable = {
  title: string;
  url: string;
  subtitle?: string;
  kind: "live" | "movie" | "episode" | "download";
  returnTo: StalkerContentView;
  liveIdentity?: LiveChannelIdentity;
  vodIdentity?: CatalogPlaybackIdentity;
  progressRef?: MediaPlaybackRef;
  seriesIdentity?: StalkerSeriesEpisodeIdentity;
};

/**
 * R17 category seam. Backend identity, provider-visible label, and provider order
 * stay separate; UI code must never manufacture a label from an id.
 */
export type StalkerCategoryPresentation = {
  id: string;
  name: string;
  order: number;
};

const visibleErrorText = (value?: string | null) =>
  value ? redactSensitiveText(value) : null;

const providerPresentation = (provider: ProviderConfig) =>
  providerListPresentation({
    ...provider,
    type: provider.declaredType ?? provider.type,
  });

function isStalkerProductProvider(
  provider: ProviderConfig,
): provider is ProviderConfig & StalkerProductProviderIdentity {
  return provider.type === "stalker";
}

/**
 * R17 parity freeze:
 * - This page owns the Stalker presentation lifecycle; protocol/session code stays outside.
 * - Navigation, safe-area shell, content viewport, History, Downloads and Settings are
 *   controlled clones of OptimizedHomeScreenPaged.
 * - Product adapters resolve a normalized Playable and hand it to this page. They do not
 *   own a private player.
 * - Live can already use the golden PagedLiveCatalog because useCatalogPage has a proven
 *   Stalker-live backend seam. Movies use a controlled golden presentation clone while
 *   Series adapts protocol data into the shared Golden Series catalog. Both product
 *   adapters hand normalized playback intents to this page instead of owning a player.
 */
export default function StalkerMainPage() {
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
    isLoading,
    isEpgLoading,
    error,
    scopedError,
    toggleFavorite,
    recordWatched,
    removeWatched,
    resolveProviderForSwitch,
    setActiveProvider,
    removeProvider,
    disconnectProvider,
    clearError,
    clearScopedError,
  } = usePlayer();
  useCredentialDiagnosticsStartup();
  const mountGenerationRef = useRef<number | null>(null);
  useEffect(() => {
    if (!provider || provider.type !== "stalker") return;
    const mountGeneration = nextStalkerMountGeneration(); mountGenerationRef.current = mountGeneration;
    traceStalker("STALKER_RUNTIME_OWNER_MOUNT", { providerShortId: shortSafeId(provider.id), mountGeneration });
    return () => traceStalker("STALKER_RUNTIME_OWNER_UNMOUNT", { providerShortId: shortSafeId(provider.id), mountGeneration });
  }, [provider?.id, provider?.type]);

  const [view, setView] = useState<StalkerViewName>("home");
  const [playable, setPlayable] = useState<Playable | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogDrawerOpen, setCatalogDrawerOpen] = useState(false);
  const [switchingProviderId, setSwitchingProviderId] = useState<string | null>(null);
  const switchingProviderRef = useRef<string | null>(null);
  const historyPlaybackAbortRef = useRef<AbortController | null>(null);
  const historyPlaybackSequenceRef = useRef(0);
  const liveCatalog = useStalkerLiveCatalogSync(provider);
  const productCounts = useStalkerProductCounts(provider?.type === "stalker" ? provider.id : undefined);
  const homeSummary = useStalkerHomeSummary(provider?.type === "stalker" ? provider.id : undefined);

  const playerLiveChannels = useMemo(
    () => provider
      ? channels.filter(
          (channel) =>
            channel.providerId === provider.id &&
            (channel.contentType ?? "live") === "live",
        )
      : [],
    [channels, provider?.id],
  );
  const historyIdentityIds = useMemo(
    () => view === "history" ? [...history, ...favorites] : [],
    [favorites, history, view],
  );
  const resolvedHistoryChannels = useResolvedLiveIdentityChannels(
    provider,
    historyIdentityIds,
    playerLiveChannels,
  );

  useEffect(() => () => {
    historyPlaybackAbortRef.current?.abort();
    historyPlaybackSequenceRef.current += 1;
  }, [provider?.id]);

  if (!provider || !isStalkerProductProvider(provider)) return null;

  const navigate = (target: StalkerContentView) => {
    setCatalogError(null);
    if (target !== "live") clearScopedError("live-history");
    setView(target);
  };

  const openResolvedPlayable = (next: Playable) => {
    if (next.kind !== "live") clearScopedError("live-history");
    const traceId = getActiveStalkerTraceId();
    if (traceId) traceStalker("STALKER_PLAYER_HANDOFF", { traceId, providerShortId: shortSafeId(provider.id), channelId: next.liveIdentity?.channelId, hasRuntimeSource: next.url.startsWith("legendstream-catalog://"), runtimeSourceKind: classifyPlaybackSource(next.url), kind: next.kind });
    setPlayable(next);
    setView("player");
  };

  const openLive = (channel: Channel) => {
    const traceId = beginStalkerPlaybackTrace();
    traceStalker("STALKER_LIVE_TAP", { traceId, providerShortId: shortSafeId(provider.id), channelId: channel.id, sourceKind: classifyPlaybackSource(channel.streamUrl) });
    if (!channel.streamUrl) {
      setCatalogError("The cached playback address is unavailable. Refresh Live TV and try again.");
      return;
    }
    openResolvedPlayable({
      title: channel.name,
      subtitle: channel.category,
      url: channel.streamUrl,
      kind: "live",
      returnTo: "live",
      liveIdentity: { providerId: channel.providerId, channelId: channel.id },
    });
    void recordWatched(channel.id);
  };

  const openDownload = (item: DownloadedMedia) => {
    openResolvedPlayable({
      title: item.title,
      subtitle: item.subtitle,
      url: item.uri,
      kind: "download",
      returnTo: "downloads",
    });
  };

  const openMovie = (movie: StalkerMoviePlayable) => {
    openResolvedPlayable({
      title: movie.title,
      subtitle: movie.subtitle,
      url: movie.url,
      kind: "movie",
      returnTo: "movies",
      vodIdentity: { providerId: provider.id, itemId: movie.itemId },
      progressRef: {
        type: "stalker-vod",
        itemId: movie.itemId,
        categoryId: movie.categoryId,
      },
    });
  };

  const openSeriesEpisode = (intent: StalkerSeriesPlayableIntent) => {
    if (intent.identity.providerId !== provider.id) {
      setCatalogError("Bölüm artık etkin sağlayıcıya ait değil.");
      return;
    }
    openResolvedPlayable({
      title: intent.title,
      subtitle: intent.subtitle,
      url: intent.url,
      kind: intent.kind,
      returnTo: "series",
      seriesIdentity: intent.identity,
      progressRef: {
        type: "stalker-episode",
        seriesId: intent.identity.seriesId,
        seasonId: intent.identity.seasonId,
        episodeId: intent.identity.episodeId,
      },
    });
  };

  const openProgress = async (item: MediaProgress) => {
    historyPlaybackAbortRef.current?.abort();
    const sequence = ++historyPlaybackSequenceRef.current;
    if (item.playbackRef.type === "stalker-episode") {
      if (item.providerId !== provider.id) {
        setCatalogError("Bölüm artık etkin sağlayıcıya ait değil.");
        return;
      }
      const abort = new AbortController();
      historyPlaybackAbortRef.current = abort;
      setCatalogError(null);
      try {
        const intent = await resolveStalkerSeriesHistoryEpisode(
          readCurrentStalkerProductSession(provider).session,
          provider.id,
          item.playbackRef,
          item.title,
          abort.signal,
        );
        if (abort.signal.aborted || sequence !== historyPlaybackSequenceRef.current) return;
        openResolvedPlayable({
          title: intent.title,
          subtitle: intent.subtitle,
          url: intent.url,
          kind: intent.kind,
          returnTo: "history",
          seriesIdentity: intent.identity,
          progressRef: item.playbackRef,
        });
      } catch (caught) {
        if (abort.signal.aborted || sequence !== historyPlaybackSequenceRef.current) return;
        setCatalogError(redactSensitiveText(
          caught instanceof Error ? caught.message : "Bölüm geçmişten yeniden açılamadı.",
        ));
      }
      return;
    }
    if (item.playbackRef.type === "stalker-vod") {
      const abort = new AbortController();
      historyPlaybackAbortRef.current = abort;
      setCatalogError(null);
      try {
        const { url } = await resolveStalkerVodHistoryLink(
          readCurrentStalkerProductSession(provider).session,
          {
            itemId: item.playbackRef.itemId,
            categoryId: item.playbackRef.categoryId,
          },
          { signal: abort.signal },
        );
        if (abort.signal.aborted || sequence !== historyPlaybackSequenceRef.current) return;
        openResolvedPlayable({
          title: item.title,
          subtitle: item.subtitle,
          url,
          kind: "movie",
          returnTo: "history",
          vodIdentity: { providerId: provider.id, itemId: item.playbackRef.itemId },
          progressRef: item.playbackRef,
        });
      } catch (caught) {
        if (abort.signal.aborted || sequence !== historyPlaybackSequenceRef.current) return;
        setCatalogError(redactSensitiveText(
          caught instanceof Error ? caught.message : "Film geçmişten yeniden açılamadı.",
        ));
      }
      return;
    }
    openResolvedPlayable({
      title: item.title,
      subtitle: item.subtitle,
      url: item.source,
      kind: item.kind,
      returnTo: "history",
    });
  };

  const switchProvider = async (id: string) => {
    if (id === provider.id) return;
    const target = providers.find((item) => item.id === id);
    if (!target) {
      setCatalogError("The saved provider could not be opened.");
      return;
    }
    if (target.needsCredentials) {
      setCatalogError("Credentials are required before this saved provider can be opened.");
      return;
    }
    const gate = tryBeginProviderSwitch(switchingProviderRef.current, id);
    if (!gate.started) return;
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

  const presentedView = view === "player" ? playable?.returnTo ?? "home" : view;

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
  const providerSwitchBusy = isLoading || switchingProviderId !== null;
  const visibleScopedError = presentedView === "live" && scopedError?.domain === "live-history" && scopedError.providerId === provider.id
    ? t(scopedError.messageKey)
    : null;

  return (
    <View
      style={[
        s.screen,
        {
          backgroundColor: colors.background,
          paddingTop: top,
          paddingBottom: Math.max(insets.bottom, 10),
        },
      ]}
    >
      <View
        style={[
          s.header,
          { borderColor: colors.border },
          presentedView === "home" ? s.homeHeaderPremium : null,
        ]}
      >
        <View style={s.headerTop}>
          <Text style={[s.brand, { color: colors.foreground }]}>
            LEGEND<Text style={{ color: colors.primary }}>STREAM</Text>
          </Text>
          <ProviderSubscriptionChip provider={provider} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.nav}>
          {nav.map((item) => (
            <FocusButton
              key={item.key}
              label={item.label}
              icon={item.icon}
              variant={presentedView === item.key ? "secondary" : "ghost"}
              onPress={() => navigate(item.key)}
            />
          ))}
        </ScrollView>
      </View>

      {error || catalogError || visibleScopedError ? (
        <View style={[s.error, { borderColor: colors.destructive, backgroundColor: colors.card }]}>
          <Text style={{ color: colors.destructive, flex: 1 }}>
            {visibleErrorText(error || catalogError || visibleScopedError)}
          </Text>
          <Pressable onPress={() => { clearError(); clearScopedError(); setCatalogError(null); }}>
            <Feather name="x" size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>
      ) : null}

      {presentedView === "live" ? (
        <PagedLiveCatalog
          provider={provider}
          snapshotCount={{ totalCount: liveCatalog.totalCount, countKnown: liveCatalog.countKnown }}
          hasMeaningfulM3ULiveGroups={null}
          epgByChannel={epgByChannel}
          favorites={favorites}
          epgLoading={isEpgLoading}
          refreshing={isLoading || liveCatalog.syncing}
          onRefresh={liveCatalog.refresh}
          onOpen={openLive}
          onFavorite={(id) => void toggleFavorite(id)}
          onDrawerVisibilityChange={setCatalogDrawerOpen}
        />
      ) : null}

      {presentedView === "movies" ? (
        <StalkerProductErrorBoundary product="movies" providerId={provider.id} onBack={() => navigate("home")}>
          <StalkerGoldenMoviesCatalog
            provider={provider}
            onPlayable={openMovie}
            onError={setCatalogError}
            onDrawerVisibilityChange={setCatalogDrawerOpen}
          />
        </StalkerProductErrorBoundary>
      ) : null}

      {presentedView === "series" ? (
        <StalkerProductErrorBoundary product="series" providerId={provider.id} onBack={() => navigate("home")}>
          <StalkerSeriesProductSurface provider={provider} onPlayable={openSeriesEpisode} onDrawerVisibilityChange={setCatalogDrawerOpen} />
        </StalkerProductErrorBoundary>
      ) : null}

      {presentedView === "history" ? (
        <HistoryView
          providerId={provider.id}
          channels={resolvedHistoryChannels}
          favorites={favorites}
          history={history}
          onOpen={openLive}
          onOpenMedia={openProgress}
        />
      ) : null}

      {presentedView !== "live" && presentedView !== "movies" && presentedView !== "series" && presentedView !== "history" ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEnabled={!catalogDrawerOpen}
        >
          {presentedView === "home" ? (
            <HomeDiscovery
              provider={provider}
              live={liveCatalog.countKnown ? liveCatalog.totalCount : null}
              vod={productCounts.vod}
              series={productCounts.series}
              vodCategories={0}
              seriesCategories={0}
              catalogLoading={liveCatalog.syncing && !liveCatalog.countKnown}
              channels={liveCatalog.channels}
              history={history}
              movies={homeSummary.movies}
              seriesItems={homeSummary.series}
              newChannels={[]}
              newMovies={[]}
              newSeries={[]}
              onNavigate={navigate}
              onOpenLive={openLive}
              onOpenMovie={() => navigate("movies")}
              onOpenSeries={() => navigate("series")}
              onOpenMedia={openProgress}
              onRemoveLive={(id) => void removeWatched(id)}
            />
          ) : null}
          {presentedView === "downloads" ? <DownloadsView onOpen={openDownload} /> : null}
          {presentedView === "settings" ? (
            <Settings
              provider={provider}
              providers={providers}
              busy={providerSwitchBusy}
              switchingProviderId={switchingProviderId}
              onSwitch={(id) => void switchProvider(id)}
              onDisconnect={() => { clearStalkerLiveRuntimeLocators(); void disconnectProvider(); }}
              onRemove={(id) => { clearStalkerLiveRuntimeLocators(); void removeProvider(id); }}
            />
          ) : null}
        </ScrollView>
      ) : null}

      {view === "player" && playable ? (
        <View style={s.fullPlayer}>
          <NativeVideoPlayer
            source={playable.url}
            title={playable.title}
            subtitle={playable.subtitle}
            mediaKind={playable.kind}
            liveIdentity={playable.liveIdentity}
            vodIdentity={playable.vodIdentity}
            progressRef={playable.progressRef}
            autoFullscreen
            allowDownload={playable.kind === "movie" || playable.kind === "episode"}
            onFullscreenExit={() => {
              setView(playable.returnTo);
              setPlayable(null);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

type HistorySectionRow = { key: string; channel: Channel };

function HistoryView({ providerId, channels, favorites, history, onOpen, onOpenMedia }: {
  providerId: string;
  channels: Channel[];
  favorites: string[];
  history: string[];
  onOpen: (channel: Channel) => void;
  onOpenMedia: (item: MediaProgress) => void;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const { entries, unscopedEntries } = useMediaLibrary();
  const channelIndex = useMemo(() => indexLiveChannelsByProviderAndId(channels), [channels]);
  const recent = useMemo(
    () => resolveLiveIdentityPresentationRows(providerId, history, channelIndex).map((channel, index) => ({ key: `history:${index}:${channel.id}`, channel })),
    [providerId, history, channelIndex],
  );
  const favs = useMemo(
    () => resolveLiveIdentityPresentationRows(providerId, favorites, channelIndex).map((channel, index) => ({ key: `favorite:${index}:${channel.id}`, channel })),
    [providerId, favorites, channelIndex],
  );
  const sections = useMemo(
    () => [
      { title: t("recentlyWatched"), data: recent },
      { title: t("favorites"), data: favs },
    ].filter((section) => section.data.length > 0),
    [recent, favs, t],
  );
  return (
    <SectionList<HistorySectionRow>
      style={{ flex: 1 }}
      contentContainerStyle={s.content}
      sections={sections}
      keyExtractor={(item) => item.key}
      ListHeaderComponent={
        <View>
          <Text style={[s.title, { color: colors.foreground }]}>{t("history")}</Text>
          <View style={{ marginBottom: 30 }}><ContinueWatchingView onOpen={onOpenMedia} showHeading={false} showEmpty={false} /></View>
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Text style={[s.section, { color: colors.foreground, marginBottom: 10 }]}>{section.title}</Text>
      )}
      renderItem={({ item }) => (
        <Pressable onPress={() => onOpen(item.channel)} style={[s.episode, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontWeight: "700" }}>{item.channel.name}</Text>
            <Text style={{ color: colors.mutedForeground }}>{item.channel.category}</Text>
          </View>
          <Feather name="play" size={20} color={colors.primary} />
        </Pressable>
      )}
      ListEmptyComponent={entries.length || unscopedEntries.length
        ? null
        : <Text style={{ color: colors.mutedForeground }}>{t("nothingYet")}</Text>}
      initialNumToRender={24}
      maxToRenderPerBatch={24}
      windowSize={9}
      removeClippedSubviews={Platform.OS !== "web"}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    />
  );
}

function Settings({ provider, providers, busy, switchingProviderId, onSwitch, onDisconnect, onRemove }: {
  provider: ProviderConfig;
  providers: ProviderConfig[];
  busy: boolean;
  switchingProviderId: string | null;
  onSwitch: (id: string) => void;
  onDisconnect: () => void;
  onRemove: (id: string) => void;
}) {
  const colors = useColors();
  const { t, language, languages, setLanguage } = useI18n();
  return (
    <View>
      <Text style={[s.title, { color: colors.foreground }]}>{t("settings")}</Text>
      <View style={[s.settings, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Text style={{ color: colors.foreground, fontWeight: "800", fontSize: 16 }}>{t("activeConnection")}</Text>
        <Text style={{ color: colors.foreground }}>{provider.name}</Text>
        <Text style={{ color: colors.mutedForeground }}>
          {(provider.declaredType ?? provider.type).toUpperCase()} · {provider.channelCount ?? 0}
        </Text>
        <View style={s.row}>
          <FocusButton label={t("editSource")} icon="edit-2" onPress={() => undefined} disabled />
          <FocusButton label={t("addAccount")} icon="plus" onPress={() => undefined} disabled />
          <FocusButton label={t("disconnect")} icon="log-out" variant="ghost" onPress={onDisconnect} />
        </View>
      </View>
      <View style={{ marginTop: 24 }}>
        <Text style={[s.section, { color: colors.foreground }]}>{t("language")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
          {languages.map((item) => (
            <FocusButton
              key={item.code}
              label={item.label}
              variant={language === item.code ? "secondary" : "ghost"}
              onPress={() => void setLanguage(item.code)}
            />
          ))}
        </ScrollView>
      </View>
      <PlayerChromeTimeoutSetting />
      <ProviderBackupPanel />
      <CredentialDiagnosticsPanel />
      <View style={{ marginTop: 24 }}>
        <Text style={[s.section, { color: colors.foreground }]}>{t("savedAccounts")}</Text>
        <View style={{ gap: 8 }}>
          {providers.map((item) => {
            const active = item.id === provider.id;
            const switching = switchingProviderId === item.id;
            return (
              <View key={item.id} style={[s.accountCard, {
                borderColor: switching || active ? colors.primary : colors.border,
                backgroundColor: colors.card,
                opacity: busy && !switching && !active ? 0.6 : 1,
              }]}>
                <Pressable disabled={busy} onPress={() => onSwitch(item.id)} style={{ flex: 1 }}>
                  <View style={s.rowBetween}>
                    <Text style={{ color: colors.foreground, fontWeight: "800", flex: 1 }}>
                      {item.name}{active ? ` · ${t("active")}` : ""}
                    </Text>
                    {switching
                      ? <ActivityIndicator size="small" color={colors.primary} />
                      : active
                        ? <Feather name="check-circle" size={18} color={colors.primary} />
                        : null}
                  </View>
                  <Text style={{ color: item.needsCredentials ? colors.destructive : switching ? colors.primary : colors.mutedForeground }}>
                    {switching ? t("opening") : item.needsCredentials ? t("credentialsMissing") : providerPresentation(item).meta}
                  </Text>
                  <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    {providerPresentation(item).host}
                  </Text>
                </Pressable>
                <Pressable disabled={busy} onPress={() => onRemove(item.id)} style={s.iconButton}>
                  <Feather name="trash-2" size={20} color={colors.mutedForeground} />
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  fullPlayer: { ...StyleSheet.absoluteFillObject, zIndex: 100, backgroundColor: "#000" },
  content: { padding: 18, paddingBottom: 40, maxWidth: 1500, width: "100%", alignSelf: "center" },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingBottom: 8 },
  homeHeaderPremium: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 10 },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  nav: { gap: 6, paddingVertical: 4 },
  brand: { fontSize: 18, fontWeight: "900", letterSpacing: 1 },
  error: { margin: 12, borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: "row", gap: 8, alignItems: "center" },
  title: { fontSize: 28, fontWeight: "800", marginBottom: 6 },
  section: { fontSize: 20, fontWeight: "800" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  rowBetween: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconButton: { padding: 10 },
  accountCard: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  settings: { borderWidth: 1, borderRadius: 16, padding: 18, gap: 8 },
  rail: { gap: 6, paddingVertical: 14 },
  episode: { borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
});
