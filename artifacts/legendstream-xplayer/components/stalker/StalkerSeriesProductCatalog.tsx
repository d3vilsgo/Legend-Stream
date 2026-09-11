import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { useColors } from "@/hooks/useColors";
import type {
  StalkerSeriesProductCategory,
  StalkerSeriesProductDetail,
  StalkerSeriesProductItem,
} from "@/lib/stalkerSeriesProduct";

export type StalkerSeriesProductScreen = "categories" | "list" | "detail";

export function StalkerSeriesProductCatalog({
  screen,
  categories,
  items,
  detail,
  selectedCategoryTitle,
  selectedSeasonId,
  currentPage,
  totalItems,
  maxPageItems,
  hasNextPage,
  loading,
  error,
  playbackLoading,
  playbackError,
  onBack,
  onRetry,
  onSelectCategory,
  onSelectSeries,
  onSelectSeason,
  onSelectEpisode,
  onPreviousPage,
  onNextPage,
}: {
  screen: StalkerSeriesProductScreen;
  categories: readonly StalkerSeriesProductCategory[];
  items: readonly StalkerSeriesProductItem[];
  detail: StalkerSeriesProductDetail | null;
  selectedCategoryTitle?: string;
  selectedSeasonId: string | null;
  currentPage: number;
  totalItems?: number;
  maxPageItems?: number;
  hasNextPage: boolean;
  loading: boolean;
  error?: string | null;
  playbackLoading: boolean;
  playbackError?: string | null;
  onBack: () => void;
  onRetry: () => void;
  onSelectCategory: (id: string) => void;
  onSelectSeries: (id: string) => void;
  onSelectSeason: (id: string) => void;
  onSelectEpisode: (seasonId: string, episodeId: string) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  const colors = useColors();
  const selectedSeason = detail?.seasons.find((season) => season.id === selectedSeasonId) ?? null;

  return <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.titleRow}>
      {screen !== "categories" ? <FocusButton label="Geri" icon="arrow-left" variant="ghost" onPress={onBack} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.foreground }]}>Diziler</Text>
        <Text style={{ color: colors.mutedForeground }}>
          {screen === "categories"
            ? "Kategori seçin"
            : screen === "list"
              ? `${selectedCategoryTitle || "Diziler"} · Sayfa ${currentPage}${totalItems != null ? ` · ${totalItems} dizi` : ""}${maxPageItems != null ? ` · sayfa başına ${maxPageItems}` : ""}`
              : detail?.title || "Dizi detayı"}
        </Text>
      </View>
    </View>

    {loading ? <StateCard loading text="Yükleniyor" /> : null}
    {error ? <ErrorCard detail={error} onRetry={onRetry} /> : null}

    {!loading && !error && screen === "categories" ? <View style={styles.list}>
      {categories.length ? categories.map((category) => <Pressable
        key={category.id}
        accessibilityRole="button"
        accessibilityLabel={category.title}
        onPress={() => onSelectCategory(category.id)}
        style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}
      >
        <View style={[styles.icon, { backgroundColor: colors.secondary }]}><Feather name="folder" size={20} color={colors.primary} /></View>
        <Text style={[styles.rowTitle, { color: colors.foreground }]}>{category.title}</Text>
        <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
      </Pressable>) : <Empty text="Kullanılabilir Series kategorisi bulunamadı." />}
    </View> : null}

    {!loading && !error && screen === "list" ? <>
      <View style={styles.grid}>
        {items.length ? items.map((item) => <Pressable
          key={item.id}
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
        </Pressable>) : <Empty text="Bu kategoride dizi bulunamadı." />}
      </View>
      <View style={styles.pager}>
        <FocusButton
          label="Önceki"
          icon="chevron-left"
          variant="secondary"
          disabled={currentPage <= 1}
          onPress={onPreviousPage}
        />
        <FocusButton
          label="Sonraki"
          icon="chevron-right"
          variant="secondary"
          disabled={!hasNextPage}
          onPress={onNextPage}
        />
      </View>
    </> : null}

    {!loading && !error && screen === "detail" && detail ? <View style={styles.detailSection}>
      <View style={[styles.hero, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Poster item={detail} large />
        <View style={styles.heroText}>
          <Text style={[styles.detailTitle, { color: colors.foreground }]}>{detail.title}</Text>
          <Text style={{ color: colors.mutedForeground }}>
            {[detail.year, detail.genre, detail.rating].filter(Boolean).join(" · ")}
          </Text>
          {detail.director ? <Text style={{ color: colors.mutedForeground }}>Yönetmen: {detail.director}</Text> : null}
          {detail.actors ? <Text style={{ color: colors.mutedForeground }}>Oyuncular: {detail.actors}</Text> : null}
          {detail.description ? <Text style={{ color: colors.foreground, lineHeight: 20 }}>{detail.description}</Text> : null}
        </View>
      </View>

      <Text style={[styles.section, { color: colors.foreground }]}>Sezonlar</Text>
      {detail.seasons.length ? detail.seasons.map((season) => {
        const selected = season.id === selectedSeasonId;
        return <View key={season.id} style={{ gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={season.label}
            onPress={() => onSelectSeason(season.id)}
            style={[styles.card, { borderColor: selected ? colors.primary : colors.border, backgroundColor: colors.card }]}
          >
            <View style={[styles.icon, { backgroundColor: colors.secondary }]}><Feather name="layers" size={20} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>{season.label}</Text>
              <Text style={{ color: colors.mutedForeground }}>{season.episodeCount} bölüm</Text>
            </View>
            <Feather name={selected ? "chevron-down" : "chevron-right"} size={20} color={colors.mutedForeground} />
          </Pressable>
          {selected ? <View style={styles.episodes}>
            {season.episodes.length ? season.episodes.map((episode) => <Pressable
              key={episode.key}
              accessibilityRole="button"
              accessibilityLabel={episode.label}
              onPress={() => onSelectEpisode(season.id, episode.id)}
              style={[styles.episode, { borderColor: colors.border, backgroundColor: colors.card }]}
            >
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>{episode.label}</Text>
              <Feather name="play" size={20} color={colors.primary} />
            </Pressable>) : <Empty text="Bu sezonda embedded bölüm kimliği bulunamadı." />}
          </View> : null}
        </View>;
      }) : <Empty text="Kullanılabilir sezon bulunamadı." />}

      {playbackLoading ? <StateCard loading text="Bölüm hazırlanıyor" /> : null}
      {playbackError ? <View style={[styles.stateCard, { borderColor: colors.destructive, backgroundColor: colors.card }]}>
        <Text style={{ color: colors.destructive, fontWeight: "800" }}>Bölüm başlatılamadı</Text>
        <Text style={{ color: colors.mutedForeground }}>{playbackError}</Text>
      </View> : null}
      {selectedSeason && !selectedSeason.episodes.length ? <Text style={{ color: colors.mutedForeground }}>Seçili sezonda oynatılabilir embedded bölüm yok.</Text> : null}
    </View> : null}
  </ScrollView>;
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
  content: { padding: 18, paddingBottom: 40, maxWidth: 1200, width: "100%", alignSelf: "center", gap: 14 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 28, fontWeight: "800" },
  detailTitle: { fontSize: 24, fontWeight: "900" },
  section: { fontSize: 20, fontWeight: "800" },
  list: { gap: 10 },
  detailSection: { gap: 14 },
  card: { borderWidth: 1, borderRadius: 14, minHeight: 68, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowTitle: { flex: 1, fontWeight: "800", fontSize: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  seriesCard: { width: 154, borderWidth: 1, borderRadius: 14, padding: 8, gap: 7 },
  seriesTitle: { fontWeight: "800", fontSize: 14, lineHeight: 18 },
  poster: { width: "100%", aspectRatio: 2 / 3, borderRadius: 10, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  posterLarge: { width: 210, aspectRatio: 2 / 3, borderRadius: 14, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  posterImage: { width: "100%", height: "100%" },
  posterFallback: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  pager: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  hero: { borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 16, flexWrap: "wrap" },
  heroText: { flex: 1, minWidth: 220, gap: 8 },
  episodes: { gap: 8, paddingLeft: 18 },
  episode: { borderWidth: 1, borderRadius: 12, minHeight: 58, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  stateCard: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
});
