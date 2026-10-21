import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { usePlayer, type Channel } from "@/context/PlayerContext";
import { useCatalogSync } from "@/context/CatalogSyncContext";
import { NativeVideoPlayer } from "@/components/NativeVideoPlayer";
import { resolveCatalogPlaybackSource } from "@/lib/catalogRuntime";
import {
  createEliteHomeItems,
  type EliteHomeItem,
} from "@/lib/eliteV4HomeModel";
import type { CatalogPlaybackIdentity } from "@/lib/catalogPageRepository";
import type { LiveChannelIdentity } from "@/lib/playerLiveQueue";
import { EliteV4Home } from "./EliteV4Home";
import { EliteV4Sidebar } from "./EliteV4Sidebar";
import { EliteV4FocusSurface, useEliteV4Focus } from "./EliteV4FocusSurface";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";

type ActivePlayback = {
  url: string;
  title: string;
  subtitle?: string;
  kind: "live" | "movie";
  vodIdentity?: CatalogPlaybackIdentity;
  liveIdentity?: LiveChannelIdentity;
};

function EliteV4TvShellContent({ onReturnToV3 }: { onReturnToV3: () => void }) {
  const { provider, channels, recordWatched } = usePlayer();
  const { snapshot, hasUsableCache, isSyncing } = useCatalogSync();
  const focus = useEliteV4Focus();
  const [playback, setPlayback] = useState<ActivePlayback | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const providerIdRef = useRef(provider?.id ?? null);
  const returnFocusIdRef = useRef("hero");
  useEffect(() => {
    providerIdRef.current = provider?.id ?? null;
  }, [provider?.id]);

  const currentSnapshot =
    provider && snapshot.providerId === provider.id ? snapshot : null;
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
      .slice(0, 12);
  }, [channels, currentSnapshot, hasUsableCache, provider?.id]);
  const items = useMemo(
    () => createEliteHomeItems(movies, liveItems),
    [movies, liveItems],
  );
  const providerName = provider?.name?.trim() || "İçerik sağlayıcısı";

  const openItem = async (item: EliteHomeItem) => {
    if (!provider) return;
    const ownerId = provider.id;
    returnFocusIdRef.current = focus.focusedId ?? "hero";
    setPlaybackError(null);
    try {
      if (item.kind === "movie" && item.movie) {
        const resolved = await resolveCatalogPlaybackSource(
          { kind: "movie", item: item.movie },
          provider,
        );
        if (providerIdRef.current !== ownerId) return;
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
      if (!channel) return;
      const url =
        provider.type === "stalker"
          ? channel.streamUrl
          : (
              await resolveCatalogPlaybackSource(
                { kind: "live", item: channel },
                provider,
              )
            ).url;
      if (providerIdRef.current !== ownerId) return;
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
      if (providerIdRef.current === ownerId)
        setPlaybackError(
          "İçerik başlatılamadı. Sağlayıcı kaynağını kontrol edip yeniden deneyin.",
        );
    }
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
      <EliteV4Sidebar onReturnToV3={onReturnToV3} />
      <View
        style={{
          flex: 1,
          minWidth: 0,
          backgroundColor: theme.color.background,
        }}
      >
        <EliteV4Home
          items={items}
          providerName={providerName}
          providerId={provider.id}
          providerType={provider.type}
          loading={isSyncing || (!currentSnapshot?.ready && !hasUsableCache)}
          onOpen={(item) => void openItem(item)}
        />
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
        {!items.length && isSyncing ? (
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
            vodIdentity={playback.vodIdentity}
            liveIdentity={playback.liveIdentity}
            autoFullscreen
            allowDownload={playback.kind === "movie"}
            onFullscreenExit={() => {
              setPlayback(null);
              requestAnimationFrame(() => {
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
