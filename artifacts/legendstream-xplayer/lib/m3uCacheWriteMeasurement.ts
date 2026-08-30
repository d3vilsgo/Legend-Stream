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

export type M3UCacheWriteTelemetry = {
  writeAttempted: true;
  writeOutcome: M3UCacheWriteOutcome;
  writeMs: number;
  writeInputCounts: M3UCacheCounts;
  writeSafeCounts: M3UCacheCounts;
  writeWrittenCounts: M3UCacheCounts;
  writeRejectCounts: M3URefRejectionCounts;
};

export type M3UCacheWriteObservation = {
  startedAt: number;
  cacheRawCounts: M3UCacheCounts;
  cacheSyncPhase: M3UCacheSyncPhase;
  write: M3UCacheWriteTelemetry;
};

export type M3UCacheWriteMeasurement = {
  kind: "m3u-cache-write";
  startedAt: number;
  m3u: {
    cacheRawCounts: M3UCacheCounts;
    cacheSyncPhase: M3UCacheSyncPhase;
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
    ...M3U_REF_REJECTION_REASONS.map(
      (reason) => `m3u.writeRejectCounts.${reason}=${write.writeRejectCounts[reason]}`,
    ),
  ];
}

export function formatM3UCacheWriteMeasurement(measurement: M3UCacheWriteMeasurement) {
  const { m3u } = measurement;
  return [
    `m3u.cacheRawCounts.live=${m3u.cacheRawCounts.live}`,
    `m3u.cacheRawCounts.vod=${m3u.cacheRawCounts.vod}`,
    `m3u.cacheRawCounts.series=${m3u.cacheRawCounts.series}`,
    `m3u.cacheSyncPhase=${m3u.cacheSyncPhase}`,
    ...formatM3UCacheWriteFields(m3u.write),
  ].join("\n");
}
