import * as Clipboard from "expo-clipboard";
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import {
  buildM3UDiagnosticReport,
  getM3UDiagnosticSnapshot,
  resetM3UDiagnosticCounters,
  subscribeM3UDiagnostics,
} from "@/lib/m3uInAppDiagnostics";
import { getM3UDiagnosticSourceShape } from "@/lib/catalogPageRepository";

export function M3UDiagnosticPanel({ providerId }: { providerId: string }) {
  const colors = useColors();
  const snapshot = useSyncExternalStore(
    subscribeM3UDiagnostics,
    getM3UDiagnosticSnapshot,
    getM3UDiagnosticSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Copy diagnostic report");
  const report = buildM3UDiagnosticReport(snapshot);

  useEffect(() => {
    if (!open) return;
    void getM3UDiagnosticSourceShape(providerId).catch(() => undefined);
  }, [open, providerId]);

  const copy = async () => {
    await Clipboard.setStringAsync(buildM3UDiagnosticReport(getM3UDiagnosticSnapshot()));
    setCopyLabel("Copied");
    setTimeout(() => setCopyLabel("Copy diagnostic report"), 1200);
  };

  return <View pointerEvents="box-none" style={styles.overlay}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open M3U diagnostic panel"
      onPress={() => setOpen((value) => !value)}
      style={({ pressed }) => [
        styles.floatingButton,
        {
          borderColor: colors.border,
          backgroundColor: colors.card,
          opacity: pressed ? 0.7 : 0.92,
        },
      ]}
    >
      <Text style={{ color: colors.foreground, fontWeight: "900", fontSize: 11 }}>M3U DBG</Text>
    </Pressable>

    {open ? <View
      style={[
        styles.panel,
        { borderColor: colors.border, backgroundColor: colors.card },
      ]}
    >
      <Text style={[styles.title, { color: colors.foreground }]}>M3U Diagnostic</Text>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        <Text selectable style={[styles.report, { color: colors.foreground }]}>{report}</Text>
      </ScrollView>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void copy()}
          style={[styles.action, { borderColor: colors.border }]}
        >
          <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 12 }}>{copyLabel}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={resetM3UDiagnosticCounters}
          style={[styles.action, { borderColor: colors.border }]}
        >
          <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 12 }}>Reset counters</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setOpen(false)}
          style={[styles.action, { borderColor: colors.border }]}
        >
          <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 12 }}>Close</Text>
        </Pressable>
      </View>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  floatingButton: {
    position: "absolute",
    right: 8,
    top: 112,
    minHeight: 34,
    minWidth: 62,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  panel: {
    position: "absolute",
    right: 8,
    top: 152,
    width: "88%",
    maxWidth: 560,
    maxHeight: "68%",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: "900",
  },
  scroll: {
    maxHeight: 420,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  report: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "monospace",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  action: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
