import React, { useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { usePlayer } from "@/context/PlayerContext";
import { useColors } from "@/hooks/useColors";
import { getManualEpgSnapshot, subscribeManualEpg } from "@/lib/manualEpgMode";

export function ManualEpgControl({ providerId, enabled }: { providerId: string; enabled: boolean }) {
  const colors = useColors();
  const { loadEpgManually } = usePlayer();
  const state = useSyncExternalStore(subscribeManualEpg, getManualEpgSnapshot, getManualEpgSnapshot);
  const activeProvider = state.providerId === providerId;
  const loading = activeProvider && state.manualActive;
  const pressCount = activeProvider ? state.manualPressCount : 0;

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
    </View>
    {activeProvider && (state.manualResult === "failure" || state.manualResult === "timeout") && !loading
      ? <Text style={{ color: colors.destructive, marginTop: 4 }}>EPG yüklenemedi</Text> : null}
  </View>;
}
