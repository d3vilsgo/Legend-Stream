import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { useColors } from "@/hooks/useColors";
import {
  formatCredentialDiagnostics,
  runCredentialDiagnostics,
  type CredentialDiagnosticsReport,
} from "@/lib/credentialDiagnostics";

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function useCredentialDiagnosticsStartup() {
  useEffect(() => {
    let active = true;
    void runCredentialDiagnostics()
      .then((report) => {
        if (!active) return;
        console.log("LS_DIAG", formatCredentialDiagnostics(report));
      })
      .catch((error) => {
        if (!active) return;
        console.log("LS_DIAG", JSON.stringify({ fatalError: errorMessage(error) }));
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

  const run = async () => {
    setBusy(true);
    setFatalError(null);
    try {
      const next = await runCredentialDiagnostics();
      setReport(next);
      console.log("LS_DIAG", formatCredentialDiagnostics(next));
    } catch (error) {
      const message = errorMessage(error);
      setFatalError(message);
      console.log("LS_DIAG", JSON.stringify({ fatalError: message }));
    } finally {
      setBusy(false);
    }
  };

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
            {formatCredentialDiagnostics(report)}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}
