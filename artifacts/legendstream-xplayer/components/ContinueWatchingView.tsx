import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMediaLibrary, MediaProgress } from "@/context/MediaLibraryContext";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/context/I18nContext";

const time = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

export function ContinueWatchingView({ onOpen }: { onOpen: (item: MediaProgress) => void }) {
  const colors = useColors();
  const { t } = useI18n();
  const { entries, clearProgress, removeProgress } = useMediaLibrary();

  return <View>
    <View style={s.header}>
      <Text style={[s.title, { color: colors.foreground }]}>{t("continueWatching")}</Text>
      {entries.length ? <Pressable onPress={() => void clearProgress()} style={s.clear}><Text style={{ color: colors.mutedForeground }}>{t("clearAll")}</Text></Pressable> : null}
    </View>
    {!entries.length ? <Text style={{ color: colors.mutedForeground }}>{t("nothingYet")}</Text> : null}
    <View style={{ gap: 9 }}>
      {entries.map((item) => {
        const pct = item.duration > 0 ? Math.min(1, item.position / item.duration) : 0;
        return <View key={item.id} style={[s.row, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Pressable onPress={() => onOpen(item)} style={{ flex: 1, gap: 5 }}>
            <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "800" }}>{item.title}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{item.kind === "episode" ? t("episode") : t("movies")} · {time(item.position)}{item.duration > 0 ? ` / ${time(item.duration)}` : ""}</Text>
            {item.duration > 0 ? <View style={[s.track, { backgroundColor: colors.muted }]}><View style={[s.progress, { width: `${pct * 100}%`, backgroundColor: colors.primary }]} /></View> : null}
          </Pressable>
          <Pressable onPress={() => void removeProgress(item.source)} style={s.remove}><Feather name="x" size={20} color={colors.mutedForeground} /></Pressable>
        </View>;
      })}
    </View>
  </View>;
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  title: { fontSize: 24, fontWeight: "800" },
  clear: { paddingHorizontal: 10, paddingVertical: 8 },
  row: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  remove: { padding: 8 },
  track: { height: 4, borderRadius: 3, overflow: "hidden" },
  progress: { height: "100%" },
});
