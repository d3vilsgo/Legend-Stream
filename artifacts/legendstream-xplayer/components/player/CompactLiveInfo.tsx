import {
  compactInfoHeight,
  realEpgProgress,
} from "@/lib/playerCompactPresentation";
import React from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PlayerProgramInfo } from "./PlayerChrome";

const clock = (value?: number) =>
  value && Number.isFinite(value)
    ? new Date(value).toLocaleTimeString("tr-TR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

export function CompactLiveInfo({
  title,
  now,
  next,
  loading,
  reserveBack,
}: {
  title: string;
  now?: PlayerProgramInfo;
  next?: PlayerProgramInfo;
  loading?: boolean;
  reserveBack: number;
}) {
  const { width, height } = useWindowDimensions();
  const safe = useSafeAreaInsets();
  const panelHeight = compactInfoHeight(height, safe.top, safe.bottom);
  const tight = panelHeight < 44;
  const progress = realEpgProgress(now?.start, now?.end);
  const availableWidth = width - safe.left - safe.right - reserveBack;
  return (
    <View
      testID="compact-live-info"
      pointerEvents="none"
      style={[
        styles.root,
        {
          top: safe.top,
          left: safe.left + reserveBack,
          right: safe.right,
          height: panelHeight,
          paddingHorizontal: tight ? 7 : 12,
          paddingVertical: tight ? 1 : 4,
        },
      ]}
    >
      <View style={styles.heading}>
        <Text
          numberOfLines={1}
          style={[
            styles.title,
            { fontSize: tight ? 11 : panelHeight < 66 ? 13 : 16 },
          ]}
        >
          {title.trim() || "Canlı yayın"}
        </Text>
        <View style={styles.livePill}>
          <View style={styles.dot} />
          <Text style={styles.liveText}>CANLI</Text>
        </View>
      </View>
      <View style={styles.programRow}>
        <Text
          numberOfLines={1}
          style={[styles.now, { fontSize: tight ? 9 : 11 }]}
        >
          {now?.title?.trim()
            ? `${clock(now.start)} ${now.title.trim()} ${clock(now.end)}`
            : loading
              ? "Program yükleniyor…"
              : "Program bilgisi yok"}
        </Text>
        {availableWidth > 580 && next?.title?.trim() ? (
          <Text
            numberOfLines={1}
            style={[styles.next, { fontSize: tight ? 9 : 10 }]}
          >
            Sonraki: {next.title.trim()}
          </Text>
        ) : null}
      </View>
      {progress !== null ? (
        <View testID="compact-live-epg-track" style={styles.track}>
          <View
            testID="compact-live-epg-fill"
            style={[styles.fill, { width: `${progress * 100}%` }]}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    zIndex: 56,
    backgroundColor: "rgba(9, 17, 30, 0.84)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(45, 212, 191, 0.55)",
    overflow: "hidden",
    justifyContent: "center",
    gap: 2,
  },
  heading: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },
  title: { flexShrink: 1, fontWeight: "700", color: "#f8fafc" },
  livePill: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#2dd4bf" },
  liveText: { fontWeight: "700", fontSize: 9, color: "#99f6e4" },
  programRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
  },
  now: { flex: 1, fontWeight: "500", color: "#e2e8f0" },
  next: { flex: 0.8, color: "#94a3b8" },
  track: { height: 2, width: "100%", backgroundColor: "rgba(148,163,184,.3)" },
  fill: { height: 2, backgroundColor: "#2dd4bf" },
});
