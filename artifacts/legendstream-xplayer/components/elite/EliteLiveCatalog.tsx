import React, { useEffect, useReducer, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { TVPreviewPressable } from "@/components/tvPreview/TVPreviewFocus";
import { selectProgramsAt } from "@/context/PlayerContext";
import type { Channel, EpgProgram } from "@/lib/iptv";
import { eliteTokens as tokens } from "@/lib/design/eliteTokens";
import {
  eliteLiveInitial,
  eliteLiveReduce,
  eliteLiveLayout,
  eliteLiveSelection,
  eliteLiveSurfaces,
} from "@/lib/design/eliteLiveLayout";

/** Native-TV-only presentation adapter. Providers, playback and Back ownership remain outside. */
export function EliteLiveCatalog({
  categories,
  category,
  onCategory,
  channels,
  epgByChannel,
  clock,
  favorites,
  loading,
  loadingMore,
  search,
  onSearch,
  onRefresh,
  onLoadMore,
  onOpen,
  onFavorite,
  idPrefix,
}: {
  categories: readonly { id: string; name: string }[];
  category: string | null;
  onCategory: (id: string) => void;
  channels: Channel[];
  epgByChannel: ReadonlyMap<string, readonly EpgProgram[]>;
  clock: number;
  favorites: string[];
  loading: boolean;
  loadingMore: boolean;
  search: string;
  onSearch: (value: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onOpen: (channel: Channel) => void;
  onFavorite: (id: string) => void;
  idPrefix: string;
}) {
  const [bounds, setBounds] = useState({ width: 960, height: 540 });
  const [{ panelOpen, selectedId }, dispatch] = useReducer(
    eliteLiveReduce,
    eliteLiveInitial,
  );
  const list = useRef<FlatList<Channel>>(null);
  const scrolled = useRef(false);
  const selected = eliteLiveSelection(channels, selectedId);
  const { fontScale } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const geometry = eliteLiveLayout({ ...bounds, fontScale, safeArea });
  useEffect(() => {
    dispatch({ type: "reset" });
    scrolled.current = false;
  }, [category, search]);
  const programs = selected
    ? selectProgramsAt(epgByChannel.get(selected.id), clock)
    : {};
  const text = { color: tokens.color.text, fontSize: geometry.bodyFont };
  const meta = { color: tokens.color.muted, fontSize: geometry.metaFont };
  const button = (
    id: string,
    label: string,
    action: () => void,
    disabled = false,
  ) => (
    <TVPreviewPressable
      eliteVisual
      focusId={`${idPrefix}:${id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={action}
      style={s.action}
    >
      <Text style={[text, disabled && { color: tokens.color.muted }]}>
        {label}
      </Text>
    </TVPreviewPressable>
  );
  const time = (program: EpgProgram) =>
    `${new Date(program.start).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} – ${new Date(program.end).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`;
  return (
    <View
      style={[
        s.root,
        {
          paddingLeft: geometry.left,
          paddingRight: geometry.right,
          paddingBottom: geometry.bottom,
        },
      ]}
      onLayout={(e) => setBounds(e.nativeEvent.layout)}
    >
      <View style={s.toolbar}>
        <Text style={[text, { fontSize: 26, fontWeight: "800", flex: 1 }]}>
          Canlı TV
        </Text>
        {button(
          "panel",
          panelOpen ? "Kanal panelini kapat" : "Kanal panelini aç",
          () => dispatch({ type: "togglePanel" }),
        )}
        {button("refresh", "Yenile", onRefresh, loading)}
      </View>
      <View style={[s.body, geometry.stacked && { flexDirection: "column" }]}>
        {panelOpen ? (
          <View
            style={[
              s.panel,
              geometry.stacked
                ? { flex: 1 }
                : {
                    width: geometry.categoryWidth + geometry.channelWidth + 12,
                  },
            ]}
          >
            <ScrollView
              style={{ width: geometry.categoryWidth, flexGrow: 0 }}
              contentContainerStyle={s.column}
            >
              <Text style={meta}>Kategoriler</Text>
              {categories.map((item) => (
                <TVPreviewPressable
                  key={item.id}
                  eliteVisual
                  focusId={`${idPrefix}:category:${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={item.name}
                  accessibilityState={{ selected: category === item.id }}
                  onPress={() => onCategory(item.id)}
                  style={[
                    s.category,
                    { minHeight: geometry.rowHeight },
                    category === item.id && {
                      backgroundColor: tokens.color.selected,
                    },
                  ]}
                >
                  <Text numberOfLines={2} style={text}>
                    {item.name}
                  </Text>
                </TVPreviewPressable>
              ))}
            </ScrollView>
            <View style={{ flex: 1, minWidth: 0 }}>
              <TextInput
                accessibilityLabel="Kanal ara"
                placeholder="Kanal ara…"
                placeholderTextColor={tokens.color.muted}
                editable={category !== null}
                value={search}
                onChangeText={onSearch}
                style={[s.search, text]}
              />
              <FlatList
                ref={list}
                data={channels}
                keyExtractor={(item) => item.id}
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 8 }}
                removeClippedSubviews={false}
                initialNumToRender={12}
                maxToRenderPerBatch={12}
                windowSize={9}
                onScroll={(e) => {
                  if (e.nativeEvent.contentOffset.y > 0)
                    scrolled.current = true;
                }}
                scrollEventThrottle={16}
                onEndReached={() => {
                  if (scrolled.current) onLoadMore();
                }}
                onEndReachedThreshold={0.45}
                ListEmptyComponent={
                  <Text style={[meta, { padding: 12 }]}>
                    {loading
                      ? "Kanallar yükleniyor…"
                      : category === null
                        ? "Bir kategori seçin"
                        : "Kanal bulunamadı"}
                  </Text>
                }
                ListFooterComponent={
                  loadingMore ? (
                    <ActivityIndicator color={tokens.color.accent} />
                  ) : null
                }
                extraData={{ selectedId, epgByChannel, clock, favorites }}
                renderItem={({ item, index }) => {
                  const now = selectProgramsAt(
                    epgByChannel.get(item.id),
                    clock,
                  ).now;
                  return (
                    <TVPreviewPressable
                      eliteVisual
                      focusId={`${idPrefix}:channel:${item.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.name}, kanal bilgilerini seç`}
                      accessibilityState={{ selected: selectedId === item.id }}
                      onFocus={() =>
                        list.current?.scrollToIndex({
                          index,
                          animated: false,
                          viewPosition: 0.5,
                        })
                      }
                      onPress={() => dispatch({ type: "select", id: item.id })}
                      style={[
                        s.channel,
                        { minHeight: geometry.rowHeight },
                        selectedId === item.id && {
                          backgroundColor: tokens.color.selected,
                        },
                      ]}
                    >
                      <ChannelLogo channel={item} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          numberOfLines={2}
                          style={[text, { fontWeight: "700" }]}
                        >
                          {item.name}
                        </Text>
                        <Text numberOfLines={2} style={meta}>
                          {now?.title ?? "Program bilgisi yok"}
                        </Text>
                      </View>
                      {favorites.includes(item.id) ? (
                        <Feather
                          name="star"
                          size={18}
                          color={tokens.color.accent}
                        />
                      ) : null}
                    </TVPreviewPressable>
                  );
                }}
                onScrollToIndexFailed={({ averageItemLength, index }) =>
                  list.current?.scrollToOffset({
                    offset: averageItemLength * index,
                    animated: false,
                  })
                }
              />
            </View>
          </View>
        ) : null}
        <ScrollView
          style={[
            s.details,
            geometry.stacked && panelOpen && { flex: 0, maxHeight: 180 },
          ]}
          contentContainerStyle={{ padding: 20, gap: 16 }}
        >
          {selected ? (
            <>
              <ChannelLogo channel={selected} />
              <Text style={[text, { fontSize: 28, fontWeight: "800" }]}>
                {selected.name}
              </Text>
              <Text style={meta}>
                Kanal bilgisi · Video önizlemesi bu sürümde desteklenmiyor.
              </Text>
              {(
                [
                  ["Şimdi", programs.now],
                  ["Sonraki", programs.next],
                ] as const
              ).map(([label, program]) => (
                <View key={label} style={s.program}>
                  <Text style={[meta, { color: tokens.color.accent }]}>
                    {label}
                  </Text>
                  <Text numberOfLines={3} style={text}>
                    {program?.title ?? "Program bilgisi yok"}
                  </Text>
                  {program ? <Text style={meta}>{time(program)}</Text> : null}
                </View>
              ))}
              {button("play", "Tam ekran izle", () => onOpen(selected))}
              {button(
                "favorite",
                favorites.includes(selected.id)
                  ? "Favorilerden çıkar"
                  : "Favorilere ekle",
                () => onFavorite(selected.id),
              )}
            </>
          ) : (
            <Text style={text}>
              Kanalı OK ile seçin; ardından “Tam ekran izle” ile yayını açın.
            </Text>
          )}
        </ScrollView>
      </View>
    </View>
  );
}
function ChannelLogo({ channel }: { channel: Channel }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [channel.logoUrl]);
  return channel.logoUrl && !failed ? (
    <Image
      source={{ uri: channel.logoUrl }}
      resizeMode="contain"
      onError={() => setFailed(true)}
      style={s.logo}
    />
  ) : (
    <View style={[s.logo, { alignItems: "center", justifyContent: "center" }]}>
      <Feather name="tv" size={30} color={tokens.color.muted} />
    </View>
  );
}
const s = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    padding: 12,
    gap: 12,
    backgroundColor: tokens.color.canvas,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
  },
  body: { flex: 1, minHeight: 0, flexDirection: "row", gap: 12 },
  panel: {
    flexDirection: "row",
    minHeight: 0,
    backgroundColor: eliteLiveSurfaces.outer,
    gap: 12,
  },
  column: { padding: 8, gap: 8 },
  category: {
    borderWidth: 4,
    borderColor: "transparent",
    padding: 10,
    borderRadius: 8,
    justifyContent: "center",
  },
  channel: {
    borderWidth: 4,
    borderColor: "transparent",
    padding: 10,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
    backgroundColor: eliteLiveSurfaces.information,
  },
  logo: {
    width: 60,
    height: 48,
    backgroundColor: tokens.color.surface,
    borderRadius: 6,
  },
  search: {
    minHeight: 56,
    padding: 12,
    backgroundColor: eliteLiveSurfaces.information,
    borderWidth: 2,
    borderColor: tokens.color.border,
    borderRadius: 8,
    margin: 8,
  },
  details: {
    flex: 1,
    minWidth: 0,
    backgroundColor: eliteLiveSurfaces.information,
  },
  program: { gap: 6 },
  action: {
    minHeight: 64,
    borderWidth: 4,
    borderColor: "transparent",
    padding: 12,
    borderRadius: 8,
    justifyContent: "center",
    backgroundColor: tokens.color.surface,
  },
});
