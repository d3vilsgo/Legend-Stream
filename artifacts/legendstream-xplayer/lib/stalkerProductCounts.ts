import AsyncStorage from "@react-native-async-storage/async-storage";

export type StalkerProductKind = "vod" | "series";
export type StalkerProductCounts = Record<StalkerProductKind, number | null>;

type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem">;

const STORAGE_PREFIX = "@legendstream/stalker-product-counts-v1:";
const listeners = new Map<string, Set<(counts: StalkerProductCounts) => void>>();
let writeQueue = Promise.resolve();

const emptyCounts = (): StalkerProductCounts => ({ vod: null, series: null });

export function parseStalkerProductCounts(raw: string | null): StalkerProductCounts {
  if (!raw) return emptyCounts();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const count = (kind: StalkerProductKind) => {
      const value = parsed[kind];
      return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
    };
    return { vod: count("vod"), series: count("series") };
  } catch {
    return emptyCounts();
  }
}

export async function readStalkerProductCounts(
  providerId: string,
  storage: Storage = AsyncStorage,
) {
  return parseStalkerProductCounts(await storage.getItem(`${STORAGE_PREFIX}${providerId}`));
}

export function writeStalkerProductCount(
  providerId: string,
  kind: StalkerProductKind,
  totalCount: number,
  storage: Storage = AsyncStorage,
) {
  const normalized = Math.max(0, Math.trunc(totalCount));
  const write = async () => {
    const current = await readStalkerProductCounts(providerId, storage);
    const next = { ...current, [kind]: normalized };
    await storage.setItem(`${STORAGE_PREFIX}${providerId}`, JSON.stringify(next));
    listeners.get(providerId)?.forEach((listener) => listener(next));
    return next;
  };
  const queued = writeQueue.then(write, write);
  writeQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

export function subscribeStalkerProductCounts(
  providerId: string,
  listener: (counts: StalkerProductCounts) => void,
) {
  const providerListeners = listeners.get(providerId) ?? new Set();
  providerListeners.add(listener);
  listeners.set(providerId, providerListeners);
  return () => {
    providerListeners.delete(listener);
    if (!providerListeners.size) listeners.delete(providerId);
  };
}
