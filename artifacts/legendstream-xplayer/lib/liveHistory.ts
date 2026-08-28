export const LIVE_HISTORY_V2_STORAGE_KEY = "@legendstream/live-history-v2";
export const LIVE_HISTORY_MIGRATION_ERROR = "LIVE_HISTORY_MIGRATION_FAILED";
export const LIVE_HISTORY_PROVIDER_LIMIT = 50;

export type LiveHistoryV2 = {
  schemaVersion: 2;
  byProvider: Record<string, string[]>;
  unscoped: string[];
};

export type LiveHistoryStorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const uniqueInOrder = (values: readonly string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
};

export function emptyLiveHistoryV2(): LiveHistoryV2 {
  return { schemaVersion: 2, byProvider: {}, unscoped: [] };
}

export function providerIdFromChannelId(channelId: string): string | null {
  if (!channelId) return null;
  const first = channelId.indexOf(":");
  if (first <= 0) return null;
  const second = channelId.indexOf(":", first + 1);
  if (second <= first + 1 || second >= channelId.length - 1) return null;
  const providerId = channelId.slice(0, first);
  const indexPart = channelId.slice(first + 1, second);
  const streamPart = channelId.slice(second + 1);
  if (!providerId || !/^\d+$/.test(indexPart) || !streamPart) return null;
  return providerId;
}

export function migrateLiveHistoryV1(history: unknown): LiveHistoryV2 {
  if (!Array.isArray(history)) throw asLiveHistoryMigrationError();
  const byProvider: Record<string, string[]> = {};
  const unscoped: string[] = [];
  const unscopedSeen = new Set<string>();

  for (const value of history) {
    if (typeof value !== "string" || !value) continue;
    const providerId = providerIdFromChannelId(value);
    if (!providerId) {
      if (!unscopedSeen.has(value)) {
        unscopedSeen.add(value);
        unscoped.push(value);
      }
      continue;
    }
    const current = byProvider[providerId] ?? (byProvider[providerId] = []);
    if (!current.includes(value) && current.length < LIVE_HISTORY_PROVIDER_LIMIT) current.push(value);
  }

  return { schemaVersion: 2, byProvider, unscoped };
}

function assertCanonicalLiveHistory(value: unknown): LiveHistoryV2 {
  const raw = asObject(value);
  if (!raw || raw.schemaVersion !== 2) throw asLiveHistoryMigrationError();
  const topKeys = Object.keys(raw).sort();
  if (topKeys.join("|") !== "byProvider|schemaVersion|unscoped") {
    throw asLiveHistoryMigrationError();
  }
  const rawByProvider = asObject(raw.byProvider);
  if (!rawByProvider || !Array.isArray(raw.unscoped)) throw asLiveHistoryMigrationError();

  const byProvider: Record<string, string[]> = {};
  for (const [providerId, valueList] of Object.entries(rawByProvider)) {
    if (!providerId || !Array.isArray(valueList) || valueList.length > LIVE_HISTORY_PROVIDER_LIMIT) {
      throw asLiveHistoryMigrationError();
    }
    const list: string[] = [];
    for (const value of valueList) {
      if (typeof value !== "string" || !value || providerIdFromChannelId(value) !== providerId) {
        throw asLiveHistoryMigrationError();
      }
      list.push(value);
    }
    if (uniqueInOrder(list).length !== list.length) throw asLiveHistoryMigrationError();
    byProvider[providerId] = list;
  }

  const unscoped: string[] = [];
  for (const value of raw.unscoped) {
    if (typeof value !== "string" || !value || providerIdFromChannelId(value) !== null) {
      throw asLiveHistoryMigrationError();
    }
    unscoped.push(value);
  }
  if (uniqueInOrder(unscoped).length !== unscoped.length) throw asLiveHistoryMigrationError();

  return { schemaVersion: 2, byProvider, unscoped };
}

export function parseLiveHistoryV2Payload(raw: string): LiveHistoryV2 {
  try {
    return assertCanonicalLiveHistory(JSON.parse(raw));
  } catch {
    throw asLiveHistoryMigrationError();
  }
}

export function asLiveHistoryMigrationError(_caught?: unknown): Error {
  const error = new Error(LIVE_HISTORY_MIGRATION_ERROR);
  error.name = "LiveHistoryMigrationError";
  return error;
}

export async function commitLiveHistoryV2(
  storage: LiveHistoryStorageAdapter,
  history: LiveHistoryV2,
): Promise<LiveHistoryV2> {
  try {
    const canonical = assertCanonicalLiveHistory(history);
    const serialized = JSON.stringify(canonical);
    await storage.setItem(LIVE_HISTORY_V2_STORAGE_KEY, serialized);
    const readBack = await storage.getItem(LIVE_HISTORY_V2_STORAGE_KEY);
    if (readBack !== serialized) throw asLiveHistoryMigrationError();
    return parseLiveHistoryV2Payload(readBack);
  } catch {
    throw asLiveHistoryMigrationError();
  }
}

export async function migrateLiveHistoryStorage(
  storage: LiveHistoryStorageAdapter,
  legacyHistory: unknown | undefined,
  deleteLegacy: () => Promise<void>,
): Promise<LiveHistoryV2> {
  try {
    const existing = await storage.getItem(LIVE_HISTORY_V2_STORAGE_KEY);
    let verified: LiveHistoryV2;
    if (existing !== null) {
      try {
        verified = parseLiveHistoryV2Payload(existing);
      } catch {
        if (legacyHistory === undefined) throw asLiveHistoryMigrationError();
        verified = await commitLiveHistoryV2(storage, migrateLiveHistoryV1(legacyHistory));
      }
    } else {
      verified = await commitLiveHistoryV2(
        storage,
        migrateLiveHistoryV1(legacyHistory ?? []),
      );
    }

    // K1: legacy deletion is attempted only after exact v2 read-back + schema validation.
    // A cleanup failure leaves the verified v2 usable and the legacy copy available for retry.
    try { await deleteLegacy(); } catch { /* retry on the next hydration */ }
    return verified;
  } catch {
    throw asLiveHistoryMigrationError();
  }
}

export function historyForProvider(history: LiveHistoryV2, providerId?: string | null): string[] {
  if (!providerId) return [];
  return [...(history.byProvider[providerId] ?? [])];
}

export function recordLiveHistory(
  history: LiveHistoryV2,
  providerId: string,
  channelId: string,
): LiveHistoryV2 {
  const current = history.byProvider[providerId] ?? [];
  const next = [channelId, ...current.filter((id) => id !== channelId)]
    .slice(0, LIVE_HISTORY_PROVIDER_LIMIT);
  return {
    schemaVersion: 2,
    byProvider: { ...history.byProvider, [providerId]: next },
    unscoped: history.unscoped.filter((id) => id !== channelId),
  };
}

export function removeLiveHistory(
  history: LiveHistoryV2,
  providerId: string,
  channelId: string,
): LiveHistoryV2 {
  return {
    schemaVersion: 2,
    byProvider: {
      ...history.byProvider,
      [providerId]: (history.byProvider[providerId] ?? []).filter((id) => id !== channelId),
    },
    unscoped: history.unscoped,
  };
}

export function clearLiveHistoryProvider(
  history: LiveHistoryV2,
  providerId: string,
): LiveHistoryV2 {
  return {
    schemaVersion: 2,
    byProvider: { ...history.byProvider, [providerId]: [] },
    unscoped: history.unscoped,
  };
}
