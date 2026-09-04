import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PersistedVodCatalogItem } from "../lib/catalogPersistence";
import {
  CATALOG_ADAPTIVE_WIDTHS,
  CATALOG_UPSERT_VALUES_PER_ROW,
  type CatalogBindValue,
  type CatalogPreparedStatement,
  type CatalogWriteDatabase,
  type CatalogWriteTransaction,
} from "../lib/catalogWriteBatch";
import { executeCatalogBulkNonCancellableBatches } from "../lib/catalogBulkWrite";

type AttemptLog = {
  committed: boolean;
  executions: CatalogBindValue[][];
  finalized: number;
};

class FakeDatabase implements CatalogWriteDatabase {
  attempts: AttemptLog[] = [];
  prepareShapes: number[] = [];
  maxWidth = 50;
  executeFailure?: { transaction: number; execute: number; error: Error };
  prepareFailure?: Error;

  async withExclusiveTransactionAsync(task: (transaction: CatalogWriteTransaction) => Promise<void>) {
    const log: AttemptLog = { committed: false, executions: [], finalized: 0 };
    const transactionNumber = this.attempts.length + 1;
    let executeNumber = 0;
    const transaction: CatalogWriteTransaction = {
      prepareAsync: async (sql: string): Promise<CatalogPreparedStatement> => {
        if (this.prepareFailure) throw this.prepareFailure;
        const shape = (sql.match(/\?/g) ?? []).length / CATALOG_UPSERT_VALUES_PER_ROW;
        this.prepareShapes.push(shape);
        if (shape > this.maxWidth) throw new Error("too many SQL variables");
        return {
          executeAsync: async (params) => {
            executeNumber += 1;
            if (
              this.executeFailure?.transaction === transactionNumber &&
              this.executeFailure.execute === executeNumber
            ) {
              throw this.executeFailure.error;
            }
            log.executions.push([...params]);
          },
          finalizeAsync: async () => {
            log.finalized += 1;
          },
        };
      },
    };
    try {
      await task(transaction);
      log.committed = true;
    } finally {
      this.attempts.push(log);
    }
  }
}

function vod(index: number, overrides: Partial<PersistedVodCatalogItem> = {}): PersistedVodCatalogItem {
  return {
    schemaVersion: 1,
    catalogKind: "vod",
    providerId: "provider-a",
    stream_id: String(index),
    name: `Film ${index}`,
    category_id: "7",
    stream_icon: `https://invalid.example/${index}.jpg`,
    added: "1700000000",
    plot: `Plot ${index}`,
    playbackRef: {
      type: "m3u-path",
      kind: "movie",
      streamId: String(index),
      containerExtension: "mp4",
    },
    ...overrides,
  };
}

const rows = (count: number) => Array.from({ length: count }, (_, index) => vod(index));

type RunObservation = {
  started: number[];
  committed: Array<{ batchIndex: number; batchRows: number; committedRows: number }>;
  progress: number[];
  stages: string[];
  yields: number;
};

function createObservation(): RunObservation {
  return { started: [], committed: [], progress: [], stages: [], yields: 0 };
}

function bulkOptions(
  database: FakeDatabase,
  items: PersistedVodCatalogItem[],
  observation: RunObservation,
  overrides: Partial<Parameters<typeof executeCatalogBulkNonCancellableBatches>[0]> = {},
): Parameters<typeof executeCatalogBulkNonCancellableBatches>[0] {
  return {
    database,
    providerId: "provider-a",
    kind: "vod",
    items,
    seenAt: 1_800_000_000_000,
    markNew: true,
    onBatchStarted: (batchIndex) => observation.started.push(batchIndex),
    onBatchCommitted: (entry) => observation.committed.push(entry),
    onProgress: (written) => observation.progress.push(written),
    onSqliteStage: (stage) => observation.stages.push(stage),
    yieldToUi: async () => {
      observation.yields += 1;
    },
    ...overrides,
  };
}

let fakePassed = 0;
async function fakeScenario(name: string, run: () => void | Promise<void>) {
  await run();
  fakePassed += 1;
  console.log(`ok stageb-fake ${fakePassed} - ${name}`);
}

let sourcePassed = 0;
async function sourceScenario(name: string, run: () => void | Promise<void>) {
  await run();
  sourcePassed += 1;
  console.log(`ok stageb-source ${sourcePassed} - ${name}`);
}

function source(relative: string) {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

function between(text: string, start: string, end: string) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing source marker: ${start}`);
  assert.notEqual(to, -1, `missing source marker: ${end}`);
  return text.slice(from, to);
}

async function main() {
  await fakeScenario("one row commits exactly once and yields after commit", async () => {
    const database = new FakeDatabase();
    const observation = createObservation();
    const written = await executeCatalogBulkNonCancellableBatches(
      bulkOptions(database, rows(1), observation),
    );
    assert.equal(written, 1);
    assert.deepEqual(observation.started, [1]);
    assert.deepEqual(observation.committed, [{ batchIndex: 1, batchRows: 1, committedRows: 1 }]);
    assert.deepEqual(observation.progress, [1]);
    assert.equal(observation.yields, 1);
  });

  await fakeScenario("fifty rows use the HYBRID_50 prepared shape", async () => {
    const database = new FakeDatabase();
    const observation = createObservation();
    assert.equal(await executeCatalogBulkNonCancellableBatches(bulkOptions(database, rows(50), observation)), 50);
    assert.deepEqual(database.prepareShapes, [50]);
    assert.equal(database.attempts.length, 1);
  });

  await fakeScenario("sixty-seven rows use exact 50 plus 17 prepared shapes", async () => {
    const database = new FakeDatabase();
    const observation = createObservation();
    assert.equal(await executeCatalogBulkNonCancellableBatches(bulkOptions(database, rows(67), observation)), 67);
    assert.deepEqual(database.prepareShapes, [50, 17]);
    assert.equal(database.attempts[0].finalized, 2);
  });

  await fakeScenario("199 rows remain one logical batch", async () => {
    const database = new FakeDatabase();
    const observation = createObservation();
    assert.equal(await executeCatalogBulkNonCancellableBatches(bulkOptions(database, rows(199), observation)), 199);
    assert.deepEqual(observation.started, [1]);
    assert.deepEqual(observation.progress, [199]);
    assert.equal(observation.yields, 1);
  });

  await fakeScenario("200 rows remain one logical batch with one yield", async () => {
    const database = new FakeDatabase();
    const observation = createObservation();
    assert.equal(await executeCatalogBulkNonCancellableBatches(bulkOptions(database, rows(200), observation)), 200);
    assert.deepEqual(observation.started, [1]);
    assert.deepEqual(observation.committed, [{ batchIndex: 1, batchRows: 200, committedRows: 200 }]);
    assert.deepEqual(observation.progress, [200]);
    assert.equal(observation.yields, 1);
  });

  await fakeScenario("201 rows produce two logical batches and committed-only progress", async () => {
    const database = new FakeDatabase();
    const observation = createObservation();
    assert.equal(await executeCatalogBulkNonCancellableBatches(bulkOptions(database, rows(201), observation)), 201);
    assert.deepEqual(observation.started, [1, 2]);
    assert.deepEqual(observation.progress, [200, 201]);
    assert.deepEqual(observation.committed, [
      { batchIndex: 1, batchRows: 200, committedRows: 200 },
      { batchIndex: 2, batchRows: 1, committedRows: 201 },
    ]);
    assert.equal(observation.yields, 2);
  });

  await fakeScenario("400 rows preserve logical callback and progress order", async () => {
    const database = new FakeDatabase();
    const observation = createObservation();
    assert.equal(await executeCatalogBulkNonCancellableBatches(bulkOptions(database, rows(400), observation)), 400);
    assert.deepEqual(observation.started, [1, 2]);
    assert.deepEqual(observation.progress, [200, 400]);
    assert.deepEqual(observation.committed, [
      { batchIndex: 1, batchRows: 200, committedRows: 200 },
      { batchIndex: 2, batchRows: 200, committedRows: 400 },
    ]);
    assert.equal(observation.yields, 2);
  });

  await fakeScenario("DTO provider mismatch fails closed before committed progress", async () => {
    const database = new FakeDatabase();
    const observation = createObservation();
    await assert.rejects(
      executeCatalogBulkNonCancellableBatches(
        bulkOptions(database, [vod(1, { providerId: "provider-b" })], observation),
      ),
      /does not match its write target/,
    );
    assert.deepEqual(observation.committed, []);
    assert.deepEqual(observation.progress, []);
    assert.equal(observation.yields, 0);
    assert.equal(database.attempts[0].committed, false);
    assert.equal(database.attempts[0].finalized, 1);
  });

  await fakeScenario("DTO kind mismatch fails closed before committed progress", async () => {
    const database = new FakeDatabase();
    const observation = createObservation();
    await assert.rejects(
      executeCatalogBulkNonCancellableBatches(
        bulkOptions(database, [vod(1)], observation, { kind: "live" }),
      ),
      /does not match its write target/,
    );
    assert.deepEqual(observation.committed, []);
    assert.deepEqual(observation.progress, []);
    assert.equal(observation.yields, 0);
  });

  await fakeScenario("markNew and seenAt bind semantics reach the prepared statement unchanged", async () => {
    const database = new FakeDatabase();
    const observation = createObservation();
    const seenAt = 1_912_345_678_901;
    await executeCatalogBulkNonCancellableBatches(
      bulkOptions(database, rows(1), observation, { seenAt, markNew: true }),
    );
    const bind = database.attempts[0].executions[0];
    assert.deepEqual(bind.slice(8), [seenAt, seenAt, 1]);
  });

  await fakeScenario("TOO_MANY_VARIABLES retries the whole logical batch in a fresh transaction", async () => {
    const database = new FakeDatabase();
    database.executeFailure = { transaction: 1, execute: 2, error: new Error("too many SQL variables") };
    const observation = createObservation();
    assert.equal(await executeCatalogBulkNonCancellableBatches(bulkOptions(database, rows(200), observation)), 200);
    assert.equal(database.attempts.length, 2);
    assert.equal(database.attempts[0].committed, false);
    assert.equal(database.attempts[0].finalized, 1);
    assert.equal(database.attempts[1].committed, true);
    assert.equal(database.attempts[1].executions[0][2], "0");
    assert.deepEqual(observation.progress, [200]);
    assert.deepEqual(observation.stages, [
      "begin-transaction",
      "insert-statement",
      "begin-transaction",
      "insert-statement",
      "commit",
    ]);
  });

  await fakeScenario("non-variable SQLite errors propagate without fallback", async () => {
    const database = new FakeDatabase();
    database.prepareFailure = new Error("SQLITE_BUSY: database is locked");
    const observation = createObservation();
    await assert.rejects(
      executeCatalogBulkNonCancellableBatches(bulkOptions(database, rows(50), observation)),
      /SQLITE_BUSY/,
    );
    assert.equal(database.attempts.length, 1);
    assert.deepEqual(observation.committed, []);
    assert.deepEqual(observation.progress, []);
    assert.equal(observation.yields, 0);
  });

  await fakeScenario("width one variable-limit failure propagates after the exact adaptive sequence", async () => {
    const database = new FakeDatabase();
    database.maxWidth = 0;
    const observation = createObservation();
    await assert.rejects(
      executeCatalogBulkNonCancellableBatches(bulkOptions(database, rows(50), observation)),
      /too many SQL variables/,
    );
    assert.deepEqual(database.prepareShapes, [...CATALOG_ADAPTIVE_WIDTHS]);
    assert.equal(database.attempts.length, CATALOG_ADAPTIVE_WIDTHS.length);
    assert.deepEqual(observation.committed, []);
    assert.equal(observation.yields, 0);
  });

  await fakeScenario("prepared statements finalize on successful Stage B writes", async () => {
    const database = new FakeDatabase();
    const observation = createObservation();
    await executeCatalogBulkNonCancellableBatches(bulkOptions(database, rows(67), observation));
    assert.equal(database.attempts[0].finalized, 2);
  });

  await fakeScenario("prepared statements finalize on failed Stage B writes", async () => {
    const database = new FakeDatabase();
    database.executeFailure = { transaction: 1, execute: 1, error: new Error("SQLITE_CONSTRAINT") };
    const observation = createObservation();
    await assert.rejects(
      executeCatalogBulkNonCancellableBatches(bulkOptions(database, rows(50), observation)),
      /SQLITE_CONSTRAINT/,
    );
    assert.equal(database.attempts[0].finalized, 1);
  });

  await fakeScenario("onBatchStarted fires exactly once per logical batch", async () => {
    const database = new FakeDatabase();
    const observation = createObservation();
    await executeCatalogBulkNonCancellableBatches(bulkOptions(database, rows(400), observation));
    assert.deepEqual(observation.started, [1, 2]);
  });

  await fakeScenario("failed logical batches publish no commit progress or yield", async () => {
    const database = new FakeDatabase();
    database.executeFailure = { transaction: 1, execute: 1, error: new Error("SQLITE_FULL") };
    const observation = createObservation();
    await assert.rejects(
      executeCatalogBulkNonCancellableBatches(bulkOptions(database, rows(200), observation)),
      /SQLITE_FULL/,
    );
    assert.deepEqual(observation.started, [1]);
    assert.deepEqual(observation.committed, []);
    assert.deepEqual(observation.progress, []);
    assert.equal(observation.yields, 0);
  });

  await fakeScenario("normal SQLite stage order is begin insert commit", async () => {
    const database = new FakeDatabase();
    const observation = createObservation();
    await executeCatalogBulkNonCancellableBatches(bulkOptions(database, rows(50), observation));
    assert.deepEqual(observation.stages, ["begin-transaction", "insert-statement", "commit"]);
  });

  const catalogCache = source("../lib/catalogCache.ts");
  const m3uCache = source("../lib/m3uCatalogCache.ts");
  const xtreamContext = source("../context/CatalogSyncContext.tsx");
  const packageJson = source("../package.json");

  await sourceScenario("explicit production API is non-cancellable and stays on the DB writer queue", () => {
    const block = between(
      catalogCache,
      "export async function upsertCatalogItemsBulkNonCancellable(",
      "export async function replaceCatalogKind(",
    );
    assert.doesNotMatch(block, /isCancelled/);
    assert.match(block, /enqueueCatalogDbWrite/);
    assert.match(block, /executeCatalogBulkNonCancellableBatches/);
    assert.match(block, /yieldToUi/);
  });

  await sourceScenario("generic upsertCatalogItems does not auto-route to the bulk helper", () => {
    const block = between(
      catalogCache,
      "export async function upsertCatalogItems(",
      "export async function upsertCatalogItemsBulkNonCancellable(",
    );
    assert.doesNotMatch(block, /executeCatalogBulkNonCancellableBatches/);
    assert.match(block, /options\.isCancelled/);
  });

  await sourceScenario("M3U live vod and series staging writes explicitly use the bulk API", () => {
    assert.equal((m3uCache.match(/upsertCatalogItemsBulkNonCancellable\(/g) ?? []).length, 3);
    assert.doesNotMatch(m3uCache, /\bupsertCatalogItems\(/);
    assert.match(m3uCache, /stagedCounts\.live = await upsertCatalogItemsBulkNonCancellable/);
    assert.match(m3uCache, /stagedCounts\.vod = await upsertCatalogItemsBulkNonCancellable/);
    assert.match(m3uCache, /stagedCounts\.series = await upsertCatalogItemsBulkNonCancellable/);
  });

  await sourceScenario("Xtream remains on generic cancellable upsertCatalogItems", () => {
    assert.doesNotMatch(xtreamContext, /BulkNonCancellable/);
    assert.equal((xtreamContext.match(/await upsertCatalogItems\(/g) ?? []).length, 3);
    assert.ok((xtreamContext.match(/isCancelled,/g) ?? []).length >= 3);
  });

  await sourceScenario("replaceCatalogKind remains outside the Stage B bulk route", () => {
    const block = between(
      catalogCache,
      "export async function replaceCatalogKind(",
      "export async function pruneCatalogKind(",
    );
    assert.doesNotMatch(block, /executeCatalogBulkNonCancellableBatches|BulkNonCancellable/);
    assert.match(block, /insertRows/);
  });

  await sourceScenario("final staging swap SQL and category replacement remain on the existing path", () => {
    const block = between(
      catalogCache,
      "export async function swapStagingToProvider(",
      "export async function getCachedPersistedItems(",
    );
    assert.match(block, /DELETE FROM catalog_items WHERE provider_id = \?/);
    assert.match(block, /UPDATE catalog_items SET provider_id = \? WHERE provider_id = \?/);
    assert.match(block, /replaceCategories\(txn, options\.providerId, "vod"/);
    assert.match(block, /replaceCategories\(txn, options\.providerId, "series"/);
    assert.doesNotMatch(block, /executeCatalogBulkNonCancellableBatches/);
  });

  await sourceScenario("M3U category construction still feeds the unchanged final swap", () => {
    assert.match(m3uCache, /vodCategories: categories\(movieInput\.map\(\(item\) => item\.category\)\)/);
    assert.match(m3uCache, /seriesCategories: categories\(seriesInput\.map\(\(item\) => item\.category\)\)/);
    assert.match(m3uCache, /const committedCounts = await swapStagingToProvider/);
  });

  await sourceScenario("the existing Quality command runs Stage B after the 27-scenario candidate suite", () => {
    assert.match(
      packageJson,
      /"test:catalog-write-batch": "tsx tests\/catalogWriteBatchScenarios\.ts && tsx tests\/catalogBulkWriteStageBScenarios\.ts"/,
    );
  });

  assert.equal(fakePassed, 18);
  assert.equal(sourcePassed, 8);
  console.log("catalog Stage B bulk write fake DB scenarios: 18/18 passed");
  console.log("catalog Stage B integration source assertions: 8/8 passed");
}

void main();
