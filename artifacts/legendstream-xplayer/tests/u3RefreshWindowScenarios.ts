import {
  finishOwnedCatalogCommit,
  ProviderLoadRequestGate,
} from "../lib/catalogAvailability";
import assert from "node:assert/strict";
import { refreshCatalogWindow } from "../lib/catalogRefreshWindow";
import {
  parseCatalogRefreshPolicy,
  DEFAULT_CATALOG_REFRESH_POLICY,
  shouldRefreshCatalogAutomatically,
  lastSuccessfulCatalogRefresh,
} from "../lib/catalogRefreshPolicy";
async function main() {
  const old = [1, 2, 3, 4, 5, 6];
  let calls = 0;
  const result = await refreshCatalogWindow({
    loadedRows: old.length,
    isCurrent: () => true,
    load: async (cursor) => {
      calls++;
      const start = Number(cursor ?? 0);
      return {
        items: old.slice(start, start + 2),
        nextCursor: start + 2 < old.length ? String(start + 2) : null,
        hasMore: start + 2 < old.length,
      };
    },
  });
  assert.deepEqual(result?.items, old);
  assert.equal(calls, 3);
  assert(result?.items.includes(5));
  let current = true;
  const cancelled = await refreshCatalogWindow({
    loadedRows: 3,
    isCurrent: () => current,
    load: async () => {
      current = false;
      return { items: [9], nextCursor: null, hasMore: false };
    },
  });
  assert.equal(cancelled, null);
  assert.deepEqual(old, [1, 2, 3, 4, 5, 6]);
  await assert.rejects(
    refreshCatalogWindow({
      loadedRows: 100,
      isCurrent: () => true,
      load: async () => ({ items: [1], nextCursor: "same", hasMore: true }),
    }),
    /cursor/,
  );
  await assert.rejects(
    refreshCatalogWindow({
      loadedRows: 100,
      isCurrent: () => true,
      load: async () => {
        throw new Error("offline");
      },
    }),
    /offline/,
  );
  assert(old.includes(5));
  assert.deepEqual(
    parseCatalogRefreshPolicy({ version: 99, refreshIntervalHours: 1 }),
    DEFAULT_CATALOG_REFRESH_POLICY,
  );
  assert.equal(lastSuccessfulCatalogRefresh(null, undefined), null);
  assert.equal(
    shouldRefreshCatalogAutomatically({
      policy: DEFAULT_CATALOG_REFRESH_POLICY,
      hasUsableCache: true,
      lastSuccessfulAt: null,
      now: NaN,
    }),
    false,
  );
  assert.equal(
    shouldRefreshCatalogAutomatically({
      policy: DEFAULT_CATALOG_REFRESH_POLICY,
      hasUsableCache: true,
      lastSuccessfulAt: 1,
      now: 86_400_001,
    }),
    true,
  );
  const gate = new ProviderLoadRequestGate();
  const owner = gate.beginForeground("m3u");
  const committed = await finishOwnedCatalogCommit(
    Promise.resolve(true),
    () => gate.isCurrent(owner),
    () => {
      gate.finish(owner);
    },
  );
  assert.equal(committed, true);
  assert.equal(gate.isCurrent(owner), false);
  const stale = gate.beginForeground("m3u");
  gate.invalidateAll();
  assert.equal(
    await finishOwnedCatalogCommit(
      Promise.resolve(true),
      () => gate.isCurrent(stale),
      () => {
        gate.finish(stale);
      },
    ),
    false,
  );
  const failed = gate.beginForeground("m3u");
  assert.equal(
    await finishOwnedCatalogCommit(
      Promise.resolve(false),
      () => gate.isCurrent(failed),
      () => {
        gate.finish(failed);
      },
    ),
    false,
  );
  assert.equal(gate.isCurrent(failed), false);
  console.log(
    "U3 refresh window/policy compatibility: 9/9 passed; MODEL_NOT_PHYSICAL",
  );
}
void main();
