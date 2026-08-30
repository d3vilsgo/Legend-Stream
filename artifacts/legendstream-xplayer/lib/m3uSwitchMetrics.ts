import {
  resolveM3UNetworkFallback,
  type M3UCacheHydrationOutcome,
  type M3UCacheHydrationReason,
  type M3UItemCounts,
  type M3UNetworkFallbackReason,
  type M3USwitchMeasurement,
} from "./m3uSwitchMeasurement";
import {
  emptyM3UCacheCounts,
  type M3UCacheSnapshot,
  type M3UCacheSyncPhase,
  type M3UCacheWriteMeasurement,
  type M3UCacheWriteObservation,
} from "./m3uCacheWriteMeasurement";
import type { M3UShapeDiagnostics } from "./m3uShapeDiagnostics";
import { safeLog } from "./safeLog";

export type M3UHydrationObservation = {
  outcome: M3UCacheHydrationOutcome;
  reason: M3UCacheHydrationReason;
  sqliteReadMs: number;
  runtimeHydrateMs: number;
  itemCounts: M3UItemCounts;
  cacheRawCounts: M3UItemCounts;
  cacheSyncPhase: M3UCacheSyncPhase;
};

type PendingM3USwitch = {
  providerId: string;
  startedAt: number;
  hydration?: M3UHydrationObservation;
  path?: "memory" | "cache" | "network";
  fallbackReasonOverride?: M3UNetworkFallbackReason;
  networkCounts?: M3UItemCounts;
  networkDiagnostics?: M3UShapeDiagnostics;
  writeStarted: boolean;
  write?: M3UCacheWriteObservation;
  switchCompletedAt?: number;
};

let pending: PendingM3USwitch | null = null;

export function beginM3UProviderSwitchMeasurement(providerId: string) {
  pending = { providerId, startedAt: Date.now(), writeStarted: false };
}

export function noteM3UCacheHydration(observation: M3UHydrationObservation) {
  if (!pending) return;
  pending.hydration = observation;
}

export function noteM3UProviderSwitchPath(path: "memory" | "cache" | "network") {
  if (!pending) return;
  pending.path = path;
}

export function noteM3UNetworkCatalogCounts(
  itemCounts: M3UItemCounts,
  diagnostics?: M3UShapeDiagnostics,
) {
  if (!pending) return;
  pending.networkCounts = itemCounts;
  pending.networkDiagnostics = diagnostics;
}

export function noteM3UCacheWriteStarted(providerId: string) {
  if (pending?.providerId === providerId) pending.writeStarted = true;
}

function finalCounts(value: PendingM3USwitch): M3UItemCounts {
  if (value.path === "network" && value.networkCounts) return value.networkCounts;
  return value.hydration?.itemCounts ?? emptyM3UCacheCounts();
}

function beforeSnapshot(value: PendingM3USwitch): M3UCacheSnapshot {
  return {
    rawCounts: value.hydration?.cacheRawCounts ?? emptyM3UCacheCounts(),
    syncPhase: value.hydration?.cacheSyncPhase ?? "none",
  };
}

async function publishMeasurement(measurement: M3USwitchMeasurement | M3UCacheWriteMeasurement) {
  try {
    const { recordCatalogSyncMeasurementPersisted } = await import("./catalogSyncMetrics");
    await recordCatalogSyncMeasurementPersisted(measurement);
  } catch (caught) {
    safeLog.error("LS_M3U_METRICS_PERSIST", caught);
  }
}

function takePendingMeasurement(value: PendingM3USwitch): M3USwitchMeasurement {
  const fallback = value.fallbackReasonOverride
    ? { used: true, reason: value.fallbackReasonOverride }
    : resolveM3UNetworkFallback(
        value.path!,
        value.hydration?.outcome,
        value.hydration?.reason,
      );
  const completedAt = value.switchCompletedAt ?? Date.now();
  const cacheBefore = beforeSnapshot(value);
  const cacheAfter = value.write?.cacheAfter ?? cacheBefore;
  pending = null;
  return {
    kind: "m3u-switch",
    startedAt: value.startedAt,
    m3u: {
      sqliteReadMs: value.hydration?.sqliteReadMs ?? 0,
      runtimeHydrateMs: value.hydration?.runtimeHydrateMs ?? 0,
      cacheHydrationOutcome: value.hydration?.outcome ?? "null",
      networkFallback: fallback.used,
      networkFallbackReason: fallback.reason,
      totalSwitchMs: Math.max(0, completedAt - value.startedAt),
      itemCounts: finalCounts(value),
      cacheBefore,
      cacheAfter,
      shapeDiagnostics: value.networkDiagnostics,
      write: value.write?.write,
    },
  };
}

export async function noteM3UCacheWriteResult(
  providerId: string,
  observation: M3UCacheWriteObservation,
) {
  if (pending?.providerId === providerId) {
    pending.write = observation;
    if (pending.switchCompletedAt !== undefined && pending.path) {
      await publishMeasurement(takePendingMeasurement(pending));
    }
    return;
  }

  await publishMeasurement({
    kind: "m3u-cache-write",
    startedAt: observation.startedAt,
    m3u: {
      cacheAfter: observation.cacheAfter,
      write: observation.write,
    },
  });
}

export function completePendingM3UProviderSwitchMeasurement(providerId?: string) {
  if (!pending) return false;
  const path = pending.path;
  if (!path) return false;
  if (providerId && pending.providerId !== providerId) return false;
  pending.switchCompletedAt ??= Date.now();
  if (path === "network" && pending.writeStarted && !pending.write) return false;
  const measurement = takePendingMeasurement(pending);
  void publishMeasurement(measurement);
  return true;
}

export function failPendingM3UProviderSwitchMeasurement(
  reason: M3UNetworkFallbackReason = "network-error",
) {
  if (!pending) return false;
  pending.path = "network";
  pending.fallbackReasonOverride = reason;
  pending.writeStarted = false;
  return completePendingM3UProviderSwitchMeasurement();
}

export function hasPendingM3UProviderSwitchMeasurement() {
  return pending !== null;
}
