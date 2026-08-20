import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/context/I18nContext";
import {
  ActiveDownload,
  deleteDownload,
  DownloadedMedia,
  listDownloads,
  subscribeActiveDownloads,
} from "@/lib/downloads";

const formatBytes = (bytes?: number | null) => {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};

const percent = (item: ActiveDownload) => `${Math.round(item.progress * 100)}%`;

export function DownloadsView({ onOpen }: { onOpen: (item: DownloadedMedia) => void }) {
  const colors = useColors();
  const { t } = useI18n();
  const [items, setItems] = useState<DownloadedMedia[]>([]);
  const [active, setActive] = useState<ActiveDownload[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setItems(await listDownloads()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => subscribeActiveDownloads((next) => {
    setActive(next);
    if (!next.length) void reload();
  }), [reload]);

  const remove = async (id: string) => {
    await deleteDownload(id);
    await reload();
  };

  return <View>
    <View style={s.header}>
      <View>
        <Text style={[s.title, { color: colors.foreground }]}>{t("download")}</Text>
        <Text style={{ color: colors.mutedForeground }}>
          {active.length ? `${active.length} · ${t("downloading")}` : loading ? t("loading") : `${items.length} ${t("downloaded").toLowerCase()}`}
        </Text>
      </View>
      <Pressable onPress={() => void reload()} style={[s.iconButton, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Feather name="refresh-cw" size={20} color={colors.foreground} />
      </Pressable>
    </View>

    {active.length ? <View style={{ gap: 9, marginBottom: 18 }}>
      {active.map((item) => <View key={item.id} style={[s.row, { borderColor: item.status === "failed" ? colors.destructive : colors.border, backgroundColor: colors.card }]}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "800", fontSize: 15 }}>{item.title}</Text>
          <Text style={{ color: item.status === "failed" ? colors.destructive : colors.mutedForeground, fontSize: 12 }}>
            {item.status === "failed" ? `${t("downloadFailed")} · ${item.error || ""}` : `${t("downloading")} · ${percent(item)} · ${formatBytes(item.bytesWritten)} / ${formatBytes(item.bytesExpected)}`}
          </Text>
          {item.status !== "failed" ? <View style={[s.track, { backgroundColor: colors.muted }]}><View style={[s.progress, { width: `${Math.max(2, item.progress * 100)}%`, backgroundColor: colors.primary }]} /></View> : null}
        </View>
      </View>)}
    </View> : null}

    {!loading && !items.length && !active.length ? <View style={s.empty}>
      <Feather name="download-cloud" size={42} color={colors.mutedForeground} />
      <Text style={{ color: colors.mutedForeground, textAlign: "center" }}>{t("nothingYet")}</Text>
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
  track: { height: 5, borderRadius: 4, overflow: "hidden" },
  progress: { height: "100%" },
});
