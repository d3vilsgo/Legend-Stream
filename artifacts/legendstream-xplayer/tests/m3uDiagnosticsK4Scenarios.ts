import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  emptyM3URefRejectionCounts,
  emptyM3UValidationScan,
  formatM3UCacheWriteMeasurement,
  type M3UCacheWriteMeasurement,
} from "../lib/m3uCacheWriteMeasurement";
import {
  createM3USqliteBatchProgress,
  classifyM3USqliteError,
  failedM3USqliteBatchIndex,
  M3U_SQLITE_ERROR_CLASSES,
  noteM3USqliteBatchCommitted,
  noteM3USqliteBatchStarted,
  snapshotM3USqliteBatchProgress,
} from "../lib/sqliteWriteDiagnostics";
import {
  createM3UShapeDiagnosticsObserver,
  formatM3UShapeDiagnosticsFields,
} from "../lib/m3uShapeDiagnostics";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogCacheSource = readFileSync(resolve(ROOT, "lib/catalogCache.ts"), "utf8");
const providerHost = "panel-secret.example";
const streamHost = "cdn-secret.example";
const username = "private-user";
const password = "private-password";
const token = "private-token";
const extensionName = "mkv";

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function sqliteFailureMeasurement(
  readOutcome: "success" | "error",
  message: string,
): M3UCacheWriteMeasurement {
  const identity = classifyM3USqliteError(
    Object.assign(new Error(message), { code: "SQLITE_BUSY" }),
  );
  return {
    kind: "m3u-cache-write",
    startedAt: 1,
    m3u: {
      cacheAfter: {
        rawCounts: { live: 400, vod: 0, series: 0 },
        syncPhase: "error",
      },
      write: {
        writeAttempted: true,
        writeOutcome: "sqlite-error",
        writeMs: 15_481,
        writeInputCounts: { live: 2001, vod: 5356, series: 836 },
        writeSafeCounts: { live: 2001, vod: 5356, series: 836 },
        writeWrittenCounts: { live: 0, vod: 0, series: 0 },
        completedBatchCount: { live: 2, vod: 0, series: 0 },
        committedRows: { live: 400, vod: 0, series: 0 },
        failedBatchIndex: 3,
        cacheAfterReadOutcome: readOutcome,
        ...identity,
        sqliteStage: "upsert-live",
        writeRejectCounts: emptyM3URefRejectionCounts(),
        scan: emptyM3UValidationScan(8193),
        cleanupOutcome: "not-required",
        cleanupStage: "none",
      },
    },
  };
}

async function main() {
  await scenario("shape diagnostics remain K4-safe", () => {
    const observer = createM3UShapeDiagnosticsObserver(
      `https://${providerHost}:8443/get.php?username=${username}&password=${password}&type=m3u_plus`,
    );
    observer.observe({
      streamUrl: `https://${streamHost}:9443/series/${username}/${password}/991.${extensionName}?token=${token}`,
      category: "Series",
      extinfDuration: "3600",
      tvgId: "private-tvg-id",
    });

    const output = formatM3UShapeDiagnosticsFields(observer.snapshot()).join("\n");
    assert.match(output, /m3u\.originCompare\.total=1/);
    assert.match(output, /m3u\.streamOrigin\.distinctOriginCount=1/);
    assert.match(output, /m3u\.pathShape\.hasSeriesSegmentCount=1/);
    assert.match(output, /m3u\.extension\.vodLikeCount=1/);
    assert.match(output, /m3u\.extinfDuration\.positiveCount=1/);
    assert.match(output, /m3u\.tvgId\.presentCount=1/);

    for (const secret of [
      "://",
      providerHost,
      streamHost,
      username,
      password,
      token,
      "get.php",
      extensionName,
      "991",
      "private-tvg-id",
    ]) {
      assert.equal(output.toLowerCase().includes(secret.toLowerCase()), false, `telemetry leaked ${secret}`);
    }

    assert.doesNotMatch(output, /(?:^|[.=])(?:hostname|host|ip|url|pathname|username|password|token|extensionName)(?:[.=]|$)/i);
  });

  await scenario("SQLite classifier emits only allowlisted class and primary code", () => {
    const busy = classifyM3USqliteError(
      Object.assign(new Error("database is locked at /data/private.db https://panel.example username=alice password=secret"), {
        code: "SQLITE_BUSY",
      }),
    );
    assert.deepEqual(busy, { sqliteErrorClass: "SQLITE_BUSY", sqlitePrimaryCode: 5 });
    assert.ok(M3U_SQLITE_ERROR_CLASSES.includes(busy.sqliteErrorClass));

    const full = classifyM3USqliteError({ code: 13, message: "database or disk is full" });
    assert.deepEqual(full, { sqliteErrorClass: "SQLITE_FULL", sqlitePrimaryCode: 13 });

    const unknown = classifyM3USqliteError(new Error("private opaque storage failure"));
    assert.deepEqual(unknown, { sqliteErrorClass: "UNKNOWN", sqlitePrimaryCode: -1 });
  });

  await scenario("partial batch commits are distinguishable from zero writes", () => {
    const progress = createM3USqliteBatchProgress();
    noteM3USqliteBatchStarted(progress, "live", 1);
    noteM3USqliteBatchCommitted(progress, "live", 1, 200);
    noteM3USqliteBatchStarted(progress, "live", 2);
    noteM3USqliteBatchCommitted(progress, "live", 2, 400);
    noteM3USqliteBatchStarted(progress, "live", 3);

    const snapshot = snapshotM3USqliteBatchProgress(progress);
    assert.deepEqual(snapshot.completedBatchCount, { live: 2, vod: 0, series: 0 });
    assert.deepEqual(snapshot.committedRows, { live: 400, vod: 0, series: 0 });
    assert.equal(failedM3USqliteBatchIndex(progress, "upsert-live"), 3);
  });

  await scenario("SQLite write telemetry never emits raw error payloads", () => {
    const secretMessage = "SQLITE_BUSY /data/user/0/private.db https://panel-secret.example username=private-user password=private-password";
    const output = formatM3UCacheWriteMeasurement(sqliteFailureMeasurement("success", secretMessage));

    assert.match(output, /m3u\.sqliteErrorClass=SQLITE_BUSY/);
    assert.match(output, /m3u\.sqlitePrimaryCode=5/);
    assert.match(output, /m3u\.sqliteStage=upsert-live/);
    assert.match(output, /m3u\.completedBatchCount\.live=2/);
    assert.match(output, /m3u\.committedRows\.live=400/);
    assert.match(output, /m3u\.failedBatchIndex=3/);
    assert.match(output, /m3u\.cacheAfterReadOutcome=success/);

    for (const secret of [
      "://",
      "/data/user/0/private.db",
      "panel-secret.example",
      "private-user",
      "private-password",
      "username=",
      "password=",
    ]) {
      assert.equal(output.toLowerCase().includes(secret.toLowerCase()), false, `SQLite telemetry leaked ${secret}`);
    }
    assert.doesNotMatch(output, /(?:SELECT|INSERT|UPDATE|DELETE)\s/i);
  });

  await scenario("cacheAfter read failure is explicit instead of masquerading as zero counts", () => {
    const output = formatM3UCacheWriteMeasurement(
      sqliteFailureMeasurement("error", "SQLITE_BUSY database is locked"),
    );
    assert.match(output, /m3u\.cacheAfterReadOutcome=error/);
  });

  await scenario("measurement does not change catalog transaction or batch policy", () => {
    const upsertStart = catalogCacheSource.indexOf("export async function upsertCatalogItems");
    const replaceStart = catalogCacheSource.indexOf("export async function replaceCatalogKind", upsertStart);
    assert.ok(upsertStart >= 0 && replaceStart > upsertStart);
    const upsertSource = catalogCacheSource.slice(upsertStart, replaceStart);
    assert.match(catalogCacheSource, /const WRITE_BATCH_SIZE = 200;/);
    assert.match(upsertSource, /withTransactionAsync\(async \(\) =>/);
    assert.doesNotMatch(upsertSource, /withExclusiveTransactionAsync/);
    assert.match(upsertSource, /onBatchStarted/);
    assert.match(upsertSource, /onBatchCommitted/);
  });

  assert.equal(passed, 6);
  console.log("m3u diagnostics K4 scenarios: 6/6 passed");
}

void main();
