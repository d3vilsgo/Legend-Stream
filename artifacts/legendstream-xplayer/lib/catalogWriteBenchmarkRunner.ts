import { redactSensitiveText } from "./safeLog";

export const CATALOG_BENCHMARK_BUILD_FLAG = "EXPO_PUBLIC_ENABLE_CATALOG_BENCHMARK";
export const CATALOG_BENCHMARK_DB_PREFIX = "legendstream-catalog-benchmark-v1-";
export const PRODUCTION_CATALOG_DB_NAME = "legendstream-catalog-v1.db";
export const CATALOG_BENCHMARK_STRATEGIES = [
  "CURRENT",
  "PREPARED_SINGLE",
  "HYBRID_50",
] as const;
export const CATALOG_BENCHMARK_DEVICE_GATE_DATASETS = [
  { rows: 20_000, profile: "medium" },
  { rows: 50_000, profile: "medium" },
] as const;

export type CatalogBenchmarkStrategy = typeof CATALOG_BENCHMARK_STRATEGIES[number];
export type CatalogBenchmarkProfile = "small" | "medium" | "large";
export type CatalogBenchmarkRows = 200 | 1_000 | 5_000 | 20_000 | 50_000;
export type CatalogBenchmarkClassification =
  | "CORRECTNESS_FAILED"
  | "PERFORMANCE_PASS"
  | "PERFORMANCE_FAIL"
  | "REGRESSION_WARNING";

export type CatalogBenchmarkRunResult = {
  strategy: CatalogBenchmarkStrategy;
  profile: CatalogBenchmarkProfile;
  rows: CatalogBenchmarkRows;
  projectionMs: number;
  jsonSerializeMs: number;
  serializedBytes: number;
  dbSetupMs: number;
  transactionMs: number;
  sqliteWriteMs: number;
  yieldMs: number;
  prepareCount: number;
  executeCount: number;
  finalizeCount: number;
  yieldCount: number;
  categoryWriteMs: number;
  finalSwapMs: number;
  totalMs: number;
  rowsPerSecond: number;
  sqliteRowsPerSecond: number;
  correctness: "passed";
};

export type CatalogBenchmarkNativeProbe = {
  name: string;
  passed: boolean;
  durationMs: number;
  errorCode?: string;
  sanitizedMessage?: string;
};

export type CatalogBenchmarkRunRecord = {
  phase: "warmup" | "measured";
  round: number;
  strategy: CatalogBenchmarkStrategy;
  result?: CatalogBenchmarkRunResult;
  correctness: "passed" | "failed";
  errorCode?: string;
  sanitizedMessage?: string;
};

const TIMING_FIELDS = [
  "sqliteWriteMs",
  "totalMs",
  "yieldMs",
  "finalSwapMs",
  "rowsPerSecond",
  "sqliteRowsPerSecond",
] as const;
type TimingField = typeof TIMING_FIELDS[number];
type TimingSummary = Record<TimingField, number>;

export type CatalogBenchmarkStrategyAggregate = {
  strategy: CatalogBenchmarkStrategy;
  measuredRunCount: number;
  warmupCount: number;
  correctness: "passed";
  median: TimingSummary;
  p95: TimingSummary;
  prepareCount: number[];
  executeCount: number[];
  finalizeCount: number[];
  yieldCount: number[];
  serializedBytes: number[];
};

export type CatalogBenchmarkComparison = {
  candidate: Exclude<CatalogBenchmarkStrategy, "CURRENT">;
  speedupSqlite: number;
  speedupTotal: number;
};

export type CatalogBenchmarkSessionResult = {
  rows: CatalogBenchmarkRows;
  profile: CatalogBenchmarkProfile;
  warmupCount: 1;
  measuredRunCount: number;
  settleDelayMs: number;
  thermal: "NOT_MEASURED";
  warmupOrder: CatalogBenchmarkStrategy[];
  strategyOrder: CatalogBenchmarkStrategy[][];
  warmups: CatalogBenchmarkRunRecord[];
  rawRuns: CatalogBenchmarkRunRecord[];
  nativeCorrectness: CatalogBenchmarkNativeProbe[];
  aggregates: CatalogBenchmarkStrategyAggregate[];
  comparisons: CatalogBenchmarkComparison[];
  regressionWarnings: string[];
  correctness: "passed" | "failed";
  classification: CatalogBenchmarkClassification;
};

export type CatalogBenchmarkDeviceGateReport = {
  schemaVersion: 1;
  createdAt: string;
  deviceGate: {
    passed: boolean;
    performanceResultValid: boolean;
    requiredDatasets: Array<{ rows: CatalogBenchmarkRows; profile: CatalogBenchmarkProfile }>;
  };
  sessions: CatalogBenchmarkSessionResult[];
  nativeCorrectness: CatalogBenchmarkNativeProbe[];
  configuration: {
    warmupsPerStrategy: 1;
    measuredRunsPerStrategy: number;
    settleDelayMs: number;
    strategyRotation: "rotate-by-round-modulo-3";
    p95: "nearest-rank";
    thermal: "NOT_MEASURED";
  };
};

export type CatalogBenchmarkProgress = {
  phase: "native-probes" | "warmup" | "measured" | "settle" | "complete";
  rows?: CatalogBenchmarkRows;
  profile?: CatalogBenchmarkProfile;
  round?: number;
  strategy?: CatalogBenchmarkStrategy;
  completedSteps: number;
  totalSteps: number;
};

export type CatalogBenchmarkDependencies = {
  runBenchmark(options: {
    strategy: CatalogBenchmarkStrategy;
    rows: CatalogBenchmarkRows;
    profile: CatalogBenchmarkProfile;
    databaseName: string;
  }): Promise<CatalogBenchmarkRunResult>;
  runNativeCorrectnessProbes(): Promise<CatalogBenchmarkNativeProbe[]>;
  wait?: (milliseconds: number) => Promise<void>;
  createDatabaseName?: () => string;
  nowIso?: () => string;
};

export class CatalogBenchmarkAlreadyRunningError extends Error {
  readonly code = "BENCHMARK_ALREADY_RUNNING";

  constructor() {
    super("BENCHMARK_ALREADY_RUNNING");
    this.name = "CatalogBenchmarkAlreadyRunningError";
  }
}

let activeSession = false;
let databaseSequence = 0;

export function median(values: number[]) {
  if (values.length === 0) throw new RangeError("Median requires at least one value.");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function percentile95NearestRank(values: number[]) {
  if (values.length === 0) throw new RangeError("P95 requires at least one value.");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(0.95 * sorted.length) - 1];
}

export function measuredStrategyOrder(round: number): CatalogBenchmarkStrategy[] {
  if (!Number.isInteger(round) || round < 0) throw new RangeError("Round must be a non-negative integer.");
  const offset = round % CATALOG_BENCHMARK_STRATEGIES.length;
  return [
    ...CATALOG_BENCHMARK_STRATEGIES.slice(offset),
    ...CATALOG_BENCHMARK_STRATEGIES.slice(0, offset),
  ];
}

export function assertSafeCatalogBenchmarkDatabaseName(databaseName: string) {
  if (
    databaseName === PRODUCTION_CATALOG_DB_NAME ||
    !databaseName.startsWith(CATALOG_BENCHMARK_DB_PREFIX) ||
    !/^legendstream-catalog-benchmark-v1-[a-z0-9-]+\.db$/.test(databaseName)
  ) {
    throw new Error("INVALID_BENCHMARK_DATABASE_NAME");
  }
  return databaseName;
}

export function createCatalogBenchmarkDatabaseName(suffix?: string) {
  databaseSequence += 1;
  const generated = suffix ?? `${Date.now().toString(36)}-${databaseSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  if (!/^[a-z0-9-]+$/.test(generated)) throw new Error("INVALID_BENCHMARK_DATABASE_SUFFIX");
  return assertSafeCatalogBenchmarkDatabaseName(`${CATALOG_BENCHMARK_DB_PREFIX}${generated}.db`);
}

function sanitizedFailure(caught: unknown) {
  return {
    errorCode: caught instanceof CatalogBenchmarkAlreadyRunningError
      ? caught.code
      : "BENCHMARK_RUN_FAILED",
    sanitizedMessage: redactSensitiveText(caught instanceof Error ? caught.message : String(caught)),
  };
}

function summarize(
  records: CatalogBenchmarkRunRecord[],
  strategy: CatalogBenchmarkStrategy,
): CatalogBenchmarkStrategyAggregate | null {
  const results = records
    .filter((record) => record.strategy === strategy && record.correctness === "passed" && record.result)
    .map((record) => record.result as CatalogBenchmarkRunResult);
  if (results.length === 0) return null;
  const summarizeTimings = (summary: (values: number[]) => number) =>
    Object.fromEntries(TIMING_FIELDS.map((field) => [field, summary(results.map((result) => result[field]))])) as TimingSummary;
  return {
    strategy,
    measuredRunCount: results.length,
    warmupCount: 1 as const,
    correctness: "passed" as const,
    median: summarizeTimings(median),
    p95: summarizeTimings(percentile95NearestRank),
    prepareCount: results.map((result) => result.prepareCount),
    executeCount: results.map((result) => result.executeCount),
    finalizeCount: results.map((result) => result.finalizeCount),
    yieldCount: results.map((result) => result.yieldCount),
    serializedBytes: results.map((result) => result.serializedBytes),
  };
}

function comparison(
  current: CatalogBenchmarkStrategyAggregate,
  candidate: CatalogBenchmarkStrategyAggregate,
): CatalogBenchmarkComparison {
  return {
    candidate: candidate.strategy as Exclude<CatalogBenchmarkStrategy, "CURRENT">,
    speedupSqlite: candidate.median.sqliteWriteMs > 0
      ? current.median.sqliteWriteMs / candidate.median.sqliteWriteMs
      : 0,
    speedupTotal: candidate.median.totalMs > 0
      ? current.median.totalMs / candidate.median.totalMs
      : 0,
  };
}

async function runRecord(
  dependencies: CatalogBenchmarkDependencies,
  options: {
    phase: "warmup" | "measured";
    round: number;
    strategy: CatalogBenchmarkStrategy;
    rows: CatalogBenchmarkRows;
    profile: CatalogBenchmarkProfile;
  },
): Promise<CatalogBenchmarkRunRecord> {
  try {
    const result = await dependencies.runBenchmark({
      strategy: options.strategy,
      rows: options.rows,
      profile: options.profile,
      databaseName: (dependencies.createDatabaseName ?? createCatalogBenchmarkDatabaseName)(),
    });
    return { ...options, result, correctness: "passed" };
  } catch (caught) {
    return { ...options, correctness: "failed", ...sanitizedFailure(caught) };
  }
}

async function executeSession(options: {
  rows: CatalogBenchmarkRows;
  profile: CatalogBenchmarkProfile;
  measuredRuns?: number;
  settleDelayMs?: number;
  nativeCorrectness: CatalogBenchmarkNativeProbe[];
  dependencies: CatalogBenchmarkDependencies;
  onProgress?: (progress: CatalogBenchmarkProgress) => void;
}): Promise<CatalogBenchmarkSessionResult> {
  const measuredRuns = options.measuredRuns ?? 5;
  const settleDelayMs = options.settleDelayMs ?? 750;
  if (!Number.isInteger(measuredRuns) || measuredRuns < 5) {
    throw new RangeError("Catalog benchmark requires at least five measured runs.");
  }
  if (!Number.isFinite(settleDelayMs) || settleDelayMs < 0) {
    throw new RangeError("Settle delay must be a non-negative number.");
  }

  const warmupOrder = [...CATALOG_BENCHMARK_STRATEGIES];
  const strategyOrder = Array.from({ length: measuredRuns }, (_, round) => measuredStrategyOrder(round));
  const totalSteps = warmupOrder.length + measuredRuns * CATALOG_BENCHMARK_STRATEGIES.length;
  let completedSteps = 0;
  const warmups: CatalogBenchmarkRunRecord[] = [];
  const rawRuns: CatalogBenchmarkRunRecord[] = [];

  if (options.nativeCorrectness.some((probe) => !probe.passed)) {
    options.onProgress?.({
      phase: "complete", rows: options.rows, profile: options.profile,
      completedSteps, totalSteps,
    });
    return {
      rows: options.rows,
      profile: options.profile,
      warmupCount: 1,
      measuredRunCount: measuredRuns,
      settleDelayMs,
      thermal: "NOT_MEASURED",
      warmupOrder,
      strategyOrder,
      warmups,
      rawRuns,
      nativeCorrectness: options.nativeCorrectness,
      aggregates: [],
      comparisons: [],
      regressionWarnings: [],
      correctness: "failed",
      classification: "CORRECTNESS_FAILED",
    };
  }

  for (const strategy of warmupOrder) {
    options.onProgress?.({
      phase: "warmup", rows: options.rows, profile: options.profile,
      round: 0, strategy, completedSteps, totalSteps,
    });
    const record = await runRecord(options.dependencies, {
      phase: "warmup", round: 0, strategy, rows: options.rows, profile: options.profile,
    });
    warmups.push(record);
    completedSteps += 1;
  }

  for (let round = 0; round < measuredRuns; round += 1) {
    for (const strategy of strategyOrder[round]) {
      options.onProgress?.({
        phase: "measured", rows: options.rows, profile: options.profile,
        round: round + 1, strategy, completedSteps, totalSteps,
      });
      const record = await runRecord(options.dependencies, {
        phase: "measured", round: round + 1, strategy,
        rows: options.rows, profile: options.profile,
      });
      rawRuns.push(record);
      completedSteps += 1;
    }
    if (settleDelayMs > 0 && round < measuredRuns - 1) {
      options.onProgress?.({
        phase: "settle", rows: options.rows, profile: options.profile,
        round: round + 1, completedSteps, totalSteps,
      });
      await (options.dependencies.wait ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))))(settleDelayMs);
    }
  }

  const nativeCorrectnessPassed = options.nativeCorrectness.every((probe) => probe.passed);
  const allRunsPassed = [...warmups, ...rawRuns].every((record) => record.correctness === "passed");
  const aggregateValues = CATALOG_BENCHMARK_STRATEGIES
    .map((strategy) => summarize(rawRuns, strategy))
    .filter((aggregate): aggregate is CatalogBenchmarkStrategyAggregate => aggregate !== null);
  const completeAggregates = aggregateValues.length === CATALOG_BENCHMARK_STRATEGIES.length &&
    aggregateValues.every((aggregate) => aggregate.measuredRunCount === measuredRuns);
  const correctness = nativeCorrectnessPassed && allRunsPassed && completeAggregates ? "passed" : "failed";
  const comparisons: CatalogBenchmarkComparison[] = [];
  const regressionWarnings: string[] = [];

  if (correctness === "passed") {
    const current = aggregateValues.find((aggregate) => aggregate.strategy === "CURRENT")!;
    for (const strategy of ["PREPARED_SINGLE", "HYBRID_50"] as const) {
      const candidate = aggregateValues.find((aggregate) => aggregate.strategy === strategy)!;
      comparisons.push(comparison(current, candidate));
      if (candidate.median.totalMs > current.median.totalMs * 1.1) {
        regressionWarnings.push(`${strategy}_TOTAL_MEDIAN_GT_CURRENT_BY_10_PERCENT`);
      }
    }
  }

  let classification: CatalogBenchmarkClassification;
  if (correctness === "failed") classification = "CORRECTNESS_FAILED";
  else if (regressionWarnings.length > 0) classification = "REGRESSION_WARNING";
  else {
    const hybrid = comparisons.find((item) => item.candidate === "HYBRID_50")!;
    classification = hybrid.speedupSqlite >= 2 && hybrid.speedupTotal >= 2
      ? "PERFORMANCE_PASS"
      : "PERFORMANCE_FAIL";
  }

  options.onProgress?.({
    phase: "complete", rows: options.rows, profile: options.profile,
    completedSteps, totalSteps,
  });
  return {
    rows: options.rows,
    profile: options.profile,
    warmupCount: 1,
    measuredRunCount: measuredRuns,
    settleDelayMs,
    thermal: "NOT_MEASURED",
    warmupOrder,
    strategyOrder,
    warmups,
    rawRuns,
    nativeCorrectness: options.nativeCorrectness,
    aggregates: aggregateValues,
    comparisons,
    regressionWarnings,
    correctness,
    classification,
  };
}

async function withSessionGuard<T>(run: () => Promise<T>) {
  if (activeSession) throw new CatalogBenchmarkAlreadyRunningError();
  activeSession = true;
  try {
    return await run();
  } finally {
    activeSession = false;
  }
}

export async function runCatalogWriteBenchmarkSession(options: {
  rows: CatalogBenchmarkRows;
  profile: CatalogBenchmarkProfile;
  dependencies: CatalogBenchmarkDependencies;
  measuredRuns?: number;
  settleDelayMs?: number;
  onProgress?: (progress: CatalogBenchmarkProgress) => void;
}) {
  return withSessionGuard(async () => {
    options.onProgress?.({ phase: "native-probes", completedSteps: 0, totalSteps: 1 });
    const nativeCorrectness = await options.dependencies.runNativeCorrectnessProbes();
    return executeSession({ ...options, nativeCorrectness });
  });
}

export async function runCatalogWriteDeviceGate(options: {
  dependencies: CatalogBenchmarkDependencies;
  settleDelayMs?: number;
  onProgress?: (progress: CatalogBenchmarkProgress) => void;
}): Promise<CatalogBenchmarkDeviceGateReport> {
  return withSessionGuard(async () => {
    options.onProgress?.({ phase: "native-probes", completedSteps: 0, totalSteps: 1 });
    const nativeCorrectness = await options.dependencies.runNativeCorrectnessProbes();
    const probesPassed = nativeCorrectness.every((probe) => probe.passed);
    const sessions: CatalogBenchmarkSessionResult[] = [];
    if (probesPassed) {
      for (const dataset of CATALOG_BENCHMARK_DEVICE_GATE_DATASETS) {
        sessions.push(await executeSession({
          ...dataset,
          measuredRuns: 5,
          settleDelayMs: options.settleDelayMs,
          nativeCorrectness,
          dependencies: options.dependencies,
          onProgress: options.onProgress,
        }));
      }
    }
    const passed = probesPassed && sessions.length === CATALOG_BENCHMARK_DEVICE_GATE_DATASETS.length &&
      sessions.every((session) => session.classification === "PERFORMANCE_PASS");
    return {
      schemaVersion: 1,
      createdAt: (options.dependencies.nowIso ?? (() => new Date().toISOString()))(),
      deviceGate: {
        passed,
        performanceResultValid: probesPassed && sessions.every((session) => session.correctness === "passed"),
        requiredDatasets: CATALOG_BENCHMARK_DEVICE_GATE_DATASETS.map((dataset) => ({ ...dataset })),
      },
      sessions,
      nativeCorrectness,
      configuration: {
        warmupsPerStrategy: 1,
        measuredRunsPerStrategy: 5,
        settleDelayMs: options.settleDelayMs ?? 750,
        strategyRotation: "rotate-by-round-modulo-3",
        p95: "nearest-rank",
        thermal: "NOT_MEASURED",
      },
    };
  });
}

const SENSITIVE_RESULT_KEY = /password|username|token|credential|provider|playlist|stream|url|uri|secret|authorization/i;
const SENSITIVE_RESULT_TEXT = /(?:https?:\/\/|password\s*[=:]|username\s*[=:]|bearer\s+)/i;

export function serializeCatalogBenchmarkReport(report: unknown) {
  const json = JSON.stringify(report, (key, value) => {
    if (key && SENSITIVE_RESULT_KEY.test(key)) throw new Error("SENSITIVE_BENCHMARK_RESULT_FIELD");
    return value;
  }, 2);
  if (SENSITIVE_RESULT_TEXT.test(json)) throw new Error("SENSITIVE_BENCHMARK_RESULT_TEXT");
  return json;
}
