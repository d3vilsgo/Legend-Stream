import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/context/I18nContext";
import { deleteDownload, DownloadedMedia, listDownloads } from "@/lib/downloads";

const formatBytes = (bytes?: number | null) => {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};

export function DownloadsView({ onOpen }: { onOpen: (item: DownloadedMedia) => void }) {
  const colors = useColors();
  const { t } = useI18n();
  const [items, setItems] = useState<DownloadedMedia[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setItems(await listDownloads()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const remove = async (id: string) => {
    await deleteDownload(id);
    await reload();
  };

  return <View>
    <View style={s.header}>
      <View>
        <Text style={[s.title, { color: colors.foreground }]}>{t("downloads")}</Text>
        <Text style={{ color: colors.mutedForeground }}>{loading ? t("loading") : `${items.length} ${t("downloaded").toLowerCase()}`}</Text>
      </View>
      <Pressable onPress={() => void reload()} style={[s.iconButton, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Feather name="refresh-cw" size={20} color={colors.foreground} />
      </Pressable>
    </View>

    {!loading && !items.length ? <View style={s.empty}>
      <Feather name="download-cloud" size={42} color={colors.mutedForeground} />
      <Text style={{ color: colors.mutedForeground, textAlign: "center" }}>{t("noDownloads")}</Text>
    </View> : null}

    <View style={{ gap: 9 }}>
      {items.map((item) => <View key={item.id} style={[s.row, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Pressable style={{ flex: 1, gap: 3 }} onPress={() => onOpen(item)}>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "800", fontSize: 15 }}>{item.title}</Text>
          {item.subtitle ? <Text numberOfLines={1} style={{ color: colors.mutedForeground }}>{item.subtitle}</Text> : null}
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{item.kind === "episode" ? t("episode") : t("movies")} · {formatBytes(item.size)}</Text>
        </Pressable>
        <Pressable onPress={() => void remove(item.id)} style={s.trash}>
          <Feather name="trash-2" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>)}
    </View>
  </View>;
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  title: { fontSize: 28, fontWeight: "800" },
  iconButton: { width: 46, height: 46, borderRadius: 13, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  empty: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: 12 },
  row: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  trash: { padding: 10 },
});
