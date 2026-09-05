import * as Clipboard from "expo-clipboard";
import { Redirect } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { isCatalogBenchmarkBuildEnabled } from "@/lib/catalogBenchmarkEntry";
import { nativeCatalogBenchmarkDependencies } from "@/lib/catalogWriteBenchmarkNative";
import {
  runCatalogWriteBenchmarkSession,
  runCatalogWriteDeviceGate,
  serializeCatalogBenchmarkReport,
  type CatalogBenchmarkProfile,
  type CatalogBenchmarkProgress,
  type CatalogBenchmarkRows,
} from "@/lib/catalogWriteBenchmarkRunner";
import { redactSensitiveText } from "@/lib/safeLog";

const ROW_OPTIONS: CatalogBenchmarkRows[] = [200, 1_000, 5_000, 20_000, 50_000];
const PROFILE_OPTIONS: CatalogBenchmarkProfile[] = ["small", "medium", "large"];

export default function CatalogBenchmarkScreen() {
  const enabled = isCatalogBenchmarkBuildEnabled();
  const colors = useColors();
  const [rows, setRows] = useState<CatalogBenchmarkRows>(20_000);
  const [profile, setProfile] = useState<CatalogBenchmarkProfile>("medium");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<CatalogBenchmarkProgress | null>(null);
  const [resultJson, setResultJson] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");

  const progressText = useMemo(() => {
    if (!progress) return "Idle";
    const dataset = progress.rows ? `${progress.rows.toLocaleString()} / ${progress.profile}` : "native probes";
    const round = progress.round ? ` • round ${progress.round}` : "";
    const strategy = progress.strategy ? ` • ${progress.strategy}` : "";
    return `${progress.phase} • ${dataset}${round}${strategy} • ${progress.completedSteps}/${progress.totalSteps}`;
  }, [progress]);

  if (!enabled) return <Redirect href="/" />;

  const execute = async (mode: "device" | "selected") => {
    if (running) return;
    setRunning(true);
    setError("");
    setResultJson("");
    setSummary("");
    try {
      const result = mode === "device"
        ? await runCatalogWriteDeviceGate({
            dependencies: nativeCatalogBenchmarkDependencies,
            onProgress: setProgress,
          })
        : await runCatalogWriteBenchmarkSession({
            rows,
            profile,
            dependencies: nativeCatalogBenchmarkDependencies,
            measuredRuns: 5,
            onProgress: setProgress,
          });
      setResultJson(serializeCatalogBenchmarkReport(result));
      setSummary(mode === "device"
        ? `DEVICE GATE ${"deviceGate" in result && result.deviceGate.passed ? "PASS" : "FAIL"}`
        : `${rows.toLocaleString()} / ${profile}: ${"classification" in result ? result.classification : "UNKNOWN"}`);
    } catch (caught) {
      setError(redactSensitiveText(caught instanceof Error ? caught.message : String(caught)));
      setSummary("BENCHMARK FAILED");
    } finally {
      setRunning(false);
    }
  };

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: colors.foreground }]}>Catalog SQLite Benchmark</Text>
      <Text style={[styles.warning, { color: colors.mutedForeground }]}>Internal benchmark build only. Runs are non-cancellable.</Text>

      <Text style={[styles.heading, { color: colors.foreground }]}>Dataset rows</Text>
      <View style={styles.choices}>
        {ROW_OPTIONS.map((value) => (
          <Choice key={value} label={value.toLocaleString()} selected={rows === value} disabled={running} onPress={() => setRows(value)} />
        ))}
      </View>

      <Text style={[styles.heading, { color: colors.foreground }]}>Payload profile</Text>
      <View style={styles.choices}>
        {PROFILE_OPTIONS.map((value) => (
          <Choice key={value} label={value} selected={profile === value} disabled={running} onPress={() => setProfile(value)} />
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Run device gate"
        disabled={running}
        onPress={() => void execute("device")}
        style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: running ? 0.5 : 1 }]}
      >
        <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>RUN DEVICE GATE — 20K + 50K MEDIUM</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Run selected benchmark session"
        disabled={running}
        onPress={() => void execute("selected")}
        style={[styles.secondaryButton, { backgroundColor: colors.secondary, borderColor: colors.border, opacity: running ? 0.5 : 1 }]}
      >
        <Text style={[styles.buttonText, { color: colors.secondaryForeground }]}>Run selected session</Text>
      </Pressable>

      <View style={[styles.status, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.statusText, { color: colors.cardForeground }]}>{running ? "RUNNING — do not leave this screen" : progressText}</Text>
        {summary ? <Text style={[styles.statusText, { color: colors.cardForeground }]}>{summary}</Text> : null}
        {running ? <Text style={[styles.progressText, { color: colors.mutedForeground }]}>{progressText}</Text> : null}
        {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
      </View>

      {resultJson ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy benchmark JSON"
            onPress={() => void Clipboard.setStringAsync(resultJson)}
            style={[styles.secondaryButton, { backgroundColor: colors.secondary, borderColor: colors.border }]}
          >
            <Text style={[styles.buttonText, { color: colors.secondaryForeground }]}>Copy JSON</Text>
          </Pressable>
          <Text selectable style={[styles.result, { color: colors.mutedForeground, borderColor: colors.border }]}>{resultJson}</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

function Choice(props: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected, disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={[
        styles.choice,
        { borderColor: props.selected ? colors.primary : colors.border, backgroundColor: colors.card },
      ]}
    >
      <Text style={{ color: props.selected ? colors.primary : colors.cardForeground }}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, paddingTop: 56, paddingBottom: 64, gap: 12 },
  title: { fontFamily: "Inter_700Bold", fontSize: 24 },
  warning: { fontFamily: "Inter_400Regular", fontSize: 14, marginBottom: 8 },
  heading: { fontFamily: "Inter_600SemiBold", fontSize: 16, marginTop: 6 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  primaryButton: { borderRadius: 8, minHeight: 50, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, marginTop: 10 },
  secondaryButton: { borderWidth: 1, borderRadius: 8, minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  buttonText: { fontFamily: "Inter_600SemiBold", fontSize: 14, textAlign: "center" },
  status: { borderWidth: 1, borderRadius: 8, padding: 14, gap: 8 },
  statusText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  progressText: { fontFamily: "Inter_400Regular", fontSize: 13 },
  error: { fontFamily: "Inter_500Medium", fontSize: 13 },
  result: { borderWidth: 1, borderRadius: 8, padding: 12, fontFamily: "monospace", fontSize: 11 },
});
