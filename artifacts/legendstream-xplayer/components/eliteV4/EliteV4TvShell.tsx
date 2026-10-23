import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePlayer, type Channel } from "@/context/PlayerContext";
import { useCatalogSync } from "@/context/CatalogSyncContext";
import { NativeVideoPlayer } from "@/components/NativeVideoPlayer";
import { resolveCatalogPlaybackSource } from "@/lib/catalogRuntime";
import {
  createEliteHomeSections,
  type EliteHomeItem,
} from "@/lib/eliteV4HomeModel";
import {
  MEDIA_PROGRESS_V2_STORAGE_KEY,
  mediaProgressForProvider,
  parseMediaProgressV2Payload,
  type MediaProgressV2,
  type MediaPlaybackRef,
} from "@/lib/mediaProgress";
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
  vodIdentity?: CatalogPlaybackIdentity;
  liveIdentity?: LiveChannelIdentity;
};

function EliteV4TvShellContent({ onReturnToV3 }: { onReturnToV3: () => void }) {
  const { provider, channels, recordWatched } = usePlayer();
  const { snapshot, hasUsableCache, isSyncing } = useCatalogSync();
  const focus = useEliteV4Focus();
  const [route, setRoute] = useState<"home" | "live" | "movies" | "series">(
    "home",
  );
  const routeRef = useRef(route);
  routeRef.current = route;
  const [playback, setPlayback] = useState<ActivePlayback | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [progress, setProgress] = useState<MediaProgressV2[]>([]);
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
  useEffect(() => {
    let active = true;
    setProgress([]);
    if (!provider?.id)
      return () => {
        active = false;
      };
    void AsyncStorage.getItem(MEDIA_PROGRESS_V2_STORAGE_KEY)
      .then((raw) => {
        if (!active || !raw) return;
        const parsed = parseMediaProgressV2Payload(raw);
        setProgress(mediaProgressForProvider(parsed, provider.id));
      })
      .catch(() => {
        if (active) setProgress([]);
      });
    return () => {
      active = false;
    };
  }, [provider?.id]);
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
  const sections = useMemo(
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
  const providerName = provider?.name?.trim() || "İçerik sağlayıcısı";

  const openItem = async (item: EliteHomeItem, originFocusId?: string) => {
    const requestId = ++requestIdRef.current;
    if (item.kind === "series") {
      navigate("series");
      return;
    }
    if (!provider) return;
    const ownerId = provider.id;
    returnFocusIdRef.current = originFocusId ?? focus.focusedId ?? "hero";
    setPlaybackError(null);
    try {
      if (item.kind === "movie" && item.movie) {
        const resolved = await resolveCatalogPlaybackSource(
          { kind: "movie", item: item.movie },
          provider,
        );
        if (
          providerIdRef.current !== ownerId ||
          requestIdRef.current !== requestId
        )
          return;
        setPlayback({
          url: resolved.url,
          title: item.title,
          subtitle: item.subtitle,
          kind: "movie",
          vodIdentity: {
            providerId: ownerId,
            itemId: String(item.movie.stream_id),
          },
        });
        return;
      }
      const channel: Channel | undefined = item.channel;
      if (!channel || channel.providerId !== ownerId) return;
      const url =
        provider.type === "stalker"
          ? channel.streamUrl
          : (
              await resolveCatalogPlaybackSource(
                { kind: "live", item: channel },
                provider,
              )
            ).url;
      if (
        providerIdRef.current !== ownerId ||
        requestIdRef.current !== requestId
      )
        return;
      setPlayback({
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
    }
  };

  const navigate = (next: "home" | "live" | "movies" | "series") => {
    requestIdRef.current += 1;
    routeRef.current = next;
    setRoute(next);
    setPlaybackError(null);
    requestAnimationFrame(() =>
      focus.focus(
        next === "series"
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
          route === "series"
            ? "v4-series-hero"
            : route === "live"
              ? "v4-live-search"
              : route === "movies"
                ? "v4-movies-hero"
                : "hero"
        }
        liveAvailable={provider.type === "xtream" || provider.type === "m3u"}
        onNavigate={navigate}
      />
      <View
        style={{
          flex: 1,
          minWidth: 0,
          backgroundColor: theme.color.background,
        }}
      >
        {route === "series" ? (
          <EliteV4SeriesCatalog
            key={provider.id}
            active={!playback}
            onBack={() => navigate("home")}
            onPlayable={(value) => {
              if (
                value.providerId !== providerIdRef.current ||
                routeRef.current !== "series"
              )
                return;
              requestIdRef.current += 1;
              setPlaybackError(null);
              returnFocusIdRef.current = focus.focusedId ?? "v4-series-hero";
              setPlayback({
                url: value.url,
                title: value.title,
                subtitle: value.subtitle,
                kind: "episode",
                progressRef: value.progressRef,
              });
            }}
          />
        ) : route === "live" ? (
          <EliteV4LiveCatalog
            key={provider.id}
            active={!playback}
            onBack={() => navigate("home")}
            onOpen={(channel) =>
              void openItem({
                id: `live-${channel.id}`,
                kind: "live",
                title: channel.name,
                channel,
              })
            }
          />
        ) : route === "movies" ? (
          <EliteV4MoviesCatalog
            active={!playback}
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
              setPlayback({
                url: movie.url,
                title: movie.title,
                subtitle: movie.subtitle,
                kind: "movie",
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
            onOpen={(item) => void openItem(item)}
          />
        )}
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
            source={playback.url}
            title={playback.title}
            subtitle={playback.subtitle}
            mediaKind={playback.kind}
            progressRef={playback.progressRef}
            vodIdentity={playback.vodIdentity}
            liveIdentity={playback.liveIdentity}
            autoFullscreen
            allowDownload={playback.kind === "movie"}
            onFullscreenExit={() => {
              requestIdRef.current += 1;
              setPlayback(null);
              requestAnimationFrame(() => {
                if (playback.kind !== "episode")
                  focus.focus(returnFocusIdRef.current);
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
