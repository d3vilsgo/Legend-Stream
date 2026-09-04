import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isCatalogBenchmarkBuildEnabled, resolveCatalogBenchmarkEntry } from "../lib/catalogBenchmarkEntry";
import {
  CatalogBenchmarkCleanupError,
  CatalogBenchmarkLifecycleError,
  catalogBenchmarkArtifactFileUris,
  deleteExistingCatalogBenchmarkArtifacts,
  normalizeBenchmarkDirectoryFileUri,
} from "../lib/catalogBenchmarkCleanup";
import {
  CATALOG_BENCHMARK_DEVICE_GATE_DATASETS,
  CatalogBenchmarkAlreadyRunningError,
  PRODUCTION_CATALOG_DB_NAME,
  assertSafeCatalogBenchmarkDatabaseName,
  catalogBenchmarkArtifactNames,
  createCatalogBenchmarkDatabaseName,
  measuredStrategyOrder,
  median,
  percentile95NearestRank,
  runCatalogWriteBenchmarkSession,
  runCatalogWriteDeviceGate,
  serializeCatalogBenchmarkReport,
  type CatalogBenchmarkDependencies,
  type CatalogBenchmarkNativeProbe,
  type CatalogBenchmarkRunResult,
  type CatalogBenchmarkStrategy,
} from "../lib/catalogWriteBenchmarkRunner";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const passedProbe: CatalogBenchmarkNativeProbe = { name: "native-probe", passed: true, durationMs: 1 };

function result(
  strategy: CatalogBenchmarkStrategy,
  rows: 200 | 1_000 | 5_000 | 20_000 | 50_000,
  profile: "small" | "medium" | "large",
  totalMs: number,
  sqliteWriteMs = totalMs,
): CatalogBenchmarkRunResult {
  return {
    strategy, rows, profile,
    projectionMs: 1, jsonSerializeMs: 1, serializedBytes: rows * 10,
    dbSetupMs: 1, transactionMs: sqliteWriteMs, sqliteWriteMs, yieldMs: 2,
    prepareCount: strategy === "CURRENT" ? rows : 1,
    executeCount: strategy === "HYBRID_50" ? Math.ceil(rows / 50) : rows,
    finalizeCount: strategy === "CURRENT" ? rows : 1,
    yieldCount: Math.ceil(rows / 200), categoryWriteMs: 1, finalSwapMs: 3,
    totalMs, rowsPerSecond: rows * 1000 / totalMs,
    sqliteRowsPerSecond: rows * 1000 / sqliteWriteMs,
    correctness: "passed",
  };
}

type DependencyOptions = {
  current?: number;
  prepared?: number;
  hybrid?: number;
  probes?: CatalogBenchmarkNativeProbe[];
  failRun?: (strategy: CatalogBenchmarkStrategy, invocation: number) => boolean;
  probePromise?: Promise<CatalogBenchmarkNativeProbe[]>;
  mutateResult?: (result: CatalogBenchmarkRunResult, invocation: number) => unknown;
};

function dependencies(options: DependencyOptions = {}) {
  let invocation = 0;
  const names: string[] = [];
  const progressRuns: CatalogBenchmarkStrategy[] = [];
  const dependency: CatalogBenchmarkDependencies = {
    runBenchmark: async ({ strategy, rows, profile, databaseName }) => {
      invocation += 1;
      names.push(databaseName);
      progressRuns.push(strategy);
      if (options.failRun?.(strategy, invocation)) throw new Error("https://secret.example?token=hidden");
      const duration = strategy === "CURRENT"
        ? options.current ?? 100
        : strategy === "PREPARED_SINGLE"
          ? options.prepared ?? 70
          : options.hybrid ?? 40;
      const runResult = result(strategy, rows, profile, duration, duration);
      return (options.mutateResult?.(runResult, invocation) ?? runResult) as CatalogBenchmarkRunResult;
    },
    runNativeCorrectnessProbes: () => options.probePromise ?? Promise.resolve(options.probes ?? [passedProbe]),
    wait: async () => undefined,
    createDatabaseName: () => createCatalogBenchmarkDatabaseName(`test-${names.length + 1}`),
    nowIso: () => "2026-09-03T00:00:00.000Z",
  };
  return { dependency, names, progressRuns };
}

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function sessionWith(options: DependencyOptions = {}) {
  const fixture = dependencies(options);
  const session = await runCatalogWriteBenchmarkSession({
    rows: 200, profile: "medium", dependencies: fixture.dependency,
    measuredRuns: 5, settleDelayMs: 0,
  });
  return { session, fixture };
}

async function invalidSession(mutateResult: NonNullable<DependencyOptions["mutateResult"]>) {
  const { session } = await sessionWith({ mutateResult });
  assert.equal(session.correctness, "failed");
  assert.equal(session.classification, "CORRECTNESS_FAILED");
  assert.equal(session.rawRuns[0]?.errorCode, "INVALID_BENCHMARK_RUN_RESULT");
  assert.equal(session.comparisons.length, 0);
  return session;
}

function cleanupFixture(existingUris: string[], deleteFailureUri?: string) {
  const existing = new Set(existingUris);
  const visited: string[] = [];
  const deleted: string[] = [];
  return {
    existing,
    visited,
    deleted,
    createFile: (fileUri: string) => {
      visited.push(fileUri);
      return {
        get exists() { return existing.has(fileUri); },
        delete() {
          if (fileUri === deleteFailureUri) throw new Error("EACCES");
          deleted.push(fileUri);
          existing.delete(fileUri);
        },
      };
    },
  };
}

async function main() {
  await scenario("median odd uses the sorted middle value", () => {
    assert.equal(median([9, 1, 5, 3, 7]), 5);
  });

  await scenario("median even averages the two middle values", () => {
    assert.equal(median([8, 2, 6, 4]), 5);
  });

  await scenario("P95 uses the nearest-rank contract", () => {
    assert.equal(percentile95NearestRank([1, 2, 3, 4, 5]), 5);
    assert.equal(percentile95NearestRank(Array.from({ length: 20 }, (_, index) => index + 1)), 19);
  });

  await scenario("five measured rounds use exact modulo-three rotation", () => {
    assert.deepEqual(Array.from({ length: 5 }, (_, round) => measuredStrategyOrder(round)), [
      ["CURRENT", "PREPARED_SINGLE", "HYBRID_50"],
      ["PREPARED_SINGLE", "HYBRID_50", "CURRENT"],
      ["HYBRID_50", "CURRENT", "PREPARED_SINGLE"],
      ["CURRENT", "PREPARED_SINGLE", "HYBRID_50"],
      ["PREPARED_SINGLE", "HYBRID_50", "CURRENT"],
    ]);
  });

  await scenario("warm-up is retained but excluded from measured aggregation", async () => {
    let invocation = 0;
    const fixture = dependencies();
    fixture.dependency.runBenchmark = async ({ strategy, rows, profile }) => {
      invocation += 1;
      const duration = invocation <= 3 ? 10_000 : strategy === "CURRENT" ? 100 : strategy === "PREPARED_SINGLE" ? 70 : 40;
      return result(strategy, rows, profile, duration);
    };
    const session = await runCatalogWriteBenchmarkSession({ rows: 200, profile: "medium", dependencies: fixture.dependency, settleDelayMs: 0 });
    assert.equal(session.warmups.length, 3);
    assert.equal(session.rawRuns.length, 15);
    assert.equal(session.aggregates.find((item) => item.strategy === "CURRENT")?.median.totalMs, 100);
  });

  await scenario("raw measured runs retain round and strategy order", async () => {
    const { session } = await sessionWith();
    assert.equal(session.rawRuns.length, 15);
    assert.deepEqual(session.rawRuns.slice(0, 6).map((run) => `${run.round}:${run.strategy}`), [
      "1:CURRENT", "1:PREPARED_SINGLE", "1:HYBRID_50",
      "2:PREPARED_SINGLE", "2:HYBRID_50", "2:CURRENT",
    ]);
  });

  await scenario("SQLite speedup compares candidate median with CURRENT median", async () => {
    const { session } = await sessionWith({ current: 100, hybrid: 40 });
    assert.equal(session.comparisons.find((item) => item.candidate === "HYBRID_50")?.speedupSqlite, 2.5);
  });

  await scenario("total speedup compares candidate median with CURRENT median", async () => {
    const { session } = await sessionWith({ current: 120, hybrid: 40 });
    assert.equal(session.comparisons.find((item) => item.candidate === "HYBRID_50")?.speedupTotal, 3);
  });

  await scenario("HYBRID_50 at or above both 2x thresholds passes", async () => {
    const { session } = await sessionWith({ current: 100, hybrid: 50 });
    assert.equal(session.classification, "PERFORMANCE_PASS");
  });

  await scenario("HYBRID_50 below either 2x threshold fails", async () => {
    const { session } = await sessionWith({ current: 100, hybrid: 60 });
    assert.equal(session.classification, "PERFORMANCE_FAIL");
  });

  await scenario("PREPARED_SINGLE regression remains informational when HYBRID_50 passes", async () => {
    const { session } = await sessionWith({ current: 100, prepared: 111, hybrid: 40 });
    assert.equal(session.classification, "PERFORMANCE_PASS");
    assert.deepEqual(session.regressionWarnings, ["PREPARED_SINGLE_TOTAL_MEDIAN_GT_CURRENT_BY_10_PERCENT"]);
  });

  await scenario("HYBRID_50 total regression is a blocking regression warning", async () => {
    const { session } = await sessionWith({ current: 100, prepared: 70, hybrid: 111 });
    assert.equal(session.classification, "REGRESSION_WARNING");
    assert.deepEqual(session.regressionWarnings, ["HYBRID_50_TOTAL_MEDIAN_GT_CURRENT_BY_10_PERCENT"]);
  });

  await scenario("NaN benchmark timing is rejected before aggregation", async () => {
    await invalidSession((run) => ({ ...run, sqliteWriteMs: Number.NaN }));
  });

  await scenario("infinite benchmark timing is rejected before aggregation", async () => {
    await invalidSession((run) => ({ ...run, totalMs: Number.POSITIVE_INFINITY }));
  });

  await scenario("missing benchmark timing is rejected before aggregation", async () => {
    await invalidSession((run) => {
      const { projectionMs: _missing, ...incomplete } = run;
      return incomplete;
    });
  });

  await scenario("zero SQLite write timing is rejected before aggregation", async () => {
    await invalidSession((run) => ({ ...run, sqliteWriteMs: 0 }));
  });

  await scenario("zero total timing is rejected before aggregation", async () => {
    await invalidSession((run) => ({ ...run, totalMs: 0 }));
  });

  await scenario("negative benchmark values are rejected before aggregation", async () => {
    await invalidSession((run) => ({ ...run, yieldMs: -1 }));
  });

  await scenario("mismatched benchmark row count is rejected", async () => {
    await invalidSession((run) => ({ ...run, rows: 1_000 }));
  });

  await scenario("mismatched benchmark strategy is rejected", async () => {
    await invalidSession((run) => ({ ...run, strategy: run.strategy === "CURRENT" ? "HYBRID_50" : "CURRENT" }));
  });

  await scenario("one invalid measured run cannot enter its aggregate", async () => {
    const { session } = await sessionWith({
      mutateResult: (run, invocation) => invocation === 4 ? { ...run, sqliteWriteMs: Number.NaN } : run,
    });
    assert.equal(session.correctness, "failed");
    assert.equal(session.rawRuns[0]?.errorCode, "INVALID_BENCHMARK_RUN_RESULT");
    assert.equal(session.aggregates.find((aggregate) => aggregate.strategy === "CURRENT")?.measuredRunCount, 4);
    assert.equal(session.comparisons.length, 0);
  });

  await scenario("run correctness failure overrides performance", async () => {
    const { session } = await sessionWith({ failRun: (_strategy, invocation) => invocation === 4 });
    assert.equal(session.correctness, "failed");
    assert.equal(session.classification, "CORRECTNESS_FAILED");
    assert.equal(session.comparisons.length, 0);
  });

  await scenario("mandatory device gate contains exactly 20k and 50k medium", () => {
    assert.deepEqual(CATALOG_BENCHMARK_DEVICE_GATE_DATASETS, [
      { rows: 20_000, profile: "medium" },
      { rows: 50_000, profile: "medium" },
    ]);
  });

  await scenario("single-session guard rejects concurrent invocation", async () => {
    let release!: (value: CatalogBenchmarkNativeProbe[]) => void;
    const probePromise = new Promise<CatalogBenchmarkNativeProbe[]>((resolve) => { release = resolve; });
    const firstFixture = dependencies({ probePromise });
    const first = runCatalogWriteBenchmarkSession({ rows: 200, profile: "small", dependencies: firstFixture.dependency, settleDelayMs: 0 });
    await Promise.resolve();
    const secondFixture = dependencies();
    await assert.rejects(
      runCatalogWriteBenchmarkSession({ rows: 200, profile: "small", dependencies: secondFixture.dependency, settleDelayMs: 0 }),
      (caught) => caught instanceof CatalogBenchmarkAlreadyRunningError && caught.code === "BENCHMARK_ALREADY_RUNNING",
    );
    release([passedProbe]);
    await first;
  });

  await scenario("session guard releases after failure", async () => {
    const failed = dependencies();
    failed.dependency.runNativeCorrectnessProbes = async () => { throw new Error("probe failed"); };
    await assert.rejects(runCatalogWriteBenchmarkSession({ rows: 200, profile: "small", dependencies: failed.dependency, settleDelayMs: 0 }), /probe failed/);
    const next = await sessionWith();
    assert.equal(next.session.correctness, "passed");
    const cleanupFailure = dependencies({ failRun: () => true });
    const failedRun = await runCatalogWriteBenchmarkSession({
      rows: 200, profile: "small", dependencies: cleanupFailure.dependency, settleDelayMs: 0,
    });
    assert.equal(failedRun.classification, "CORRECTNESS_FAILED");
    const afterCleanupFailure = await sessionWith();
    assert.equal(afterCleanupFailure.session.correctness, "passed");
  });

  await scenario("generated benchmark database names are unique and isolated", () => {
    const first = createCatalogBenchmarkDatabaseName();
    const second = createCatalogBenchmarkDatabaseName();
    assert.notEqual(first, second);
    assert.match(first, /^legendstream-catalog-benchmark-v1-[a-z0-9-]+\.db$/);
  });

  await scenario("production catalog database name is rejected", () => {
    assert.throws(() => assertSafeCatalogBenchmarkDatabaseName(PRODUCTION_CATALOG_DB_NAME), /INVALID_BENCHMARK_DATABASE_NAME/);
  });

  await scenario("benchmark sidecar cleanup names stay constrained to one safe database", () => {
    const databaseName = createCatalogBenchmarkDatabaseName("sidecar-test");
    assert.deepEqual(catalogBenchmarkArtifactNames(databaseName), [
      databaseName,
      `${databaseName}-wal`,
      `${databaseName}-shm`,
      `${databaseName}-journal`,
    ]);
    assert.throws(() => catalogBenchmarkArtifactNames(PRODUCTION_CATALOG_DB_NAME), /INVALID_BENCHMARK_DATABASE_NAME/);
  });

  await scenario("raw Android SQLite directory becomes an absolute file URI", () => {
    assert.equal(
      normalizeBenchmarkDirectoryFileUri("/data/data/com.legendstream.xplayer/files/SQLite"),
      "file:///data/data/com.legendstream.xplayer/files/SQLite",
    );
  });

  await scenario("an existing absolute file URI is preserved", () => {
    const directory = "file:///data/data/com.legendstream.xplayer/files/SQLite";
    assert.equal(normalizeBenchmarkDirectoryFileUri(directory), directory);
  });

  await scenario("relative and malformed benchmark directories fail closed", () => {
    for (const directory of ["data/SQLite", "//data/SQLite", "content://SQLite", " file:///data/SQLite", ""]) {
      assert.throws(
        () => normalizeBenchmarkDirectoryFileUri(directory),
        /INVALID_BENCHMARK_DATABASE_DIRECTORY/,
      );
    }
  });

  await scenario("an absent fresh UUID database needs no delete operation", async () => {
    const databaseName = createCatalogBenchmarkDatabaseName("absent-main");
    const fixture = cleanupFixture([]);
    await deleteExistingCatalogBenchmarkArtifacts({
      databaseName,
      directory: "/data/app/SQLite",
      createFile: fixture.createFile,
    });
    assert.deepEqual(fixture.deleted, []);
    assert.equal(fixture.visited[0], `file:///data/app/SQLite/${databaseName}`);
  });

  await scenario("absent WAL SHM and journal sidecars are idempotent success", async () => {
    const databaseName = createCatalogBenchmarkDatabaseName("absent-sidecars");
    const mainUri = `file:///data/app/SQLite/${databaseName}`;
    const fixture = cleanupFixture([mainUri]);
    await deleteExistingCatalogBenchmarkArtifacts({
      databaseName,
      directory: "file:///data/app/SQLite",
      createFile: fixture.createFile,
    });
    assert.deepEqual(fixture.deleted, [mainUri]);
    assert.equal(fixture.visited.length, 4);
  });

  await scenario("existing benchmark artifacts are enumerated and deleted exactly", async () => {
    const databaseName = createCatalogBenchmarkDatabaseName("existing-artifacts");
    const expected = catalogBenchmarkArtifactFileUris(databaseName, "/data/app/SQLite");
    const fixture = cleanupFixture(expected);
    await deleteExistingCatalogBenchmarkArtifacts({
      databaseName,
      directory: "/data/app/SQLite/",
      createFile: fixture.createFile,
    });
    assert.deepEqual(fixture.visited, expected);
    assert.deepEqual(fixture.deleted, expected);
    assert.equal(fixture.existing.size, 0);
  });

  await scenario("a real benchmark artifact delete failure propagates fail closed", async () => {
    const databaseName = createCatalogBenchmarkDatabaseName("delete-failure");
    const uris = catalogBenchmarkArtifactFileUris(databaseName, "/data/app/SQLite");
    const fixture = cleanupFixture(uris, uris[1]);
    await assert.rejects(
      deleteExistingCatalogBenchmarkArtifacts({
        databaseName,
        directory: "/data/app/SQLite",
        createFile: fixture.createFile,
      }),
      (caught) => caught instanceof CatalogBenchmarkCleanupError && caught.failures.length === 1,
    );
    assert.equal(fixture.existing.has(uris[1]), true);
  });

  await scenario("primary and cleanup failures retain both original causes", () => {
    const primary = new Error("primary benchmark failure");
    const cleanup = new CatalogBenchmarkCleanupError([new Error("cleanup failure")]);
    const lifecycle = new CatalogBenchmarkLifecycleError(primary, cleanup);
    assert.equal(lifecycle.primaryError, primary);
    assert.equal(lifecycle.cleanupError, cleanup);
    assert.match(lifecycle.message, /primary benchmark failure[\s\S]*cleanup failure/);
  });

  await scenario("safe result JSON contains no provider or credential fields", async () => {
    const fixture = dependencies();
    const report = await runCatalogWriteDeviceGate({ dependencies: fixture.dependency, settleDelayMs: 0 });
    const json = serializeCatalogBenchmarkReport(report);
    assert.doesNotMatch(json, /password|username|token|provider|https?:\/\//i);
    assert.throws(
      () => serializeCatalogBenchmarkReport({ ...report, password: "secret" }),
      /SENSITIVE_BENCHMARK_RESULT_FIELD/,
    );
  });

  await scenario("native probe failure invalidates and short-circuits device performance gate", async () => {
    const fixture = dependencies({ probes: [{ name: "rollback", passed: false, durationMs: 1, errorCode: "FAILED" }] });
    const report = await runCatalogWriteDeviceGate({ dependencies: fixture.dependency, settleDelayMs: 0 });
    assert.equal(report.deviceGate.passed, false);
    assert.equal(report.deviceGate.performanceResultValid, false);
    assert.equal(report.sessions.length, 0);
    assert.equal(fixture.progressRuns.length, 0);
    const selectedFixture = dependencies({ probes: [{ name: "rollback", passed: false, durationMs: 1, errorCode: "FAILED" }] });
    const selected = await runCatalogWriteBenchmarkSession({
      rows: 200, profile: "small", dependencies: selectedFixture.dependency, settleDelayMs: 0,
    });
    assert.equal(selected.classification, "CORRECTNESS_FAILED");
    assert.equal(selected.rawRuns.length, 0);
    assert.equal(selectedFixture.progressRuns.length, 0);
  });

  await scenario("runner progress order is deterministic", async () => {
    const fixture = dependencies();
    const progress: string[] = [];
    await runCatalogWriteBenchmarkSession({
      rows: 200, profile: "small", dependencies: fixture.dependency, settleDelayMs: 0,
      onProgress: (item) => progress.push(`${item.phase}:${item.round ?? 0}:${item.strategy ?? "none"}`),
    });
    assert.deepEqual(progress.slice(0, 7), [
      "native-probes:0:none",
      "warmup:0:CURRENT", "warmup:0:PREPARED_SINGLE", "warmup:0:HYBRID_50",
      "measured:1:CURRENT", "measured:1:PREPARED_SINGLE", "measured:1:HYBRID_50",
    ]);
    assert.equal(progress.at(-1), "complete:0:none");
  });

  await scenario("benchmark route is unreachable unless the exact build flag is one", () => {
    assert.equal(isCatalogBenchmarkBuildEnabled(undefined), false);
    assert.equal(isCatalogBenchmarkBuildEnabled("0"), false);
    assert.equal(resolveCatalogBenchmarkEntry(undefined), null);
    assert.equal(resolveCatalogBenchmarkEntry("1"), "/catalog-benchmark");
  });

  await scenario("normal Home and Settings flows do not expose benchmark navigation", () => {
    const home = readFileSync(resolve(ROOT, "components/OptimizedHomeScreenPaged.tsx"), "utf8");
    const route = readFileSync(resolve(ROOT, "app/catalog-benchmark.tsx"), "utf8");
    const layout = readFileSync(resolve(ROOT, "app/_layout.tsx"), "utf8");
    const index = readFileSync(resolve(ROOT, "app/(tabs)/index.tsx"), "utf8");
    const workflow = readFileSync(resolve(ROOT, "../../.github/workflows/android-apk.yml"), "utf8");
    assert.doesNotMatch(home, /catalog-benchmark|Catalog SQLite Benchmark/);
    assert.match(route, /if \(!enabled\) return <Redirect href="\/"/);
    assert.match(layout, /appRuntime\.benchmarkRoute \? \(/);
    assert.match(layout, /if \(appRuntime\.kind === "benchmark"\)/);
    assert.match(index, /isCatalogBenchmarkBuildEnabled\(\).*<Redirect href="\/catalog-benchmark"/);
    assert.match(workflow, /catalog_benchmark:[\s\S]*?default: false/);
    assert.match(workflow, /EXPO_PUBLIC_ENABLE_CATALOG_BENCHMARK/);
  });

  assert.equal(passed, 41);
  console.log("catalog write benchmark runner scenarios: 41/41 passed");
}

void main();
