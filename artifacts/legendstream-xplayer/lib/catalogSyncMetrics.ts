import type { CatalogFetchMetrics } from "./catalogSyncStrategy";
import type { CatalogSyncMode } from "./catalogAvailability";

export type CatalogSyncMeasurement = {
  providerId: string;
  mode: CatalogSyncMode;
  startedAt: number;
  totalMs: number;
  liveSqliteWriteMs: number;
  vod: CatalogFetchMetrics;
  series: CatalogFetchMetrics;
};

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

export function formatCatalogSyncMeasurement(measurement: CatalogSyncMeasurement) {
  return [
    `mode=${measurement.mode}`,
    `totalMs=${measurement.totalMs}`,
    `liveSqliteWriteMs=${measurement.liveSqliteWriteMs}`,
    ...formatFetchMetrics("vod", measurement.vod),
    ...formatFetchMetrics("series", measurement.series),
  ].join("\n");
}

export function recordCatalogSyncMeasurement(measurement: CatalogSyncMeasurement) {
  latestMeasurement = measurement;
}

export function getLatestCatalogSyncMeasurement() {
  return latestMeasurement;
}

export function clearLatestCatalogSyncMeasurement() {
  latestMeasurement = null;
}
