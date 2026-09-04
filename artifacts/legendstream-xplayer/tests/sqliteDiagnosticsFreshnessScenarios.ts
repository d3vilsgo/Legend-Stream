import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  M3U_SQLITE_ERROR_REASONS,
  classifyM3USqliteError,
  createM3USqliteBatchProgress,
  failedM3USqliteBatchIndex,
  fingerprintM3USqliteColumnNames,
  noteM3USqliteBatchStarted,
} from "../lib/sqliteWriteDiagnostics";
import { formatM3UCacheWriteFields } from "../lib/m3uCacheWriteMeasurement";
import {
  beginCatalogMeasurementFreshness,
  completeCatalogMeasurementFreshness,
  formatCatalogMeasurementMetadata,
  getCatalogMeasurementInProgress,
  resolveCatalogMeasurementDisplay,
  type CatalogMeasurementMetadata,
} from "../lib/catalogMeasurementFreshness";
import {
  nextCatalogSyncMetricsSequence,
  readCatalogSyncMetricsSequence,
  type CatalogSyncMetricsStorage,
} from "../lib/catalogSyncMetricsPersistence";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogCacheSource = readFileSync(resolve(ROOT, "lib/catalogCache.ts"), "utf8");
const m3uCatalogCacheSource = readFileSync(resolve(ROOT, "lib/m3uCatalogCache.ts"), "utf8");
const catalogMetricsSource = readFileSync(resolve(ROOT, "lib/catalogSyncMetrics.ts"), "utf8");
const diagnosticsPanelSource = readFileSync(resolve(ROOT, "components/CredentialDiagnosticsPanel.tsx"), "utf8");

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function error(message: string, code = 1) {
  return { code, message };
}

function memoryStorage(): CatalogSyncMetricsStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
  };
}

const completed: CatalogMeasurementMetadata & { label: string } = {
  label: "old-completed-measurement",
  startedAt: 100,
  recordedAt: 150,
  sequence: 7,
  state: "completed",
};

async function main() {
  await scenario("SQLite error reason allowlist is exact and fixed", () => {
    assert.deepEqual(M3U_SQLITE_ERROR_REASONS, [
      "TOO_MANY_VARIABLES",
      "NO_SUCH_COLUMN",
      "NO_SUCH_TABLE",
      "COLUMN_VALUE_COUNT_MISMATCH",
      "ON_CONFLICT_MISMATCH",
      "TRANSACTION_ALREADY_ACTIVE",
      "NO_ACTIVE_TRANSACTION",
      "SQL_SYNTAX",
      "UNKNOWN_SQLITE_ERROR",
    ]);
  });

  await scenario("too many variables maps to fixed reason", () => {
    assert.equal(classifyM3USqliteError(error("too many SQL variables")).sqliteErrorReason, "TOO_MANY_VARIABLES");
  });

  await scenario("no such column maps to fixed reason", () => {
    assert.equal(classifyM3USqliteError(error("no such column: secret_column")).sqliteErrorReason, "NO_SUCH_COLUMN");
  });

  await scenario("no such table maps to fixed reason", () => {
    assert.equal(classifyM3USqliteError(error("no such table: private_table")).sqliteErrorReason, "NO_SUCH_TABLE");
  });

  await scenario("column/value mismatch maps to fixed reason", () => {
    assert.equal(
      classifyM3USqliteError(error("table hidden has 11 columns but 10 values were supplied")).sqliteErrorReason,
      "COLUMN_VALUE_COUNT_MISMATCH",
    );
  });

  await scenario("ON CONFLICT mismatch maps to fixed reason", () => {
    assert.equal(
      classifyM3USqliteError(error("ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint")).sqliteErrorReason,
      "ON_CONFLICT_MISMATCH",
    );
  });

  await scenario("nested transaction maps to fixed reason", () => {
    assert.equal(
      classifyM3USqliteError(error("cannot start a transaction within a transaction")).sqliteErrorReason,
      "TRANSACTION_ALREADY_ACTIVE",
    );
  });

  await scenario("missing active transaction maps to fixed reason", () => {
    assert.equal(
      classifyM3USqliteError(error("cannot commit - no transaction is active")).sqliteErrorReason,
      "NO_ACTIVE_TRANSACTION",
    );
  });

  await scenario("syntax error maps to fixed reason", () => {
    assert.equal(classifyM3USqliteError(error('near "hidden": syntax error')).sqliteErrorReason, "SQL_SYNTAX");
  });

  await scenario("unrecognized generic SQLite error stays fixed UNKNOWN", () => {
    assert.equal(classifyM3USqliteError(error("opaque sqlite failure")).sqliteErrorReason, "UNKNOWN_SQLITE_ERROR");
  });

  await scenario("numeric SQLITE_ERROR does not hide the more specific message reason", () => {
    const result = classifyM3USqliteError(error("too many SQL variables", 1));
    assert.equal(result.sqliteErrorClass, "SQLITE_ERROR");
    assert.equal(result.sqlitePrimaryCode, 1);
    assert.equal(result.sqliteErrorReason, "TOO_MANY_VARIABLES");
  });

  await scenario("classifier output never leaks raw error details", () => {
    const result = JSON.stringify(classifyM3USqliteError(error(
      "no such column: password_secret /data/user/0/app.db https://panel.example?username=alice&password=secret",
    )));
    assert.doesNotMatch(result, /password_secret|\/data\/user|panel\.example|alice|secret/i);
    assert.match(result, /NO_SUCH_COLUMN/);
  });

  await scenario("failed batch index is retained for begin-transaction", () => {
    const progress = createM3USqliteBatchProgress();
    noteM3USqliteBatchStarted(progress, "live", 1);
    assert.equal(failedM3USqliteBatchIndex(progress, "begin-transaction"), 1);
  });

  await scenario("failed batch index is retained for insert-statement", () => {
    const progress = createM3USqliteBatchProgress();
    noteM3USqliteBatchStarted(progress, "live", 2);
    assert.equal(failedM3USqliteBatchIndex(progress, "insert-statement"), 2);
  });

  await scenario("failed batch index is retained for commit", () => {
    const progress = createM3USqliteBatchProgress();
    noteM3USqliteBatchStarted(progress, "vod", 3);
    assert.equal(failedM3USqliteBatchIndex(progress, "commit"), 3);
  });

  await scenario("writer is coordinated before exclusive batch transactions while exposing real stages", () => {
    const start = catalogCacheSource.indexOf("export async function upsertCatalogItems");
    const end = catalogCacheSource.indexOf("export async function replaceCatalogKind", start);
    const source = catalogCacheSource.slice(start, end);
    assert.match(source, /enqueueCatalogDbWrite/);
    assert.match(source, /onSqliteStage\?\.\("begin-transaction"\)/);
    assert.match(source, /withExclusiveTransactionAsync\(async \(txn\) =>/);
    assert.match(source, /onSqliteStage\?\.\("insert-statement"\)/);
    assert.match(source, /onSqliteStage\?\.\("commit"\)/);
    assert.doesNotMatch(source, /withTransactionAsync/);
    assert.match(source, /WRITE_BATCH_SIZE/);
  });

  await scenario("M3U writer uses explicit bulk staging writes before existing staging swap", () => {
    assert.doesNotMatch(m3uCatalogCacheSource, /sqliteStage\s*=\s*"upsert-live"/);
    assert.match(m3uCatalogCacheSource, /const stagingProviderId = `__staging__\$\{provider\.id\}`;/);
    assert.match(
      m3uCatalogCacheSource,
      /await upsertCatalogItemsBulkNonCancellable\(stagingProviderId,\s*"live"/,
    );
    assert.doesNotMatch(m3uCatalogCacheSource, /await upsertCatalogItems\(stagingProviderId,\s*"live"/);
    assert.match(m3uCatalogCacheSource, /const committedCounts = await swapStagingToProvider\(\{/);
    assert.doesNotMatch(m3uCatalogCacheSource, /replaceProviderCatalogAtomically/);
    assert.match(m3uCatalogCacheSource, /onSqliteStage:\s*\(stage\)\s*=>/);
  });

  await scenario("schema fingerprint is deterministic", () => {
    const a = fingerprintM3USqliteColumnNames(["provider_id", "kind", "payload"]);
    const b = fingerprintM3USqliteColumnNames(["payload", "provider_id", "kind"]);
    assert.deepEqual(a, b);
    assert.equal(a.sqliteSchemaColumnCount, 3);
    assert.match(a.sqliteSchemaColumnNameHash, /^fnv1a32:[0-9a-f]{8}$/);
  });

  await scenario("schema fingerprint does not expose column names", () => {
    const fingerprint = JSON.stringify(fingerprintM3USqliteColumnNames([
      "provider_id",
      "password_secret",
      "credential_token",
    ]));
    assert.doesNotMatch(fingerprint, /provider_id|password_secret|credential_token/);
  });

  await scenario("formatted SQLite telemetry contains fixed reason and fingerprint only", () => {
    const output = formatM3UCacheWriteFields({
      writeAttempted: true,
      writeOutcome: "sqlite-error",
      writeMs: 20,
      writeInputCounts: { live: 1, vod: 0, series: 0 },
      writeSafeCounts: { live: 1, vod: 0, series: 0 },
      writeWrittenCounts: { live: 0, vod: 0, series: 0 },
      completedBatchCount: { live: 0, vod: 0, series: 0 },
      committedRows: { live: 0, vod: 0, series: 0 },
      failedBatchIndex: 1,
      cacheAfterReadOutcome: "success",
      sqliteErrorClass: "SQLITE_ERROR",
      sqlitePrimaryCode: 1,
      sqliteErrorReason: "NO_SUCH_COLUMN",
      sqliteStage: "insert-statement",
      sqliteSchemaColumnCount: 11,
      sqliteSchemaColumnNameHash: "fnv1a32:1234abcd",
      writeRejectCounts: {
        "origin-mismatch": 0,
        "path-shape": 0,
        "query-present": 0,
        "kind-mismatch": 0,
        "missing-extension": 0,
        "credential-path-mismatch": 0,
      },
      scan: {
        scanTotalCandidateCount: 1,
        scanInspectedCount: 1,
        scanTruncated: false,
        firstRejectKind: "none",
        firstRejectReason: "none",
      },
      cleanupOutcome: "not-required",
      cleanupStage: "none",
    }).join("\n");
    assert.match(output, /m3u\.sqliteErrorReason=NO_SUCH_COLUMN/);
    assert.match(output, /m3u\.sqliteStage=insert-statement/);
    assert.match(output, /m3u\.sqliteSchemaColumnCount=11/);
    assert.match(output, /m3u\.sqliteSchemaColumnNameHash=fnv1a32:1234abcd/);
    assert.doesNotMatch(output, /provider_id|catalog_items|password|https?:\/\//i);
  });

  await scenario("measurement metadata formatter emits all four freshness fields", () => {
    const output = formatCatalogMeasurementMetadata({
      startedAt: 100,
      recordedAt: 150,
      sequence: 7,
      state: "completed",
    });
    assert.equal(output, [
      "measurement.startedAt=100",
      "measurement.recordedAt=150",
      "measurement.sequence=7",
      "measurement.state=completed",
    ].join("\n"));
  });

  await scenario("active run suppresses stale completed measurement", () => {
    beginCatalogMeasurementFreshness(200);
    const active = getCatalogMeasurementInProgress();
    const display = resolveCatalogMeasurementDisplay(active, completed, 8);
    assert.equal(display.state, "in-progress");
    assert.equal(display.measurement, null);
    assert.equal(display.metadata.sequence, 8);
    assert.equal(display.metadata.startedAt, 200);
    completeCatalogMeasurementFreshness(200);
  });

  await scenario("completed measurement remains visible when no run is active", () => {
    const display = resolveCatalogMeasurementDisplay(null, completed, 8);
    assert.equal(display.state, "completed");
    assert.equal(display.measurement?.label, "old-completed-measurement");
    assert.equal(display.metadata.sequence, 7);
  });

  await scenario("persistent sequence increases monotonically", async () => {
    const storage = memoryStorage();
    assert.equal(await nextCatalogSyncMetricsSequence(storage), 1);
    assert.equal(await nextCatalogSyncMetricsSequence(storage), 2);
    assert.equal(await nextCatalogSyncMetricsSequence(storage), 3);
    assert.equal(await readCatalogSyncMetricsSequence(storage), 3);
  });

  await scenario("concurrent sequence requests are serialized and unique", async () => {
    const storage = memoryStorage();
    const values = await Promise.all([
      nextCatalogSyncMetricsSequence(storage),
      nextCatalogSyncMetricsSequence(storage),
      nextCatalogSyncMetricsSequence(storage),
    ]);
    assert.deepEqual(values, [1, 2, 3]);
    assert.equal(await readCatalogSyncMetricsSequence(storage), 3);
  });

  await scenario("restored sequence floor cannot move backwards", async () => {
    const storage = memoryStorage();
    assert.equal(await nextCatalogSyncMetricsSequence(storage, 41), 42);
    assert.equal(await nextCatalogSyncMetricsSequence(storage, 7), 43);
  });

  await scenario("refresh implementation is storage-first unless a run is active", () => {
    const displayStart = catalogMetricsSource.indexOf("export async function readCatalogSyncMeasurementDisplay");
    const displaySource = catalogMetricsSource.slice(displayStart);
    const activeCheck = displaySource.indexOf("getCatalogMeasurementInProgress()");
    const persistedRead = displaySource.indexOf("readPersistedCatalogSyncMeasurement()");
    assert.ok(activeCheck >= 0);
    assert.ok(persistedRead > activeCheck);
    const persistedStart = catalogMetricsSource.indexOf("export async function readPersistedCatalogSyncMeasurement");
    const persistedEnd = catalogMetricsSource.indexOf("export async function readCatalogSyncMeasurementDisplay", persistedStart);
    const persistedSource = catalogMetricsSource.slice(persistedStart, persistedEnd);
    assert.match(persistedSource, /readCatalogSyncMetricsPayload\(AsyncStorage\)/);
    assert.doesNotMatch(persistedSource, /if \(latestMeasurement\) return latestMeasurement/);
  });

  await scenario("diagnostics panel renders in-progress state without stale copy action", () => {
    assert.match(diagnosticsPanelSource, /catalogDisplay\?\.state === "in-progress"/);
    assert.match(diagnosticsPanelSource, /Son tamamlanan turun ölçümü bu tur tamamlanana kadar gösterilmez/);
    const inProgressStart = diagnosticsPanelSource.indexOf('catalogDisplay?.state === "in-progress"');
    const completedStart = diagnosticsPanelSource.indexOf("completedCatalogMeasurement ?", inProgressStart);
    const inProgressSource = diagnosticsPanelSource.slice(inProgressStart, completedStart);
    assert.doesNotMatch(inProgressSource, /Katalog Ölçümünü Kopyala/);
  });

  assert.equal(passed, 28);
  console.log("sqlite diagnostics freshness scenarios: 28/28 passed");
}

void main();
