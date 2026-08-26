import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

export type ImportMemoryPhase = "kdf" | "decision" | "commit";

export type ImportMemoryMetrics = {
  available: boolean;
  processingPeakPssKb: number;
  kdfPeakPssKb: number;
  commitPeakPssKb: number;
  decisionPeakPssKb: number;
  sampleCount: number;
  sampleIntervalMs: number;
};

type LegendStreamDiagnosticsNativeModule = {
  startImportMemorySampling: () => boolean;
  setImportMemoryPhase: (phase: ImportMemoryPhase) => boolean;
  stopImportMemorySampling: () => ImportMemoryMetrics;
};

let cachedModule: LegendStreamDiagnosticsNativeModule | null | undefined;

const unavailableMetrics = (): ImportMemoryMetrics => ({
  available: false,
  processingPeakPssKb: 0,
  kdfPeakPssKb: 0,
  commitPeakPssKb: 0,
  decisionPeakPssKb: 0,
  sampleCount: 0,
  sampleIntervalMs: 0,
});

const getNativeModule = () => {
  if (cachedModule !== undefined) return cachedModule;
  cachedModule = requireOptionalNativeModule(
    "LegendStreamDiagnostics",
  ) as LegendStreamDiagnosticsNativeModule | null;
  return cachedModule;
};

export function startImportMemorySampling(): boolean {
  if (Platform.OS !== "android") return false;
  try {
    return Boolean(getNativeModule()?.startImportMemorySampling?.());
  } catch {
    return false;
  }
}

export function setImportMemoryPhase(phase: ImportMemoryPhase): boolean {
  if (Platform.OS !== "android") return false;
  try {
    return Boolean(getNativeModule()?.setImportMemoryPhase?.(phase));
  } catch {
    return false;
  }
}

export function stopImportMemorySampling(): ImportMemoryMetrics {
  if (Platform.OS !== "android") return unavailableMetrics();
  try {
    const result = getNativeModule()?.stopImportMemorySampling?.();
    if (!result || !result.available) return unavailableMetrics();
    return {
      available: true,
      processingPeakPssKb: Math.max(0, Number(result.processingPeakPssKb) || 0),
      kdfPeakPssKb: Math.max(0, Number(result.kdfPeakPssKb) || 0),
      commitPeakPssKb: Math.max(0, Number(result.commitPeakPssKb) || 0),
      decisionPeakPssKb: Math.max(0, Number(result.decisionPeakPssKb) || 0),
      sampleCount: Math.max(0, Number(result.sampleCount) || 0),
      sampleIntervalMs: Math.max(0, Number(result.sampleIntervalMs) || 0),
    };
  } catch {
    return unavailableMetrics();
  }
}
