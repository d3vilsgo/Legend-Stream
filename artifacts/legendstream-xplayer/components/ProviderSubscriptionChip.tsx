import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ProviderConfig } from "@/context/PlayerContext";
import { useColors } from "@/hooks/useColors";
import {
  accountRemainingMs,
  getXtreamAccountInfo,
  XtreamAccountInfo,
} from "@/lib/xtreamAccount";

type Props = {
  provider: ProviderConfig;
};

const MONTHS_TR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

const pad = (value: number) => String(value).padStart(2, "0");

const formatDateTime = (value?: number) => {
  if (!value || !Number.isFinite(value)) return "Belirtilmemiş";
  const date = new Date(value);
  return `${pad(date.getDate())} ${MONTHS_TR[date.getMonth()]} ${date.getFullYear()} · ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatDate = (value?: number) => {
  if (!value || !Number.isFinite(value)) return "Belirtilmemiş";
  const date = new Date(value);
  return `${pad(date.getDate())} ${MONTHS_TR[date.getMonth()]} ${date.getFullYear()}`;
};

const formatRemaining = (info?: XtreamAccountInfo, compact = false) => {
  if (!info?.expiresAt) return compact ? "Süre bilgisi yok" : "Belirtilmemiş";
  const remaining = accountRemainingMs(info);
  if (remaining === undefined) return compact ? "Süre bilgisi yok" : "Belirtilmemiş";
  if (remaining <= 0) return "Süresi doldu";

  const totalMinutes = Math.floor(remaining / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (compact) {
    if (days > 0) return `${days} gün kaldı`;
    if (hours > 0) return `${hours} saat kaldı`;
    return `${Math.max(1, minutes)} dk kaldı`;
  }

  if (days > 0) return `${days} gün ${hours} saat`;
  if (hours > 0) return `${hours} saat ${minutes} dakika`;
  return `${Math.max(1, minutes)} dakika`;
};

const maskUsername = (value?: string) => {
  if (!value) return "—";
  const clean = value.trim();
  if (clean.length <= 2) return "••";
  if (clean.length <= 4) return `${clean.slice(0, 1)}••${clean.slice(-1)}`;
  return `${clean.slice(0, 2)}***${clean.slice(-2)}`;
};

const normalizedStatus = (info?: XtreamAccountInfo) => {
  const remaining = info ? accountRemainingMs(info) : undefined;
  if (remaining !== undefined && remaining <= 0) return { label: "Süresi doldu", tone: "danger" as const };
  const status = info?.status?.trim().toLowerCase();
  if (!status) return { label: "Bilinmiyor", tone: "muted" as const };
  if (status === "active") return { label: "Aktif", tone: "active" as const };
  if (status === "disabled") return { label: "Devre dışı", tone: "danger" as const };
  if (status === "banned") return { label: "Engelli", tone: "danger" as const };
  if (status === "expired") return { label: "Süresi doldu", tone: "danger" as const };
  return { label: info?.status || "Bilinmiyor", tone: "muted" as const };
};

export function ProviderSubscriptionChip({ provider }: Props) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<XtreamAccountInfo | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canQuery = provider.type === "xtream" && Boolean(provider.username && provider.password);

  const refresh = useCallback(async () => {
    if (!canQuery || !provider.username || !provider.password) return;
    setLoading(true);
    setError(null);
    try {
      setInfo(await getXtreamAccountInfo({
        baseUrl: provider.url || provider.playlistUrl,
        username: provider.username,
        password: provider.password,
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Abonelik bilgileri alınamadı.");
    } finally {
      setLoading(false);
    }
  }, [canQuery, provider.password, provider.playlistUrl, provider.url, provider.username]);

  useEffect(() => {
    setInfo(undefined);
    setError(null);
    if (canQuery) void refresh();
  }, [provider.id, canQuery, refresh]);

  const status = useMemo(() => normalizedStatus(info), [info]);
  const statusColor = status.tone === "danger"
    ? colors.destructive
    : status.tone === "active"
      ? "#22c55e"
      : colors.mutedForeground;

  const connectionText = info?.activeConnections !== undefined || info?.maxConnections !== undefined
    ? `${info?.activeConnections ?? "—"} / ${info?.maxConnections ?? "—"}`
    : "Belirtilmemiş";

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Abonelik bilgilerini aç"
        onPress={() => {
          setOpen(true);
          if (canQuery && !loading) void refresh();
        }}
        style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.card }]}
      >
        <View style={[styles.dot, { backgroundColor: canQuery && !info ? colors.primary : statusColor }]} />
        <View style={styles.chipCopy}>
          <Text numberOfLines={1} style={[styles.providerName, { color: colors.foreground }]}>{provider.name}</Text>
          <Text numberOfLines={1} style={[styles.providerMeta, { color: colors.mutedForeground }]}>
            {loading && !info
              ? "Kontrol ediliyor…"
              : provider.type === "xtream"
                ? info ? `${status.label} · ${formatRemaining(info, true)}` : "Abonelik bilgisi"
                : provider.type.toUpperCase()}
          </Text>
        </View>
        <Feather name="chevron-down" size={15} color={colors.mutedForeground} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={[styles.handle, { backgroundColor: colors.mutedForeground }]} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Abonelik Bilgileri</Text>
                <Text numberOfLines={1} style={{ color: colors.mutedForeground }}>{provider.name}</Text>
              </View>
              <Pressable onPress={() => setOpen(false)} style={styles.closeButton} hitSlop={8}>
                <Feather name="x" size={22} color={colors.foreground} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.rows}>
              {provider.type !== "xtream" ? (
                <View style={[styles.notice, { borderColor: colors.border, backgroundColor: colors.card }]}>
                  <Feather name="info" size={20} color={colors.primary} />
                  <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>
                    Bu bağlantı türü abonelik bitişi ve aktif bağlantı sayısını standart olarak sağlamıyor.
                  </Text>
                </View>
              ) : null}

              {error ? (
                <View style={[styles.notice, { borderColor: colors.destructive, backgroundColor: colors.card }]}>
                  <Feather name="alert-circle" size={20} color={colors.destructive} />
                  <Text style={[styles.noticeText, { color: colors.destructive }]}>{error}</Text>
                </View>
              ) : null}

              <InfoRow label="Durum" value={provider.type === "xtream" ? status.label : "Bağlı"} valueColor={provider.type === "xtream" ? statusColor : "#22c55e"} />
              <InfoRow label="Abonelik bitişi" value={provider.type === "xtream" ? formatDateTime(info?.expiresAt) : "Sağlayıcı tarafından sunulmuyor"} />
              <InfoRow label="Kalan süre" value={provider.type === "xtream" ? formatRemaining(info) : "—"} strong />
              <InfoRow label="Aktif bağlantı" value={provider.type === "xtream" ? connectionText : "—"} strong />
              <InfoRow label="Hesap türü" value={provider.type === "xtream" ? info ? (info.isTrial ? "Deneme" : "Standart") : "Belirtilmemiş" : provider.type.toUpperCase()} />
              <InfoRow label="Deneme hesabı" value={provider.type === "xtream" ? info ? (info.isTrial ? "Evet" : "Hayır") : "Belirtilmemiş" : "—"} />
              <InfoRow label="Oluşturulma tarihi" value={provider.type === "xtream" ? formatDate(info?.createdAt) : formatDate(provider.createdAt)} />
              <InfoRow label="Sağlayıcı" value={provider.name} />
              <InfoRow label="Kullanıcı adı" value={provider.type === "xtream" ? maskUsername(provider.username) : provider.mac ? maskUsername(provider.mac) : "—"} />
            </ScrollView>

            {provider.type === "xtream" ? (
              <Pressable
                disabled={loading}
                onPress={() => void refresh()}
                style={[styles.refreshButton, { backgroundColor: colors.primary, opacity: loading ? 0.6 : 1 }]}
              >
                <Feather name="refresh-cw" size={18} color="#041018" />
                <Text style={styles.refreshText}>{loading ? "Kontrol ediliyor…" : "Bilgileri yenile"}</Text>
              </Pressable>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function InfoRow({ label, value, strong = false, valueColor }: {
  label: string;
  value: string;
  strong?: boolean;
  valueColor?: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <Text
        numberOfLines={2}
        style={[
          styles.value,
          { color: valueColor || colors.foreground },
          strong && styles.valueStrong,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    maxWidth: 235,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 999,
    paddingLeft: 11,
    paddingRight: 9,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipCopy: { minWidth: 0, flexShrink: 1 },
  providerName: { fontWeight: "800", fontSize: 12.5 },
  providerMeta: { fontSize: 10.5, marginTop: 1 },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,.58)",
  },
  sheet: {
    width: "100%",
    maxHeight: "88%",
    borderTopWidth: 1,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 9,
    paddingBottom: 22,
  },
  handle: { width: 42, height: 4, borderRadius: 4, opacity: 0.45, alignSelf: "center", marginBottom: 14 },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  sheetTitle: { fontSize: 23, fontWeight: "900" },
  closeButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  rows: { paddingBottom: 10 },
  row: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  label: { flex: 0.43, fontSize: 13 },
  value: { flex: 0.57, textAlign: "right", fontSize: 14, fontWeight: "600" },
  valueStrong: { fontSize: 15, fontWeight: "900" },
  notice: {
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    marginVertical: 8,
  },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18 },
  refreshButton: {
    marginTop: 12,
    minHeight: 48,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  refreshText: { color: "#041018", fontWeight: "900", fontSize: 14 },
});
