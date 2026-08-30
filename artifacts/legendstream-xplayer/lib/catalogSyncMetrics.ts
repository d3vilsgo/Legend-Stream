import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CatalogFetchMetrics } from "./catalogSyncStrategy";
import type { CatalogSyncMode } from "./catalogAvailability";
import {
  formatM3USwitchMeasurement,
  type M3UCacheHydrationOutcome,
  type M3UNetworkFallbackReason,
  type M3USwitchMeasurement,
} from "./m3uSwitchMeasurement";
import {
  readCatalogSyncMetricsPayload,
  writeCatalogSyncMetricsPayload,
} from "./catalogSyncMetricsPersistence";

export type XtreamCatalogSyncMeasurement = {
  providerId: string;
  mode: CatalogSyncMode;
  startedAt: number;
  totalMs: number;
  liveSqliteWriteMs: number;
  vod: CatalogFetchMetrics;
  series: CatalogFetchMetrics;
};

export type CatalogSyncMeasurement = XtreamCatalogSyncMeasurement | M3USwitchMeasurement;

let latestMeasurement: CatalogSyncMeasurement | null = null;

const formatFetchMetrics = (label: "vod" | "series", metrics: CatalogFetchMetrics) => [
  `${label}.path=${metrics.path}`,
  `${label}.bulkParseMs=${metrics.bulkParseMs}`,
  `${label}.sqliteWriteMs=${metrics.sqliteWriteMs}`,
  `${label}.totalMs=${metrics.totalMs}`,
  `${label}.itemCount=${metrics.itemCount}`,
  `${label}.parallelMaxObserved=${metrics.parallelMaxObserved}`,
  `${label}.fallbackReason=${metrics.fallbackReason ?? "none"}`,
];

function isM3USwitchMeasurement(measurement: CatalogSyncMeasurement): measurement is M3USwitchMeasurement {
  return "kind" in measurement && measurement.kind === "m3u-switch";
}

export function formatCatalogSyncMeasurement(measurement: CatalogSyncMeasurement) {
  if (isM3USwitchMeasurement(measurement)) return formatM3USwitchMeasurement(measurement);
  return [
    `mode=${measurement.mode}`,
    `totalMs=${measurement.totalMs}`,
    `liveSqliteWriteMs=${measurement.liveSqliteWriteMs}`,
    ...formatFetchMetrics("vod", measurement.vod),
    ...formatFetchMetrics("series", measurement.series),
  ].join("\n");
}

const finiteNonNegative = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const countValue = (value: unknown) => {
  const numeric = finiteNonNegative(value);
  return numeric === null ? null : Math.trunc(numeric);
};
const objectValue = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const M3U_OUTCOMES = new Set<M3UCacheHydrationOutcome>(["hit", "null", "error"]);
const M3U_FALLBACK_REASONS = new Set<M3UNetworkFallbackReason>([
  "none",
  "cache-unsupported-source",
  "cache-empty",
  "cache-sqlite-error",
  "cache-runtime-error",
  "cache-unavailable",
  "network-error",
]);
const FETCH_FALLBACK_REASONS = new Set<NonNullable<CatalogFetchMetrics["fallbackReason"]>>([
  "empty",
  "too-few-items",
  "missing-category-ids",
  "bulk-error",
  "parallel-error",
]);

function normalizeM3UMeasurement(raw: Record<string, unknown>): M3USwitchMeasurement | null {
  if (raw.kind !== "m3u-switch") return null;
  const startedAt = finiteNonNegative(raw.startedAt);
  const m3u = objectValue(raw.m3u);
  const itemCounts = objectValue(m3u?.itemCounts);
  const sqliteReadMs = finiteNonNegative(m3u?.sqliteReadMs);
  const runtimeHydrateMs = finiteNonNegative(m3u?.runtimeHydrateMs);
  const totalSwitchMs = finiteNonNegative(m3u?.totalSwitchMs);
  const live = countValue(itemCounts?.live);
  const vod = countValue(itemCounts?.vod);
  const series = countValue(itemCounts?.series);
  const outcome = m3u?.cacheHydrationOutcome as M3UCacheHydrationOutcome;
  const fallbackReason = m3u?.networkFallbackReason as M3UNetworkFallbackReason;
  if (
    startedAt === null ||
    sqliteReadMs === null ||
    runtimeHydrateMs === null ||
    totalSwitchMs === null ||
    live === null || vod === null || series === null ||
    !M3U_OUTCOMES.has(outcome) ||
    typeof m3u?.networkFallback !== "boolean" ||
    !M3U_FALLBACK_REASONS.has(fallbackReason)
  ) {
    return null;
  }
  return {
    kind: "m3u-switch",
    startedAt,
    m3u: {
      sqliteReadMs,
      runtimeHydrateMs,
      cacheHydrationOutcome: outcome,
      networkFallback: m3u.networkFallback,
      networkFallbackReason: fallbackReason,
      totalSwitchMs,
      itemCounts: { live, vod, series },
    },
  };
}

function normalizeFetchMetrics(value: unknown): CatalogFetchMetrics | null {
  const raw = objectValue(value);
  if (!raw || (raw.path !== "bulk" && raw.path !== "parallel" && raw.path !== "serial")) return null;
  const itemCount = countValue(raw.itemCount);
  const bulkParseMs = finiteNonNegative(raw.bulkParseMs);
  const sqliteWriteMs = finiteNonNegative(raw.sqliteWriteMs);
  const totalMs = finiteNonNegative(raw.totalMs);
  const parallelMaxObserved = countValue(raw.parallelMaxObserved);
  if (
    itemCount === null || bulkParseMs === null || sqliteWriteMs === null ||
    totalMs === null || parallelMaxObserved === null
  ) return null;
  const fallbackReason = typeof raw.fallbackReason === "string" &&
    FETCH_FALLBACK_REASONS.has(raw.fallbackReason as NonNullable<CatalogFetchMetrics["fallbackReason"]>)
      ? raw.fallbackReason as NonNullable<CatalogFetchMetrics["fallbackReason"]>
      : undefined;
  return {
    path: raw.path,
    itemCount,
    bulkParseMs,
    sqliteWriteMs,
    totalMs,
    parallelMaxObserved,
    fallbackReason,
  };
}

function normalizeXtreamMeasurement(raw: Record<string, unknown>): XtreamCatalogSyncMeasurement | null {
  if (typeof raw.providerId !== "string" || !raw.providerId) return null;
  if (raw.mode !== "initial" && raw.mode !== "background" && raw.mode !== "manual") return null;
  const startedAt = finiteNonNegative(raw.startedAt);
  const totalMs = finiteNonNegative(raw.totalMs);
  const liveSqliteWriteMs = finiteNonNegative(raw.liveSqliteWriteMs);
  const vod = normalizeFetchMetrics(raw.vod);
  const series = normalizeFetchMetrics(raw.series);
  if (startedAt === null || totalMs === null || liveSqliteWriteMs === null || !vod || !series) return null;
  return {
    providerId: raw.providerId,
    mode: raw.mode,
    startedAt,
    totalMs,
    liveSqliteWriteMs,
    vod,
    series,
  };
}

function normalizeStoredMeasurement(value: unknown): CatalogSyncMeasurement | null {
  const raw = objectValue(value);
  if (!raw) return null;
  return raw.kind === "m3u-switch"
    ? normalizeM3UMeasurement(raw)
    : normalizeXtreamMeasurement(raw);
}

export function recordCatalogSyncMeasurement(measurement: CatalogSyncMeasurement) {
  latestMeasurement = measurement;
  void writeCatalogSyncMetricsPayload(AsyncStorage, JSON.stringify(measurement)).catch(() => undefined);
}

export async function readPersistedCatalogSyncMeasurement(): Promise<CatalogSyncMeasurement | null> {
  if (latestMeasurement) return latestMeasurement;
  const raw = await readCatalogSyncMetricsPayload(AsyncStorage);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Stored catalog sync measurement is invalid.");
  }
  const measurement = normalizeStoredMeasurement(parsed);
  if (!measurement) throw new Error("Stored catalog sync measurement is invalid.");
  latestMeasurement = measurement;
  return measurement;
}

export function getLatestCatalogSyncMeasurement() {
  return latestMeasurement;
}

export function clearLatestCatalogSyncMeasurement() {
  latestMeasurement = null;
}
