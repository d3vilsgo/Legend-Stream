export const CATALOG_SYNC_METRICS_KEY = "@legendstream/catalog-sync-metrics-v1";
export const CATALOG_SYNC_METRICS_SEQUENCE_KEY = "@legendstream/catalog-sync-metrics-sequence-v1";

export type CatalogSyncMetricsStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

const sequenceTails = new WeakMap<object, Promise<void>>();

function normalizedSequence(value: string | null) {
  if (value === null || !/^\d+$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

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

export async function readCatalogSyncMetricsSequence(
  storage: CatalogSyncMetricsStorage,
): Promise<number> {
  return normalizedSequence(await storage.getItem(CATALOG_SYNC_METRICS_SEQUENCE_KEY));
}

export async function nextCatalogSyncMetricsSequence(
  storage: CatalogSyncMetricsStorage,
  minimumCurrent = 0,
): Promise<number> {
  const key = storage as object;
  const previous = sequenceTails.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    const stored = await readCatalogSyncMetricsSequence(storage);
    const current = Math.max(stored, Math.max(0, Math.trunc(minimumCurrent)));
    const next = current + 1;
    await storage.setItem(CATALOG_SYNC_METRICS_SEQUENCE_KEY, String(next));
    return next;
  });
  sequenceTails.set(key, run.then(() => undefined, () => undefined));
  return run;
}
