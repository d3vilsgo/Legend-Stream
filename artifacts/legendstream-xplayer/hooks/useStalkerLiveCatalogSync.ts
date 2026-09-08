import { useCallback, useEffect, useRef, useState } from "react";
import { getCatalogCounts, initCatalogCache } from "@/lib/catalogCache";
import { syncStalkerLiveCatalog, type StalkerLiveSyncOwner } from "@/lib/stalkerLiveSync";
import type { ProviderConfig } from "@/context/PlayerContext";

const BACKGROUND_SYNC_DELAY_MS = 1_250;

type State = {
  totalCount: number | null;
  countKnown: boolean;
  syncing: boolean;
};

export function useStalkerLiveCatalogSync(provider: ProviderConfig | null) {
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>({ totalCount: null, countKnown: false, syncing: false });

  const readCount = useCallback(async (expectedProviderId: string, generation: number) => {
    const counts = await getCatalogCounts(expectedProviderId);
    if (generationRef.current !== generation || provider?.id !== expectedProviderId) return;
    setState((current) => ({ ...current, totalCount: counts.live, countKnown: true }));
  }, [provider?.id]);

  const run = useCallback(async (owner: StalkerLiveSyncOwner = "LIVE_MANUAL_REFRESH") => {
    if (!provider || provider.type !== "stalker") return;
    const portalUrl = provider.url;
    const mac = provider.mac?.trim() || "";
    if (!portalUrl || !mac) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    const providerId = provider.id;
    const isCurrent = () =>
      !controller.signal.aborted &&
      generationRef.current === generation;

    setState((current) => ({ ...current, syncing: true }));
    try {
      await syncStalkerLiveCatalog({
        provider: { id: providerId, url: portalUrl, mac },
        signal: controller.signal,
        isCurrent,
        owner,
      });
      if (isCurrent()) await readCount(providerId, generation);
    } finally {
      if (isCurrent()) setState((current) => ({ ...current, syncing: false }));
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [provider, readCount]);

  useEffect(() => {
    controllerRef.current?.abort();
    const generation = ++generationRef.current;
    if (!provider || provider.type !== "stalker") {
      setState({ totalCount: null, countKnown: false, syncing: false });
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void (async () => {
      await initCatalogCache();
      const counts = await getCatalogCounts(provider.id);
      if (disposed || generationRef.current !== generation) return;
      setState({ totalCount: counts.live, countKnown: true, syncing: false });
      if (counts.live > 0) {
        timer = setTimeout(() => {
          if (!disposed && generationRef.current === generation) void run("LIVE_MOUNT").catch(() => undefined);
        }, BACKGROUND_SYNC_DELAY_MS);
      } else {
        void run("LIVE_MOUNT").catch(() => undefined);
      }
    })().catch(() => undefined);
    return () => {
      disposed = true;
      generationRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      if (timer) clearTimeout(timer);
    };
  }, [provider?.id, run]);

  return { ...state, refresh: () => run("LIVE_MANUAL_REFRESH") };
}
