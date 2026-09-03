import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { enqueueCatalogDbWrite } from "../lib/catalogDbWriter";
import type { PersistedVodCatalogItem } from "../lib/catalogPersistence";
import {
  CURRENT_CATALOG_SINGLE_ROW_UPSERT_SQL,
  buildCurrentCatalogItemBindValues,
} from "../lib/catalogWriteBaseline";
import {
  CATALOG_ADAPTIVE_WIDTHS,
  CATALOG_SINGLE_ROW_UPSERT_SQL,
  CATALOG_UPSERT_VALUES_PER_ROW,
  buildCatalogItemBindValues,
  buildCatalogItemsBindValues,
  buildCatalogMultiRowUpsert,
  executePreparedCatalogMultiRowBatch,
  executePreparedCatalogSingleRowBatch,
  type CatalogBindValue,
  type CatalogPreparedStatement,
  type CatalogWriteDatabase,
  type CatalogWriteTransaction,
} from "../lib/catalogWriteBatch";
import { classifyM3USqliteError } from "../lib/sqliteWriteDiagnostics";

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
            if (this.executeFailure?.transaction === transactionNumber && this.executeFailure.execute === executeNumber) {
              throw this.executeFailure.error;
            }
            log.executions.push([...params]);
          },
          finalizeAsync: async () => { log.finalized += 1; },
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
const options = (database: FakeDatabase, items: PersistedVodCatalogItem[]) => ({
  database,
  providerId: "provider-a",
  kind: "vod" as const,
  items,
  seenAt: 1_800_000_000_000,
  markNew: true,
});

function createSqliteSchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE catalog_items (
    provider_id TEXT NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL,
    category_id TEXT, name TEXT NOT NULL, image_url TEXT, payload TEXT NOT NULL,
    added_at INTEGER NOT NULL DEFAULT 0, first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL, is_new INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (provider_id, kind, item_id)
  )`);
}

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function main() {
  await scenario("one-row SQL matches the independent current production control", () => {
    const sql = buildCatalogMultiRowUpsert(1);
    assert.equal((sql.match(/\?/g) ?? []).length, 11);
    assert.equal((CURRENT_CATALOG_SINGLE_ROW_UPSERT_SQL.match(/\?/g) ?? []).length, 11);
    assert.equal(sql, CATALOG_SINGLE_ROW_UPSERT_SQL);
    assert.equal(sql.replace(/\s+/g, " ").trim(), CURRENT_CATALOG_SINGLE_ROW_UPSERT_SQL.replace(/\s+/g, " ").trim());
  });

  await scenario("fifty-row SQL has 550 placeholders", () => {
    assert.equal((buildCatalogMultiRowUpsert(50).match(/\?/g) ?? []).length, 550);
  });

  await scenario("seventeen-row tail uses its exact shape without padding", () => {
    const sql = buildCatalogMultiRowUpsert(17);
    assert.equal((sql.match(/\?/g) ?? []).length, 187);
    assert.throws(() => buildCatalogMultiRowUpsert(0), RangeError);
    assert.throws(() => buildCatalogMultiRowUpsert(51), RangeError);
  });

  await scenario("candidate bind order matches the independent current production control", () => {
    const item = vod(9);
    const bind = buildCatalogItemBindValues({
      providerId: "provider-a", kind: "vod", item, seenAt: 1234, markNew: true,
    });
    const currentBind = buildCurrentCatalogItemBindValues({
      providerId: "provider-a", kind: "vod", item, seenAt: 1234, markNew: true,
    });
    assert.deepEqual(bind, currentBind);
    assert.deepEqual(bind.slice(0, 6), ["provider-a", "vod", "9", "7", "Film 9", "https://invalid.example/9.jpg"]);
    assert.equal(bind[6], JSON.stringify(item));
    assert.deepEqual(bind.slice(7), [1_700_000_000_000, 1234, 1234, 1]);
  });

  await scenario("DTO target mismatch rejects before candidate execution and still finalizes", async () => {
    const database = new FakeDatabase();
    await assert.rejects(
      executePreparedCatalogSingleRowBatch(options(database, [vod(1, { providerId: "provider-b" })])),
      /does not match its write target/,
    );
    assert.equal(database.attempts.length, 1);
    assert.equal(database.attempts[0].executions.length, 0);
    assert.equal(database.attempts[0].finalized, 1);
  });

  await scenario("every row contributes exactly eleven bind parameters", () => {
    assert.equal(buildCatalogItemsBindValues({
      providerId: "provider-a", kind: "vod", items: rows(17), seenAt: 1, markNew: false,
    }).length, 17 * 11);
  });

  await scenario("UPSERT updates exactly the six mutable columns", () => {
    const update = buildCatalogMultiRowUpsert(1).split("DO UPDATE SET")[1];
    assert.deepEqual(
      update.split(",").map((value) => value.trim()),
      [
        "category_id = excluded.category_id", "name = excluded.name",
        "image_url = excluded.image_url", "payload = excluded.payload",
        "added_at = excluded.added_at", "last_seen_at = excluded.last_seen_at",
      ],
    );
  });

  await scenario("first_seen_at is insert-only", () => {
    assert.doesNotMatch(buildCatalogMultiRowUpsert(1).split("DO UPDATE SET")[1], /first_seen_at/);
  });

  await scenario("is_new is insert-only", () => {
    assert.doesNotMatch(buildCatalogMultiRowUpsert(1).split("DO UPDATE SET")[1], /is_new/);
  });

  await scenario("null image and blank category preserve current bind semantics", () => {
    const item = vod(1, { stream_icon: undefined, category_id: undefined });
    const bind = buildCatalogItemBindValues({
      providerId: "provider-a", kind: "vod", item, seenAt: 1, markNew: false,
    });
    assert.deepEqual(bind, buildCurrentCatalogItemBindValues({
      providerId: "provider-a", kind: "vod", item, seenAt: 1, markNew: false,
    }));
    assert.equal(bind[3], "");
    assert.equal(bind[5], null);
  });

  await scenario("quotes Unicode Turkish letters newline and JSON remain bound data", () => {
    const name = `"İSTANBUL" IĞDIR ığdır\n\\json`;
    const item = vod(2, { name, plot: `${name}${"x".repeat(32_000)}` });
    const bind = buildCatalogItemBindValues({
      providerId: "provider-a", kind: "vod", item, seenAt: 1, markNew: false,
    });
    assert.equal(bind[4], name);
    assert.equal(JSON.parse(String(bind[6])).plot, item.plot);
    assert.doesNotMatch(buildCatalogMultiRowUpsert(1), /İSTANBUL|IĞDIR|Film/);
  });

  await scenario("one prepared 50-row statement executes repeatedly for a full 200-row logical batch", async () => {
    const database = new FakeDatabase();
    const result = await executePreparedCatalogMultiRowBatch(options(database, rows(200)));
    assert.equal(result.actualExecutedRows, 200);
    assert.deepEqual(result.counters, { prepareCount: 1, executeCount: 4, finalizeCount: 1 });
    assert.deepEqual(database.prepareShapes, [50]);
    assert.equal(database.attempts[0].executions.length, 4);
  });

  await scenario("executed 17-row tail has one exact tail statement lifecycle", async () => {
    const database = new FakeDatabase();
    const result = await executePreparedCatalogMultiRowBatch(options(database, rows(67)));
    assert.equal(result.actualExecutedRows, 67);
    assert.deepEqual(result.counters, { prepareCount: 2, executeCount: 2, finalizeCount: 2 });
    assert.deepEqual(database.prepareShapes, [50, 17]);
    assert.deepEqual(database.attempts[0].executions.map((bind) => bind.length), [550, 187]);
  });

  await scenario("199-row logical batch executes 150 rows plus an exact 49-row tail", async () => {
    const database = new FakeDatabase();
    const result = await executePreparedCatalogMultiRowBatch(options(database, rows(199)));
    assert.equal(result.actualExecutedRows, 199);
    assert.deepEqual(result.counters, { prepareCount: 2, executeCount: 4, finalizeCount: 2 });
    assert.deepEqual(database.prepareShapes, [50, 49]);
    assert.equal(database.attempts[0].executions.flat().length, 199 * 11);
  });

  await scenario("prepared statements finalize on success", async () => {
    const database = new FakeDatabase();
    await executePreparedCatalogMultiRowBatch(options(database, rows(67)));
    assert.equal(database.attempts[0].finalized, 2);
  });

  await scenario("prepared statements finalize after execute errors", async () => {
    const database = new FakeDatabase();
    database.executeFailure = { transaction: 1, execute: 1, error: new Error("SQLITE_CONSTRAINT") };
    await assert.rejects(executePreparedCatalogMultiRowBatch(options(database, rows(50))), /SQLITE_CONSTRAINT/);
    assert.equal(database.attempts[0].finalized, 1);
  });

  await scenario("only real too-many-variables errors classify for width fallback", () => {
    assert.equal(classifyM3USqliteError(new Error("too many SQL variables")).sqliteErrorReason, "TOO_MANY_VARIABLES");
    assert.notEqual(classifyM3USqliteError(new Error("SQLITE_BUSY")).sqliteErrorReason, "TOO_MANY_VARIABLES");
  });

  await scenario("adaptive retry widths are exactly 50 25 12 6 3 1", async () => {
    const database = new FakeDatabase();
    database.maxWidth = 0;
    const observed: number[] = [];
    await assert.rejects(executePreparedCatalogMultiRowBatch({
      ...options(database, rows(200)), onAttemptCompleted: (attempt) => observed.push(attempt.width),
    }), /too many SQL variables/);
    assert.deepEqual(observed, [...CATALOG_ADAPTIVE_WIDTHS]);
  });

  await scenario("non-variable SQLite failures do not retry", async () => {
    const database = new FakeDatabase();
    database.prepareFailure = new Error("SQLITE_BUSY: database is locked");
    await assert.rejects(executePreparedCatalogMultiRowBatch(options(database, rows(50))), /SQLITE_BUSY/);
    assert.equal(database.attempts.length, 1);
  });

  await scenario("a rolled-back variable-limit attempt restarts the logical batch at row zero", async () => {
    const database = new FakeDatabase();
    database.executeFailure = { transaction: 1, execute: 2, error: new Error("too many SQL variables") };
    const result = await executePreparedCatalogMultiRowBatch(options(database, rows(200)));
    assert.equal(result.width, 25);
    assert.equal(database.attempts[0].committed, false);
    assert.equal(database.attempts[1].executions[0][2], "0");
    assert.equal(database.attempts[1].executions.flat().length, 200 * 11);
  });

  await scenario("failed attempts publish no false committed progress", async () => {
    const database = new FakeDatabase();
    database.executeFailure = { transaction: 1, execute: 2, error: new Error("too many variables") };
    const attempts: string[] = [];
    const result = await executePreparedCatalogMultiRowBatch({
      ...options(database, rows(200)),
      onAttemptCompleted: (attempt) => attempts.push(`${attempt.width}:${attempt.outcome}`),
    });
    assert.deepEqual(attempts, ["50:rolled-back", "25:committed"]);
    assert.equal(result.actualExecutedRows, 200);
  });

  await scenario("cancellation before first row executes zero rows", async () => {
    const database = new FakeDatabase();
    const result = await executePreparedCatalogSingleRowBatch({
      ...options(database, rows(10)), isCancelled: () => true,
    });
    assert.equal(result.actualExecutedRows, 0);
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.counters, { prepareCount: 1, executeCount: 0, finalizeCount: 1 });
    assert.equal(database.attempts[0].executions.length, 0);
  });

  await scenario("cancellable prepared candidate reports exact executed rows", async () => {
    const database = new FakeDatabase();
    let checks = 0;
    const result = await executePreparedCatalogSingleRowBatch({
      ...options(database, rows(10)), isCancelled: () => checks++ >= 3,
    });
    assert.equal(result.actualExecutedRows, 3);
    assert.equal(result.counters.executeCount, 3);
    assert.equal(result.cancelled, true);
  });

  await scenario("cancellation remains a check-before-each-row boundary", async () => {
    const database = new FakeDatabase();
    let checks = 0;
    const result = await executePreparedCatalogSingleRowBatch({
      ...options(database, rows(10)), isCancelled: () => { checks += 1; return checks === 5; },
    });
    assert.equal(result.actualExecutedRows, 4);
    assert.equal(checks, 5);
    assert.equal(database.attempts[0].executions.length, 4);
  });

  await scenario("cancellation near final row stops before the last row", async () => {
    const database = new FakeDatabase();
    let checks = 0;
    const result = await executePreparedCatalogSingleRowBatch({
      ...options(database, rows(10)), isCancelled: () => { checks += 1; return checks === 10; },
    });
    assert.equal(result.actualExecutedRows, 9);
    assert.equal(result.counters.executeCount, 9);
    assert.equal(result.cancelled, true);
    assert.equal(checks, 10);
    assert.equal(database.attempts[0].executions.length, 9);
  });

  await scenario("duplicate primary keys match independent current sequential UPSERT final state", () => {
    const fixture = [vod(1, { name: "first", plot: "one" }), vod(1, { name: "second", plot: "two" })];
    const currentBind = fixture.map((item, index) => buildCurrentCatalogItemBindValues({
      providerId: "provider-a", kind: "vod", item, seenAt: 100 + index, markNew: index === 0,
    }));
    const candidateBind = fixture.map((item, index) => buildCatalogItemBindValues({
      providerId: "provider-a", kind: "vod", item, seenAt: 100 + index, markNew: index === 0,
    }));
    const sequential = new DatabaseSync(":memory:");
    const candidate = new DatabaseSync(":memory:");
    try {
      createSqliteSchema(sequential);
      createSqliteSchema(candidate);
      const single = sequential.prepare(CURRENT_CATALOG_SINGLE_ROW_UPSERT_SQL);
      for (const values of currentBind) single.run(...values);
      candidate.prepare(buildCatalogMultiRowUpsert(2)).run(...candidateBind.flat());
      const sql = "SELECT category_id, name, image_url, payload, added_at, first_seen_at, last_seen_at, is_new FROM catalog_items";
      assert.deepEqual(candidate.prepare(sql).get(), sequential.prepare(sql).get());
    } finally {
      sequential.close();
      candidate.close();
    }
  });

  await scenario("catalog DB writer serialization contract remains unchanged", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = enqueueCatalogDbWrite(async () => { order.push("first-start"); await gate; order.push("first-end"); });
    const second = enqueueCatalogDbWrite(async () => { order.push("second"); });
    await Promise.resolve();
    assert.deepEqual(order, ["first-start"]);
    release();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first-start", "first-end", "second"]);
  });

  assert.equal(passed, 27);
  console.log("catalog write batch scenarios: 27/27 passed");
}

void main();
