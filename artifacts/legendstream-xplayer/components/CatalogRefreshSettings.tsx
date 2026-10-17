import React, { useState } from "react";
import { Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/context/I18nContext";
import { useCatalogSync } from "@/context/CatalogSyncContext";
import { usePlayer } from "@/context/PlayerContext";
export function CatalogRefreshSettings() {
  const colors = useColors();
  const { t, language } = useI18n();
  const { provider, isLoading } = usePlayer();
  const {
    refreshPolicy,
    refreshPolicyReady,
    lastSuccessfulAt,
    setRefreshPolicy: onSetRefreshPolicy,
    refreshCatalog: onRefreshNow,
    syncState,
    snapshot,
    isSyncing,
    isRefreshing,
  } = useCatalogSync();
  const syncing = isLoading || isSyncing || isRefreshing,
    busy = syncing;
  const syncPhase =
    snapshot.providerId === provider?.id ? syncState?.phase : null;
  const [policySaveFailed, setPolicySaveFailed] = useState(false);
  const updatePolicy = (patch: Partial<typeof refreshPolicy>) => {
    setPolicySaveFailed(false);
    void onSetRefreshPolicy({ ...refreshPolicy, ...patch }).catch(() =>
      setPolicySaveFailed(true),
    );
  };
  const status = syncing
    ? t("catalogUpdating")
    : syncPhase === "error"
      ? t("catalogUpdateFailed")
      : syncPhase === "ready" || syncPhase === "cache-ready"
        ? t("catalogReady")
        : t("catalogIdle");
  if (!provider) return null;
  return (
    <View
      style={{
        borderWidth: 1,
        borderRadius: 16,
        padding: 18,
        gap: 8,
        borderColor: colors.border,
        backgroundColor: colors.card,
        marginTop: 18,
      }}
    >
      <Text
        style={{ color: colors.foreground, fontWeight: "800", fontSize: 16 }}
      >
        {t("catalogManagement")}
      </Text>
      <Text style={{ color: colors.mutedForeground }}>
        {t("automaticCatalogRefresh")}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <FocusButton
          label={
            refreshPolicy.automaticRefreshEnabled ? t("enabled") : t("disabled")
          }
          icon={
            refreshPolicy.automaticRefreshEnabled ? "check-circle" : "slash"
          }
          variant={
            refreshPolicy.automaticRefreshEnabled ? "secondary" : "ghost"
          }
          disabled={!refreshPolicyReady}
          onPress={() =>
            updatePolicy({
              automaticRefreshEnabled: !refreshPolicy.automaticRefreshEnabled,
            })
          }
        />
      </View>
      <Text style={{ color: colors.mutedForeground }}>
        {t("catalogRefreshInterval")}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <FocusButton
          label={t("hours24")}
          variant={
            refreshPolicy.refreshIntervalHours === 24 ? "secondary" : "ghost"
          }
          disabled={!refreshPolicyReady}
          onPress={() => updatePolicy({ refreshIntervalHours: 24 })}
        />
        <FocusButton
          label={t("days3")}
          variant={
            refreshPolicy.refreshIntervalHours === 72 ? "secondary" : "ghost"
          }
          disabled={!refreshPolicyReady}
          onPress={() => updatePolicy({ refreshIntervalHours: 72 })}
        />
      </View>
      <FocusButton
        label={syncing ? t("catalogUpdating") : t("updateNow")}
        icon="refresh-cw"
        disabled={syncing || busy || !refreshPolicyReady}
        onPress={onRefreshNow}
      />
      <Text style={{ color: colors.mutedForeground }}>
        {t("lastSuccessfulCatalogUpdate")}:{" "}
        {lastSuccessfulAt
          ? new Date(lastSuccessfulAt).toLocaleString(language)
          : t("never")}
      </Text>
      <Text style={{ color: colors.mutedForeground }}>
        {t("catalogUpdateStatus")}: {status}
      </Text>
      {provider.type === "stalker" ? (
        <Text style={{ color: colors.mutedForeground }}>
          {t("stalkerRefreshScope")}
        </Text>
      ) : null}
      {policySaveFailed ? (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {t("catalogPolicySaveFailed")}
        </Text>
      ) : null}
    </View>
  );
}
