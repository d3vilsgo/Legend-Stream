import * as SQLite from "expo-sqlite";
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import type { PersistedVodCatalogItem } from "./catalogPersistence";
import {
  CURRENT_CATALOG_SINGLE_ROW_UPSERT_SQL,
  buildCurrentCatalogItemBindValues,
} from "./catalogWriteBaseline";
import {
  CATALOG_LOGICAL_BATCH_MAX,
  executePreparedCatalogMultiRowBatch,
  executePreparedCatalogSingleRowBatch,
  type CatalogWriteCounters,
} from "./catalogWriteBatch";
import { yieldToUi } from "./cooperative";
import {
  assertSafeCatalogBenchmarkDatabaseName,
  createCatalogBenchmarkDatabaseName,
  type CatalogBenchmarkNativeProbe,
} from "./catalogWriteBenchmarkRunner";
import {
  CatalogBenchmarkCleanupError,
  CatalogBenchmarkLifecycleError,
  deleteExistingCatalogBenchmarkArtifacts,
} from "./catalogBenchmarkCleanup";
import { redactSensitiveText } from "./safeLog";

const ACTIVE_PROVIDER = "benchmark-active";
const STAGING_PROVIDER = "__staging__benchmark-active";

export function createNativeCatalogBenchmarkDatabaseName() {
  return createCatalogBenchmarkDatabaseName(Crypto.randomUUID().replace(/-/g, ""));
}

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
  /** Stale DB delete + open + schema/index setup wall-clock. Cleanup is excluded. */
  dbSetupMs: number;
  /** Strategy transaction wall-clock total. Excludes yield and final swap time. */
  transactionMs: number;
  /** Same strategy-transaction boundary as transactionMs; retained as the SQLite write metric. */
  sqliteWriteMs: number;
  /** Wall-clock spent awaiting cooperative UI yields between logical write batches. */
  yieldMs: number;
  prepareCount: number;
  executeCount: number;
  finalizeCount: number;
  yieldCount: number;
  categoryWriteMs: number;
  finalSwapMs: number;
  /** First logical write batch start -> final swap completion. */
  totalMs: number;
  rowsPerSecond: number;
  sqliteRowsPerSecond: number;
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

async function createBenchmarkSchema(db: SQLite.SQLiteDatabase) {
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
}

async function cleanupIsolatedDatabase(db: SQLite.SQLiteDatabase | null, databaseName: string) {
  const failures: unknown[] = [];
  if (db) {
    try {
      await db.closeAsync();
    } catch (caught) {
      failures.push(caught);
    }
  }
  try { await deleteExactBenchmarkArtifacts(databaseName); } catch (caught) { failures.push(caught); }
  if (failures.length > 0) throw new CatalogBenchmarkCleanupError(failures);
}

async function deleteExactBenchmarkArtifacts(databaseName: string) {
  const directory = SQLite.defaultDatabaseDirectory;
  if (typeof directory !== "string" || directory.length === 0) {
    throw new Error("BENCHMARK_DATABASE_DIRECTORY_UNAVAILABLE");
  }
  await deleteExistingCatalogBenchmarkArtifacts({
    databaseName,
    directory,
    createFile: (fileUri) => new File(fileUri),
  });
}

async function withIsolatedBenchmarkDatabase<T>(
  databaseName: string,
  run: (db: SQLite.SQLiteDatabase, dbSetupMs: number) => Promise<T>,
): Promise<T> {
  assertSafeCatalogBenchmarkDatabaseName(databaseName);
  let db: SQLite.SQLiteDatabase | null = null;
  let primaryError: unknown;
  let hasPrimaryError = false;

  try {
    const setupStartedAt = nowMs();
    // Fail closed: a stale benchmark DB must not survive into a new measurement.
    await deleteExactBenchmarkArtifacts(databaseName);
    db = await SQLite.openDatabaseAsync(databaseName);
    await createBenchmarkSchema(db);
    const dbSetupMs = nowMs() - setupStartedAt;
    return await run(db, dbSetupMs);
  } catch (caught) {
    hasPrimaryError = true;
    primaryError = caught;
    throw caught;
  } finally {
    try {
      await cleanupIsolatedDatabase(db, databaseName);
    } catch (cleanupError) {
      if (hasPrimaryError) throw new CatalogBenchmarkLifecycleError(primaryError, cleanupError);
      throw cleanupError;
    }
  }
}

async function currentWriteBatch(
  db: SQLite.SQLiteDatabase,
  items: PersistedVodCatalogItem[],
  seenAt: number,
) {
  await db.withExclusiveTransactionAsync(async (transaction) => {
    for (const item of items) {
      await transaction.runAsync(
        CURRENT_CATALOG_SINGLE_ROW_UPSERT_SQL,
        buildCurrentCatalogItemBindValues({
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

function rowFingerprint(values: readonly unknown[]) {
  return values.map((value) => value === null ? "<null>" : String(value)).join("\u001f") + "\u001e";
}

async function validateResult(
  db: SQLite.SQLiteDatabase,
  items: PersistedVodCatalogItem[],
  seenAt: number,
) {
  const counts = await db.getFirstAsync<{
    total: number;
    active: number;
    staging: number;
    wrong_seen: number;
    wrong_new: number;
  }>(`SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN provider_id = ? THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN provider_id = ? THEN 1 ELSE 0 END) AS staging,
       SUM(CASE WHEN first_seen_at != ? OR last_seen_at != ? THEN 1 ELSE 0 END) AS wrong_seen,
       SUM(CASE WHEN is_new != 1 THEN 1 ELSE 0 END) AS wrong_new
     FROM catalog_items`, ACTIVE_PROVIDER, STAGING_PROVIDER, seenAt, seenAt);
  if (
    !counts ||
    counts.total !== items.length ||
    counts.active !== items.length ||
    counts.staging !== 0 ||
    counts.wrong_seen !== 0 ||
    counts.wrong_new !== 0
  ) {
    throw new Error("Catalog benchmark row/count metadata validation failed.");
  }

  let actualHash = 2_166_136_261;
  let offset = 0;
  while (offset < items.length) {
    const page = await db.getAllAsync<{
      item_id: string;
      category_id: string | null;
      name: string;
      image_url: string | null;
      payload: string;
      added_at: number;
      first_seen_at: number;
      last_seen_at: number;
      is_new: number;
    }>(
      `SELECT item_id, category_id, name, image_url, payload,
              added_at, first_seen_at, last_seen_at, is_new
         FROM catalog_items
        WHERE provider_id = ? AND kind = 'vod'
        ORDER BY item_id ASC LIMIT 500 OFFSET ?`,
      ACTIVE_PROVIDER,
      offset,
    );
    for (const row of page) {
      actualHash = hashText(actualHash, rowFingerprint([
        row.item_id,
        row.category_id,
        row.name,
        row.image_url,
        row.payload,
        row.added_at,
        row.first_seen_at,
        row.last_seen_at,
        row.is_new,
      ]));
    }
    offset += page.length;
    if (page.length === 0) break;
  }

  let expectedHash = 2_166_136_261;
  const expectedItems = [...items].sort((left, right) => String(left.stream_id).localeCompare(String(right.stream_id)));
  for (const item of expectedItems) {
    const bind = buildCurrentCatalogItemBindValues({
      providerId: STAGING_PROVIDER,
      kind: "vod",
      item,
      seenAt,
      markNew: true,
    });
    expectedHash = hashText(expectedHash, rowFingerprint([
      bind[2], bind[3], bind[4], bind[5], bind[6], bind[7], bind[8], bind[9], bind[10],
    ]));
  }
  if (actualHash !== expectedHash) {
    throw new Error("Catalog benchmark persisted-column parity validation failed.");
  }

  const categories = await db.getAllAsync<{
    category_id: string;
    category_name: string;
    parent_id: number | null;
  }>(
    `SELECT category_id, category_name, parent_id
       FROM catalog_categories
      WHERE provider_id = ? AND kind = 'vod'
      ORDER BY CAST(category_id AS INTEGER) ASC`,
    ACTIVE_PROVIDER,
  );
  if (
    categories.length !== 24 ||
    categories.some((category, index) =>
      category.category_id !== String(index) ||
      category.category_name !== `Category ${index}` ||
      category.parent_id !== null
    )
  ) {
    throw new Error("Catalog benchmark category validation failed.");
  }
}

export async function runCatalogWriteBenchmark(options: {
  strategy: CatalogWriteBenchmarkStrategy;
  rows: CatalogWriteBenchmarkRows;
  profile: CatalogWritePayloadProfile;
  databaseName?: string;
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

  const databaseName = options.databaseName ?? createNativeCatalogBenchmarkDatabaseName();
  return withIsolatedBenchmarkDatabase(databaseName, async (db, dbSetupMs) => {
    const seenAt = 1_800_000_000_000;
    const counters: CatalogWriteCounters = { prepareCount: 0, executeCount: 0, finalizeCount: 0 };
    let transactionMs = 0;
    let yieldMs = 0;
    let yieldCount = 0;
    let categoryWriteMs = 0;
    let finalSwapMs = 0;

    // Exact total boundary: immediately before the first logical strategy batch.
    const totalStartedAt = nowMs();
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

      const yieldStartedAt = nowMs();
      await yieldToUi();
      yieldMs += nowMs() - yieldStartedAt;
      yieldCount += 1;
    }
    const sqliteWriteMs = transactionMs;

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
    // Validation and cleanup happen after this timestamp and are intentionally excluded.
    const totalMs = nowMs() - totalStartedAt;

    await validateResult(db, items, seenAt);

    return {
      strategy: options.strategy,
      profile: options.profile,
      rows: options.rows,
      projectionMs,
      jsonSerializeMs,
      serializedBytes,
      dbSetupMs,
      transactionMs,
      sqliteWriteMs,
      yieldMs,
      ...counters,
      yieldCount,
      categoryWriteMs,
      finalSwapMs,
      totalMs,
      rowsPerSecond: totalMs > 0 ? (items.length * 1000) / totalMs : 0,
      sqliteRowsPerSecond: sqliteWriteMs > 0 ? (items.length * 1000) / sqliteWriteMs : 0,
      correctness: "passed",
    };
  });
}

export async function runCatalogWriteRollbackProbe(
  strategy: CatalogWriteBenchmarkStrategy,
  databaseName = createNativeCatalogBenchmarkDatabaseName(),
) {
  return withIsolatedBenchmarkDatabase(databaseName, async (db) => {
    const seenAt = 1_800_000_000_000;
    const valid = makeRows(200, "small").slice(0, 2);
    const invalid = { ...valid[1], name: null } as unknown as PersistedVodCatalogItem;

    // Seed write is inside the same protected lifecycle as the injected failure probe.
    await db.runAsync(
      CURRENT_CATALOG_SINGLE_ROW_UPSERT_SQL,
      buildCurrentCatalogItemBindValues({
        providerId: ACTIVE_PROVIDER,
        kind: "vod",
        item: { ...valid[0], providerId: ACTIVE_PROVIDER },
        seenAt,
        markNew: false,
      }),
    );

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
  });
}

async function runNativeProbe(name: string, run: () => Promise<void>): Promise<CatalogBenchmarkNativeProbe> {
  const startedAt = nowMs();
  try {
    await run();
    return { name, passed: true, durationMs: nowMs() - startedAt };
  } catch (caught) {
    return {
      name,
      passed: false,
      durationMs: nowMs() - startedAt,
      errorCode: "NATIVE_CORRECTNESS_PROBE_FAILED",
      sanitizedMessage: redactSensitiveText(caught instanceof Error ? caught.message : String(caught)),
    };
  }
}

async function runDuplicatePrimaryKeyNativeProbe() {
  const databaseName = createNativeCatalogBenchmarkDatabaseName();
  await withIsolatedBenchmarkDatabase(databaseName, async (db) => {
    const seenAt = 1_800_000_000_000;
    const first = makeRows(200, "small")[0];
    const second = { ...first, name: "Benchmark duplicate winner", plot: "second payload" };
    const sequentialProvider = "benchmark-sequential";
    const candidateProvider = "benchmark-candidate";
    const sequentialRows = [first, second].map((item) => ({ ...item, providerId: sequentialProvider }));
    const candidateRows = [first, second].map((item) => ({ ...item, providerId: candidateProvider }));

    await db.withExclusiveTransactionAsync(async (transaction) => {
      for (const item of sequentialRows) {
        await transaction.runAsync(
          CURRENT_CATALOG_SINGLE_ROW_UPSERT_SQL,
          buildCurrentCatalogItemBindValues({
            providerId: sequentialProvider, kind: "vod", item, seenAt, markNew: true,
          }),
        );
      }
    });
    await executePreparedCatalogMultiRowBatch({
      database: db,
      providerId: candidateProvider,
      kind: "vod",
      items: candidateRows,
      seenAt,
      markNew: true,
    });
    const select = `SELECT category_id, name, image_url, payload, added_at,
                           first_seen_at, last_seen_at, is_new
                      FROM catalog_items WHERE provider_id = ?`;
    const sequential = await db.getFirstAsync<Record<string, unknown>>(select, sequentialProvider);
    const candidate = await db.getFirstAsync<Record<string, unknown>>(select, candidateProvider);
    if (!sequential || !candidate) throw new Error("Native duplicate-primary-key rows are missing.");
    const normalizePayloadProvider = (row: Record<string, unknown>) => ({
      ...row,
      payload: String(row.payload).replace(sequentialProvider, candidateProvider),
    });
    if (JSON.stringify(normalizePayloadProvider(sequential)) !== JSON.stringify(candidate)) {
      throw new Error("Native duplicate-primary-key UPSERT parity failed.");
    }
  });
}

async function runPreparedRepeatNativeProbe() {
  const databaseName = createNativeCatalogBenchmarkDatabaseName();
  await withIsolatedBenchmarkDatabase(databaseName, async (db) => {
    const items = makeRows(200, "small").slice(0, 100);
    const result = await executePreparedCatalogMultiRowBatch({
      database: db,
      providerId: STAGING_PROVIDER,
      kind: "vod",
      items,
      seenAt: 1_800_000_000_000,
      markNew: true,
    });
    const count = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM catalog_items WHERE provider_id = ?",
      STAGING_PROVIDER,
    );
    if (
      result.actualExecutedRows !== 100 ||
      result.counters.prepareCount !== 1 ||
      result.counters.executeCount !== 2 ||
      result.counters.finalizeCount !== 1 ||
      count?.count !== 100
    ) {
      throw new Error("Native repeated prepared execution lifecycle failed.");
    }
  });
}

export async function runCatalogWriteNativeCorrectnessProbes(): Promise<CatalogBenchmarkNativeProbe[]> {
  const probes: Array<[string, () => Promise<void>]> = [
    ["duplicate-pk-sequential-vs-hybrid", runDuplicatePrimaryKeyNativeProbe],
    ["rollback-current", async () => { await runCatalogWriteRollbackProbe("CURRENT"); }],
    ["rollback-prepared-single", async () => { await runCatalogWriteRollbackProbe("PREPARED_SINGLE"); }],
    ["rollback-hybrid-50", async () => { await runCatalogWriteRollbackProbe("HYBRID_50"); }],
    ["prepared-repeated-execution-finalize", runPreparedRepeatNativeProbe],
    ["persisted-hash-metadata-staging-cleanup", async () => {
      await runCatalogWriteBenchmark({ strategy: "HYBRID_50", rows: 200, profile: "small" });
    }],
  ];
  const results: CatalogBenchmarkNativeProbe[] = [];
  for (const [name, run] of probes) results.push(await runNativeProbe(name, run));
  return results;
}
