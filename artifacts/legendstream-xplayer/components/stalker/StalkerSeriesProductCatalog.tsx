import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { useColors } from "@/hooks/useColors";
import type {
  StalkerSeriesProductCategory,
  StalkerSeriesProductDetail,
  StalkerSeriesProductItem,
} from "@/lib/stalkerSeriesProduct";

export type StalkerSeriesProductScreen = "categories" | "list" | "search" | "detail";

export function StalkerSeriesProductCatalog({
  screen,
  categories,
  items,
  detail,
  selectedCategoryId,
  selectedCategoryTitle,
  selectedSeasonId,
  currentPage,
  totalItems,
  maxPageItems,
  hasNextPage,
  loading,
  loadingMore,
  error,
  pagingError,
  playbackLoading,
  playbackError,
  searchQuery,
  searchLoading,
  searchError,
  onSearchQueryChange,
  onBack,
  onRetry,
  onRetryNextPage,
  onSelectCategory,
  onSelectSeries,
  onSelectSeason,
  onSelectEpisode,
  onLoadMore,
}: {
  screen: StalkerSeriesProductScreen;
  categories: readonly StalkerSeriesProductCategory[];
  items: readonly StalkerSeriesProductItem[];
  detail: StalkerSeriesProductDetail | null;
  selectedCategoryId: string | null;
  selectedCategoryTitle?: string;
  selectedSeasonId: string | null;
  currentPage: number;
  totalItems?: number;
  maxPageItems?: number;
  hasNextPage: boolean;
  loading: boolean;
  loadingMore: boolean;
  error?: string | null;
  pagingError?: string | null;
  playbackLoading: boolean;
  playbackError?: string | null;
  searchQuery: string;
  searchLoading: boolean;
  searchError?: string | null;
  onSearchQueryChange: (value: string) => void;
  onBack: () => void;
  onRetry: () => void;
  onRetryNextPage: () => void;
  onSelectCategory: (id: string) => void;
  onSelectSeries: (id: string) => void;
  onSelectSeason: (id: string) => void;
  onSelectEpisode: (seasonId: string, episodeId: string) => void;
  onLoadMore: () => void;
}) {
  const colors = useColors();
  const selectedSeason = detail?.seasons.find((season) => season.id === selectedSeasonId) ?? null;

  if (screen === "detail") {
    return <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.titleRow}>
        <FocusButton label="Geri" icon="arrow-left" variant="ghost" onPress={onBack} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>Diziler</Text>
          <Text style={{ color: colors.mutedForeground }}>{detail?.title || "Dizi detayı"}</Text>
        </View>
      </View>

      {loading ? <StateCard loading text="Yükleniyor" /> : null}
      {error ? <ErrorCard detail={error} onRetry={onRetry} /> : null}

      {!loading && !error && detail ? <View style={styles.detailSection}>
        <View style={[styles.hero, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Poster item={detail} large />
          <View style={styles.heroText}>
            <Text style={[styles.detailTitle, { color: colors.foreground }]}>{detail.title}</Text>
            <Text style={{ color: colors.mutedForeground }}>{[detail.year, detail.genre, detail.rating].filter(Boolean).join(" · ")}</Text>
            {detail.director ? <Text style={{ color: colors.mutedForeground }}>Yönetmen: {detail.director}</Text> : null}
            {detail.actors ? <Text style={{ color: colors.mutedForeground }}>Oyuncular: {detail.actors}</Text> : null}
            {detail.description ? <Text style={{ color: colors.foreground, lineHeight: 20 }}>{detail.description}</Text> : null}
          </View>
        </View>

        {detail.hierarchyTruncated ? <View style={[styles.stateCard, { borderColor: colors.destructive, backgroundColor: colors.card }]}>
          <Text style={{ color: colors.destructive, fontWeight: "800" }}>Bölüm hiyerarşisi eksik</Text>
          <Text style={{ color: colors.mutedForeground }}>Sağlayıcı yanıtı güvenlik sınırını aştı; yalnız güvenli biçimde materialize edilen bölümler gösteriliyor.</Text>
        </View> : null}

        <Text style={[styles.section, { color: colors.foreground }]}>Sezonlar</Text>
        {detail.seasons.length ? <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.seasonTabs}
        >
          {detail.seasons.map((season) => {
            const selected = season.id === selectedSeasonId;
            return <Pressable
              key={season.id}
              accessibilityRole="button"
              accessibilityLabel={season.label}
              accessibilityState={{ selected }}
              onPress={() => onSelectSeason(season.id)}
              style={[
                styles.seasonTab,
                {
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.secondary : colors.card,
                },
              ]}
            >
              <Text style={{ color: selected ? colors.primary : colors.foreground, fontWeight: "900" }}>{season.label}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{season.episodeCount} bölüm</Text>
            </Pressable>;
          })}
        </ScrollView> : <Empty text="Kullanılabilir sezon bulunamadı." />}

        {selectedSeason ? <View style={styles.episodes}>
          <Text style={[styles.section, { color: colors.foreground }]}>{selectedSeason.label} · Bölümler</Text>
          {selectedSeason.episodes.length ? selectedSeason.episodes.map((episode) => <Pressable
            key={episode.key}
            accessibilityRole="button"
            accessibilityLabel={episode.label}
            onPress={() => onSelectEpisode(selectedSeason.id, episode.id)}
            style={[styles.episode, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>{episode.label}</Text>
            <Feather name="play" size={20} color={colors.primary} />
          </Pressable>) : <Empty text="Bu sezonda embedded bölüm kimliği bulunamadı." />}
        </View> : null}

        {playbackLoading ? <StateCard loading text="Bölüm hazırlanıyor" /> : null}
        {playbackError ? <View style={[styles.stateCard, { borderColor: colors.destructive, backgroundColor: colors.card }]}>
          <Text style={{ color: colors.destructive, fontWeight: "800" }}>Bölüm başlatılamadı</Text>
          <Text style={{ color: colors.mutedForeground }}>{playbackError}</Text>
        </View> : null}
      </View> : null}
    </ScrollView>;
  }

  const header = <View style={styles.headerBlock}>
    <View style={styles.titleRow}>
      {screen !== "categories" && screen !== "search" ? <FocusButton label="Geri" icon="arrow-left" variant="ghost" onPress={onBack} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.foreground }]}>Diziler</Text>
        <Text style={{ color: colors.mutedForeground }}>
          {screen === "categories"
            ? "Kategori seçin"
            : screen === "search"
              ? "Tüm dizi kataloğunda arama"
              : `${selectedCategoryTitle || "Diziler"}${totalItems != null ? ` · ${totalItems} dizi` : ""}${maxPageItems != null ? ` · sayfa başına ${maxPageItems}` : ""}`}
        </Text>
      </View>
    </View>
    <SearchBox value={searchQuery} placeholder="Dizi ara..." onChange={onSearchQueryChange} />
    {searchLoading ? <StateCard loading text="Tüm dizi kataloğu taranıyor" /> : null}
    {searchError ? <ErrorCard detail={searchError} onRetry={onRetry} /> : null}
    {loading && screen !== "search" ? <StateCard loading text="Yükleniyor" /> : null}
    {error ? <ErrorCard detail={error} onRetry={onRetry} /> : null}
  </View>;

  if (screen === "categories") {
    return <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={categories}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      ListEmptyComponent={!loading && !error ? <Empty text="Kullanılabilir Series kategorisi bulunamadı." /> : null}
      renderItem={({ item }) => {
        const selected = item.id === selectedCategoryId;
        return <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.title}
          accessibilityState={{ selected }}
          onPress={() => onSelectCategory(item.id)}
          style={[styles.card, { borderColor: selected ? colors.primary : colors.border, backgroundColor: colors.card }]}
        >
          <View style={[styles.icon, { backgroundColor: colors.secondary }]}><Feather name="folder" size={20} color={colors.primary} /></View>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>{item.title}</Text>
          <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
        </Pressable>;
      }}
    />;
  }

  return <FlatList
    style={styles.screen}
    contentContainerStyle={styles.content}
    data={items}
    keyExtractor={(item) => item.id}
    numColumns={2}
    columnWrapperStyle={styles.gridRow}
    ListHeaderComponent={header}
    ListEmptyComponent={!loading && !searchLoading && !error && !searchError
      ? <Empty text={screen === "search" ? "Aramanızla eşleşen dizi bulunamadı." : "Bu kategoride dizi bulunamadı."} />
      : null}
    renderItem={({ item }) => <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title}
      onPress={() => onSelectSeries(item.id)}
      style={[styles.seriesCard, { borderColor: colors.border, backgroundColor: colors.card }]}
    >
      <Poster item={item} />
      <Text numberOfLines={2} style={[styles.seriesTitle, { color: colors.foreground }]}>{item.title}</Text>
      <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 12 }}>
        {[item.year, item.rating].filter(Boolean).join(" · ")}
      </Text>
    </Pressable>}
    onEndReached={screen === "list" && hasNextPage ? onLoadMore : undefined}
    onEndReachedThreshold={0.55}
    ListFooterComponent={screen === "list" ? <View style={styles.footer}>
      {loadingMore ? <StateCard loading text={`Sayfa ${currentPage + 1} yükleniyor`} /> : null}
      {pagingError ? <View style={styles.footer}>
        <ErrorCard detail={pagingError} onRetry={onRetryNextPage} />
      </View> : null}
      {!hasNextPage && items.length ? <Text style={{ color: colors.mutedForeground, textAlign: "center" }}>Kategori sonu</Text> : null}
    </View> : null}
  />;
}

function SearchBox({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (value: string) => void }) {
  const colors = useColors();
  return <View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
    <Feather name="search" size={18} color={colors.mutedForeground} />
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      autoCorrect={false}
      style={[styles.searchInput, { color: colors.foreground }]}
    />
    {value ? <Pressable accessibilityRole="button" accessibilityLabel="Aramayı temizle" onPress={() => onChange("")}>
      <Feather name="x-circle" size={20} color={colors.mutedForeground} />
    </Pressable> : null}
  </View>;
}

function Poster({ item, large = false }: { item: Pick<StalkerSeriesProductItem, "posterUrl" | "title">; large?: boolean }) {
  const colors = useColors();
  const style = large ? styles.posterLarge : styles.poster;
  return <View style={[style, { backgroundColor: colors.secondary }]}>
    {item.posterUrl
      ? <Image source={{ uri: item.posterUrl }} style={styles.posterImage} resizeMode="cover" />
      : <View style={styles.posterFallback}><Feather name="tv" size={large ? 34 : 26} color={colors.mutedForeground} /><Text style={{ color: colors.mutedForeground }}>Dizi</Text></View>}
  </View>;
}

function StateCard({ loading, text }: { loading?: boolean; text: string }) {
  const colors = useColors();
  return <View style={[styles.stateCard, { borderColor: colors.border, backgroundColor: colors.card }]}> 
    {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
    <Text style={{ color: colors.mutedForeground }}>{text}</Text>
  </View>;
}

function ErrorCard({ detail, onRetry }: { detail: string; onRetry: () => void }) {
  const colors = useColors();
  return <View style={[styles.stateCard, { borderColor: colors.destructive, backgroundColor: colors.card }]}> 
    <View style={{ flex: 1, gap: 3 }}>
      <Text style={{ color: colors.destructive, fontWeight: "800" }}>Diziler yüklenemedi</Text>
      <Text style={{ color: colors.mutedForeground }}>{detail}</Text>
    </View>
    <FocusButton label="Tekrar dene" icon="refresh-cw" variant="secondary" onPress={onRetry} />
  </View>;
}

function Empty({ text }: { text: string }) {
  return <StateCard text={text} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 18, paddingBottom: 40, maxWidth: 1200, width: "100%", alignSelf: "center", gap: 12 },
  headerBlock: { gap: 12, marginBottom: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 28, fontWeight: "800" },
  detailTitle: { fontSize: 24, fontWeight: "900" },
  section: { fontSize: 20, fontWeight: "800" },
  detailSection: { gap: 14 },
  card: { borderWidth: 1, borderRadius: 14, minHeight: 68, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  icon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowTitle: { flex: 1, fontWeight: "800", fontSize: 16 },
  gridRow: { gap: 12, marginBottom: 12 },
  seriesCard: { flex: 1, maxWidth: 260, borderWidth: 1, borderRadius: 14, padding: 8, gap: 7 },
  seriesTitle: { fontWeight: "800", fontSize: 14, lineHeight: 18 },
  poster: { width: "100%", aspectRatio: 2 / 3, borderRadius: 10, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  posterLarge: { width: 210, aspectRatio: 2 / 3, borderRadius: 14, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  posterImage: { width: "100%", height: "100%" },
  posterFallback: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  hero: { borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 16, flexWrap: "wrap" },
  heroText: { flex: 1, minWidth: 220, gap: 8 },
  seasonTabs: { gap: 8, paddingVertical: 2, paddingRight: 18 },
  seasonTab: { minWidth: 112, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, gap: 3 },
  episodes: { gap: 8 },
  episode: { borderWidth: 1, borderRadius: 12, minHeight: 58, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  stateCard: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  footer: { gap: 10, paddingVertical: 8 },
  searchBox: { borderWidth: 1, borderRadius: 14, minHeight: 50, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 10 },
});
