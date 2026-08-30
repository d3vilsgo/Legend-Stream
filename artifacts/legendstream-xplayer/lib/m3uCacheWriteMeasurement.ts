import type {
  M3UCacheAfterReadOutcome,
  M3USqliteErrorClass,
  M3USqliteStage,
} from "./sqliteWriteDiagnostics";

export type M3UCacheWriteOutcome =
  | "success"
  | "unsupported-source"
  | "unsafe-live-ref"
  | "unsafe-vod-ref"
  | "unsafe-series-ref"
  | "projection-drop"
  | "sqlite-error";

export type M3URefRejectionReason =
  | "origin-mismatch"
  | "path-shape"
  | "query-present"
  | "kind-mismatch"
  | "missing-extension"
  | "credential-path-mismatch";

export type M3UCacheSyncPhase =
  | "none"
  | "idle"
  | "preparing"
  | "syncing"
  | "ready"
  | "cancelled"
  | "error";

export type M3UCacheCounts = {
  live: number;
  vod: number;
  series: number;
};

export type M3URefRejectionCounts = Record<M3URefRejectionReason, number>;

export type M3UCacheSnapshot = {
  rawCounts: M3UCacheCounts;
  syncPhase: M3UCacheSyncPhase;
};

export type M3UCacheValidationScan = {
  scanTotalCandidateCount: number;
  scanInspectedCount: number;
  scanTruncated: boolean;
  firstRejectKind: "none" | "live" | "vod" | "series";
  firstRejectReason: "none" | M3URefRejectionReason;
};

export type M3UCleanupOutcome = "not-required" | "success" | "error";
export type M3UCleanupStage = "none" | "delete-catalog" | "set-error-state";

export type M3UCacheWriteTelemetry = {
  writeAttempted: true;
  writeOutcome: M3UCacheWriteOutcome;
  writeMs: number;
  writeInputCounts: M3UCacheCounts;
  writeSafeCounts: M3UCacheCounts;
  writeWrittenCounts: M3UCacheCounts;
  completedBatchCount: M3UCacheCounts;
  committedRows: M3UCacheCounts;
  failedBatchIndex: number;
  cacheAfterReadOutcome: M3UCacheAfterReadOutcome;
  sqliteErrorClass?: M3USqliteErrorClass;
  sqlitePrimaryCode?: number;
  sqliteStage?: M3USqliteStage;
  writeRejectCounts: M3URefRejectionCounts;
  scan: M3UCacheValidationScan;
  cleanupOutcome: M3UCleanupOutcome;
  cleanupStage: M3UCleanupStage;
};

export type M3UCacheWriteObservation = {
  startedAt: number;
  cacheAfter: M3UCacheSnapshot;
  write: M3UCacheWriteTelemetry;
};

export type M3UCacheWriteMeasurement = {
  kind: "m3u-cache-write";
  startedAt: number;
  m3u: {
    cacheAfter: M3UCacheSnapshot;
    write: M3UCacheWriteTelemetry;
  };
};

export const M3U_WRITE_OUTCOMES = new Set<M3UCacheWriteOutcome>([
  "success",
  "unsupported-source",
  "unsafe-live-ref",
  "unsafe-vod-ref",
  "unsafe-series-ref",
  "projection-drop",
  "sqlite-error",
]);

export const M3U_REF_REJECTION_REASONS: readonly M3URefRejectionReason[] = [
  "origin-mismatch",
  "path-shape",
  "query-present",
  "kind-mismatch",
  "missing-extension",
  "credential-path-mismatch",
];

export const M3U_CACHE_SYNC_PHASES = new Set<M3UCacheSyncPhase>([
  "none",
  "idle",
  "preparing",
  "syncing",
  "ready",
  "cancelled",
  "error",
]);

export const M3U_CLEANUP_OUTCOMES = new Set<M3UCleanupOutcome>([
  "not-required",
  "success",
  "error",
]);

export const M3U_CLEANUP_STAGES = new Set<M3UCleanupStage>([
  "none",
  "delete-catalog",
  "set-error-state",
]);

export const M3U_FIRST_REJECT_KINDS = new Set<M3UCacheValidationScan["firstRejectKind"]>([
  "none",
  "live",
  "vod",
  "series",
]);

export function emptyM3UCacheCounts(): M3UCacheCounts {
  return { live: 0, vod: 0, series: 0 };
}

export function emptyM3URefRejectionCounts(): M3URefRejectionCounts {
  return {
    "origin-mismatch": 0,
    "path-shape": 0,
    "query-present": 0,
    "kind-mismatch": 0,
    "missing-extension": 0,
    "credential-path-mismatch": 0,
  };
}

export function emptyM3UValidationScan(total = 0): M3UCacheValidationScan {
  return {
    scanTotalCandidateCount: Math.max(0, Math.trunc(total)),
    scanInspectedCount: 0,
    scanTruncated: total > 0,
    firstRejectKind: "none",
    firstRejectReason: "none",
  };
}

export function formatM3UCacheWriteFields(write: M3UCacheWriteTelemetry) {
  return [
    "m3u.writeAttempted=true",
    `m3u.writeOutcome=${write.writeOutcome}`,
    `m3u.writeMs=${write.writeMs}`,
    `m3u.writeInputCounts.live=${write.writeInputCounts.live}`,
    `m3u.writeInputCounts.vod=${write.writeInputCounts.vod}`,
    `m3u.writeInputCounts.series=${write.writeInputCounts.series}`,
    `m3u.writeSafeCounts.live=${write.writeSafeCounts.live}`,
    `m3u.writeSafeCounts.vod=${write.writeSafeCounts.vod}`,
    `m3u.writeSafeCounts.series=${write.writeSafeCounts.series}`,
    `m3u.writeWrittenCounts.live=${write.writeWrittenCounts.live}`,
    `m3u.writeWrittenCounts.vod=${write.writeWrittenCounts.vod}`,
    `m3u.writeWrittenCounts.series=${write.writeWrittenCounts.series}`,
    `m3u.completedBatchCount.live=${write.completedBatchCount.live}`,
    `m3u.completedBatchCount.vod=${write.completedBatchCount.vod}`,
    `m3u.completedBatchCount.series=${write.completedBatchCount.series}`,
    `m3u.committedRows.live=${write.committedRows.live}`,
    `m3u.committedRows.vod=${write.committedRows.vod}`,
    `m3u.committedRows.series=${write.committedRows.series}`,
    `m3u.failedBatchIndex=${write.failedBatchIndex}`,
    `m3u.cacheAfterReadOutcome=${write.cacheAfterReadOutcome}`,
    ...(write.sqliteErrorClass !== undefined &&
    write.sqlitePrimaryCode !== undefined &&
    write.sqliteStage !== undefined
      ? [
          `m3u.sqliteErrorClass=${write.sqliteErrorClass}`,
          `m3u.sqlitePrimaryCode=${write.sqlitePrimaryCode}`,
          `m3u.sqliteStage=${write.sqliteStage}`,
        ]
      : []),
    ...M3U_REF_REJECTION_REASONS.map(
      (reason) => `m3u.writeRejectCounts.${reason}=${write.writeRejectCounts[reason]}`,
    ),
    `m3u.scanTotalCandidateCount=${write.scan.scanTotalCandidateCount}`,
    `m3u.scanInspectedCount=${write.scan.scanInspectedCount}`,
    `m3u.scanTruncated=${write.scan.scanTruncated}`,
    `m3u.firstRejectKind=${write.scan.firstRejectKind}`,
    `m3u.firstRejectReason=${write.scan.firstRejectReason}`,
    `m3u.cleanupOutcome=${write.cleanupOutcome}`,
    `m3u.cleanupStage=${write.cleanupStage}`,
  ];
}

export function formatM3UCacheWriteMeasurement(measurement: M3UCacheWriteMeasurement) {
  const { m3u } = measurement;
  return [
    `m3u.cacheAfter.rawCounts.live=${m3u.cacheAfter.rawCounts.live}`,
    `m3u.cacheAfter.rawCounts.vod=${m3u.cacheAfter.rawCounts.vod}`,
    `m3u.cacheAfter.rawCounts.series=${m3u.cacheAfter.rawCounts.series}`,
    `m3u.cacheAfter.syncPhase=${m3u.cacheAfter.syncPhase}`,
    ...formatM3UCacheWriteFields(m3u.write),
  ].join("\n");
}
