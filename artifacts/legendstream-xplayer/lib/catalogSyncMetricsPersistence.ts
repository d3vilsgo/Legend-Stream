export const CATALOG_SYNC_METRICS_KEY = "@legendstream/catalog-sync-metrics-v1";

export type CatalogSyncMetricsStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

export async function writeCatalogSyncMetricsPayload(
  storage: CatalogSyncMetricsStorage,
  payload: string,
): Promise<void> {
  await storage.setItem(CATALOG_SYNC_METRICS_KEY, payload);
}

export async function readCatalogSyncMetricsPayload(
  storage: CatalogSyncMetricsStorage,
): Promise<string | null> {
  return storage.getItem(CATALOG_SYNC_METRICS_KEY);
}
