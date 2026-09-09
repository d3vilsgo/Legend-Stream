import { useCallback, useEffect, useRef, useState } from "react";
import { getCatalogCounts, initCatalogCache } from "@/lib/catalogCache";
import type { ProviderConfig } from "@/context/PlayerContext";
import { getOrCreateStalkerPortalSession } from "@/lib/stalkerPortalRuntime";
import { fetchStalkerLiveCategories } from "@/lib/stalkerLiveCatalog";
import {
  readRememberedStalkerLiveCategories,
  rememberStalkerLiveCategories,
} from "@/lib/stalkerCategoryCapability";
import { persistStalkerLiveCategories } from "@/lib/stalkerCategoryCache";

type State = {
  totalCount: number | null;
  countKnown: boolean;
  syncing: boolean;
  categoriesReady: boolean;
};

export function useStalkerLiveCatalogSync(provider: ProviderConfig | null) {
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>({
    totalCount: null,
    countKnown: false,
    syncing: false,
    categoriesReady: false,
  });

  const prepare = useCallback(async (expected: ProviderConfig, generation: number, controller: AbortController) => {
    await initCatalogCache();
    let categories = readRememberedStalkerLiveCategories(expected.id);
    if (categories.length === 0) {
      const portalUrl = expected.url || expected.playlistUrl;
      const mac = expected.mac?.trim() || "";
      if (portalUrl && mac) {
        const session = getOrCreateStalkerPortalSession({
          providerId: expected.id,
          portalUrl,
          mac,
          diagnostics: { providerId: expected.id },
        });
        categories = await fetchStalkerLiveCategories(
          session,
          controller.signal,
          { providerId: expected.id },
        );
        rememberStalkerLiveCategories(expected.id, categories);
      }
    }
    if (controller.signal.aborted || generationRef.current !== generation || provider?.id !== expected.id) return;
    await persistStalkerLiveCategories(expected.id, categories);
    if (controller.signal.aborted || generationRef.current !== generation || provider?.id !== expected.id) return;
    const counts = await getCatalogCounts(expected.id);
    if (controller.signal.aborted || generationRef.current !== generation || provider?.id !== expected.id) return;
    setState({ totalCount: counts.live, countKnown: true, syncing: false, categoriesReady: true });
  }, [provider?.id]);

  useEffect(() => {
    controllerRef.current?.abort();
    const generation = ++generationRef.current;
    if (!provider || provider.type !== "stalker") {
      setState({ totalCount: null, countKnown: false, syncing: false, categoriesReady: false });
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((current) => ({ ...current, categoriesReady: false, syncing: false }));
    void prepare(provider, generation, controller).catch(() => {
      if (!controller.signal.aborted && generationRef.current === generation) {
        setState((current) => ({ ...current, syncing: false, categoriesReady: true }));
      }
    });
    return () => {
      generationRef.current += 1;
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [provider?.id, provider?.type, prepare]);

  const refresh = useCallback(async () => {
    if (!provider || provider.type !== "stalker") return;
    controllerRef.current?.abort();
    const generation = ++generationRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((current) => ({ ...current, syncing: true }));
    try {
      const portalUrl = provider.url || provider.playlistUrl;
      const mac = provider.mac?.trim() || "";
      if (portalUrl && mac) {
        const session = getOrCreateStalkerPortalSession({
          providerId: provider.id,
          portalUrl,
          mac,
          diagnostics: { providerId: provider.id },
        });
        const categories = await fetchStalkerLiveCategories(
          session,
          controller.signal,
          { providerId: provider.id },
        );
        rememberStalkerLiveCategories(provider.id, categories);
        await persistStalkerLiveCategories(provider.id, categories);
      }
      if (controller.signal.aborted || generationRef.current !== generation) return;
      const counts = await getCatalogCounts(provider.id);
      if (controller.signal.aborted || generationRef.current !== generation) return;
      setState({ totalCount: counts.live, countKnown: true, syncing: false, categoriesReady: true });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (!controller.signal.aborted && generationRef.current === generation) {
        setState((current) => ({ ...current, syncing: false }));
      }
    }
  }, [provider]);

  return { ...state, refresh };
}
