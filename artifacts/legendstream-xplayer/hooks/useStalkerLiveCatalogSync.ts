import { useCallback, useEffect, useRef, useState } from "react";
import { getCatalogCounts, initCatalogCache } from "@/lib/catalogCache";
import type { ProviderConfig } from "@/context/PlayerContext";

type State = {
  totalCount: number | null;
  countKnown: boolean;
  syncing: boolean;
};

export function useStalkerLiveCatalogSync(provider: ProviderConfig | null) {
  const generationRef = useRef(0);
  const [state, setState] = useState<State>({ totalCount: null, countKnown: false, syncing: false });

  const readCount = useCallback(async (expectedProviderId: string, generation: number) => {
    const counts = await getCatalogCounts(expectedProviderId);
    if (generationRef.current !== generation || provider?.id !== expectedProviderId) return;
    setState({ totalCount: counts.live, countKnown: true, syncing: false });
  }, [provider?.id]);

  useEffect(() => {
    const generation = ++generationRef.current;
    if (!provider || provider.type !== "stalker") {
      setState({ totalCount: null, countKnown: false, syncing: false });
      return;
    }
    void (async () => {
      await initCatalogCache();
      await readCount(provider.id, generation);
    })().catch(() => undefined);
    return () => {
      generationRef.current += 1;
    };
  }, [provider?.id, provider?.type, readCount]);

  // PagedLiveCatalog owns the actual p=1 / next-page network lifecycle. Its
  // refresh callback reloads the lazy page after this lightweight count read.
  const refresh = useCallback(async () => {
    if (!provider || provider.type !== "stalker") return;
    const generation = ++generationRef.current;
    setState((current) => ({ ...current, syncing: true }));
    try {
      await readCount(provider.id, generation);
    } finally {
      if (generationRef.current === generation) {
        setState((current) => ({ ...current, syncing: false }));
      }
    }
  }, [provider, readCount]);

  return { ...state, refresh };
}
