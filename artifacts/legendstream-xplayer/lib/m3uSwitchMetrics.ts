import {
  resolveM3UNetworkFallback,
  type M3UCacheHydrationOutcome,
  type M3UCacheHydrationReason,
  type M3UItemCounts,
  type M3UNetworkFallbackReason,
  type M3USwitchMeasurement,
} from "./m3uSwitchMeasurement";

export type M3UHydrationObservation = {
  outcome: M3UCacheHydrationOutcome;
  reason: M3UCacheHydrationReason;
  sqliteReadMs: number;
  runtimeHydrateMs: number;
  itemCounts: M3UItemCounts;
};

type PendingM3USwitch = {
  providerId: string;
  startedAt: number;
  hydration?: M3UHydrationObservation;
  path?: "memory" | "cache" | "network";
  fallbackReasonOverride?: M3UNetworkFallbackReason;
  networkCounts?: M3UItemCounts;
};

let pending: PendingM3USwitch | null = null;

export function beginM3UProviderSwitchMeasurement(providerId: string) {
  pending = { providerId, startedAt: Date.now() };
}

export function noteM3UCacheHydration(observation: M3UHydrationObservation) {
  if (!pending) return;
  pending.hydration = observation;
}

export function noteM3UProviderSwitchPath(path: "memory" | "cache" | "network") {
  if (!pending) return;
  pending.path = path;
}

export function noteM3UNetworkCatalogCounts(itemCounts: M3UItemCounts) {
  if (!pending) return;
  pending.networkCounts = itemCounts;
}

function finalCounts(value: PendingM3USwitch): M3UItemCounts {
  if (value.path === "network" && value.networkCounts) return value.networkCounts;
  return value.hydration?.itemCounts ?? { live: 0, vod: 0, series: 0 };
}

function publishMeasurement(measurement: M3USwitchMeasurement) {
  void import("./catalogSyncMetrics")
    .then(({ recordCatalogSyncMeasurement }) => recordCatalogSyncMeasurement(measurement))
    .catch(() => undefined);
}

export function completePendingM3UProviderSwitchMeasurement(providerId?: string) {
  if (!pending || !pending.path) return false;
  if (providerId && pending.providerId !== providerId) return false;
  const value = pending;
  pending = null;
  const fallback = value.fallbackReasonOverride
    ? { used: true, reason: value.fallbackReasonOverride }
    : resolveM3UNetworkFallback(
        value.path,
        value.hydration?.outcome,
        value.hydration?.reason,
      );
  publishMeasurement({
    kind: "m3u-switch",
    startedAt: value.startedAt,
    m3u: {
      sqliteReadMs: value.hydration?.sqliteReadMs ?? 0,
      runtimeHydrateMs: value.hydration?.runtimeHydrateMs ?? 0,
      cacheHydrationOutcome: value.hydration?.outcome ?? "null",
      networkFallback: fallback.used,
      networkFallbackReason: fallback.reason,
      totalSwitchMs: Math.max(0, Date.now() - value.startedAt),
      itemCounts: finalCounts(value),
    },
  });
  return true;
}

export function failPendingM3UProviderSwitchMeasurement(
  reason: M3UNetworkFallbackReason = "network-error",
) {
  if (!pending) return false;
  pending.path = "network";
  pending.fallbackReasonOverride = reason;
  return completePendingM3UProviderSwitchMeasurement();
}

export function hasPendingM3UProviderSwitchMeasurement() {
  return pending !== null;
}
