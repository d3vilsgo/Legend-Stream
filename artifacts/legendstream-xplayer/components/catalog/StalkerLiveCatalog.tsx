import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
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
import type { EpgProgram } from "@/context/PlayerContext";
import { selectProgramsAt } from "@/context/PlayerContext";
import { useI18n } from "@/context/I18nContext";
import { useColors } from "@/hooks/useColors";
import type { Channel } from "@/lib/iptv";

export function StalkerLiveCatalog({
  providerId,
  channels,
  epgByChannel,
  favorites,
  epgLoading,
  refreshing,
  onRefresh,
  onOpen,
  onFavorite,
}: {
  providerId: string;
  channels: Channel[];
  epgByChannel: ReadonlyMap<string, readonly EpgProgram[]>;
  favorites: string[];
  epgLoading: boolean;
  refreshing: boolean;
  onRefresh: () => Promise<void> | void;
  onOpen: (channel: Channel) => void;
  onFavorite: (id: string) => void;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("__all__");
  const [epgClock, setEpgClock] = useState(() => Date.now());

  const providerChannels = useMemo(
    () => channels.filter((channel) => channel.providerId === providerId && (channel.contentType ?? "live") === "live"),
    [channels, providerId],
  );
  const categories = useMemo(
    () => Array.from(new Set(providerChannels.map((channel) => channel.category).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, "tr", { sensitivity: "base" })),
    [providerChannels],
  );

  useEffect(() => {
    if (category !== "__all__" && !categories.includes(category)) setCategory("__all__");
  }, [category, categories]);
  useEffect(() => {
    const timer = setInterval(() => setEpgClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const normalizedSearch = search.trim().toLocaleLowerCase("tr");
  const visible = useMemo(
    () => providerChannels.filter((channel) => {
      if (category !== "__all__" && channel.category !== category) return false;
      if (!normalizedSearch) return true;
      return `${channel.name} ${channel.category}`.toLocaleLowerCase("tr").includes(normalizedSearch);
    }),
    [providerChannels, category, normalizedSearch],
  );

  return <View style={{ flex: 1 }}>
    <View style={[s.header, { borderColor: colors.border }]}> 
      <View style={s.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: colors.foreground }]}>{t("liveTv")}</Text>
          <Text style={{ color: colors.mutedForeground }}>
            {t("channels", { count: visible.length.toLocaleString() })}{epgLoading ? " · EPG…" : ""}
          </Text>
        </View>
        <Pressable
          disabled={refreshing}
          onPress={() => void onRefresh()}
          style={[s.refresh, { borderColor: colors.border, opacity: refreshing ? 0.6 : 1 }]}
        >
          {refreshing
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Feather name="refresh-cw" size={17} color={colors.primary} />}
          <Text style={{ color: colors.foreground, fontWeight: "700" }}>{t("refresh")}</Text>
        </Pressable>
      </View>
      <View style={[s.search, { borderColor: colors.border, backgroundColor: colors.card }]}> 
        <Feather name="search" size={18} color={colors.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={`${t("search")} ${t("liveTv").toLowerCase()}`}
          placeholderTextColor={colors.mutedForeground}
          style={{ flex: 1, color: colors.foreground, minHeight: 42 }}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.categories}>
        {["__all__", ...categories].map((item) => {
          const active = item === category;
          return <Pressable
            key={item}
            onPress={() => setCategory(item)}
            style={[s.category, { borderColor: active ? colors.primary : colors.border, backgroundColor: colors.card }]}
          >
            <Text style={{ color: active ? colors.primary : colors.foreground, fontWeight: active ? "800" : "600" }}>
              {item === "__all__" ? t("all") : item}
            </Text>
          </Pressable>;
        })}
      </ScrollView>
    </View>

    <FlatList
      data={visible}
      keyExtractor={(channel) => channel.id}
      contentContainerStyle={s.list}
      ListEmptyComponent={<Text style={{ color: colors.mutedForeground, textAlign: "center", paddingVertical: 30 }}>—</Text>}
      renderItem={({ item: channel }) => {
        const current = selectProgramsAt(epgByChannel.get(channel.id), epgClock).now;
        const endLabel = current
          ? new Date(current.end).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
          : undefined;
        return <View style={[s.row, { borderColor: colors.border, backgroundColor: colors.card }]}> 
          <Pressable style={s.main} onPress={() => onOpen(channel)}>
            {channel.logoUrl
              ? <Image source={{ uri: channel.logoUrl }} style={s.logo} />
              : <View style={[s.logo, { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }]}>
                  <Text style={{ color: colors.primary, fontWeight: "800" }}>{channel.name.slice(0, 2).toUpperCase()}</Text>
                </View>}
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "700" }}>{channel.name}</Text>
              <Text numberOfLines={1} style={{ color: current ? colors.foreground : colors.mutedForeground, fontSize: 12 }}>
                {current ? `${current.title}${endLabel ? ` · ${endLabel}` : ""}` : channel.category}
              </Text>
            </View>
          </Pressable>
          <Pressable onPress={() => onFavorite(channel.id)} style={s.iconButton}>
            <Feather name="star" size={20} color={favorites.includes(channel.id) ? colors.primary : colors.mutedForeground} />
          </Pressable>
        </View>;
      }}
      initialNumToRender={16}
      maxToRenderPerBatch={12}
      windowSize={9}
      showsVerticalScrollIndicator={false}
    />
  </View>;
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 28, fontWeight: "800" },
  refresh: { minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7 },
  search: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  categories: { gap: 7, paddingVertical: 2 },
  category: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  list: { padding: 14, paddingBottom: 40 },
  row: { borderWidth: 1, borderRadius: 12, marginBottom: 8, flexDirection: "row", alignItems: "center" },
  main: { flex: 1, minHeight: 68, flexDirection: "row", alignItems: "center", gap: 10, padding: 10 },
  logo: { width: 46, height: 46, borderRadius: 8 },
  iconButton: { padding: 12 },
});
