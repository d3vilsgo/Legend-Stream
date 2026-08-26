import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ProviderImportMetricsReport } from "./providerImportMetrics";

const PROVIDER_IMPORT_METRICS_KEY = "@legendstream/provider-import-metrics-v2";

export async function saveLatestProviderImportMetrics(
  report: ProviderImportMetricsReport,
): Promise<void> {
  await AsyncStorage.setItem(PROVIDER_IMPORT_METRICS_KEY, JSON.stringify(report));
}

export async function readLatestProviderImportMetrics(): Promise<ProviderImportMetricsReport | null> {
  const raw = await AsyncStorage.getItem(PROVIDER_IMPORT_METRICS_KEY);
  if (raw === null) return null;
  const parsed = JSON.parse(raw) as Partial<ProviderImportMetricsReport>;
  if (
    parsed.schemaVersion !== 2 ||
    (parsed.status !== "success" && parsed.status !== "error") ||
    !parsed.durations ||
    !parsed.calls ||
    !parsed.memory ||
    !Array.isArray(parsed.providers)
  ) {
    throw new Error("Stored provider import metrics are invalid.");
  }
  return parsed as ProviderImportMetricsReport;
}
