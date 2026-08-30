import {
  formatM3UCacheWriteFields,
  type M3UCacheCounts,
  type M3UCacheSnapshot,
  type M3UCacheWriteTelemetry,
} from "./m3uCacheWriteMeasurement";
import {
  formatM3UShapeDiagnosticsFields,
  type M3UShapeDiagnostics,
} from "./m3uShapeDiagnostics";

export type M3UCacheHydrationOutcome = "hit" | "null" | "error";
export type M3UCacheHydrationReason =
  | "none"
  | "unsupported-source"
  | "empty-cache"
  | "error-state"
  | "sqlite-read-error"
  | "runtime-hydrate-error";

export type M3UNetworkFallbackReason =
  | "none"
  | "cache-unsupported-source"
  | "cache-empty"
  | "cache-sqlite-error"
  | "cache-runtime-error"
  | "cache-unavailable"
  | "network-error";

export type M3UItemCounts = M3UCacheCounts;

export type M3USwitchMeasurement = {
  kind: "m3u-switch";
  startedAt: number;
  m3u: {
    sqliteReadMs: number;
    runtimeHydrateMs: number;
    cacheHydrationOutcome: M3UCacheHydrationOutcome;
    networkFallback: boolean;
    networkFallbackReason: M3UNetworkFallbackReason;
    totalSwitchMs: number;
    itemCounts: M3UItemCounts;
    cacheBefore: M3UCacheSnapshot;
    cacheAfter: M3UCacheSnapshot;
    shapeDiagnostics?: M3UShapeDiagnostics;
    write?: M3UCacheWriteTelemetry;
  };
};

export function resolveM3UNetworkFallback(
  path: "memory" | "cache" | "network",
  outcome: M3UCacheHydrationOutcome | undefined,
  reason: M3UCacheHydrationReason | undefined,
): { used: boolean; reason: M3UNetworkFallbackReason } {
  if (path !== "network") return { used: false, reason: "none" };
  if (outcome === "null" && reason === "unsupported-source") {
    return { used: true, reason: "cache-unsupported-source" };
  }
  if (outcome === "null" && reason === "empty-cache") {
    return { used: true, reason: "cache-empty" };
  }
  if (outcome === "error" && reason === "sqlite-read-error") {
    return { used: true, reason: "cache-sqlite-error" };
  }
  if (outcome === "error" && reason === "runtime-hydrate-error") {
    return { used: true, reason: "cache-runtime-error" };
  }
  return { used: true, reason: "cache-unavailable" };
}

export function formatM3USwitchMeasurement(measurement: M3USwitchMeasurement) {
  const { m3u } = measurement;
  return [
    `m3u.sqliteReadMs=${m3u.sqliteReadMs}`,
    `m3u.runtimeHydrateMs=${m3u.runtimeHydrateMs}`,
    `m3u.cacheHydrationOutcome=${m3u.cacheHydrationOutcome}`,
    `m3u.networkFallback=${m3u.networkFallback}`,
    `m3u.networkFallbackReason=${m3u.networkFallbackReason}`,
    `m3u.totalSwitchMs=${m3u.totalSwitchMs}`,
    `m3u.itemCounts.live=${m3u.itemCounts.live}`,
    `m3u.itemCounts.vod=${m3u.itemCounts.vod}`,
    `m3u.itemCounts.series=${m3u.itemCounts.series}`,
    `m3u.cacheBefore.rawCounts.live=${m3u.cacheBefore.rawCounts.live}`,
    `m3u.cacheBefore.rawCounts.vod=${m3u.cacheBefore.rawCounts.vod}`,
    `m3u.cacheBefore.rawCounts.series=${m3u.cacheBefore.rawCounts.series}`,
    `m3u.cacheBefore.syncPhase=${m3u.cacheBefore.syncPhase}`,
    `m3u.cacheAfter.rawCounts.live=${m3u.cacheAfter.rawCounts.live}`,
    `m3u.cacheAfter.rawCounts.vod=${m3u.cacheAfter.rawCounts.vod}`,
    `m3u.cacheAfter.rawCounts.series=${m3u.cacheAfter.rawCounts.series}`,
    `m3u.cacheAfter.syncPhase=${m3u.cacheAfter.syncPhase}`,
    ...(m3u.shapeDiagnostics ? formatM3UShapeDiagnosticsFields(m3u.shapeDiagnostics) : []),
    ...(m3u.write ? formatM3UCacheWriteFields(m3u.write) : ["m3u.writeAttempted=false"]),
  ].join("\n");
}
