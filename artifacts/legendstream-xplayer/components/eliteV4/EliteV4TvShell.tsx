import { EliteV4Settings } from "./EliteV4Settings";
import {
  useMediaLibrary,
  type MediaProgress,
} from "@/context/MediaLibraryContext";
import {
  continueWatching,
  favoriteForProgress,
  progressCaption,
  resolveLibraryProgress,
  resolveLibraryMovie,
  type LibraryTarget,
} from "@/lib/eliteV4Library";
import {
  readCurrentStalkerProductSession,
  isCurrentStalkerProductSession,
} from "@/lib/stalkerProductSession";
import { EliteV4LibraryCatalog } from "./EliteV4LibraryCatalog";
import { EliteV4LibraryDetail } from "./EliteV4LibraryDetail";
import type { V4Movie } from "@/lib/eliteV4Movies";
import type { EpisodeProgressContext } from "@/lib/mediaProgress";
import type { V4SeriesPlayable } from "./EliteV4SeriesCatalog";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { usePlayer, type Channel } from "@/context/PlayerContext";
import { useCatalogSync } from "@/context/CatalogSyncContext";
import { NativeVideoPlayer } from "@/components/NativeVideoPlayer";
import {
  resolveCatalogPlaybackSource,
  resolveCatalogRuntimeSource,
} from "@/lib/catalogRuntime";
import {
  createEliteHomeSections,
  type EliteHomeItem,
} from "@/lib/eliteV4HomeModel";
import { type MediaPlaybackRef } from "@/lib/mediaProgress";
import type { CatalogPlaybackIdentity } from "@/lib/catalogPageRepository";
import type { LiveChannelIdentity } from "@/lib/playerLiveQueue";
import { EliteV4SeriesCatalog } from "./EliteV4SeriesCatalog";
import { EliteV4MoviesCatalog } from "./EliteV4MoviesCatalog";
import { EliteV4LiveCatalog } from "./EliteV4LiveCatalog";
import { EliteV4Home } from "./EliteV4Home";
import { EliteV4Sidebar } from "./EliteV4Sidebar";
import { EliteV4FocusSurface, useEliteV4Focus } from "./EliteV4FocusSurface";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";

type ActivePlayback = {
  url: string;
  title: string;
  subtitle?: string;
  kind: "live" | "movie" | "episode";
  progressRef?: MediaPlaybackRef;
  episodeContext?: EpisodeProgressContext;
  detailOwner?: boolean;
  vodIdentity?: CatalogPlaybackIdentity;
  liveIdentity?: LiveChannelIdentity;
};

function EliteV4TvShellContent({ onReturnToV3 }: { onReturnToV3: () => void }) {
  const {
    provider,
    channels,
    recordWatched,
    favoriteError,
    mediaFavorites,
    favorites,
    setMediaFavorite,
    toggleFavorite,
  } = usePlayer();
  const favoriteRecords = useRef(mediaFavorites ?? []);
  favoriteRecords.current = mediaFavorites ?? [];
  const library = useMediaLibrary();
  const historyEntries = library.historyEntries ?? library.entries ?? [];
  const latestEntries = useRef(historyEntries);
  latestEntries.current = historyEntries;
  const { snapshot, hasUsableCache, isSyncing } = useCatalogSync();
  const focus = useEliteV4Focus();
  const [route, setRoute] = useState<
    "home" | "live" | "movies" | "series" | "history" | "favorites" | "settings"
  >("home");
  const libraryReturnRef = useRef<"home" | "settings">("home");
  const routeRef = useRef(route);
  routeRef.current = route;
  const [playback, setPlayback] = useState<ActivePlayback | null>(null);
  const activePlayback = useRef<ActivePlayback | null>(playback);
  activePlayback.current = playback;
  const openLock = useRef(false),
    openAbort = useRef<AbortController | null>(null);
  const commitPlayback = (value: ActivePlayback) => {
    activePlayback.current = value;
    setPlayback(value);
  };
  const clearPlayback = () => {
    activePlayback.current = null;
    setPlayback(null);
  };
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const progress = historyEntries;
  const [detail, setDetail] = useState<{
    target: LibraryTarget;
    origin: string;
  } | null>(null);
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const providerRef = useRef(provider);
  providerRef.current = provider;
  const libraryAbort = useRef<AbortController | null>(null),
    libraryLock = useRef(false);
  const providerIdRef = useRef(provider?.id ?? null);
  const returnFocusIdRef = useRef("hero");
  providerIdRef.current = provider?.id ?? null;
  const requestIdRef = useRef(0);
  useEffect(
    () => () => {
      requestIdRef.current += 1;
    },
    [],
  );

  const currentSnapshot =
    provider && snapshot.providerId === provider.id ? snapshot : null;
  useEffect(
    () => () => {
      libraryAbort.current?.abort();
      openAbort.current?.abort();
    },
    [],
  );
  useEffect(() => {
    requestIdRef.current += 1;
    openAbort.current?.abort();
    openLock.current = false;
    libraryAbort.current?.abort();
    libraryLock.current = false;
    setDetail(null);
    clearPlayback();
  }, [provider]);
  const movies =
    provider?.type === "stalker" ? [] : (currentSnapshot?.movies ?? []);
  const liveItems = useMemo(() => {
    const source =
      currentSnapshot && (currentSnapshot.live.length || hasUsableCache)
        ? currentSnapshot.live
        : channels;
    return source
      .filter(
        (channel) =>
          channel.providerId === provider?.id &&
          (channel.contentType ?? "live") === "live",
      )
      .slice(0, 24);
  }, [channels, currentSnapshot, hasUsableCache, provider?.id]);
  const baseSections = useMemo(
    () =>
      createEliteHomeSections(
        movies,
        liveItems,
        currentSnapshot?.series ?? [],
        currentSnapshot?.newMovies ?? [],
        progress,
      ),
    [movies, liveItems, currentSnapshot, progress],
  );
  const continuations = provider
    ? continueWatching(historyEntries, provider.id).slice(0, 12)
    : [];
  const sections = {
    ...baseSections,
    continueWatching: continuations.map((entry) => ({
      id: `progress-${entry.id}`,
      kind: entry.kind === "episode" ? ("series" as const) : ("movie" as const),
      title:
        entry.kind === "episode" ? entry.subtitle || entry.title : entry.title,
      subtitle: progressCaption(entry),
      progress: entry,
      progressFraction: entry.position / entry.duration,
    })),
  };
  const openDetail = (target: LibraryTarget, origin: string) => {
    if (!provider || target.providerId !== provider.id || playback) return;
    requestIdRef.current += 1;
    libraryAbort.current?.abort();
    libraryLock.current = false;
    const next = { target, origin };
    detailRef.current = next;
    setDetail(next);
    setPlaybackError(null);
  };
  const closeDetail = () => {
    const old = detailRef.current;
    requestIdRef.current += 1;
    libraryAbort.current?.abort();
    libraryLock.current = false;
    detailRef.current = null;
    setDetail(null);
    requestAnimationFrame(() => {
      if (old && providerIdRef.current === old.target.providerId) {
        const exists = favoriteRecords.current.some(
          (item) =>
            item.providerId === old.target.providerId &&
            item.kind === old.target.kind &&
            item.catalogId === old.target.catalogId,
        );
        focus.focus(
          routeRef.current === "favorites" && !exists
            ? "v4-favorites-filter-all"
            : old.origin,
        );
      }
    });
  };
  const beginLibraryRequest = () => {
    libraryAbort.current?.abort();
    const abort = new AbortController();
    libraryAbort.current = abort;
    return { abort, ticket: ++requestIdRef.current };
  };
  const resume = async (entry: MediaProgress, origin: string) => {
    if (
      !provider ||
      entry.providerId !== provider.id ||
      libraryLock.current ||
      playback ||
      !latestEntries.current.some(
        (e) => e.id === entry.id && e.providerId === provider.id,
      )
    )
      return;
    libraryLock.current = true;
    const { abort, ticket } = beginLibraryRequest();
    returnFocusIdRef.current = origin;
    setPlaybackError(null);
    let session: ReturnType<typeof readCurrentStalkerProductSession> | null =
      null;
    try {
      session =
        provider.type === "stalker"
          ? readCurrentStalkerProductSession({ ...provider, type: "stalker" })
          : null;
      const url = await resolveLibraryProgress(provider, entry, abort.signal);
      if (
        abort.signal.aborted ||
        ticket !== requestIdRef.current ||
        providerRef.current !== provider ||
        !latestEntries.current.some(
          (e) => e.id === entry.id && e.providerId === provider.id,
        ) ||
        (session &&
          !isCurrentStalkerProductSession(
            { ...provider, type: "stalker" },
            session.session,
          ))
      )
        return;
      commitPlayback({
        url,
        title: entry.title,
        subtitle: entry.subtitle,
        kind: entry.kind,
        progressRef: entry.playbackRef,
        episodeContext: entry.episodeContext,
      });
    } catch {
      if (!abort.signal.aborted && ticket === requestIdRef.current)
        setPlaybackError(
          "Kayıt yeniden açılamadı. Sağlayıcı kaynağını kontrol edin; kaydınız korundu.",
        );
    } finally {
      if (ticket === requestIdRef.current) libraryLock.current = false;
    }
  };
  const playLibraryMovie = async (movie: V4Movie) => {
    if (
      !provider ||
      libraryLock.current ||
      !detailRef.current ||
      movie.input.identity.providerId !== provider.id
    )
      return;
    libraryLock.current = true;
    const selection = detailRef.current,
      { abort, ticket } = beginLibraryRequest();
    try {
      const url = await resolveLibraryMovie(provider, movie, abort.signal);
      if (
        abort.signal.aborted ||
        ticket !== requestIdRef.current ||
        providerRef.current !== provider ||
        detailRef.current !== selection
      )
        return;
      const ref: MediaPlaybackRef =
        movie.source.kind === "stalker"
          ? {
              type: "stalker-vod",
              itemId: movie.id,
              categoryId: movie.source.item.categoryId || "",
            }
          : provider.type === "m3u"
            ? { type: "m3u-vod", itemId: movie.id }
            : {
                type: "xtream-vod",
                streamId: movie.id,
                containerExtension:
                  movie.source.item.container_extension || "mp4",
                sourceMode: movie.source.item.direct_source
                  ? "direct"
                  : "canonical",
              };
      commitPlayback({
        url,
        title: movie.title,
        kind: "movie",
        progressRef: ref,
        detailOwner: true,
        vodIdentity: { providerId: provider.id, itemId: movie.id },
      });
    } finally {
      if (ticket === requestIdRef.current) libraryLock.current = false;
    }
  };
  const playSeries = (value: V4SeriesPlayable) => {
    if (
      !provider ||
      value.providerId !== providerIdRef.current ||
      (routeRef.current !== "series" && !detailRef.current)
    )
      return;
    requestIdRef.current += 1;
    setPlaybackError(null);
    returnFocusIdRef.current = focus.focusedId ?? "v4-series-hero";
    commitPlayback({
      url: value.url,
      title: value.title,
      subtitle: value.subtitle,
      kind: "episode",
      progressRef: value.progressRef,
      episodeContext: value.episodeContext,
      detailOwner: !!detailRef.current,
    });
  };
  const providerName = provider?.name?.trim() || "İçerik sağlayıcısı";

  const openItem = async (item: EliteHomeItem, originFocusId?: string) => {
    if (item.progress) {
      void resume(item.progress, originFocusId ?? focus.focusedId ?? "hero");
      return;
    }
    if (openLock.current || activePlayback.current) return;
    const requestId = ++requestIdRef.current;
    if (item.kind === "series") {
      if (provider && item.series)
        openDetail(
          {
            providerId: provider.id,
            kind: "series",
            catalogId: String(item.series.series_id),
            title: item.title,
          },
          originFocusId ?? focus.focusedId ?? "hero",
        );
      return;
    }
    if (!provider) return;
    const ownerId = provider.id;
    const abort = new AbortController();
    openAbort.current?.abort();
    openAbort.current = abort;
    openLock.current = true;
    returnFocusIdRef.current = originFocusId ?? focus.focusedId ?? "hero";
    setPlaybackError(null);
    try {
      if (item.kind === "movie" && item.movie) {
        const resolved = await resolveCatalogPlaybackSource(
          { kind: "movie", item: item.movie },
          provider,
          abort.signal,
        );
        if (
          abort.signal.aborted ||
          providerRef.current !== provider ||
          providerIdRef.current !== ownerId ||
          requestIdRef.current !== requestId
        )
          return;
        commitPlayback({
          url: resolved.url,
          title: item.title,
          subtitle: item.subtitle,
          kind: "movie",
          progressRef:
            provider.type === "m3u"
              ? { type: "m3u-vod", itemId: String(item.movie.stream_id) }
              : {
                  type: "xtream-vod",
                  streamId: String(item.movie.stream_id),
                  containerExtension: item.movie.container_extension || "mp4",
                  sourceMode: item.movie.direct_source ? "direct" : "canonical",
                },
          vodIdentity: {
            providerId: ownerId,
            itemId: String(item.movie.stream_id),
          },
        });
        return;
      }
      const channel: Channel | undefined = item.channel;
      if (!channel || channel.providerId !== ownerId) return;
      const session =
        provider.type === "stalker"
          ? readCurrentStalkerProductSession({ ...provider, type: "stalker" })
          : null;
      const url =
        provider.type === "stalker"
          ? await resolveCatalogRuntimeSource(
              channel.streamUrl,
              provider,
              abort.signal,
            )
          : (
              await resolveCatalogPlaybackSource(
                { kind: "live", item: channel },
                provider,
                abort.signal,
              )
            ).url;
      if (!/^(https?|rtsp|rtmp):\/\//i.test(url))
        throw new Error("LIVE_SOURCE_UNRESOLVED");
      if (
        session &&
        !isCurrentStalkerProductSession(
          { ...provider, type: "stalker" },
          session.session,
        )
      )
        return;
      if (
        abort.signal.aborted ||
        providerRef.current !== provider ||
        providerIdRef.current !== ownerId ||
        requestIdRef.current !== requestId
      )
        return;
      commitPlayback({
        url,
        title: channel.name,
        subtitle: channel.category,
        kind: "live",
        liveIdentity: {
          providerId: channel.providerId,
          channelId: channel.id,
        },
      });
      void recordWatched(channel.id);
    } catch {
      if (
        providerIdRef.current === ownerId &&
        requestIdRef.current === requestId
      )
        setPlaybackError(
          "İçerik başlatılamadı. Sağlayıcı kaynağını kontrol edip yeniden deneyin.",
        );
    } finally {
      if (requestIdRef.current === requestId) openLock.current = false;
    }
  };

  const navigate = (
    next:
      | "home"
      | "live"
      | "movies"
      | "series"
      | "history"
      | "favorites"
      | "settings",
    returnTo: "home" | "settings" = "home",
  ) => {
    if (next === "history" || next === "favorites")
      libraryReturnRef.current = returnTo;
    openAbort.current?.abort();
    openLock.current = false;
    requestIdRef.current += 1;
    libraryAbort.current?.abort();
    libraryLock.current = false;
    detailRef.current = null;
    setDetail(null);
    routeRef.current = next;
    setRoute(next);
    setPlaybackError(null);
    requestAnimationFrame(() =>
      focus.focus(
        next === "settings"
          ? "v4-settings-category-accounts"
          : next === "history" || next === "favorites"
            ? `v4-${next}-filter-all`
            : next === "series"
              ? "v4-series-hero"
              : next === "live"
                ? "v4-live-search"
                : next === "movies"
                  ? "v4-movies-hero"
                  : "hero",
      ),
    );
  };

  if (!provider) return null;
  return (
    <View
      style={{
        flex: 1,
        minHeight: 0,
        flexDirection: "row",
        backgroundColor: theme.color.background,
      }}
    >
      <EliteV4Sidebar
        onReturnToV3={onReturnToV3}
        activeId={`sidebar-${route}`}
        contentFocusId={
          route === "settings"
            ? "v4-settings-category-accounts"
            : route === "history" || route === "favorites"
              ? `v4-${route}-filter-all`
              : route === "series"
                ? "v4-series-hero"
                : route === "live"
                  ? "v4-live-search"
                  : route === "movies"
                    ? "v4-movies-hero"
                    : "hero"
        }
        liveAvailable={
          provider.type === "xtream" ||
          provider.type === "m3u" ||
          provider.type === "stalker"
        }
        onNavigate={navigate}
      />
      <View
        style={{
          flex: 1,
          minWidth: 0,
          backgroundColor: theme.color.background,
        }}
      >
        {route === "settings" ? (
          <EliteV4Settings
            active={!playback && !detail}
            onBack={() => focus.focus("sidebar-settings")}
            onLibrary={(next) => navigate(next, "settings")}
          />
        ) : route === "history" || route === "favorites" ? (
          <EliteV4LibraryCatalog
            key={`${provider.id}:${route}`}
            mode={route}
            active={!playback && !detail}
            onBack={() => navigate(libraryReturnRef.current)}
            onResume={(entry, origin) => void resume(entry, origin)}
            onDetail={openDetail}
            onLive={(channel, origin) =>
              void openItem(
                { id: channel.id, kind: "live", title: channel.name, channel },
                origin,
              )
            }
          />
        ) : route === "series" ? (
          <EliteV4SeriesCatalog
            key={provider.id}
            active={!playback && !detail}
            onBack={() => navigate("home")}
            onPlayable={playSeries}
          />
        ) : route === "live" ? (
          <EliteV4LiveCatalog
            key={provider.id}
            active={!playback && !detail}
            onBack={() => navigate("home")}
            onOpen={(channel) =>
              void openItem(
                {
                  id: `live-${channel.id}`,
                  kind: "live",
                  title: channel.name,
                  channel,
                },
                `v4-live-channel:${channel.id}`,
              )
            }
          />
        ) : route === "movies" ? (
          <EliteV4MoviesCatalog
            active={!playback && !detail}
            onBack={() => navigate("home")}
            onPlay={(movie, origin) => {
              if (movie.source.kind === "paged")
                void openItem(
                  {
                    id: `movie-${movie.id}`,
                    kind: "movie",
                    title: movie.title,
                    movie: movie.source.item,
                  },
                  origin,
                );
            }}
            onStalkerPlayable={(movie, origin) => {
              if (
                provider.type !== "stalker" ||
                providerIdRef.current !== provider.id ||
                routeRef.current !== "movies"
              )
                return;
              requestIdRef.current += 1;
              setPlaybackError(null);
              returnFocusIdRef.current = origin;
              commitPlayback({
                url: movie.url,
                title: movie.title,
                subtitle: movie.subtitle,
                kind: "movie",
                progressRef: {
                  type: "stalker-vod",
                  itemId: movie.itemId,
                  categoryId: movie.categoryId,
                },
                vodIdentity: { providerId: provider.id, itemId: movie.itemId },
              });
            }}
          />
        ) : (
          <EliteV4Home
            sections={sections}
            providerName={providerName}
            providerId={provider.id}
            providerType={provider.type}
            loading={isSyncing || (!currentSnapshot?.ready && !hasUsableCache)}
            onOpen={(item, origin) => {
              if (
                origin &&
                item.kind === "movie" &&
                item.movie &&
                !item.progress &&
                provider
              ) {
                openDetail(
                  {
                    providerId: provider.id,
                    kind: "movie",
                    catalogId: String(item.movie.stream_id),
                    title: item.title,
                  },
                  origin,
                );
              } else void openItem(item, origin ?? "hero");
            }}
            isFavorite={(item) =>
              item.channel
                ? (favorites ?? []).includes(item.channel.id)
                : (mediaFavorites ?? []).some(
                    (value) =>
                      value.providerId === provider.id &&
                      value.kind ===
                        (item.kind === "series" ? "series" : "movie") &&
                      value.catalogId ===
                        String(item.movie?.stream_id ?? item.series?.series_id),
                  )
            }
            onFavorite={(item) => {
              if (providerRef.current !== provider) return;
              if (item.channel) {
                void toggleFavorite?.(item.channel.id);
                return;
              }
              const id = item.movie?.stream_id ?? item.series?.series_id;
              if (id === undefined) return;
              const target = {
                providerId: provider.id,
                kind:
                  item.kind === "series"
                    ? ("series" as const)
                    : ("movie" as const),
                catalogId: String(id),
                title: item.title,
              };
              const selected = favoriteRecords.current.some(
                (value) =>
                  value.providerId === target.providerId &&
                  value.kind === target.kind &&
                  value.catalogId === target.catalogId,
              );
              void setMediaFavorite?.(target, !selected);
            }}
            onProgressInfo={(item, origin) => {
              const target = item.progress
                ? favoriteForProgress(item.progress)
                : null;
              if (target) openDetail(target, origin);
              else
                setPlaybackError("Bu eski kaydın katalog kimliği bulunmuyor.");
            }}
            onProgressRemove={(item, index) => {
              if (!item.progress) return;
              const target = favoriteForProgress(item.progress),
                ids = latestEntries.current
                  .filter(
                    (e) =>
                      e.id === item.progress!.id ||
                      (target?.kind === "series" &&
                        favoriteForProgress(e)?.catalogId === target.catalogId),
                  )
                  .map((e) => e.id);
              void library
                .removeProgressEntries(ids)
                .then(() =>
                  requestAnimationFrame(() =>
                    focus.focus(
                      continuations.length > 1
                        ? `continue-${Math.min(index, continuations.length - 2)}`
                        : "hero",
                    ),
                  ),
                );
            }}
          />
        )}
        {detail ? (
          <EliteV4LibraryDetail
            key={JSON.stringify([
              provider.id,
              detail.target.kind,
              detail.target.catalogId,
            ])}
            target={detail.target}
            active={!playback}
            onClose={closeDetail}
            onMovie={playLibraryMovie}
            onSeries={playSeries}
          />
        ) : null}
        {favoriteError || library.storageError ? (
          <Text
            accessibilityRole="alert"
            style={{ color: theme.color.danger, padding: 12 }}
          >
            {favoriteError || library.storageError}
          </Text>
        ) : null}
        {playbackError ? (
          <Text
            accessibilityRole="alert"
            style={{
              position: "absolute",
              bottom: 18,
              right: 28,
              color: theme.color.danger,
              backgroundColor: theme.color.surfaceGlass,
              padding: 14,
              borderRadius: theme.radius.medium,
            }}
          >
            {playbackError}
          </Text>
        ) : null}
        {!sections.featured.length && !sections.live.length && isSyncing ? (
          <ActivityIndicator
            color={theme.color.accent}
            style={{ position: "absolute", bottom: 24, right: 32 }}
          />
        ) : null}
      </View>
      {playback ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            zIndex: 100,
            elevation: 100,
            backgroundColor: "#000",
          }}
        >
          <NativeVideoPlayer
            key={`${provider.id}:${playback.url}`}
            source={playback.url}
            title={playback.title}
            subtitle={playback.subtitle}
            mediaKind={playback.kind}
            progressRef={playback.progressRef}
            episodeContext={playback.episodeContext}
            vodIdentity={playback.vodIdentity}
            liveIdentity={playback.liveIdentity}
            autoFullscreen
            allowDownload={playback.kind === "movie"}
            onFullscreenExit={() => {
              if (activePlayback.current !== playback) return;
              const origin = returnFocusIdRef.current,
                exitRoute = routeRef.current;
              requestIdRef.current += 1;
              clearPlayback();
              requestAnimationFrame(() => {
                if (
                  !activePlayback.current &&
                  providerRef.current === provider &&
                  routeRef.current === exitRoute &&
                  !playback.detailOwner &&
                  !(
                    playback.kind === "episode" && routeRef.current === "series"
                  )
                )
                  focus.focus(origin);
              });
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

export function EliteV4TvShell({ onReturnToV3 }: { onReturnToV3: () => void }) {
  return (
    <EliteV4FocusSurface initialFocusId="hero">
      <EliteV4TvShellContent onReturnToV3={onReturnToV3} />
    </EliteV4FocusSurface>
  );
}
