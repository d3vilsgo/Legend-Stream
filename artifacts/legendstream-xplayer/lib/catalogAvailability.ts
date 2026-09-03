import type { CatalogCounts, CatalogSyncPhase, CatalogSyncState } from "./catalogCache";

export type CatalogRunState = CatalogSyncState & { runId: number };
export type CatalogSyncMode = "initial" | "background" | "manual";
export type CatalogSyncOwnership = {
  providerId: string | null;
  generation: number;
};

export type ProviderLoadRequestMode = "foreground" | "background";
export type ProviderLoadRequestOwnership = {
  providerId: string;
  generation: number;
  mode: ProviderLoadRequestMode;
};

export class ProviderLoadRequestGate {
  private nextGeneration = 0;
  private readonly activeByProvider = new Map<string, ProviderLoadRequestOwnership>();

  beginForeground(providerId: string): ProviderLoadRequestOwnership {
    const ownership: ProviderLoadRequestOwnership = {
      providerId,
      generation: ++this.nextGeneration,
      mode: "foreground",
    };
    this.activeByProvider.set(providerId, ownership);
    return ownership;
  }

  beginBackground(providerId: string): ProviderLoadRequestOwnership | null {
    if (this.activeByProvider.has(providerId)) return null;
    const ownership: ProviderLoadRequestOwnership = {
      providerId,
      generation: ++this.nextGeneration,
      mode: "background",
    };
    this.activeByProvider.set(providerId, ownership);
    return ownership;
  }

  isCurrent(ownership: ProviderLoadRequestOwnership) {
    const active = this.activeByProvider.get(ownership.providerId);
    return active?.generation === ownership.generation && active.mode === ownership.mode;
  }

  finish(ownership: ProviderLoadRequestOwnership) {
    if (!this.isCurrent(ownership)) return false;
    this.activeByProvider.delete(ownership.providerId);
    return true;
  }

  invalidateProvider(providerId: string) {
    this.activeByProvider.delete(providerId);
  }

  invalidateAll() {
    this.activeByProvider.clear();
  }
}

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

export async function publishSuccessfulCatalogCommitIfCurrent(
  completion: Promise<boolean> | null | undefined,
  ownership: CatalogSyncOwnership,
  currentOwnership: () => CatalogSyncOwnership,
  publish: () => void,
) {
  if (!completion) return false;
  let committed = false;
  try {
    committed = await completion;
  } catch {
    return false;
  }
  if (!committed) return false;
  const current = currentOwnership();
  if (!isCatalogSyncOwnershipCurrent(current.providerId, current.generation, ownership)) {
    return false;
  }
  publish();
  return true;
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
