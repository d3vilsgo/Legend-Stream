import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CatalogFetchMetrics } from "./catalogSyncStrategy";
import type { CatalogSyncMode } from "./catalogAvailability";
import {
  completeCatalogMeasurementFreshness,
  formatCatalogMeasurementMetadata,
  getCatalogMeasurementInProgress,
  resolveCatalogMeasurementDisplay,
  type CatalogMeasurementDisplay,
  type CatalogMeasurementMetadata,
} from "./catalogMeasurementFreshness";
import {
  formatM3USwitchMeasurement,
  type M3UCacheHydrationOutcome,
  type M3UNetworkFallbackReason,
  type M3USwitchMeasurement,
} from "./m3uSwitchMeasurement";
import {
  formatM3UCacheWriteMeasurement,
  M3U_CACHE_SYNC_PHASES,
  M3U_CLEANUP_OUTCOMES,
  M3U_CLEANUP_STAGES,
  M3U_FIRST_REJECT_KINDS,
  M3U_REF_REJECTION_REASONS,
  M3U_WRITE_OUTCOMES,
  emptyM3URefRejectionCounts,
  type M3UCacheCounts,
  type M3UCacheSnapshot,
  type M3UCacheSyncPhase,
  type M3UCacheValidationScan,
  type M3UCacheWriteMeasurement,
  type M3UCacheWriteTelemetry,
  type M3UCleanupOutcome,
  type M3UCleanupStage,
  type M3URefRejectionCounts,
  type M3URefRejectionReason,
} from "./m3uCacheWriteMeasurement";
import type { M3UShapeDiagnostics } from "./m3uShapeDiagnostics";
import {
  nextCatalogSyncMetricsSequence,
  readCatalogSyncMetricsPayload,
  readCatalogSyncMetricsSequence,
  writeCatalogSyncMetricsPayload,
} from "./catalogSyncMetricsPersistence";
import {
  M3U_SQLITE_ERROR_CLASSES,
  M3U_SQLITE_ERROR_REASONS,
  M3U_SQLITE_STAGES,
  type M3USqliteErrorClass,
  type M3USqliteErrorReason,
  type M3USqliteStage,
} from "./sqliteWriteDiagnostics";

export type XtreamCatalogSyncMeasurement = {
  providerId: string;
  mode: CatalogSyncMode;
  startedAt: number;
  totalMs: number;
  liveSqliteWriteMs: number;
  vod: CatalogFetchMetrics;
  series: CatalogFetchMetrics;
};

type CatalogSyncMeasurementPayload =
  | XtreamCatalogSyncMeasurement
  | M3USwitchMeasurement
  | M3UCacheWriteMeasurement;

export type CatalogSyncMeasurement = CatalogSyncMeasurementPayload & Partial<CatalogMeasurementMetadata>;
export type CompletedCatalogSyncMeasurement = CatalogSyncMeasurementPayload &
  CatalogMeasurementMetadata & { state: "completed" };
export type CatalogSyncMeasurementDisplay = CatalogMeasurementDisplay<CompletedCatalogSyncMeasurement>;

let latestMeasurement: CompletedCatalogSyncMeasurement | null = null;

const formatFetchMetrics = (label: "vod" | "series", metrics: CatalogFetchMetrics) => [
  `${label}.path=${metrics.path}`,
  `${label}.bulkParseMs=${metrics.bulkParseMs}`,
  `${label}.sqliteWriteMs=${metrics.sqliteWriteMs}`,
  `${label}.totalMs=${metrics.totalMs}`,
  `${label}.itemCount=${metrics.itemCount}`,
  `${label}.parallelMaxObserved=${metrics.parallelMaxObserved}`,
  `${label}.fallbackReason=${metrics.fallbackReason ?? "none"}`,
];

function isM3USwitchMeasurement(
  measurement: CatalogSyncMeasurement,
): measurement is M3USwitchMeasurement & Partial<CatalogMeasurementMetadata> {
  return "kind" in measurement && measurement.kind === "m3u-switch";
}

function isM3UCacheWriteMeasurement(
  measurement: CatalogSyncMeasurement,
): measurement is M3UCacheWriteMeasurement & Partial<CatalogMeasurementMetadata> {
  return "kind" in measurement && measurement.kind === "m3u-cache-write";
}

function metadataForFormat(measurement: CatalogSyncMeasurement): CatalogMeasurementMetadata {
  return {
    startedAt: measurement.startedAt,
    recordedAt: typeof measurement.recordedAt === "number" ? measurement.recordedAt : measurement.startedAt,
    sequence: typeof measurement.sequence === "number" ? Math.max(0, Math.trunc(measurement.sequence)) : 0,
    state: measurement.state === "in-progress" ? "in-progress" : "completed",
  };
}

export function formatCatalogSyncMeasurement(measurement: CatalogSyncMeasurement) {
  const header = formatCatalogMeasurementMetadata(metadataForFormat(measurement));
  const body = isM3USwitchMeasurement(measurement)
    ? formatM3USwitchMeasurement(measurement)
    : isM3UCacheWriteMeasurement(measurement)
      ? formatM3UCacheWriteMeasurement(measurement)
      : [
          `mode=${measurement.mode}`,
          `totalMs=${measurement.totalMs}`,
          `liveSqliteWriteMs=${measurement.liveSqliteWriteMs}`,
          ...formatFetchMetrics("vod", measurement.vod),
          ...formatFetchMetrics("series", measurement.series),
        ].join("\n");
  return `${header}\n${body}`;
}

export function formatCatalogSyncMeasurementMetadata(metadata: CatalogMeasurementMetadata) {
  return formatCatalogMeasurementMetadata(metadata);
}

const finiteNonNegative = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const countValue = (value: unknown) => {
  const numeric = finiteNonNegative(value);
  return numeric === null ? null : Math.trunc(numeric);
};
const integerAtLeastMinusOne = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= -1 ? value : null;
const objectValue = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const M3U_OUTCOMES = new Set<M3UCacheHydrationOutcome>(["hit", "null", "error"]);
const M3U_FALLBACK_REASONS = new Set<M3UNetworkFallbackReason>([
  "none",
  "cache-unsupported-source",
  "cache-empty",
  "cache-sqlite-error",
  "cache-runtime-error",
  "cache-unavailable",
  "network-error",
]);
const FETCH_FALLBACK_REASONS = new Set<NonNullable<CatalogFetchMetrics["fallbackReason"]>>([
  "empty",
  "too-few-items",
  "missing-category-ids",
  "bulk-error",
  "parallel-error",
]);

function normalizeM3UCounts(value: unknown): M3UCacheCounts | null {
  const raw = objectValue(value);
  if (!raw) return null;
  const live = countValue(raw.live);
  const vod = countValue(raw.vod);
  const series = countValue(raw.series);
  return live === null || vod === null || series === null
    ? null
    : { live, vod, series };
}

function normalizeM3USyncPhase(value: unknown): M3UCacheSyncPhase | null {
  return typeof value === "string" && M3U_CACHE_SYNC_PHASES.has(value as M3UCacheSyncPhase)
    ? value as M3UCacheSyncPhase
    : null;
}

function normalizeM3UCacheSnapshot(value: unknown): M3UCacheSnapshot | null {
  const raw = objectValue(value);
  if (!raw) return null;
  const rawCounts = normalizeM3UCounts(raw.rawCounts);
  const syncPhase = normalizeM3USyncPhase(raw.syncPhase);
  return rawCounts && syncPhase ? { rawCounts, syncPhase } : null;
}

function normalizeM3URejectCounts(value: unknown): M3URefRejectionCounts | null {
  const raw = objectValue(value);
  if (!raw) return null;
  const result = emptyM3URefRejectionCounts();
  for (const reason of M3U_REF_REJECTION_REASONS) {
    const count = countValue(raw[reason]);
    if (count === null) return null;
    result[reason] = count;
  }
  return result;
}

function normalizeM3UValidationScan(value: unknown): M3UCacheValidationScan | null {
  const raw = objectValue(value);
  if (!raw) return null;
  const scanTotalCandidateCount = countValue(raw.scanTotalCandidateCount);
  const scanInspectedCount = countValue(raw.scanInspectedCount);
  const firstRejectKind = raw.firstRejectKind;
  const firstRejectReason = raw.firstRejectReason;
  if (
    scanTotalCandidateCount === null ||
    scanInspectedCount === null ||
    typeof raw.scanTruncated !== "boolean" ||
    typeof firstRejectKind !== "string" ||
    !M3U_FIRST_REJECT_KINDS.has(firstRejectKind as M3UCacheValidationScan["firstRejectKind"]) ||
    typeof firstRejectReason !== "string" ||
    (firstRejectReason !== "none" && !M3U_REF_REJECTION_REASONS.includes(firstRejectReason as M3URefRejectionReason))
  ) return null;
  return {
    scanTotalCandidateCount,
    scanInspectedCount,
    scanTruncated: raw.scanTruncated,
    firstRejectKind: firstRejectKind as M3UCacheValidationScan["firstRejectKind"],
    firstRejectReason: firstRejectReason as M3UCacheValidationScan["firstRejectReason"],
  };
}

function legacyM3UValidationScan(): M3UCacheValidationScan {
  return {
    scanTotalCandidateCount: 0,
    scanInspectedCount: 0,
    scanTruncated: false,
    firstRejectKind: "none",
    firstRejectReason: "none",
  };
}

function normalizeM3UWriteTelemetry(value: unknown): M3UCacheWriteTelemetry | null {
  const raw = objectValue(value);
  if (!raw || raw.writeAttempted !== true) return null;
  const outcome = raw.writeOutcome;
  const writeMs = finiteNonNegative(raw.writeMs);
  const writeInputCounts = normalizeM3UCounts(raw.writeInputCounts);
  const writeSafeCounts = normalizeM3UCounts(raw.writeSafeCounts);
  const writeWrittenCounts = normalizeM3UCounts(raw.writeWrittenCounts);
  const writeRejectCounts = normalizeM3URejectCounts(raw.writeRejectCounts);
  const scan = raw.scan === undefined ? legacyM3UValidationScan() : normalizeM3UValidationScan(raw.scan);
  const cleanupOutcome = raw.cleanupOutcome === undefined ? "not-required" : raw.cleanupOutcome;
  const cleanupStage = raw.cleanupStage === undefined ? "none" : raw.cleanupStage;
  const completedBatchCount = raw.completedBatchCount === undefined
    ? undefined
    : normalizeM3UCounts(raw.completedBatchCount);
  const committedRows = raw.committedRows === undefined
    ? undefined
    : normalizeM3UCounts(raw.committedRows);
  const failedBatchIndex = raw.failedBatchIndex === undefined ? undefined : countValue(raw.failedBatchIndex);
  if (failedBatchIndex === null) return null;
  const cacheAfterReadOutcome = raw.cacheAfterReadOutcome === undefined
    ? undefined
    : raw.cacheAfterReadOutcome;

  const hasSqliteIdentity =
    raw.sqliteErrorClass !== undefined ||
    raw.sqlitePrimaryCode !== undefined ||
    raw.sqliteErrorReason !== undefined ||
    raw.sqliteStage !== undefined;
  let sqliteErrorClass: M3USqliteErrorClass | undefined;
  let sqlitePrimaryCode: number | undefined;
  let sqliteErrorReason: M3USqliteErrorReason | undefined;
  let sqliteStage: M3USqliteStage | undefined;
  if (hasSqliteIdentity) {
    if (
      typeof raw.sqliteErrorClass !== "string" ||
      !M3U_SQLITE_ERROR_CLASSES.includes(raw.sqliteErrorClass as M3USqliteErrorClass) ||
      typeof raw.sqliteStage !== "string" ||
      !M3U_SQLITE_STAGES.includes(raw.sqliteStage as M3USqliteStage)
    ) return null;
    const code = integerAtLeastMinusOne(raw.sqlitePrimaryCode);
    if (code === null) return null;
    if (
      raw.sqliteErrorReason !== undefined &&
      (typeof raw.sqliteErrorReason !== "string" ||
        !M3U_SQLITE_ERROR_REASONS.includes(raw.sqliteErrorReason as M3USqliteErrorReason))
    ) return null;
    sqliteErrorClass = raw.sqliteErrorClass as M3USqliteErrorClass;
    sqlitePrimaryCode = code;
    sqliteErrorReason = raw.sqliteErrorReason === undefined
      ? "UNKNOWN_SQLITE_ERROR"
      : raw.sqliteErrorReason as M3USqliteErrorReason;
    sqliteStage = raw.sqliteStage as M3USqliteStage;
  }

  const sqliteSchemaColumnCount = raw.sqliteSchemaColumnCount === undefined
    ? undefined
    : countValue(raw.sqliteSchemaColumnCount);
  const sqliteSchemaColumnNameHash = raw.sqliteSchemaColumnNameHash === undefined
    ? undefined
    : raw.sqliteSchemaColumnNameHash;
  if (
    raw.sqliteSchemaColumnNameHash !== undefined &&
    (typeof sqliteSchemaColumnNameHash !== "string" || !/^fnv1a32:[0-9a-f]{8}$/.test(sqliteSchemaColumnNameHash))
  ) return null;

  if (
    typeof outcome !== "string" ||
    !M3U_WRITE_OUTCOMES.has(outcome as M3UCacheWriteTelemetry["writeOutcome"]) ||
    writeMs === null ||
    !writeInputCounts || !writeSafeCounts || !writeWrittenCounts || !writeRejectCounts || !scan ||
    (raw.completedBatchCount !== undefined && !completedBatchCount) ||
    (raw.committedRows !== undefined && !committedRows) ||
    (cacheAfterReadOutcome !== undefined && cacheAfterReadOutcome !== "success" && cacheAfterReadOutcome !== "error") ||
    (raw.sqliteSchemaColumnCount !== undefined && sqliteSchemaColumnCount === null) ||
    typeof cleanupOutcome !== "string" ||
    !M3U_CLEANUP_OUTCOMES.has(cleanupOutcome as M3UCleanupOutcome) ||
    typeof cleanupStage !== "string" ||
    !M3U_CLEANUP_STAGES.has(cleanupStage as M3UCleanupStage)
  ) {
    return null;
  }
  return {
    writeAttempted: true,
    writeOutcome: outcome as M3UCacheWriteTelemetry["writeOutcome"],
    writeMs,
    writeInputCounts,
    writeSafeCounts,
    writeWrittenCounts,
    ...(completedBatchCount ? { completedBatchCount } : {}),
    ...(committedRows ? { committedRows } : {}),
    ...(failedBatchIndex !== undefined ? { failedBatchIndex } : {}),
    ...(cacheAfterReadOutcome !== undefined ? { cacheAfterReadOutcome } : {}),
    ...(sqliteErrorClass !== undefined &&
    sqlitePrimaryCode !== undefined &&
    sqliteErrorReason !== undefined &&
    sqliteStage !== undefined
      ? { sqliteErrorClass, sqlitePrimaryCode, sqliteErrorReason, sqliteStage }
      : {}),
    ...(sqliteSchemaColumnCount !== undefined ? { sqliteSchemaColumnCount } : {}),
    ...(typeof sqliteSchemaColumnNameHash === "string" ? { sqliteSchemaColumnNameHash } : {}),
    writeRejectCounts,
    scan,
    cleanupOutcome: cleanupOutcome as M3UCleanupOutcome,
    cleanupStage: cleanupStage as M3UCleanupStage,
  };
}

function normalizedCountObject(value: unknown, keys: readonly string[]) {
  const raw = objectValue(value);
  if (!raw) return null;
  const result: Record<string, number> = {};
  for (const key of keys) {
    const count = countValue(raw[key]);
    if (count === null) return null;
    result[key] = count;
  }
  return result;
}

function normalizeSegmentHistogram(value: unknown) {
  const raw = objectValue(value);
  if (!raw) return null;
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^\d+$/.test(key)) return null;
    const count = countValue(value);
    if (count === null) return null;
    result[key] = count;
  }
  return result;
}

function normalizeM3UShapeDiagnostics(value: unknown): M3UShapeDiagnostics | null {
  const raw = objectValue(value);
  if (!raw) return null;
  const originCompare = normalizedCountObject(raw.originCompare, [
    "total",
    "protocolMatchCount",
    "hostnameMatchCount",
    "portMatchCount",
    "exactOriginMatchCount",
  ]);
  const streamOrigin = normalizedCountObject(raw.streamOrigin, ["distinctOriginCount"]);
  const pathShape = normalizedCountObject(raw.pathShape, [
    "hasLiveSegmentCount",
    "hasMovieSegmentCount",
    "hasSeriesSegmentCount",
    "noneOfKnownSegmentsCount",
  ]);
  const pathShapeRaw = objectValue(raw.pathShape);
  const segmentCountHistogram = normalizeSegmentHistogram(pathShapeRaw?.segmentCountHistogram);
  const extension = normalizedCountObject(raw.extension, [
    "presentCount",
    "absentCount",
    "distinctCount",
    "liveLikeCount",
    "vodLikeCount",
    "otherCount",
  ]);
  const extinfDuration = normalizedCountObject(raw.extinfDuration, [
    "negativeOneCount",
    "positiveCount",
    "zeroCount",
    "unparseableCount",
  ]);
  const tvgId = normalizedCountObject(raw.tvgId, ["presentCount", "absentCount"]);
  const classification = normalizedCountObject(raw.classification, [
    "byPathLive",
    "byPathMovie",
    "byPathSeries",
    "byExtensionLive",
    "byExtensionMovie",
    "byGroupMovie",
    "byGroupSeries",
    "byDefaultLive",
  ]);
  const conflict = normalizedCountObject(raw.conflict, [
    "pathLive_groupMovie",
    "durationNegativeOne_groupMovie",
    "tvgIdPresent_groupMovie",
    "pathSeries_extensionMovie",
  ]);
  if (
    !originCompare || !streamOrigin || !pathShape || !segmentCountHistogram || !extension ||
    !extinfDuration || !tvgId || !classification || !conflict
  ) return null;
  return {
    originCompare: originCompare as M3UShapeDiagnostics["originCompare"],
    streamOrigin: streamOrigin as M3UShapeDiagnostics["streamOrigin"],
    pathShape: {
      ...(pathShape as Omit<M3UShapeDiagnostics["pathShape"], "segmentCountHistogram">),
      segmentCountHistogram,
    },
    extension: extension as M3UShapeDiagnostics["extension"],
    extinfDuration: extinfDuration as M3UShapeDiagnostics["extinfDuration"],
    tvgId: tvgId as M3UShapeDiagnostics["tvgId"],
    classification: classification as M3UShapeDiagnostics["classification"],
    conflict: conflict as M3UShapeDiagnostics["conflict"],
  };
}

function normalizeM3UMeasurement(raw: Record<string, unknown>): M3USwitchMeasurement | null {
  if (raw.kind !== "m3u-switch") return null;
  const startedAt = finiteNonNegative(raw.startedAt);
  const m3u = objectValue(raw.m3u);
  const itemCounts = normalizeM3UCounts(m3u?.itemCounts);
  const sqliteReadMs = finiteNonNegative(m3u?.sqliteReadMs);
  const runtimeHydrateMs = finiteNonNegative(m3u?.runtimeHydrateMs);
  const totalSwitchMs = finiteNonNegative(m3u?.totalSwitchMs);
  const outcome = m3u?.cacheHydrationOutcome as M3UCacheHydrationOutcome;
  const fallbackReason = m3u?.networkFallbackReason as M3UNetworkFallbackReason;

  const legacyRawCounts = m3u?.cacheRawCounts === undefined
    ? { live: 0, vod: 0, series: 0 }
    : normalizeM3UCounts(m3u.cacheRawCounts);
  const legacySyncPhase = m3u?.cacheSyncPhase === undefined
    ? "none"
    : normalizeM3USyncPhase(m3u.cacheSyncPhase);
  const legacySnapshot = legacyRawCounts && legacySyncPhase
    ? { rawCounts: legacyRawCounts, syncPhase: legacySyncPhase }
    : null;
  const cacheBefore = m3u?.cacheBefore === undefined
    ? legacySnapshot
    : normalizeM3UCacheSnapshot(m3u.cacheBefore);
  const cacheAfter = m3u?.cacheAfter === undefined
    ? cacheBefore
    : normalizeM3UCacheSnapshot(m3u.cacheAfter);

  const shapeDiagnostics = m3u?.shapeDiagnostics === undefined
    ? undefined
    : normalizeM3UShapeDiagnostics(m3u.shapeDiagnostics);
  const write = m3u?.write === undefined ? undefined : normalizeM3UWriteTelemetry(m3u.write);
  if (
    startedAt === null ||
    sqliteReadMs === null ||
    runtimeHydrateMs === null ||
    totalSwitchMs === null ||
    !itemCounts || !cacheBefore || !cacheAfter ||
    !M3U_OUTCOMES.has(outcome) ||
    typeof m3u?.networkFallback !== "boolean" ||
    !M3U_FALLBACK_REASONS.has(fallbackReason) ||
    (m3u.shapeDiagnostics !== undefined && !shapeDiagnostics) ||
    (m3u.write !== undefined && !write)
  ) {
    return null;
  }
  return {
    kind: "m3u-switch",
    startedAt,
    m3u: {
      sqliteReadMs,
      runtimeHydrateMs,
      cacheHydrationOutcome: outcome,
      networkFallback: m3u.networkFallback,
      networkFallbackReason: fallbackReason,
      totalSwitchMs,
      itemCounts,
      cacheBefore,
      cacheAfter,
      shapeDiagnostics: shapeDiagnostics ?? undefined,
      write: write ?? undefined,
    },
  };
}

function normalizeM3UCacheWriteMeasurement(raw: Record<string, unknown>): M3UCacheWriteMeasurement | null {
  if (raw.kind !== "m3u-cache-write") return null;
  const startedAt = finiteNonNegative(raw.startedAt);
  const m3u = objectValue(raw.m3u);
  const legacyRawCounts = normalizeM3UCounts(m3u?.cacheRawCounts);
  const legacySyncPhase = normalizeM3USyncPhase(m3u?.cacheSyncPhase);
  const legacySnapshot = legacyRawCounts && legacySyncPhase
    ? { rawCounts: legacyRawCounts, syncPhase: legacySyncPhase }
    : null;
  const cacheAfter = m3u?.cacheAfter === undefined
    ? legacySnapshot
    : normalizeM3UCacheSnapshot(m3u.cacheAfter);
  const write = normalizeM3UWriteTelemetry(m3u?.write);
  if (startedAt === null || !cacheAfter || !write) return null;
  return {
    kind: "m3u-cache-write",
    startedAt,
    m3u: { cacheAfter, write },
  };
}

function normalizeFetchMetrics(value: unknown): CatalogFetchMetrics | null {
  const raw = objectValue(value);
  if (!raw || (raw.path !== "bulk" && raw.path !== "parallel" && raw.path !== "serial")) return null;
  const itemCount = countValue(raw.itemCount);
  const bulkParseMs = finiteNonNegative(raw.bulkParseMs);
  const sqliteWriteMs = finiteNonNegative(raw.sqliteWriteMs);
  const totalMs = finiteNonNegative(raw.totalMs);
  const parallelMaxObserved = countValue(raw.parallelMaxObserved);
  if (
    itemCount === null || bulkParseMs === null || sqliteWriteMs === null ||
    totalMs === null || parallelMaxObserved === null
  ) return null;
  const fallbackReason = typeof raw.fallbackReason === "string" &&
    FETCH_FALLBACK_REASONS.has(raw.fallbackReason as NonNullable<CatalogFetchMetrics["fallbackReason"]>)
      ? raw.fallbackReason as NonNullable<CatalogFetchMetrics["fallbackReason"]>
      : undefined;
  return {
    path: raw.path,
    itemCount,
    bulkParseMs,
    sqliteWriteMs,
    totalMs,
    parallelMaxObserved,
    fallbackReason,
  };
}

function normalizeXtreamMeasurement(raw: Record<string, unknown>): XtreamCatalogSyncMeasurement | null {
  if (typeof raw.providerId !== "string" || !raw.providerId) return null;
  if (raw.mode !== "initial" && raw.mode !== "background" && raw.mode !== "manual") return null;
  const startedAt = finiteNonNegative(raw.startedAt);
  const totalMs = finiteNonNegative(raw.totalMs);
  const liveSqliteWriteMs = finiteNonNegative(raw.liveSqliteWriteMs);
  const vod = normalizeFetchMetrics(raw.vod);
  const series = normalizeFetchMetrics(raw.series);
  if (startedAt === null || totalMs === null || liveSqliteWriteMs === null || !vod || !series) return null;
  return {
    providerId: raw.providerId,
    mode: raw.mode,
    startedAt,
    totalMs,
    liveSqliteWriteMs,
    vod,
    series,
  };
}

function normalizeStoredMeasurement(value: unknown): CompletedCatalogSyncMeasurement | null {
  const raw = objectValue(value);
  if (!raw) return null;
  const payload = raw.kind === "m3u-switch"
    ? normalizeM3UMeasurement(raw)
    : raw.kind === "m3u-cache-write"
      ? normalizeM3UCacheWriteMeasurement(raw)
      : normalizeXtreamMeasurement(raw);
  if (!payload) return null;
  const recordedAt = raw.recordedAt === undefined ? payload.startedAt : finiteNonNegative(raw.recordedAt);
  const sequence = raw.sequence === undefined ? 0 : countValue(raw.sequence);
  const state = raw.state === undefined ? "completed" : raw.state;
  if (recordedAt === null || sequence === null || state !== "completed") return null;
  return {
    ...payload,
    startedAt: payload.startedAt,
    recordedAt,
    sequence,
    state: "completed",
  } as CompletedCatalogSyncMeasurement;
}

async function persistCompletedMeasurement(
  measurement: CatalogSyncMeasurement,
): Promise<CompletedCatalogSyncMeasurement> {
  const sequenceFloor = Math.max(
    latestMeasurement?.sequence ?? 0,
    typeof measurement.sequence === "number" ? Math.max(0, Math.trunc(measurement.sequence)) : 0,
  );
  const sequence = await nextCatalogSyncMetricsSequence(AsyncStorage, sequenceFloor);
  const completed = {
    ...measurement,
    startedAt: measurement.startedAt,
    recordedAt: Date.now(),
    sequence,
    state: "completed",
  } as CompletedCatalogSyncMeasurement;
  await writeCatalogSyncMetricsPayload(AsyncStorage, JSON.stringify(completed));
  latestMeasurement = completed;
  completeCatalogMeasurementFreshness(measurement.startedAt);
  return completed;
}

export function recordCatalogSyncMeasurement(measurement: CatalogSyncMeasurement) {
  void persistCompletedMeasurement(measurement).catch(() => undefined);
}

export async function recordCatalogSyncMeasurementPersisted(measurement: CatalogSyncMeasurement) {
  await persistCompletedMeasurement(measurement);
}

export async function readPersistedCatalogSyncMeasurement(): Promise<CompletedCatalogSyncMeasurement | null> {
  const raw = await readCatalogSyncMetricsPayload(AsyncStorage);
  if (raw === null) {
    latestMeasurement = null;
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Stored catalog sync measurement is invalid.");
  }
  const measurement = normalizeStoredMeasurement(parsed);
  if (!measurement) throw new Error("Stored catalog sync measurement is invalid.");
  latestMeasurement = measurement;
  return measurement;
}

export async function readCatalogSyncMeasurementDisplay(): Promise<CatalogSyncMeasurementDisplay> {
  const active = getCatalogMeasurementInProgress();
  if (active) {
    const storedSequence = await readCatalogSyncMetricsSequence(AsyncStorage).catch(
      () => latestMeasurement?.sequence ?? 0,
    );
    const nextSequence = Math.max(storedSequence, latestMeasurement?.sequence ?? 0) + 1;
    return resolveCatalogMeasurementDisplay(active, latestMeasurement, nextSequence);
  }

  const measurement = await readPersistedCatalogSyncMeasurement();
  const storedSequence = await readCatalogSyncMetricsSequence(AsyncStorage).catch(
    () => measurement?.sequence ?? 0,
  );
  const nextSequence = Math.max(storedSequence, measurement?.sequence ?? 0) + 1;
  return resolveCatalogMeasurementDisplay(null, measurement, nextSequence);
}

export function getLatestCatalogSyncMeasurement() {
  return latestMeasurement;
}

export function clearLatestCatalogSyncMeasurement() {
  latestMeasurement = null;
}
