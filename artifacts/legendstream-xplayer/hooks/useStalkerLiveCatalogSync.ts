import { useMemo } from "react";
import type { ProviderConfig } from "@/context/PlayerContext";
import { useCatalogSync } from "@/context/CatalogSyncContext";

export function useStalkerLiveCatalogSync(provider: ProviderConfig | null) {
  const {
    snapshot,
    hasUsableCache,
    syncState,
    isSyncing,
    isRefreshing,
    refreshCatalog,
  } = useCatalogSync();

  return useMemo(() => {
    if (!provider || provider.type !== "stalker") {
      return {
        totalCount: null,
        countKnown: false,
        syncing: false,
        categoriesReady: false,
        refresh: refreshCatalog,
      };
    }

    const matches = snapshot.providerId === provider.id;
    const terminalPhase =
      syncState?.phase === "ready" ||
      syncState?.phase === "cache-ready" ||
      syncState?.phase === "error" ||
      syncState?.phase === "credentials-required" ||
      syncState?.phase === "cancelled";
    const countKnown = matches && (
      hasUsableCache ||
      snapshot.ready ||
      snapshot.counts.live > 0 ||
      syncState?.phase === "ready" ||
      syncState?.phase === "cache-ready" ||
      syncState?.phase === "error" ||
      syncState?.phase === "cancelled"
    );
    const categoriesReady = terminalPhase || (matches && (
      hasUsableCache ||
      snapshot.counts.live > 0
    ));

    return {
      totalCount: countKnown ? snapshot.counts.live : null,
      countKnown,
      syncing: isSyncing || isRefreshing,
      categoriesReady,
      refresh: refreshCatalog,
    };
  }, [
    hasUsableCache,
    isRefreshing,
    isSyncing,
    provider,
    refreshCatalog,
    snapshot.counts.live,
    snapshot.providerId,
    snapshot.ready,
    syncState?.phase,
  ]);
}
