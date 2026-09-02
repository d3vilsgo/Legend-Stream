import type { CatalogCounts, CatalogSyncPhase, CatalogSyncState } from "./catalogCache";

export type CatalogRunState = CatalogSyncState & { runId: number };
export type CatalogSyncMode = "initial" | "background" | "manual";
export type CatalogSyncOwnership = {
  providerId: string | null;
  generation: number;
};

export function isCatalogSyncOwnershipCurrent(
  currentProviderId: string | null,
  currentGeneration: number,
  target: CatalogSyncOwnership,
) {
  return (
    currentProviderId === target.providerId &&
    currentGeneration === target.generation
  );
}

export function hasUsableCatalogCache(counts: CatalogCounts) {
  return counts.live > 0 || counts.vod > 0 || counts.series > 0;
}

export function isCatalogSyncActive(phase: CatalogSyncPhase | undefined) {
  return phase === "preparing" || phase === "syncing";
}

export function shouldBlockInitialCatalogSync(
  hasUsableCache: boolean,
  isInitialSyncRunning: boolean,
  phase: CatalogSyncPhase | undefined,
) {
  return isInitialSyncRunning && !hasUsableCache && phase !== "ready";
}

export function freshCatalogRunState(
  providerId: string,
  runId: number,
  mode: CatalogSyncMode,
): CatalogRunState {
  const initial = mode === "initial";
  return {
    providerId,
    phase: initial ? "preparing" : "syncing",
    completed: 0,
    total: 1,
    message: initial ? "Catalogs are being prepared" : "Catalog update started",
    updatedAt: Date.now(),
    runId,
  };
}

export function abortCatalogRequest(controller: Pick<AbortController, "abort"> | null) {
  controller?.abort();
}
