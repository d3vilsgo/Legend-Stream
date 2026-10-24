import { Feather } from "@expo/vector-icons";
import {
  categoryForRow,
  liveDrawerCategories,
  liveDrawerWidth,
} from "@/lib/playerCompactPresentation";
import React, { useMemo } from "react";
import {
  FlatList,
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  PlayerRemoteFocusBoundary,
  PlayerRemotePressable,
} from "./PlayerRemotePressable";
import type { PlayerSelectableItem } from "./PlayerChromeV2";

export function LiveChannelDrawer({
  items,
  currentIndex,
  layer,
  category,
  onCategoryChange,
  onLayerChange,
  onSelect,
  onFavorite,
  onClose,
}: {
  items: readonly PlayerSelectableItem[];
  currentIndex: number;
  layer: "channels" | "categories";
  category: string;
  onCategoryChange: (category: string) => void;
  onLayerChange: (layer: "channels" | "categories") => void;
  onSelect: (item: PlayerSelectableItem) => void;
  onFavorite?: (item: PlayerSelectableItem) => void;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const safe = useSafeAreaInsets();
  const portrait = height > width;
  const panelWidth = liveDrawerWidth(
    width,
    safe.left,
    safe.right,
    Platform.isTV,
    portrait,
  );
  const categories = useMemo(() => liveDrawerCategories(items), [items]);
  const active = categories.includes(category)
    ? category
    : currentIndex >= 0 && items[currentIndex]
      ? categoryForRow(items[currentIndex])
      : (categories[0] ?? "Diğer");
  const rows = useMemo(
    () =>
      items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => categoryForRow(item) === active),
    [active, items],
  );
  const firstFocusIndex = Math.max(
    0,
    rows.findIndex(({ index }) => index === currentIndex),
  );
  return (
    <PlayerRemoteFocusBoundary scope={`player-live-${layer}`}>
      <View
        testID="live-channel-drawer"
        style={[
          styles.drawer,
          {
            width: panelWidth,
            top: safe.top,
            bottom: safe.bottom,
            left: safe.left,
          },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.heading} numberOfLines={1}>
            {layer === "categories" ? "KATEGORİLER" : "KANALLAR"}
          </Text>
          <PlayerRemotePressable
            compactFocus
            nativeID="player:drawer-close"
            accessibilityLabel="Kanal panelini kapat"
            onPress={onClose}
            showFocusLabel={false}
            style={styles.close}
          >
            <Feather name="x" size={16} color="#cbd5e1" />
          </PlayerRemotePressable>
        </View>
        {layer === "channels" ? (
          <PlayerRemotePressable
            compactFocus
            nativeID="player:drawer-categories"
            accessibilityLabel="Kategori seç"
            hasTVPreferredFocus={Platform.isTV && rows.length === 0}
            onPress={() => onLayerChange("categories")}
            showFocusLabel={false}
            style={styles.categorySwitch}
          >
            <Feather name="layers" size={16} color="#2dd4bf" />
            <Text style={styles.categoryLabel} numberOfLines={1}>
              {active}
            </Text>
            <Feather name="chevron-right" size={16} color="#2dd4bf" />
          </PlayerRemotePressable>
        ) : null}
        {layer === "categories" ? (
          <FlatList
            data={categories}
            keyExtractor={(item) => item}
            renderItem={({ item, index }) => (
              <PlayerRemotePressable
                compactFocus
                nativeID={`player:category:${index}`}
                accessibilityLabel={item}
                hasTVPreferredFocus={Platform.isTV && item === active}
                onPress={() => {
                  onCategoryChange(item);
                  onLayerChange("channels");
                }}
                showFocusLabel={false}
                style={[styles.row, item === active && styles.playing]}
              >
                <Text numberOfLines={1} style={styles.rowTitle}>
                  {item}
                </Text>
                {item === active ? (
                  <Feather name="check" size={16} color="#2dd4bf" />
                ) : null}
              </PlayerRemotePressable>
            )}
          />
        ) : (
          <FlatList
            testID="live-channel-list"
            data={rows}
            keyExtractor={({ item, index }) => `${item.id}:${index}`}
            initialScrollIndex={
              Platform.isTV && rows.length ? firstFocusIndex : undefined
            }
            getItemLayout={
              Platform.isTV
                ? (_, index) => ({ length: 62, offset: index * 62, index })
                : undefined
            }
            onScrollToIndexFailed={() => {
              /* Never trigger playback from a scroll fallback. */
            }}
            initialNumToRender={18}
            maxToRenderPerBatch={18}
            windowSize={6}
            ListEmptyComponent={
              <Text style={styles.empty}>Bu kategoride kanal yok.</Text>
            }
            renderItem={({ item: row }) => (
              <View
                style={[
                  styles.row,
                  row.index === currentIndex && styles.playing,
                ]}
              >
                <PlayerRemotePressable
                  compactFocus
                  nativeID={`player:channel:${row.item.id}`}
                  accessibilityLabel={row.item.title}
                  hasTVPreferredFocus={
                    Platform.isTV && row.index === rows[firstFocusIndex]?.index
                  }
                  onPress={() => onSelect(row.item)}
                  showFocusLabel={false}
                  style={styles.channelPress}
                >
                  {row.item.logoUrl ? (
                    <Image
                      source={{ uri: row.item.logoUrl }}
                      style={styles.logo}
                      resizeMode="contain"
                    />
                  ) : (
                    <View style={styles.logoPlaceholder}>
                      <Feather name="tv" size={16} color="#64748b" />
                    </View>
                  )}
                  <View style={styles.rowCopy}>
                    <Text numberOfLines={1} style={styles.rowTitle}>
                      {row.item.title}
                    </Text>
                    {row.item.nowPlaying ? (
                      <Text numberOfLines={1} style={styles.rowMeta}>
                        {row.item.nowPlaying}
                      </Text>
                    ) : null}
                  </View>
                  {row.index === currentIndex ? (
                    <Feather name="radio" size={13} color="#2dd4bf" />
                  ) : null}
                </PlayerRemotePressable>
                {onFavorite ? (
                  <PlayerRemotePressable
                    compactFocus
                    nativeID={`player:favorite:${row.item.id}`}
                    accessibilityLabel={
                      row.item.isFavorite
                        ? "Favorilerden çıkar"
                        : "Favorilere ekle"
                    }
                    onPress={() => onFavorite(row.item)}
                    showFocusLabel={false}
                    style={styles.favorite}
                  >
                    <Feather
                      name="star"
                      size={15}
                      color={row.item.isFavorite ? "#2dd4bf" : "#64748b"}
                    />
                  </PlayerRemotePressable>
                ) : null}
              </View>
            )}
          />
        )}
      </View>
    </PlayerRemoteFocusBoundary>
  );
}

const styles = StyleSheet.create({
  drawer: {
    position: "absolute",
    zIndex: 100,
    backgroundColor: "rgba(7, 15, 27, 0.9)",
    borderRightWidth: 1,
    borderRightColor: "rgba(45, 212, 191, .42)",
    paddingHorizontal: 9,
    paddingVertical: 8,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 40,
    paddingHorizontal: 8,
  },
  heading: {
    color: "#f8fafc",
    fontWeight: "700",
    fontSize: 14,
    letterSpacing: 1,
  },
  close: { padding: 5, justifyContent: "center", alignItems: "center" },
  categorySwitch: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginVertical: 7,
    paddingHorizontal: 9,
    minHeight: 40,
  },
  categoryLabel: { flex: 1, color: "#cbd5e1", fontWeight: "600", fontSize: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 62,
    height: 62,
    paddingHorizontal: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(148, 163, 184, .16)",
  },
  playing: { backgroundColor: "rgba(45, 212, 191, .09)" },
  channelPress: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    minWidth: 0,
    paddingVertical: 4,
  },
  logo: { width: 32, height: 32 },
  logoPlaceholder: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: {
    flexShrink: 1,
    color: "#f1f5f9",
    fontWeight: "600",
    fontSize: 12,
  },
  rowMeta: { color: "#94a3b8", fontSize: 10, marginTop: 3 },
  favorite: {
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: { color: "#94a3b8", fontSize: 12, padding: 16 },
});
