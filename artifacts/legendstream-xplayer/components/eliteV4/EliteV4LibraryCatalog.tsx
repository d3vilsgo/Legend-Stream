import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Image,
  Platform,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  usePlayer,
  selectProgramsAt,
  type Channel,
} from "@/context/PlayerContext";
import {
  useMediaLibrary,
  type MediaProgress,
} from "@/context/MediaLibraryContext";
import { useResolvedLiveIdentityChannels } from "@/hooks/useResolvedLiveIdentityChannels";
import { useOptionalTVPreviewFocus } from "@/components/tvPreview/TVPreviewFocus";
import { hasPlayerBackOwner } from "@/lib/playerRemoteOwnership";
import {
  favoriteForProgress,
  canResumeLibraryProgress,
  progressCaption,
  type LibraryTarget,
} from "@/lib/eliteV4Library";
import { resumableProgress } from "@/lib/progressMutations";
import { contentFavoriteKey } from "@/lib/contentFavorites";
import { v4MoviesLayout } from "@/lib/eliteV4Movies";
import { EliteV4FocusButton, useEliteV4Focus } from "./EliteV4FocusSurface";
import { EliteV4FavoriteAction } from "./EliteV4FavoriteAction";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";
export type V4LibraryRow = {
  key: string;
  kind: "live" | "movie" | "series";
  title: string;
  subtitle?: string;
  time?: number;
  image?: string;
  channel?: Channel;
  progress?: MediaProgress;
  target?: LibraryTarget;
  removeIds?: string[];
};
export function historyRows(
  providerId: string,
  channels: readonly Channel[],
  history: readonly string[],
  entries: readonly MediaProgress[],
  times: Record<string, number> = {},
): V4LibraryRow[] {
  const live = history.flatMap((id) => {
    const channel = channels.find(
      (c) => c.id === id && c.providerId === providerId,
    );
    return channel
      ? [
          {
            key: `live:${id}`,
            kind: "live" as const,
            title: channel.name,
            image: channel.logoUrl,
            channel,
            time: times[id],
          },
        ]
      : [];
  });
  const sorted = entries
      .filter((e) => e.providerId === providerId)
      .sort((a, b) => b.updatedAt - a.updatedAt),
    seen = new Set<string>(),
    media: V4LibraryRow[] = [];
  for (const entry of sorted) {
    const target = favoriteForProgress(entry),
      key =
        entry.kind === "episode" && target
          ? `series:${target.catalogId}`
          : `media:${entry.id}`;
    const prior = media.find((item) => item.key === key);
    if (prior) {
      prior.removeIds!.push(entry.id);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    media.push({
      key,
      kind: entry.kind === "episode" ? "series" : "movie",
      title:
        entry.kind === "episode" ? entry.subtitle || entry.title : entry.title,
      subtitle: progressCaption(entry),
      time: entry.updatedAt,
      progress: entry,
      target: target ?? undefined,
      removeIds: [entry.id],
    });
  }
  return [...live, ...media].sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
}
export function EliteV4LibraryCatalog({
  mode,
  active = true,
  onBack,
  onResume,
  onDetail,
  onLive,
}: {
  mode: "history" | "favorites";
  active?: boolean;
  onBack: () => void;
  onResume: (item: MediaProgress, origin: string) => void;
  onDetail: (target: LibraryTarget, origin: string) => void;
  onLive: (channel: Channel, origin: string) => void;
}) {
  const player = usePlayer(),
    library = useMediaLibrary(),
    focus = useEliteV4Focus(),
    preview = useOptionalTVPreviewFocus(),
    dimensions = useWindowDimensions();
  const [filter, setFilter] = useState<"all" | "live" | "movie" | "series">(
      "all",
    ),
    [width, setWidth] = useState(dimensions.width - 68),
    [working, setWorking] = useState(false);
  const list = useRef<FlatList<V4LibraryRow[]>>(null),
    locked = useRef(false),
    alive = useRef(true),
    headerHeight = useRef(0),
    latest = useRef({ active, providerId: player.provider?.id, filter });
  latest.current = { active, providerId: player.provider?.id, filter };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const providerId = player.provider?.id ?? "",
    sidebar = `sidebar-${mode}`,
    prefix = `v4-${mode}-`;
  const ids = useMemo(
    () => (mode === "history" ? player.history : player.favorites),
    [mode, player.history, player.favorites],
  );
  const channels = useResolvedLiveIdentityChannels(
    player.provider,
    ids,
    player.channels,
  );
  const all =
    mode === "history"
      ? historyRows(
          providerId,
          channels,
          player.history,
          library.historyEntries ?? library.entries,
          player.historyTimes,
        )
      : ([
          ...player.favorites.flatMap((id) => {
            const channel = channels.find(
              (c) => c.id === id && c.providerId === providerId,
            );
            return channel
              ? [
                  {
                    key: `live:${id}`,
                    kind: "live" as const,
                    title: channel.name,
                    image: channel.logoUrl,
                    channel,
                  },
                ]
              : [];
          }),
          ...(player.mediaFavorites ?? [])
            .filter((item) => item.providerId === providerId)
            .map((target) => ({
              key: contentFavoriteKey(target),
              kind: target.kind,
              title: target.title,
              target,
              time: target.addedAt,
            })),
        ] as V4LibraryRow[]);
  const items = all.filter((item) => filter === "all" || item.kind === filter),
    layout = v4MoviesLayout(
      width,
      dimensions.height,
      dimensions.fontScale,
      Platform.isTV,
    ),
    rows: V4LibraryRow[][] = [];
  for (let i = 0; i < items.length; i += layout.columns)
    rows.push(items.slice(i, i + layout.columns));
  const owner = JSON.stringify([providerId, mode, filter]);
  const current = useRef({ owner, items });
  current.current = { owner, items };
  const id = (key: string) => prefix + encodeURIComponent(key);
  const valid = (row: V4LibraryRow) =>
    alive.current &&
    latest.current.active &&
    current.current.owner === owner &&
    current.current.items.some((item) => item.key === row.key);
  const back = () => {
    if (latest.current.active) onBack();
  };
  useEffect(() => {
    if (!active || !preview?.enabled) return;
    return preview.registerBackAction(back);
  }, [active, preview?.enabled, preview?.registerBackAction, onBack]);
  useEffect(() => {
    if (!active || !Platform.isTV) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (hasPlayerBackOwner()) return false;
      back();
      return true;
    });
    return () => sub.remove();
  }, [active, onBack]);
  const remove = async (row: V4LibraryRow) => {
    if (!valid(row) || locked.current) return;
    locked.current = true;
    setWorking(true);
    const index = items.findIndex((i) => i.key === row.key),
      next = items[index + 1] ?? items[index - 1];
    try {
      if (mode === "favorites") {
        if (row.channel) await player.toggleFavorite(row.channel.id);
        else if (row.target) await player.setMediaFavorite(row.target, false);
      } else if (row.channel) await player.removeWatched(row.channel.id);
      else if (row.removeIds)
        await library.removeProgressEntries(row.removeIds);
      if (
        alive.current &&
        latest.current.active &&
        latest.current.providerId === providerId
      )
        requestAnimationFrame(() => {
          if (
            !alive.current ||
            !latest.current.active ||
            latest.current.providerId !== providerId
          )
            return;
          focus.focus(next ? id(next.key) : `${prefix}filter-${filter}`);
        });
    } finally {
      locked.current = false;
      if (alive.current) setWorking(false);
    }
  };
  const button = (
    focusId: string,
    label: string,
    onPress: () => void,
    neighbors: { left?: string; right?: string; up?: string; down?: string },
    selected = false,
  ) => (
    <EliteV4FocusButton
      focusId={focusId}
      region="content"
      disabled={!active}
      selected={selected}
      onPress={onPress}
      neighbors={neighbors}
      style={{
        minHeight: 44,
        padding: 10,
        borderWidth: 1,
        borderColor: theme.color.border,
        borderRadius: 8,
        backgroundColor: theme.color.surface,
      }}
      accessibilityLabel={label}
    >
      <Text
        style={{
          color: selected ? theme.color.accent : theme.color.foreground,
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </EliteV4FocusButton>
  );
  const filters = [
    { id: "all" as const, title: "Tümü" },
    { id: "live" as const, title: "Canlı TV" },
    { id: "movie" as const, title: "Filmler" },
    { id: "series" as const, title: "Diziler" },
  ];
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ flex: 1, minWidth: 0, backgroundColor: theme.color.background }}
    >
      <FlatList
        ref={list}
        data={rows}
        key={`library-${layout.columns}`}
        keyExtractor={(row) => row[0].key}
        extraData={{ active, filter, working }}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={7}
        removeClippedSubviews={false}
        contentContainerStyle={{ padding: layout.padding, gap: 16 }}
        ListHeaderComponent={
          <View
            onLayout={(e) =>
              (headerHeight.current = e.nativeEvent.layout.height)
            }
            style={{ gap: 10 }}
          >
            <Text
              style={{
                color: theme.color.foreground,
                fontSize: 23,
                fontWeight: "600",
              }}
            >
              {mode === "history" ? "İzleme Geçmişi" : "Favorilerim"} ·{" "}
              {items.length}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {filters.map((item, index) =>
                button(
                  `${prefix}filter-${item.id}`,
                  item.title,
                  () => {
                    if (!active) return;
                    setFilter(item.id);
                    list.current?.scrollToOffset({
                      offset: 0,
                      animated: false,
                    });
                  },
                  {
                    left: index
                      ? `${prefix}filter-${filters[index - 1].id}`
                      : sidebar,
                    right:
                      index < 3
                        ? `${prefix}filter-${filters[index + 1].id}`
                        : `${prefix}back`,
                    down: items[0] ? id(items[0].key) : `${prefix}back`,
                  },
                  filter === item.id,
                ),
              )}
              {button(`${prefix}back`, "Ana Sayfa", back, {
                left: `${prefix}filter-series`,
                down: items[0] ? id(items[0].key) : sidebar,
              })}
              {mode === "history" && filter === "live" && items.length
                ? button(
                    `${prefix}clear`,
                    "Son izlenen kanalları temizle",
                    () => {
                      if (!active || locked.current) return;
                      locked.current = true;
                      void player.clearHistory().finally(() => {
                        locked.current = false;
                        if (
                          alive.current &&
                          latest.current.active &&
                          latest.current.providerId === providerId
                        )
                          focus.focus(`${prefix}filter-live`);
                      });
                    },
                    {
                      left: sidebar,
                      up: `${prefix}filter-live`,
                      down: id(items[0].key),
                    },
                  )
                : null}
            </View>
            {library.storageError ||
            player.favoriteError ||
            player.scopedError?.providerId === providerId ? (
              <Text
                accessibilityRole="alert"
                style={{ color: theme.color.danger, fontSize: 13 }}
              >
                {library.storageError ||
                  player.favoriteError ||
                  "Geçmiş kaydedilemedi. Yeniden deneyin."}
              </Text>
            ) : null}
            {!library.loaded && mode === "history" ? (
              <ActivityIndicator color={theme.color.accent} />
            ) : null}
            {library.storageError
              ? button(
                  `${prefix}retry`,
                  "Kayıtları yeniden oku",
                  library.retryStorage,
                  { left: sidebar, up: `${prefix}filter-all` },
                )
              : null}
          </View>
        }
        ListEmptyComponent={
          <Text style={{ color: theme.color.muted, paddingVertical: 16 }}>
            {mode === "history"
              ? "Bu görünümde izleme kaydı yok."
              : "Bu görünümde favori yok."}
          </Text>
        }
        onScrollToIndexFailed={(info) =>
          list.current?.scrollToOffset({
            offset: headerHeight.current + info.averageItemLength * info.index,
            animated: false,
          })
        }
        renderItem={({ item: row, index: rowIndex }) => (
          <View style={{ flexDirection: "row", gap: layout.gap }}>
            {row.map((item, column) => {
              const index = rowIndex * layout.columns + column,
                up = items[index - layout.columns],
                down = items[index + layout.columns],
                main = id(item.key),
                canResume =
                  item.progress &&
                  canResumeLibraryProgress(item.progress) &&
                  !!item.target;
              const launch = () => {
                if (!valid(item) || locked.current) return;
                if (item.channel) onLive(item.channel, main);
                else if (canResume) onResume(item.progress!, main);
                else if (item.target) onDetail(item.target, main);
              };
              const now = item.channel
                ? selectProgramsAt(
                    player.epgByChannel.get(item.channel.id),
                    Date.now(),
                  ).now
                : undefined;
              return (
                <View
                  key={item.key}
                  style={{
                    width: layout.cardWidth,
                    backgroundColor: theme.color.surface,
                    borderRadius: 12,
                    overflow: "hidden",
                  }}
                >
                  <EliteV4FocusButton
                    focusId={main}
                    region="content"
                    disabled={!active}
                    onPress={launch}
                    onFocused={() =>
                      list.current?.scrollToIndex({
                        index: rowIndex,
                        viewPosition: 0.3,
                        animated: false,
                      })
                    }
                    neighbors={{
                      left: column ? id(row[column - 1].key) : sidebar,
                      right: row[column + 1]
                        ? id(row[column + 1].key)
                        : undefined,
                      up: up ? id(up.key) : `${prefix}filter-${filter}`,
                      down: item.target ? `${main}:detail` : `${main}:remove`,
                    }}
                    accessibilityLabel={`${item.title}, ${item.channel ? "kanalı aç" : canResume ? "devam et" : "bilgiler"}`}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.color.border,
                      borderRadius: 12,
                      overflow: "hidden",
                    }}
                  >
                    {item.image ? (
                      <Image
                        source={{ uri: item.image }}
                        resizeMode="contain"
                        style={{ width: "100%", height: 120 }}
                      />
                    ) : (
                      <View
                        style={{
                          height: 120,
                          justifyContent: "center",
                          alignItems: "center",
                          backgroundColor: theme.color.surfaceRaised,
                        }}
                      >
                        <Text
                          style={{ color: theme.color.quiet, fontSize: 18 }}
                        >
                          {item.kind === "live"
                            ? "CANLI TV"
                            : item.kind === "series"
                              ? "DİZİ"
                              : "FİLM"}
                        </Text>
                      </View>
                    )}
                    <View style={{ padding: 10, minHeight: 110 }}>
                      <Text
                        numberOfLines={2}
                        style={{
                          color: theme.color.foreground,
                          fontSize: Platform.isTV ? 18 : 15,
                        }}
                      >
                        {item.title}
                      </Text>
                      <Text
                        numberOfLines={2}
                        style={{
                          color: theme.color.muted,
                          fontSize: 12,
                          marginTop: 5,
                        }}
                      >
                        {now?.title || item.subtitle || item.kind}
                        {item.time
                          ? ` · ${new Date(item.time).toLocaleString("tr-TR")}`
                          : ""}
                      </Text>
                      {item.progress && item.progress.duration > 0 ? (
                        <>
                          <Text
                            style={{ color: theme.color.muted, fontSize: 12 }}
                          >
                            {Math.floor(item.progress.position / 60)} /{" "}
                            {Math.floor(item.progress.duration / 60)} dk
                          </Text>
                          <View
                            style={{
                              height: 3,
                              backgroundColor: theme.color.surfaceRaised,
                              marginTop: 8,
                            }}
                          >
                            <View
                              style={{
                                height: 3,
                                width: `${Math.min(100, (100 * item.progress.position) / item.progress.duration)}%`,
                                backgroundColor: theme.color.accent,
                              }}
                            />
                          </View>
                        </>
                      ) : null}
                      <Text
                        style={{
                          color: theme.color.accent,
                          fontSize: 12,
                          marginTop: 7,
                        }}
                      >
                        {item.channel
                          ? "Kanalı aç"
                          : canResume
                            ? "Devam et"
                            : item.target
                              ? "Bilgiler"
                              : "Kaynak bilgisi eksik"}
                      </Text>
                    </View>
                  </EliteV4FocusButton>
                  {item.target
                    ? button(
                        `${main}:detail`,
                        "İçerik bilgileri",
                        () => {
                          if (valid(item))
                            onDetail(item.target!, `${main}:detail`);
                        },
                        { up: main, left: main, down: `${main}:favorite` },
                      )
                    : null}
                  {item.target && mode !== "favorites" ? (
                    <EliteV4FavoriteAction
                      target={item.target}
                      focusId={`${main}:favorite`}
                      disabled={!active}
                      neighbors={{
                        up: `${main}:detail`,
                        left: main,
                        down: `${main}:remove`,
                      }}
                    />
                  ) : null}
                  {button(
                    `${main}:remove`,
                    mode === "favorites"
                      ? "Favorilerden çıkar"
                      : "Geçmişten kaldır",
                    () => void remove(item),
                    {
                      up: item.target
                        ? mode === "favorites"
                          ? `${main}:detail`
                          : `${main}:favorite`
                        : main,
                      left: main,
                      down: down ? id(down.key) : `${prefix}filter-${filter}`,
                    },
                  )}
                </View>
              );
            })}
          </View>
        )}
      />
    </View>
  );
}
