import * as Clipboard from "expo-clipboard";
import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { useColors } from "@/hooks/useColors";
import {
  formatCredentialDiagnostics,
  runCredentialDiagnostics,
  type CredentialDiagnosticsReport,
} from "@/lib/credentialDiagnostics";
import { cryptoAvailable, nobleCryptoRuntimeTypes } from "@/lib/providerBackupCore";
import {
  formatProviderImportMetrics,
  type ProviderImportMetricsReport,
} from "@/lib/providerImportMetrics";
import { readLatestProviderImportMetrics } from "@/lib/providerImportMetricsStore";
import {
  formatCatalogSyncMeasurement,
  formatCatalogSyncMeasurementMetadata,
  readCatalogSyncMeasurementDisplay,
  type CatalogSyncMeasurementDisplay,
} from "@/lib/catalogSyncMetrics";
import { redactSensitiveText, safeLog } from "@/lib/safeLog";

const formatDiagnosticsWithCryptoRuntime = (report: CredentialDiagnosticsReport) =>
  `${formatCredentialDiagnostics(report)}\ncryptoAvailable=${cryptoAvailable}\nnobleCryptoRuntimeTypes=${JSON.stringify(nobleCryptoRuntimeTypes())}`;

const errorMessage = (error: unknown) =>
  redactSensitiveText(error instanceof Error ? error.message : String(error));

const fatalDiagnostics = (message: string) => JSON.stringify({
  fatalError: message,
  cryptoAvailable,
  nobleCryptoRuntimeTypes: nobleCryptoRuntimeTypes(),
});

export function useCredentialDiagnosticsStartup() {
  useEffect(() => {
    let active = true;
    void runCredentialDiagnostics()
      .then((report) => {
        if (!active) return;
        safeLog.info("LS_DIAG", formatDiagnosticsWithCryptoRuntime(report));
      })
      .catch((error) => {
        if (!active) return;
        safeLog.info("LS_DIAG", fatalDiagnostics(errorMessage(error)));
      });
    return () => {
      active = false;
    };
  }, []);
}

export function CredentialDiagnosticsPanel() {
  const colors = useColors();
  const [report, setReport] = useState<CredentialDiagnosticsReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [importMetrics, setImportMetrics] = useState<ProviderImportMetricsReport | null>(null);
  const [catalogDisplay, setCatalogDisplay] = useState<CatalogSyncMeasurementDisplay | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [catalogCopyMessage, setCatalogCopyMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void readCatalogSyncMeasurementDisplay()
      .then((display) => {
        if (active) setCatalogDisplay(display);
      })
      .catch(() => {
        if (active) setCatalogDisplay({ state: "empty", metadata: null, measurement: null });
      });
    return () => {
      active = false;
    };
  }, []);

  const refreshCatalogMeasurement = () => {
    setCatalogCopyMessage(null);
    void readCatalogSyncMeasurementDisplay()
      .then((display) => setCatalogDisplay(display))
      .catch(() => setCatalogDisplay({ state: "empty", metadata: null, measurement: null }));
  };

  const run = async () => {
    setBusy(true);
    setFatalError(null);
    setCopyMessage(null);
    setCatalogCopyMessage(null);
    try {
      const [next, latestImportMetrics, latestCatalogDisplay] = await Promise.all([
        runCredentialDiagnostics(),
        readLatestProviderImportMetrics().catch(() => null),
        readCatalogSyncMeasurementDisplay().catch(
          (): CatalogSyncMeasurementDisplay => ({ state: "empty", metadata: null, measurement: null }),
        ),
      ]);
      setReport(next);
      setImportMetrics(latestImportMetrics);
      setCatalogDisplay(latestCatalogDisplay);
      safeLog.info("LS_DIAG", formatDiagnosticsWithCryptoRuntime(next));
    } catch (error) {
      const message = errorMessage(error);
      setFatalError(message);
      safeLog.info("LS_DIAG", fatalDiagnostics(message));
    } finally {
      setBusy(false);
    }
  };

  const completedCatalogMeasurement = catalogDisplay?.state === "completed"
    ? catalogDisplay.measurement
    : null;

  return (
    <View style={{ marginTop: 24, gap: 10 }}>
      <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "800" }}>Tanılama</Text>
      <Text style={{ color: colors.mutedForeground }}>
        Salt okunur credential tanısı. Kimlik bilgisi değerleri gösterilmez; yalnız kayıt varlığı, alan adları ve hatalar raporlanır.
      </Text>
      <FocusButton
        label={busy ? "Tanılama çalışıyor…" : "Tanılamayı Çalıştır"}
        icon="activity"
        disabled={busy}
        onPress={() => void run()}
      />
      {fatalError ? <Text selectable style={{ color: colors.destructive }}>{fatalError}</Text> : null}
      {report ? (
        <ScrollView
          nestedScrollEnabled
          style={{ maxHeight: 360, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 }}
        >
          <Text selectable style={{ color: colors.foreground, fontFamily: "monospace", fontSize: 12 }}>
            {formatDiagnosticsWithCryptoRuntime(report)}
          </Text>
        </ScrollView>
      ) : null}

      <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "800" }}>
        Son katalog senkronizasyonu
      </Text>
      <Text style={{ color: colors.mutedForeground }}>
        Yalnız performans sayaçları gösterilir. Sağlayıcı kimliği, adı, sunucu adresi, kullanıcı adı, parola, token, credential ve stream URL bilgileri bu çıktıya dahil edilmez.
      </Text>
      <FocusButton
        label="Katalog Ölçümünü Yenile"
        icon="refresh-cw"
        onPress={refreshCatalogMeasurement}
      />
      {catalogDisplay?.state === "in-progress" && catalogDisplay.metadata ? <>
        <Text style={{ color: colors.mutedForeground }}>
          Yeni katalog ölçümü devam ediyor. Son tamamlanan turun ölçümü bu tur tamamlanana kadar gösterilmez.
        </Text>
        <ScrollView
          nestedScrollEnabled
          style={{ maxHeight: 180, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 }}
        >
          <Text selectable style={{ color: colors.foreground, fontFamily: "monospace", fontSize: 12 }}>
            {formatCatalogSyncMeasurementMetadata(catalogDisplay.metadata)}
          </Text>
        </ScrollView>
      </> : completedCatalogMeasurement ? <>
        <FocusButton
          label="Katalog Ölçümünü Kopyala"
          icon="copy"
          onPress={() => void Clipboard.setStringAsync(formatCatalogSyncMeasurement(completedCatalogMeasurement))
            .then(() => setCatalogCopyMessage("Katalog ölçümü panoya kopyalandı."))
            .catch(() => setCatalogCopyMessage("Katalog ölçümü panoya kopyalanamadı."))}
        />
        {catalogCopyMessage ? <Text style={{ color: colors.mutedForeground }}>{catalogCopyMessage}</Text> : null}
        <ScrollView
          nestedScrollEnabled
          style={{ maxHeight: 360, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 }}
        >
          <Text selectable style={{ color: colors.foreground, fontFamily: "monospace", fontSize: 12 }}>
            {formatCatalogSyncMeasurement(completedCatalogMeasurement)}
          </Text>
        </ScrollView>
      </> : (
        <Text style={{ color: colors.mutedForeground }}>
          Henüz tamamlanmış bir katalog senkronizasyonu ölçümü yok. Senkronizasyon bittikten sonra bu bölümü yenileyin.
        </Text>
      )}

      {importMetrics ? <>
        <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "800" }}>
          Son içe aktarma performansı
        </Text>
        <Text style={{ color: colors.mutedForeground }}>
          Kullanıcı karar süresi ayrı ölçülür ve düzeltilmiş toplamdan çıkarılır. Hesap kimliği veya kimlik bilgisi içermez.
        </Text>
        <FocusButton
          label="İçe Aktarma Ölçümünü Kopyala"
          icon="copy"
          onPress={() => void Clipboard.setStringAsync(formatProviderImportMetrics(importMetrics))
            .then(() => setCopyMessage("Ölçüm panoya kopyalandı."))
            .catch(() => setCopyMessage("Ölçüm panoya kopyalanamadı."))}
        />
        {copyMessage ? <Text style={{ color: colors.mutedForeground }}>{copyMessage}</Text> : null}
        <ScrollView
          nestedScrollEnabled
          style={{ maxHeight: 360, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 }}
        >
          <Text selectable style={{ color: colors.foreground, fontFamily: "monospace", fontSize: 12 }}>
            {formatProviderImportMetrics(importMetrics)}
          </Text>
        </ScrollView>
      </> : null}
    </View>
  );
}
