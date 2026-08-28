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

export function recordCatalogSyncMeasurement(measurement: CatalogSyncMeasurement) {
  latestMeasurement = measurement;
}

export function getLatestCatalogSyncMeasurement() {
  return latestMeasurement;
}

export function clearLatestCatalogSyncMeasurement() {
  latestMeasurement = null;
}
