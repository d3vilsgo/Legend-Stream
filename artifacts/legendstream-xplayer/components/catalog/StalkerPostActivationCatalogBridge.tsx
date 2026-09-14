import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCatalogSync } from "@/context/CatalogSyncContext";
import { usePlayer } from "@/context/PlayerContext";
import { useColors } from "@/hooks/useColors";
import { subscribeStalkerLivePublishRevision } from "@/lib/stalkerLivePublishRevision";

export function StalkerPostActivationCatalogBridge() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { provider, connectProvider, isLoading, clearError } = usePlayer();
  const { syncState, refreshCatalog, refreshSnapshot } = useCatalogSync();
  const activeProviderIdRef = useRef<string | null>(provider?.id ?? null);
  const [repairOpen, setRepairOpen] = useState(false);
  const [repairUrl, setRepairUrl] = useState("");
  const [repairMac, setRepairMac] = useState("");
  const [repairError, setRepairError] = useState<string | null>(null);
  activeProviderIdRef.current = provider?.id ?? null;

  useEffect(() => {
    if (!provider || provider.type !== "stalker") return;
    const providerId = provider.id;
    return subscribeStalkerLivePublishRevision(providerId, "live", () => {
      if (activeProviderIdRef.current !== providerId) return;
      void refreshSnapshot().catch(() => undefined);
    });
  }, [provider?.id, provider?.type, refreshSnapshot]);

  useEffect(() => {
    if (!repairOpen || !provider || provider.type !== "stalker") return;
    setRepairUrl(provider.url || provider.playlistUrl || "");
    setRepairMac(provider.mac || "");
    setRepairError(null);
  }, [repairOpen, provider?.id, provider?.type]);

  if (!provider || provider.type !== "stalker") return null;

  const phase = syncState?.providerId === provider.id ? syncState.phase : "idle";
  const safeErrorCode = syncState && "errorCode" in syncState
    ? syncState.errorCode
    : undefined;
  const showNotice =
    phase === "credentials-required" ||
    phase === "preparing" ||
    phase === "syncing" ||
    phase === "error" ||
    phase === "cancelled";
  const noticeMessage = phase === "preparing" || phase === "syncing"
    ? "Canlı TV hazırlanıyor…"
    : syncState?.message || "Canlı TV kataloğu hazırlanamadı.";
  const canRetry = phase === "error" || phase === "cancelled";
  const canRepair = phase === "credentials-required" || phase === "error";

  const submitRepair = async () => {
    const url = repairUrl.trim();
    const mac = repairMac.trim();
    if (!/^https?:\/\//i.test(url)) {
      setRepairError("Geçerli bir Stalker portal URL'si girin.");
      return;
    }
    if (!mac) {
      setRepairError("Stalker için MAC adresi gerekir.");
      return;
    }
    setRepairError(null);
    clearError();
    const ok = await connectProvider({
      providerId: provider.id,
      name: provider.name,
      type: "stalker",
      playlistUrl: url,
      url,
      mac,
    });
    if (ok) setRepairOpen(false);
  };

  return <>
    {showNotice ? <View
      pointerEvents="box-none"
      style={[styles.noticeWrap, { bottom: Math.max(insets.bottom, 10) + 12 }]}
    >
      <View style={[styles.notice, { backgroundColor: colors.card, borderColor: phase === "error" || phase === "credentials-required" ? colors.destructive : colors.border }]}> 
        {(phase === "preparing" || phase === "syncing") ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.foreground, fontWeight: "800" }}>{noticeMessage}</Text>
          {safeErrorCode ? <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{safeErrorCode}</Text> : null}
        </View>
        {canRetry ? <Pressable
          accessibilityRole="button"
          onPress={() => void refreshCatalog()}
          style={[styles.action, { borderColor: colors.border }]}
        >
          <Text style={{ color: colors.foreground, fontWeight: "800" }}>Tekrar dene</Text>
        </Pressable> : null}
        {canRepair ? <Pressable
          accessibilityRole="button"
          onPress={() => setRepairOpen(true)}
          style={[styles.action, { borderColor: colors.border }]}
        >
          <Text style={{ color: colors.foreground, fontWeight: "800" }}>Provider ayarları</Text>
        </Pressable> : null}
      </View>
    </View> : null}

    <Modal visible={repairOpen} transparent animationType="fade" onRequestClose={() => setRepairOpen(false)}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Stalker bağlantı ayarları</Text>
          <Text style={{ color: colors.mutedForeground }}>
            Portal URL ve MAC adresini yeniden doğrulayın.
          </Text>
          <TextInput
            value={repairUrl}
            onChangeText={setRepairUrl}
            placeholder="http://portal.example/stalker_portal/"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          <TextInput
            value={repairMac}
            onChangeText={setRepairMac}
            placeholder="00:1A:79:XX:XX:XX"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          {repairError ? <Text style={{ color: colors.destructive }}>{repairError}</Text> : null}
          <View style={styles.modalActions}>
            <Pressable
              disabled={isLoading}
              onPress={() => setRepairOpen(false)}
              style={[styles.action, { borderColor: colors.border }]}
            >
              <Text style={{ color: colors.foreground, fontWeight: "800" }}>Vazgeç</Text>
            </Pressable>
            <Pressable
              disabled={isLoading}
              onPress={() => void submitRepair()}
              style={[styles.action, { borderColor: colors.primary, opacity: isLoading ? 0.6 : 1 }]}
            >
              {isLoading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
              <Text style={{ color: colors.primary, fontWeight: "900" }}>Yeniden doğrula</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  noticeWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 1000,
    elevation: 20,
    alignItems: "center",
  },
  notice: {
    width: "100%",
    maxWidth: 920,
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  action: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2,6,18,0.78)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    borderWidth: 1,
    borderRadius: 18,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "900",
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 4,
  },
});
