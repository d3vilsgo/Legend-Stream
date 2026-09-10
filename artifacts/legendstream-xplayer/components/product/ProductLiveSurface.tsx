import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FocusButton } from "@/components/FocusButton";
import { StalkerSeriesProbePanel } from "@/components/stalker/StalkerSeriesProbePanel";
import { StalkerVodSurface } from "@/components/stalker/StalkerVodSurface";
import { useColors } from "@/hooks/useColors";
import type { ProductCategoryRow, ProductChannelRow } from "@/lib/stalkerProductPresentation";

export type ProductLiveSurfaceScreen = "home" | "categories" | "channels";

export function ProductLiveSurface({
  screen,
  categories,
  channels,
  selectedCategoryTitle,
  selectedChannelId,
  categoriesLoading,
  categoriesError,
  channelsLoading,
  channelsError,
  playbackLoading,
  playbackError,
  onOpenLive,
  onBackToHome,
  onBackToCategories,
  onRetryCategories,
  onRetryChannels,
  onRetryPlayback,
  onSelectCategory,
  onSelectChannel,
}: {
  screen: ProductLiveSurfaceScreen;
  categories: readonly ProductCategoryRow[];
  channels: readonly ProductChannelRow[];
  selectedCategoryTitle?: string;
  selectedChannelId?: string | null;
  categoriesLoading: boolean;
  categoriesError?: string | null;
  channelsLoading: boolean;
  channelsError?: string | null;
  playbackLoading: boolean;
  playbackError?: string | null;
  onOpenLive: () => void;
  onBackToHome: () => void;
  onBackToCategories: () => void;
  onRetryCategories: () => void;
  onRetryChannels: () => void;
  onRetryPlayback: () => void;
  onSelectCategory: (id: string) => void;
  onSelectChannel: (id: string) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const top = Math.max(insets.top, Platform.OS === "web" ? 20 : 0);
  const [section, setSection] = useState<"live" | "movies">("live");

  const openLive = () => {
    setSection("live");
    onOpenLive();
  };

  return <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: top, paddingBottom: Math.max(insets.bottom, 10) }]}>
    <View style={[styles.header, { borderColor: colors.border }]}> 
      <View style={styles.headerTop}>
        <Text style={[styles.brand, { color: colors.foreground }]}>LEGEND<Text style={{ color: colors.primary }}>STREAM</Text></Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.nav}>
        <FocusButton
          label="Canlı TV"
          icon="radio"
          variant={section === "live" && screen !== "home" ? "secondary" : "ghost"}
          onPress={openLive}
        />
        <FocusButton
          label="Filmler"
          icon="film"
          variant={section === "movies" ? "secondary" : "ghost"}
          onPress={() => setSection("movies")}
        />
      </ScrollView>
    </View>

    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {section === "movies" ? <StalkerVodSurface onBack={() => setSection("live")} /> : null}

      {section === "live" && screen === "home" ? <>
        <Text style={[styles.title, { color: colors.foreground }]}>LegendStream XPlayer</Text>
        <Text style={[styles.lead, { color: colors.mutedForeground }]}>İçeriklerinize aynı LegendStream deneyimi üzerinden erişin.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Canlı TV"
          onPress={openLive}
          style={[styles.featureCard, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <View style={[styles.featureIcon, { backgroundColor: colors.secondary }]}>
            <Feather name="radio" size={28} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.section, { color: colors.foreground }]}>Canlı TV</Text>
            <Text style={{ color: colors.mutedForeground }}>Kategorilere ve canlı kanallara göz atın.</Text>
          </View>
          <Feather name="chevron-right" size={24} color={colors.mutedForeground} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filmler"
          onPress={() => setSection("movies")}
          style={[styles.featureCard, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <View style={[styles.featureIcon, { backgroundColor: colors.secondary }]}>
            <Feather name="film" size={28} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.section, { color: colors.foreground }]}>Filmler</Text>
            <Text style={{ color: colors.mutedForeground }}>Film kategorilerine ve sayfalı VOD kataloğuna göz atın.</Text>
          </View>
          <Feather name="chevron-right" size={24} color={colors.mutedForeground} />
        </Pressable>
        <StalkerSeriesProbePanel />
      </> : null}

      {section === "live" && screen === "categories" ? <>
        <View style={styles.screenTitleRow}>
          <FocusButton label="Geri" icon="arrow-left" variant="ghost" onPress={onBackToHome} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>Canlı TV</Text>
            <Text style={{ color: colors.mutedForeground }}>Kategori seçin</Text>
          </View>
        </View>
        {categoriesLoading ? <LocalLoading text="Kategoriler yükleniyor" /> : null}
        {categoriesError ? <LocalError title="Kategoriler yüklenemedi" detail={categoriesError} onRetry={onRetryCategories} /> : null}
        {!categoriesLoading && !categoriesError ? <View style={styles.list}>
          {categories.length ? categories.map((category) => <Pressable
            key={category.id}
            accessibilityRole="button"
            accessibilityLabel={category.title}
            onPress={() => onSelectCategory(category.id)}
            style={[styles.rowCard, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <View style={[styles.rowIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="folder" size={20} color={colors.primary} />
            </View>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>{category.title}</Text>
            <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>) : <EmptyState text="Kullanılabilir canlı TV kategorisi bulunamadı." />}
        </View> : null}
      </> : null}

      {section === "live" && screen === "channels" ? <>
        <View style={styles.screenTitleRow}>
          <FocusButton label="Geri" icon="arrow-left" variant="ghost" onPress={onBackToCategories} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>{selectedCategoryTitle || "Canlı TV"}</Text>
            <Text style={{ color: colors.mutedForeground }}>Kanallar</Text>
          </View>
        </View>
        {channelsLoading ? <LocalLoading text="Kanallar yükleniyor" /> : null}
        {channelsError ? <LocalError title="Kanallar yüklenemedi" detail={channelsError} onRetry={onRetryChannels} /> : null}
        {playbackLoading ? <LocalLoading text="Yayın hazırlanıyor" /> : null}
        {playbackError ? <LocalError title="Yayın başlatılamadı" detail={playbackError} onRetry={onRetryPlayback} /> : null}
        {!channelsLoading && !channelsError ? <View style={styles.list}>
          {channels.length ? channels.map((channel) => {
            const selected = selectedChannelId === channel.id;
            return <Pressable
              key={channel.id}
              accessibilityRole="button"
              accessibilityLabel={channel.title}
              onPress={() => onSelectChannel(channel.id)}
              style={[styles.rowCard, { borderColor: selected ? colors.primary : colors.border, backgroundColor: colors.card }]}
            >
              <View style={[styles.channelLogo, { backgroundColor: colors.secondary }]}>
                {channel.logoUrl ? <Image source={{ uri: channel.logoUrl }} style={styles.logoImage} resizeMode="contain" /> : <Feather name="tv" size={20} color={colors.primary} />}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>{channel.title}</Text>
                {channel.number != null ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Kanal {channel.number}</Text> : null}
              </View>
              <Feather name="play" size={20} color={selected ? colors.primary : colors.mutedForeground} />
            </Pressable>;
          }) : <EmptyState text="Bu kategoride kanal bulunamadı." />}
        </View> : null}
      </> : null}
    </ScrollView>
  </View>;
}

function LocalLoading({ text }: { text: string }) {
  const colors = useColors();
  return <View style={[styles.stateCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
    <ActivityIndicator size="small" color={colors.primary} />
    <Text style={{ color: colors.mutedForeground }}>{text}</Text>
  </View>;
}

function LocalError({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  const colors = useColors();
  return <View style={[styles.stateCard, { borderColor: colors.destructive, backgroundColor: colors.card }]}> 
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={{ color: colors.destructive, fontWeight: "800" }}>{title}</Text>
      <Text style={{ color: colors.mutedForeground }}>{detail}</Text>
    </View>
    <FocusButton label="Tekrar dene" icon="refresh-cw" variant="secondary" onPress={onRetry} />
  </View>;
}

function EmptyState({ text }: { text: string }) {
  const colors = useColors();
  return <View style={[styles.stateCard, { borderColor: colors.border, backgroundColor: colors.card }]}> 
    <Text style={{ color: colors.mutedForeground }}>{text}</Text>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, paddingTop: 6, paddingBottom: 10 },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  brand: { fontSize: 18, fontWeight: "900", letterSpacing: 1 },
  nav: { gap: 6, paddingVertical: 4 },
  content: { padding: 18, paddingBottom: 40, maxWidth: 1500, width: "100%", alignSelf: "center", gap: 14 },
  title: { fontSize: 28, fontWeight: "800", marginBottom: 4 },
  lead: { fontSize: 15, marginBottom: 10 },
  section: { fontSize: 20, fontWeight: "800" },
  featureCard: { borderWidth: 1, borderRadius: 18, padding: 18, flexDirection: "row", alignItems: "center", gap: 14, minHeight: 108 },
  featureIcon: { width: 58, height: 58, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  screenTitleRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 6 },
  list: { gap: 8 },
  rowCard: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, minHeight: 68 },
  rowIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  channelLogo: { width: 52, height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  logoImage: { width: 46, height: 46 },
  rowTitle: { flex: 1, fontWeight: "800", fontSize: 16 },
  stateCard: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
});
