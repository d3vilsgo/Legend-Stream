import * as Clipboard from "expo-clipboard";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { FocusButton } from "@/components/FocusButton";
import { usePlayer } from "@/context/PlayerContext";
import { useColors } from "@/hooks/useColors";
import {
  CRYPTO_UNAVAILABLE_MESSAGE,
  cryptoAvailable,
  generateRecoveryPhrase,
  RECOVERY_ENTROPY_BITS,
  validateCustomBackupPassword,
  type ProviderBackupError,
} from "@/lib/providerBackupCore";
import { secureRandomBytes } from "@/lib/cryptoBootstrap";
import { normalizeRecoveryPhrasePassword } from "@/lib/recoveryPhrasePassword";
import {
  buildImportPlan,
  commitProviderImport,
  createProviderBackup,
  decryptProviderBackupForImport,
  listImportConflicts,
  providerBackupErrorCode,
  type ImportConflictChoice,
  type ProviderBackupPreview,
  type ProviderImportProgress,
} from "@/lib/providerBackupService";
import {
  pickEncryptedProviderBackup,
  shareEncryptedProviderBackup,
  type PickedProviderBackup,
} from "@/lib/providerBackupFiles";
import {
  createProviderImportMetricsReport,
  formatProviderImportMetrics,
} from "@/lib/providerImportMetrics";
import { saveLatestProviderImportMetrics } from "@/lib/providerImportMetricsStore";
import {
  setImportMemoryPhase,
  startImportMemorySampling,
  stopImportMemorySampling,
} from "@/modules/legendstream-diagnostics";

type ImportPasswordMode = "recovery" | "custom";
type ImportProgressState = { percent: number; label: string };

function commitProgressState(progress: ProviderImportProgress): ImportProgressState {
  const ratio = progress.total > 0 ? progress.completed / progress.total : 1;
  if (progress.phase === "snapshot") {
    return { percent: 62 + Math.round(ratio * 16), label: "Güvenli kayıtlar denetleniyor" };
  }
  if (progress.phase === "credential_write") {
    return { percent: 79 + Math.round(ratio * 14), label: "Hesap bilgileri güvenli depoya yazılıyor" };
  }
  if (progress.phase === "extension_write") {
    return { percent: 93, label: "Hesap uzantıları doğrulanıyor" };
  }
  if (progress.phase === "root_write") {
    return { percent: 96 + Math.round(ratio), label: "Yedek uzantıları doğrulanıyor" };
  }
  return { percent: progress.completed ? 99 : 98, label: "Hesap listesi kaydediliyor" };
}

export function ProviderBackupPanel({ mode = "full" }: { mode?: "full" | "import-only" }) {
  const colors = useColors();
  const { providers, activeProviderId, mergeImportedProviders } = usePlayer();
  const [dialog, setDialog] = useState<"export" | "import" | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [customPassword, setCustomPassword] = useState("");
  const [useCustomPassword, setUseCustomPassword] = useState(false);
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [importPassword, setImportPassword] = useState("");
  const [importPasswordMode, setImportPasswordMode] = useState<ImportPasswordMode>("recovery");
  const [picked, setPicked] = useState<PickedProviderBackup | null>(null);
  const [preview, setPreview] = useState<ProviderBackupPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, ImportConflictChoice>>({});
  const [importProgress, setImportProgress] = useState<ImportProgressState>({
    percent: 0,
    label: "Yedek bekleniyor",
  });
  const importMeasurementStartedAt = useRef(0);
  const importFileLoadedAt = useRef(0);
  const passwordEntryWaitMs = useRef(0);
  const unlockTotalMs = useRef(0);
  const importKdfMs = useRef(0);
  const conflictDecisionStartedAt = useRef(0);
  const conflictPreviewPreparedAt = useRef(0);
  const conflictUiReadyMs = useRef(0);

  const customValidation = useMemo(() => {
    if (!customPassword) return null;
    try {
      return validateCustomBackupPassword(customPassword);
    } catch {
      return null;
    }
  }, [customPassword]);

  const conflicts = useMemo(
    () => preview ? listImportConflicts(preview, providers) : [],
    [preview, providers],
  );
  const unresolved = conflicts.filter((conflict) => !choices[conflict.providerId]);

  useEffect(() => {
    if (!preview || !conflicts.length || conflictDecisionStartedAt.current) return;
    const readyAt = Date.now();
    conflictUiReadyMs.current = conflictPreviewPreparedAt.current
      ? readyAt - conflictPreviewPreparedAt.current
      : 0;
    conflictDecisionStartedAt.current = readyAt;
  }, [preview, conflicts.length]);

  const errorText = (error: unknown) => {
    const code = providerBackupErrorCode(error);
    if (code === "wrong_password") return "Yedek parolası yanlış.";
    if (code === "corrupt_file") return "Yedek dosyasının şifreli verisi bozuk veya değiştirilmiş.";
    if (code === "unsupported_version") return "Bu yedek daha yeni bir LegendStream sürümü tarafından oluşturulmuş.";
    if (code === "kdf_bounds") return "Yedekteki parola türetme parametreleri güvenli sınırların dışında.";
    if (code === "entropy_unavailable") return "Güvenli rastgele sayı kaynağı kullanılamıyor; işlem başlatılmadı.";
    if (code === "secure_record_too_large") return "Yedekteki güvenli hesap verilerinden biri cihazın desteklenen boyut sınırını aşıyor.";
    if (code === "weak_password") return "Kendi parolanız en az 12 karakter olmalı.";
    if (error instanceof Error) return error.message;
    return "Yedekleme işlemi tamamlanamadı.";
  };

  const beginExport = () => {
    setMessage(null);
    if (!cryptoAvailable) {
      setMessage(CRYPTO_UNAVAILABLE_MESSAGE);
      return;
    }
    try {
      const phrase = generateRecoveryPhrase(secureRandomBytes);
      setGeneratedPassword(phrase);
      setCustomPassword("");
      setUseCustomPassword(false);
      setRecoveryConfirmed(false);
      setProgress(0);
      setDialog("export");
    } catch (error) {
      setMessage(errorText(error));
    }
  };

  const performExport = async () => {
    const password = useCustomPassword
      ? customPassword
      : normalizeRecoveryPhrasePassword(generatedPassword);
    if (!useCustomPassword && !recoveryConfirmed) {
      setMessage("Devam etmeden önce kurtarma parolasını güvenli bir yere kaydettiğinizi onaylayın.");
      return;
    }
    if (useCustomPassword) {
      try {
        validateCustomBackupPassword(customPassword);
      } catch (error) {
        setMessage(errorText(error));
        return;
      }
    }
    setBusy(true);
    setProgress(0);
    setMessage(null);
    try {
      const result = await createProviderBackup(
        providers,
        activeProviderId,
        password,
        setProgress,
      );
      console.log("BACKUP_KDF_METRIC", JSON.stringify({ operation: "export", ms: result.kdfMs }));
      await shareEncryptedProviderBackup(result.bytes);
      const skipped = result.skipped.length;
      setMessage(
        `${result.exportedCount} hesap yedeklendi.${skipped ? ` ${skipped} hesap atlandı (kimlik bilgisi eksik, erişilemedi veya güvenli depolama sınırını aştı).` : ""}`,
      );
      setDialog(null);
      setGeneratedPassword("");
      setCustomPassword("");
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const beginImport = async () => {
    setMessage(null);
    if (!cryptoAvailable) {
      setMessage(CRYPTO_UNAVAILABLE_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      const selection = await pickEncryptedProviderBackup();
      if (!selection) return;
      if (picked) await picked.cleanup();
      setPicked(selection);
      setImportPassword("");
      setImportPasswordMode("recovery");
      setPreview(null);
      setChoices({});
      setProgress(0);
      importMeasurementStartedAt.current = 0;
      importFileLoadedAt.current = Date.now();
      passwordEntryWaitMs.current = 0;
      unlockTotalMs.current = 0;
      importKdfMs.current = 0;
      conflictDecisionStartedAt.current = 0;
      conflictPreviewPreparedAt.current = 0;
      conflictUiReadyMs.current = 0;
      setImportProgress({ percent: 0, label: "Parola bekleniyor" });
      setDialog("import");
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const unlockImport = async () => {
    if (!picked) return;
    setBusy(true);
    setProgress(0);
    setMessage(null);
    setImportProgress({ percent: 2, label: "Yedek doğrulanıyor" });
    const unlockStartedAt = Date.now();
    startImportMemorySampling();
    passwordEntryWaitMs.current = importFileLoadedAt.current
      ? unlockStartedAt - importFileLoadedAt.current
      : 0;
    importMeasurementStartedAt.current = unlockStartedAt - picked.diagnostics.fileReadMs;
    try {
      const password = importPasswordMode === "recovery"
        ? normalizeRecoveryPhrasePassword(importPassword)
        : importPassword;
      const opened = await decryptProviderBackupForImport(
        picked.bytes,
        password,
        (value) => {
          setProgress(value);
          setImportProgress({
            percent: 5 + Math.round(value * 50),
            label: "Parola anahtarı türetiliyor",
          });
        },
      );
      unlockTotalMs.current = Date.now() - unlockStartedAt;
      importKdfMs.current = opened.kdfMs;
      console.log("BACKUP_KDF_METRIC", JSON.stringify({ operation: "import", ms: opened.kdfMs }));
      const openedConflicts = listImportConflicts(opened, providers);
      if (openedConflicts.length) setImportMemoryPhase("decision");
      conflictDecisionStartedAt.current = 0;
      conflictPreviewPreparedAt.current = openedConflicts.length ? Date.now() : 0;
      conflictUiReadyMs.current = 0;
      setPreview(opened);
      setChoices({});
      setImportProgress({
        percent: 60,
        label: openedConflicts.length
          ? "Çakışma kararları bekleniyor"
          : "İçe aktarmaya hazır",
      });
    } catch (error) {
      stopImportMemorySampling();
      setMessage(errorText(error));
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const performImport = async () => {
    if (!preview || unresolved.length) return;
    const decisionEndedAt = Date.now();
    const conflictDecisionWaitMs = conflictDecisionStartedAt.current
      ? decisionEndedAt - conflictDecisionStartedAt.current
      : 0;
    setBusy(true);
    setMessage(null);
    setImportProgress((previous) => ({
      percent: Math.max(previous.percent, 61),
      label: "İçe aktarma planı hazırlanıyor",
    }));
    setImportMemoryPhase("commit");
    try {
      const planStartedAt = Date.now();
      const plan = buildImportPlan(preview, providers, choices);
      const planBuildMs = Date.now() - planStartedAt;
      const result = await commitProviderImport(
        plan,
        mergeImportedProviders,
        (next) => {
          const mapped = commitProgressState(next);
          setImportProgress((previous) => ({
            percent: Math.max(previous.percent, mapped.percent),
            label: mapped.label,
          }));
        },
      );
      const memory = stopImportMemorySampling();
      setImportProgress({ percent: 100, label: "İçe aktarma tamamlandı" });
      const choiceCounts = Object.values(choices).reduce(
        (counts, choice) => {
          if (choice === "overwrite") counts.overwrite += 1;
          else if (choice === "keep_both") counts.keepBoth += 1;
          else if (choice === "skip") counts.skip += 1;
          return counts;
        },
        { overwrite: 0, keepBoth: 0, skip: 0 },
      );
      const report = createProviderImportMetricsReport({
        status: "success",
        candidateCount: preview.candidates.length,
        conflictCount: conflicts.length,
        choices: choiceCounts,
        documentPickerWaitMs: picked?.diagnostics.documentPickerWaitMs ?? 0,
        passwordEntryWaitMs: passwordEntryWaitMs.current,
        fileReadMs: picked?.diagnostics.fileReadMs ?? 0,
        unlockTotalMs: unlockTotalMs.current,
        kdfMs: importKdfMs.current,
        conflictDecisionWaitMs,
        conflictUiReadyMs: conflictUiReadyMs.current,
        planBuildMs,
        measuredFlowToFinishMs: importMeasurementStartedAt.current
          ? Date.now() - importMeasurementStartedAt.current
          : 0,
        memory,
        commit: result.diagnostics,
      });
      console.log("BACKUP_IMPORT_METRICS", formatProviderImportMetrics(report));
      void saveLatestProviderImportMetrics(report).catch(() => {
        console.warn("BACKUP_IMPORT_METRICS_SAVE_FAILED");
      });
      setMessage(`${result.importedCount} hesap içe aktarıldı.${result.skippedCount ? ` ${result.skippedCount} hesap atlandı.` : ""}`);
      if (picked) await picked.cleanup();
      setPicked(null);
      setPreview(null);
      setImportPassword("");
      setImportPasswordMode("recovery");
      setDialog(null);
    } catch (error) {
      stopImportMemorySampling();
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const closeDialog = async () => {
    if (busy) return;
    stopImportMemorySampling();
    if (dialog === "import" && picked) {
      try { await picked.cleanup(); } catch (error) {
        console.warn("BACKUP_IMPORT_TEMP_CLEANUP_FAILED", error instanceof Error ? error.message : "unknown error");
      }
      setPicked(null);
    }
    setPreview(null);
    setChoices({});
    setGeneratedPassword("");
    setCustomPassword("");
    setImportPassword("");
    setImportPasswordMode("recovery");
    importMeasurementStartedAt.current = 0;
    importFileLoadedAt.current = 0;
    passwordEntryWaitMs.current = 0;
    unlockTotalMs.current = 0;
    importKdfMs.current = 0;
    conflictDecisionStartedAt.current = 0;
    conflictPreviewPreparedAt.current = 0;
    conflictUiReadyMs.current = 0;
    setImportProgress({ percent: 0, label: "Yedek bekleniyor" });
    setDialog(null);
  };

  return <View style={[styles.panel, { borderColor: colors.border, backgroundColor: colors.card }]}>
    <Text style={[styles.heading, { color: colors.foreground }]}>Hesap Yedeği</Text>
    <Text style={{ color: colors.mutedForeground }}>
      Hesap kimlik bilgilerini cihazdan bağımsız, parola korumalı bir dosyada saklayın.
    </Text>
    {!cryptoAvailable ? (
      <Text style={{ color: colors.destructive }}>{CRYPTO_UNAVAILABLE_MESSAGE}</Text>
    ) : null}
    <View style={styles.actions}>
      {mode === "full" ? <FocusButton label="Hesapları Dışa Aktar" icon="share-2" onPress={beginExport} disabled={busy || !cryptoAvailable} /> : null}
      <FocusButton label="Hesapları İçe Aktar" icon="upload" variant={mode === "import-only" ? "primary" : "ghost"} onPress={() => void beginImport()} disabled={busy || !cryptoAvailable} />
    </View>
    {message ? <Text style={{ color: colors.foreground }}>{message}</Text> : null}

    <Modal visible={dialog === "export"} transparent animationType="fade" onRequestClose={() => void closeDialog()}>
      <View style={styles.backdrop}>
        <ScrollView contentContainerStyle={[styles.dialog, { backgroundColor: colors.background, borderColor: colors.border }]} keyboardShouldPersistTaps="handled">
          <View style={styles.dialogHead}>
            <Text style={[styles.title, { color: colors.foreground }]}>Hesapları Dışa Aktar</Text>
            <Pressable onPress={() => void closeDialog()} disabled={busy}><Feather name="x" size={22} color={colors.mutedForeground} /></Pressable>
          </View>
          <View style={styles.actions}>
            <FocusButton label="Kurtarma parolası" variant={!useCustomPassword ? "secondary" : "ghost"} onPress={() => setUseCustomPassword(false)} disabled={busy} />
            <FocusButton label="Kendi parolam" variant={useCustomPassword ? "secondary" : "ghost"} onPress={() => setUseCustomPassword(true)} disabled={busy} />
          </View>
          {useCustomPassword ? <>
            <Text style={{ color: colors.mutedForeground }}>En az 12 karakter. Parola NFKC ile normalize edilir ve hiçbir yerde saklanmaz.</Text>
            <TextInput
              value={customPassword}
              onChangeText={setCustomPassword}
              secureTextEntry
              editable={!busy}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
              placeholder="Yedek parolası"
              placeholderTextColor={colors.mutedForeground}
            />
            {customValidation?.warnings.length ? <Text style={{ color: colors.destructive }}>Bu parola zayıf görünüyor; çevrimdışı parola tahmin saldırılarına karşı daha güçlü bir parola önerilir.</Text> : null}
          </> : <>
            <Text style={{ color: colors.mutedForeground }}>Aşağıdaki 6 kelimelik parola yaklaşık {RECOVERY_ENTROPY_BITS.toFixed(1)} bit rastgelelik taşır. Başka cihazda geri yüklemek için gereklidir.</Text>
            <View style={[styles.phrase, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text selectable style={{ color: colors.foreground, fontWeight: "800", flex: 1 }}>{generatedPassword}</Text>
              <Pressable onPress={() => void Clipboard.setStringAsync(generatedPassword)}><Feather name="copy" size={20} color={colors.primary} /></Pressable>
            </View>
            <Pressable onPress={() => setRecoveryConfirmed((value) => !value)} style={styles.confirmRow} disabled={busy}>
              <Feather name={recoveryConfirmed ? "check-square" : "square"} size={20} color={recoveryConfirmed ? colors.primary : colors.mutedForeground} />
              <Text style={{ color: colors.foreground, flex: 1 }}>Parolayı güvenli bir yere kaydettim. LegendStream bu parolayı saklamaz.</Text>
            </Pressable>
          </>}
          {busy ? <Text style={{ color: colors.primary }}>Şifreleniyor… %{Math.round(progress * 100)}</Text> : null}
          <FocusButton label={busy ? "Hazırlanıyor…" : "Şifrele ve Paylaş"} icon="lock" variant="primary" onPress={() => void performExport()} disabled={busy || (useCustomPassword ? !customPassword : !recoveryConfirmed)} />
        </ScrollView>
      </View>
    </Modal>

    <Modal visible={dialog === "import"} transparent animationType="fade" onRequestClose={() => void closeDialog()}>
      <View style={styles.backdrop}>
        <ScrollView contentContainerStyle={[styles.dialog, { backgroundColor: colors.background, borderColor: colors.border }]} keyboardShouldPersistTaps="handled">
          <View style={styles.dialogHead}>
            <Text style={[styles.title, { color: colors.foreground }]}>Hesapları İçe Aktar</Text>
            <Pressable onPress={() => void closeDialog()} disabled={busy}><Feather name="x" size={22} color={colors.mutedForeground} /></Pressable>
          </View>
          {!preview ? <>
            <View style={styles.actions}>
              <FocusButton
                label="Kurtarma parolası"
                variant={importPasswordMode === "recovery" ? "secondary" : "ghost"}
                onPress={() => setImportPasswordMode("recovery")}
                disabled={busy}
              />
              <FocusButton
                label="Kendi parolam"
                variant={importPasswordMode === "custom" ? "secondary" : "ghost"}
                onPress={() => setImportPasswordMode("custom")}
                disabled={busy}
              />
            </View>
            <Text style={{ color: colors.mutedForeground }}>
              {importPasswordMode === "recovery"
                ? "Kurtarma parolasında baş/son boşluklar yok sayılır, ardışık boşluklar tek boşluğa indirilir ve büyük/küçük harf farkı yok sayılır."
                : "Kendi parolanız yalnızca NFKC ile normalize edilir; boşluk, harf büyüklüğü ve diğer karakterler aynen korunur."}
            </Text>
            <TextInput
              value={importPassword}
              onChangeText={setImportPassword}
              secureTextEntry
              editable={!busy}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
              placeholder={importPasswordMode === "recovery" ? "6 kelimelik kurtarma parolası" : "Yedek parolası"}
              placeholderTextColor={colors.mutedForeground}
            />
            <Text style={{ color: colors.mutedForeground }}>Yanlış parola veya bozuk dosyada hiçbir hesap yazılmaz.</Text>
            {busy ? <Text style={{ color: colors.primary }}>{importProgress.label}… %{importProgress.percent}</Text> : null}
            <FocusButton label={busy ? "Doğrulanıyor…" : "Yedeği Doğrula"} icon="unlock" variant="primary" onPress={() => void unlockImport()} disabled={busy || !importPassword} />
          </> : <>
            <Text style={{ color: colors.foreground, fontWeight: "700" }}>{preview.candidates.length} hesap doğrulandı.</Text>
            <Text style={{ color: colors.primary }}>
              {importProgress.label}… %{importProgress.percent}
            </Text>
            {conflicts.map((conflict) => <View key={conflict.providerId} style={[styles.conflict, { borderColor: colors.border }]}>
              <Text style={{ color: colors.foreground, fontWeight: "800" }}>{conflict.incomingName}</Text>
              <Text style={{ color: colors.mutedForeground }}>Aynı ID mevcut: {conflict.existingName}</Text>
              <View style={styles.actions}>
                {(["overwrite", "keep_both", "skip"] as ImportConflictChoice[]).map((choice) => <FocusButton
                  key={choice}
                  label={choice === "overwrite" ? "Üzerine yaz" : choice === "keep_both" ? "İkisini de tut" : "Atla"}
                  variant={choices[conflict.providerId] === choice ? "secondary" : "ghost"}
                  onPress={() => setChoices((previous) => ({ ...previous, [conflict.providerId]: choice }))}
                  disabled={busy}
                />)}
              </View>
            </View>)}
            {unresolved.length ? <Text style={{ color: colors.destructive }}>{unresolved.length} ID çakışması için karar gerekiyor.</Text> : null}
            <FocusButton label={busy ? "İçe aktarılıyor…" : "İçe Aktar"} icon="download" variant="primary" onPress={() => void performImport()} disabled={busy || unresolved.length > 0} />
          </>}
          {message ? <Text style={{ color: colors.destructive }}>{message}</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  panel: { marginTop: 24, borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  heading: { fontSize: 17, fontWeight: "800" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.68)", justifyContent: "center", padding: 18 },
  dialog: { width: "100%", maxWidth: 680, alignSelf: "center", borderWidth: 1, borderRadius: 20, padding: 20, gap: 14 },
  dialogHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { fontSize: 21, fontWeight: "900" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, minHeight: 48 },
  phrase: { borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  confirmRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  conflict: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
});
