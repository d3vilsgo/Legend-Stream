import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
}: {
  screen: StalkerSeriesProductScreen;
  categories: readonly StalkerSeriesProductCategory[];
  items: readonly StalkerSeriesProductItem[];
  detail: StalkerSeriesProductDetail | null;
  selectedCategoryTitle?: string;
  selectedSeasonId: string | null;
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
}) {
  const colors = useColors();
  const selectedSeason = detail?.seasons.find((season) => season.id === selectedSeasonId) ?? null;

  return <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.titleRow}>
      {screen !== "categories" ? <FocusButton label="Geri" icon="arrow-left" variant="ghost" onPress={onBack} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.foreground }]}>Diziler</Text>
        <Text style={{ color: colors.mutedForeground }}>
          {screen === "categories" ? "Kategori seçin" : screen === "list" ? selectedCategoryTitle || "Diziler" : detail?.title || "Dizi detayı"}
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

    {!loading && !error && screen === "list" ? <View style={styles.list}>
      {items.length ? items.map((item) => <Pressable
        key={item.id}
        accessibilityRole="button"
        accessibilityLabel={item.title}
        onPress={() => onSelectSeries(item.id)}
        style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}
      >
        <View style={[styles.icon, { backgroundColor: colors.secondary }]}><Feather name="tv" size={20} color={colors.primary} /></View>
        <Text style={[styles.rowTitle, { color: colors.foreground }]}>{item.title}</Text>
        <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
      </Pressable>) : <Empty text="Bu kategoride dizi bulunamadı." />}
      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Bu aşamada provider sayfası güvenli olarak p=1 ile sınırlandırılmıştır.</Text>
    </View> : null}

    {!loading && !error && screen === "detail" && detail ? <View style={styles.list}>
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
  section: { fontSize: 20, fontWeight: "800" },
  list: { gap: 10 },
  card: { borderWidth: 1, borderRadius: 14, minHeight: 68, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowTitle: { flex: 1, fontWeight: "800", fontSize: 16 },
  episodes: { gap: 8, paddingLeft: 18 },
  episode: { borderWidth: 1, borderRadius: 12, minHeight: 58, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  stateCard: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
});
