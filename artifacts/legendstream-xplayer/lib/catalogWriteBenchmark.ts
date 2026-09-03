import * as SQLite from "expo-sqlite";
import type { PersistedVodCatalogItem } from "./catalogPersistence";
import {
  CATALOG_LOGICAL_BATCH_MAX,
  CATALOG_SINGLE_ROW_UPSERT_SQL,
  buildCatalogItemBindValues,
  executePreparedCatalogMultiRowBatch,
  executePreparedCatalogSingleRowBatch,
  type CatalogWriteCounters,
} from "./catalogWriteBatch";
import { yieldToUi } from "./cooperative";

export const CATALOG_WRITE_BENCHMARK_DB = "legendstream-catalog-benchmark-v1.db";
const ACTIVE_PROVIDER = "benchmark-active";
const STAGING_PROVIDER = "__staging__benchmark-active";

export type CatalogWriteBenchmarkStrategy = "CURRENT" | "PREPARED_SINGLE" | "HYBRID_50";
export type CatalogWritePayloadProfile = "small" | "medium" | "large";
export type CatalogWriteBenchmarkRows = 200 | 1_000 | 5_000 | 20_000 | 50_000;

export type CatalogWriteBenchmarkResult = {
  strategy: CatalogWriteBenchmarkStrategy;
  profile: CatalogWritePayloadProfile;
  rows: CatalogWriteBenchmarkRows;
  projectionMs: number;
  jsonSerializeMs: number;
  serializedBytes: number;
  transactionMs: number;
  sqliteWriteMs: number;
  prepareCount: number;
  executeCount: number;
  finalizeCount: number;
  yieldCount: number;
  categoryWriteMs: number;
  finalSwapMs: number;
  totalMs: number;
  rowsPerSecond: number;
  correctness: "passed";
};

const PROFILE_BYTES: Record<CatalogWritePayloadProfile, number> = {
  small: 96,
  medium: 1_024,
  large: 8_192,
};

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function addCounters(target: CatalogWriteCounters, source: CatalogWriteCounters) {
  target.prepareCount += source.prepareCount;
  target.executeCount += source.executeCount;
  target.finalizeCount += source.finalizeCount;
}

function makeRows(
  rows: CatalogWriteBenchmarkRows,
  profile: CatalogWritePayloadProfile,
): PersistedVodCatalogItem[] {
  const filler = "İstanbul-IĞDIR-ızmir\n".padEnd(PROFILE_BYTES[profile], "x");
  return Array.from({ length: rows }, (_, index) => ({
    schemaVersion: 1 as const,
    catalogKind: "vod" as const,
    providerId: STAGING_PROVIDER,
    stream_id: String(index).padStart(8, "0"),
    name: `Benchmark “${index}”`,
    category_id: String(index % 24),
    stream_icon: index % 7 === 0 ? undefined : `https://invalid.example/${index}.jpg`,
    added: String(1_700_000_000 + index),
    plot: filler,
    playbackRef: {
      type: "m3u-path" as const,
      kind: "movie" as const,
      streamId: String(index),
      containerExtension: "mp4",
    },
  }));
}

async function openIsolatedDatabase() {
  await SQLite.deleteDatabaseAsync(CATALOG_WRITE_BENCHMARK_DB).catch(() => undefined);
  const db = await SQLite.openDatabaseAsync(CATALOG_WRITE_BENCHMARK_DB);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE catalog_categories (
      provider_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      category_id TEXT NOT NULL,
      category_name TEXT NOT NULL,
      parent_id INTEGER,
      PRIMARY KEY (provider_id, kind, category_id)
    );
    CREATE TABLE catalog_items (
      provider_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      item_id TEXT NOT NULL,
      category_id TEXT,
      name TEXT NOT NULL,
      image_url TEXT,
      payload TEXT NOT NULL,
      added_at INTEGER NOT NULL DEFAULT 0,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      is_new INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (provider_id, kind, item_id)
    );
    CREATE INDEX idx_catalog_items_provider_kind
      ON catalog_items(provider_id, kind);
    CREATE INDEX idx_catalog_items_provider_kind_category
      ON catalog_items(provider_id, kind, category_id);
    CREATE INDEX idx_catalog_items_new
      ON catalog_items(provider_id, kind, is_new, first_seen_at DESC);
  `);
  return db;
}

async function currentWriteBatch(
  db: SQLite.SQLiteDatabase,
  items: PersistedVodCatalogItem[],
  seenAt: number,
) {
  await db.withExclusiveTransactionAsync(async (transaction) => {
    for (const item of items) {
      await transaction.runAsync(
        CATALOG_SINGLE_ROW_UPSERT_SQL,
        buildCatalogItemBindValues({
          providerId: STAGING_PROVIDER,
          kind: "vod",
          item,
          seenAt,
          markNew: true,
        }),
      );
    }
  });
}

function hashText(hash: number, text: string) {
  let value = hash;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16_777_619);
  }
  return value >>> 0;
}

async function validateResult(
  db: SQLite.SQLiteDatabase,
  items: PersistedVodCatalogItem[],
  seenAt: number,
) {
  const counts = await db.getFirstAsync<{
    total: number;
    staging: number;
    wrong_seen: number;
    wrong_new: number;
  }>(`SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN provider_id = ? THEN 1 ELSE 0 END) AS staging,
       SUM(CASE WHEN first_seen_at != ? OR last_seen_at != ? THEN 1 ELSE 0 END) AS wrong_seen,
       SUM(CASE WHEN is_new != 1 THEN 1 ELSE 0 END) AS wrong_new
     FROM catalog_items`, STAGING_PROVIDER, seenAt, seenAt);
  if (!counts || counts.total !== items.length || counts.staging !== 0 || counts.wrong_seen !== 0 || counts.wrong_new !== 0) {
    throw new Error("Catalog benchmark row/count metadata validation failed.");
  }

  let actualHash = 2_166_136_261;
  let offset = 0;
  while (offset < items.length) {
    const page = await db.getAllAsync<{ item_id: string; payload: string }>(
      `SELECT item_id, payload FROM catalog_items
       WHERE provider_id = ? AND kind = 'vod'
       ORDER BY item_id ASC LIMIT 500 OFFSET ?`,
      ACTIVE_PROVIDER,
      offset,
    );
    for (const row of page) actualHash = hashText(actualHash, `${row.item_id}\u001f${row.payload}\u001e`);
    offset += page.length;
    if (page.length === 0) break;
  }

  let expectedHash = 2_166_136_261;
  for (const item of items) {
    expectedHash = hashText(
      expectedHash,
      `${String(item.stream_id)}\u001f${JSON.stringify({ ...item, providerId: STAGING_PROVIDER })}\u001e`,
    );
  }
  if (actualHash !== expectedHash) throw new Error("Catalog benchmark identity/payload validation failed.");
}

export async function runCatalogWriteBenchmark(options: {
  strategy: CatalogWriteBenchmarkStrategy;
  rows: CatalogWriteBenchmarkRows;
  profile: CatalogWritePayloadProfile;
}): Promise<CatalogWriteBenchmarkResult> {
  const projectionStartedAt = nowMs();
  const items = makeRows(options.rows, options.profile);
  const projectionMs = nowMs() - projectionStartedAt;
  const encoder = new TextEncoder();
  const serializationStartedAt = nowMs();
  const serializedBytes = items.reduce(
    (total, item) => total + encoder.encode(JSON.stringify(item)).length,
    0,
  );
  const jsonSerializeMs = nowMs() - serializationStartedAt;
  const totalStartedAt = nowMs();
  const db = await openIsolatedDatabase();
  const seenAt = 1_800_000_000_000;
  const counters: CatalogWriteCounters = { prepareCount: 0, executeCount: 0, finalizeCount: 0 };
  let transactionMs = 0;
  let yieldCount = 0;
  let categoryWriteMs = 0;
  let finalSwapMs = 0;

  try {
    const sqliteStartedAt = nowMs();
    for (let start = 0; start < items.length; start += CATALOG_LOGICAL_BATCH_MAX) {
      const batch = items.slice(start, start + CATALOG_LOGICAL_BATCH_MAX);
      const transactionStartedAt = nowMs();
      if (options.strategy === "CURRENT") {
        await currentWriteBatch(db, batch, seenAt);
        counters.prepareCount += batch.length;
        counters.executeCount += batch.length;
        counters.finalizeCount += batch.length;
      } else if (options.strategy === "PREPARED_SINGLE") {
        const result = await executePreparedCatalogSingleRowBatch({
          database: db,
          providerId: STAGING_PROVIDER,
          kind: "vod",
          items: batch,
          seenAt,
          markNew: true,
        });
        addCounters(counters, result.counters);
      } else {
        const result = await executePreparedCatalogMultiRowBatch({
          database: db,
          providerId: STAGING_PROVIDER,
          kind: "vod",
          items: batch,
          seenAt,
          markNew: true,
        });
        addCounters(counters, result.counters);
      }
      transactionMs += nowMs() - transactionStartedAt;
      await yieldToUi();
      yieldCount += 1;
    }
    const sqliteWriteMs = nowMs() - sqliteStartedAt;

    const swapStartedAt = nowMs();
    await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync("DELETE FROM catalog_items WHERE provider_id = ?", ACTIVE_PROVIDER);
      await transaction.runAsync("DELETE FROM catalog_categories WHERE provider_id = ?", ACTIVE_PROVIDER);
      await transaction.runAsync(
        "UPDATE catalog_items SET provider_id = ? WHERE provider_id = ?",
        ACTIVE_PROVIDER,
        STAGING_PROVIDER,
      );
      const categoriesStartedAt = nowMs();
      for (let index = 0; index < 24; index += 1) {
        await transaction.runAsync(
          `INSERT INTO catalog_categories
             (provider_id, kind, category_id, category_name, parent_id)
           VALUES (?, 'vod', ?, ?, NULL)`,
          ACTIVE_PROVIDER,
          String(index),
          `Category ${index}`,
        );
      }
      categoryWriteMs = nowMs() - categoriesStartedAt;
    });
    finalSwapMs = nowMs() - swapStartedAt;
    const totalMs = nowMs() - totalStartedAt;
    await validateResult(db, items, seenAt);

    return {
      strategy: options.strategy,
      profile: options.profile,
      rows: options.rows,
      projectionMs,
      jsonSerializeMs,
      serializedBytes,
      transactionMs,
      sqliteWriteMs,
      ...counters,
      yieldCount,
      categoryWriteMs,
      finalSwapMs,
      totalMs,
      rowsPerSecond: totalMs > 0 ? (items.length * 1000) / totalMs : 0,
      correctness: "passed",
    };
  } finally {
    await db.closeAsync().catch(() => undefined);
    await SQLite.deleteDatabaseAsync(CATALOG_WRITE_BENCHMARK_DB).catch(() => undefined);
  }
}

export async function runCatalogWriteRollbackProbe(strategy: CatalogWriteBenchmarkStrategy) {
  const db = await openIsolatedDatabase();
  const seenAt = 1_800_000_000_000;
  const valid = makeRows(200, "small").slice(0, 2);
  const invalid = { ...valid[1], name: null } as unknown as PersistedVodCatalogItem;
  await db.runAsync(
    CATALOG_SINGLE_ROW_UPSERT_SQL,
    buildCatalogItemBindValues({
      providerId: ACTIVE_PROVIDER,
      kind: "vod",
      item: { ...valid[0], providerId: ACTIVE_PROVIDER },
      seenAt,
      markNew: false,
    }),
  );
  try {
    try {
      if (strategy === "CURRENT") await currentWriteBatch(db, [valid[0], invalid], seenAt);
      else if (strategy === "PREPARED_SINGLE") {
        await executePreparedCatalogSingleRowBatch({
          database: db, providerId: STAGING_PROVIDER, kind: "vod", items: [valid[0], invalid], seenAt, markNew: true,
        });
      } else {
        await executePreparedCatalogMultiRowBatch({
          database: db, providerId: STAGING_PROVIDER, kind: "vod", items: [valid[0], invalid], seenAt, markNew: true,
        });
      }
      throw new Error("Injected constraint failure unexpectedly committed.");
    } catch (caught) {
      if (caught instanceof Error && caught.message === "Injected constraint failure unexpectedly committed.") throw caught;
    }
    const active = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM catalog_items WHERE provider_id = ?", ACTIVE_PROVIDER,
    );
    const staging = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM catalog_items WHERE provider_id = ?", STAGING_PROVIDER,
    );
    if (active?.count !== 1 || staging?.count !== 0) {
      throw new Error("Injected catalog write failure did not roll back or preserve active rows.");
    }
    return { rollback: "passed" as const, activeRows: 1, stagingRows: 0 };
  } finally {
    await db.closeAsync().catch(() => undefined);
    await SQLite.deleteDatabaseAsync(CATALOG_WRITE_BENCHMARK_DB).catch(() => undefined);
  }
}
