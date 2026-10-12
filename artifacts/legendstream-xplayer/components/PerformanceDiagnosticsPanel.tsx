import * as Clipboard from "expo-clipboard";
import React, { useState, useSyncExternalStore } from "react";
import { ScrollView, Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { useColors } from "@/hooks/useColors";
import {
  formatPerformanceDiagnostics,
  getPerformanceDiagnosticsSnapshot,
  setPerformanceDiagnosticsEnabled,
  subscribePerformanceDiagnostics,
} from "@/lib/performanceDiagnostics";

export function PerformanceDiagnosticsPanel() {
  const colors = useColors();
  const snapshot = useSyncExternalStore(
    subscribePerformanceDiagnostics,
    getPerformanceDiagnosticsSnapshot,
    getPerformanceDiagnosticsSnapshot,
  );
  const [message, setMessage] = useState<string | null>(null);
  const report = formatPerformanceDiagnostics(snapshot);
  const hasReport = snapshot.startups.length > 0 || snapshot.playback.length > 0;

  return <View style={{ gap: 10 }}>
    <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "800" }}>
      Performance Diagnostics
    </Text>
    <Text style={{ color: colors.mutedForeground }}>
      Geçici startup ve playback sürelerini ölçer. URL, token, kullanıcı adı, parola, MAC veya authorization header kaydedilmez.
    </Text>
    <FocusButton
      label={snapshot.enabled ? "Performans Kaydını Kapat" : "Performans Kaydını Aç"}
      icon={snapshot.enabled ? "pause-circle" : "play-circle"}
      disabled={!snapshot.preferenceLoaded}
      onPress={() => void setPerformanceDiagnosticsEnabled(!snapshot.enabled)
        .then(() => setMessage(snapshot.enabled ? "Performans kaydı kapatıldı." : "Performans kaydı açıldı. Sonraki cold-start ölçülebilir."))
        .catch(() => setMessage("Performans tercihi kaydedilemedi."))}
    />
    <FocusButton
      label="Performans Raporunu Kopyala"
      icon="copy"
      disabled={!snapshot.preferenceLoaded || (!snapshot.enabled && !hasReport)}
      onPress={() => void Clipboard.setStringAsync(report)
        .then(() => setMessage("Redakte edilmiş performans raporu panoya kopyalandı."))
        .catch(() => setMessage("Performans raporu kopyalanamadı."))}
    />
    {message ? <Text style={{ color: colors.mutedForeground }}>{message}</Text> : null}
    <ScrollView
      nestedScrollEnabled
      style={{ maxHeight: 420, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 }}
    >
      <Text selectable style={{ color: colors.foreground, fontFamily: "monospace", fontSize: 12 }}>
        {snapshot.enabled || hasReport ? report : "Tanılama kapalı. Etkinleştirdikten sonra uygulamayı tamamen kapatıp yeniden açın."}
      </Text>
    </ScrollView>
  </View>;
}
