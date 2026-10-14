import React from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useUiPresentation } from "@/context/UiPresentationContext";
import { useColors } from "@/hooks/useColors";

export function TVPreviewSetting() {
  const { tvPreview, setTvPreview } = useUiPresentation();
  const colors = useColors();
  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <View style={styles.copy}>
      <Text style={{ color: colors.foreground, fontWeight: "800", fontSize: 16 }}>TV Arayüzü Önizlemesi</Text>
      <Text style={{ color: colors.mutedForeground, lineHeight: 19 }}>Telefon veya tablette yatay TV kataloğunu ve sanal kumandayı açar.</Text>
    </View>
    <View style={styles.control}>
      <Text style={{ color: tvPreview ? colors.primary : colors.mutedForeground, fontWeight: "700" }}>{tvPreview ? "Açık" : "Kapalı"}</Text>
      <Switch testID="tv-preview-toggle" value={tvPreview} onValueChange={setTvPreview} accessibilityRole="switch" accessibilityLabel="TV Arayüzü Aç/Kapat" accessibilityState={{ checked: tvPreview }} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 18, flexDirection: "row", alignItems: "center", gap: 12 },
  copy: { flex: 1, gap: 5 },
  control: { alignItems: "center", gap: 2 },
});
