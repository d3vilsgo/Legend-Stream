import { useEffect, useRef } from "react";
import { useCatalogSync } from "@/context/CatalogSyncContext";
import { usePlayer } from "@/context/PlayerContext";
import { safeLog } from "@/lib/safeLog";
import { subscribeStalkerLivePublishRevision } from "@/lib/stalkerLivePublishRevision";
import { syncStalkerLiveCatalog } from "@/lib/stalkerLiveSync";

export function StalkerPostActivationCatalogBridge() {
  const { provider, isHydrating } = usePlayer();
  const { refreshSnapshot } = useCatalogSync();
  const syncGenerationRef = useRef(0);
  const activeProviderIdRef = useRef<string | null>(provider?.id ?? null);
  activeProviderIdRef.current = provider?.id ?? null;

  useEffect(() => {
    if (!provider || provider.type !== "stalker") return;
    const providerId = provider.id;
    return subscribeStalkerLivePublishRevision(providerId, "live", () => {
      if (activeProviderIdRef.current !== providerId) return;
      void refreshSnapshot().catch(() => undefined);
    });
  }, [provider?.id, provider?.type, refreshSnapshot]);

  useEffect(() => {
    if (isHydrating || !provider || provider.type !== "stalker") return;
    const portalUrl = (provider.url || provider.playlistUrl).trim();
    const mac = provider.mac?.trim() || "";
    if (!portalUrl || !mac) return;

    const providerId = provider.id;
    const generation = ++syncGenerationRef.current;
    const controller = new AbortController();
    let disposed = false;
    const isCurrent = () =>
      !disposed &&
      !controller.signal.aborted &&
      syncGenerationRef.current === generation &&
      activeProviderIdRef.current === providerId;

    safeLog.info("LS_STALKER_POST_ACTIVATION_SYNC_START", {
      providerId,
      generation,
    });

    void syncStalkerLiveCatalog({
      provider: { id: providerId, url: portalUrl, mac },
      signal: controller.signal,
      isCurrent,
      owner: "OTHER_EXPLICIT_CALLER",
    }).then((result) => {
      if (!isCurrent()) return;
      safeLog.info("LS_STALKER_POST_ACTIVATION_SYNC_END", {
        providerId,
        generation,
        result: "SUCCESS",
        persisted: result.persisted,
      });
    }).catch(() => {
      safeLog.info("LS_STALKER_POST_ACTIVATION_SYNC_END", {
        providerId,
        generation,
        result: controller.signal.aborted || !isCurrent() ? "CANCELLED" : "ERROR",
      });
    });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [isHydrating, provider?.id, provider?.type, provider?.lastLoadedAt]);

  return null;
}
