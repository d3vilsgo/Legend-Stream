import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { usePlayer } from "@/context/PlayerContext";
import { useColors } from "@/hooks/useColors";
import {
  getManualEpgSnapshot,
  manualEpgDiagnosticLines,
  recordManualEpgHeartbeat,
  subscribeManualEpg,
} from "@/lib/manualEpgMode";

export function ManualEpgControl({ providerId, enabled }: { providerId: string; enabled: boolean }) {
  const colors = useColors();
  const { loadEpgManually } = usePlayer();
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const state = useSyncExternalStore(subscribeManualEpg, getManualEpgSnapshot, getManualEpgSnapshot);
  const activeProvider = state.providerId === providerId;
  const loading = activeProvider && state.manualActive;
  const pressCount = activeProvider ? state.manualPressCount : 0;

  useEffect(() => {
    let expected = Date.now() + 1_000;
    const timer = setInterval(() => {
      recordManualEpgHeartbeat(providerId, Date.now() - expected);
      expected = Date.now() + 1_000;
    }, 1_000);
    return () => clearInterval(timer);
  }, [providerId]);

  return <View style={{ marginTop: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="EPG'yi Yükle"
        disabled={loading || !enabled}
        onPress={() => void loadEpgManually(providerId)}
        style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
          borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8, opacity: loading || !enabled ? 0.6 : 1 }}
      >
        <Text style={{ color: colors.foreground, fontWeight: "700" }}>
          {loading ? "EPG Yükleniyor…" : pressCount ? "EPG'yi Yenile" : "EPG'yi Yükle"}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="EPG tanılama"
        onPress={() => setShowDiagnostics((shown) => !shown)}>
        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>EPG DBG</Text>
      </Pressable>
    </View>
    {activeProvider && (state.manualResult === "failure" || state.manualResult === "timeout") && !loading
      ? <Text style={{ color: colors.destructive, marginTop: 4 }}>EPG yüklenemedi</Text> : null}
    {showDiagnostics ? <Text selectable style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 5 }}>
      {manualEpgDiagnosticLines(activeProvider ? state : {
        ...state, providerId, manualPressCount: 0, lastManualPressAt: null,
        manualActive: false, manualElapsedMs: null, manualResult: "idle", autoStartCount: 0,
        heartbeatDriftMaxMs: 0,
      }).join("\n")}
    </Text> : null}
  </View>;
}
