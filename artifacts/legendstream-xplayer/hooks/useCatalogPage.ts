import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CatalogPageFlightGuard,
  catalogPageQueryKey,
  mergeCatalogPageItems,
  resolveCatalogTotalCount,
  resolveCatalogTotalCountUpdate,
  type CatalogPageKind,
  type CatalogPageProviderType,
  type CatalogPageRequest,
  type CatalogPageSort,
} from "@/lib/catalogPaging";
import {
  getCachedCatalogPage,
  noteCatalogPageCommit,
  type CatalogPageItem,
} from "@/lib/catalogPageRepository";
import { getCachedStalkerLivePage } from "@/lib/stalkerLivePageRepository";
import {
  readStalkerLivePublishRevision,
  subscribeStalkerLivePublishRevision,
} from "@/lib/stalkerLivePublishRevision";
import type { CatalogRuntimeProvider } from "@/lib/catalogRuntime";

type ItemForKind<K extends CatalogPageKind> = CatalogPageItem<K>;

export type CatalogPageState<T> = {
  items: T[];
  totalCount: number | null;
  countKnown: boolean;
  loadingInitial: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  nextCursor: string | null;
  queryKey: string | null;
};

type SnapshotCount = {
  totalCount: number | null;
  countKnown: boolean;
};

type UseCatalogPageInput<K extends CatalogPageKind> = {
  provider: CatalogRuntimeProvider | null;
  providerType: CatalogPageProviderType | null;
  kind: K;
  categoryId?: string;
  search?: string;
  sort: CatalogPageSort;
  enabled: boolean;
  snapshotCount?: SnapshotCount;
};

const emptyState = <T,>(): CatalogPageState<T> => ({
  items: [],
  totalCount: null,
  countKnown: false,
  loadingInitial: false,
  loadingMore: false,
  hasMore: true,
  nextCursor: null,
  queryKey: null,
});

function itemKey(kind: CatalogPageKind, item: unknown) {
  if (kind === "live") {
    const row = item as { id?: unknown };
    return String(row.id ?? "");
  }
  if (kind === "vod") {
    const row = item as { stream_id?: unknown };
    return String(row.stream_id ?? "");
  }
  const row = item as { series_id?: unknown };
  return String(row.series_id ?? "");
}

export function useCatalogPage<K extends CatalogPageKind>({
  provider,
  providerType,
  kind,
  categoryId,
  search,
  sort,
  enabled,
  snapshotCount,
}: UseCatalogPageInput<K>) {
  const [state, setState] = useState<CatalogPageState<ItemForKind<K>>>(() => emptyState());
  const [stalkerLivePublishRevision, setStalkerLivePublishRevision] = useState(0);
  const flightGuardRef = useRef(new CatalogPageFlightGuard());
  const generationRef = useRef(0);
  const observedStalkerLivePublishRevisionRef = useRef(0);
  const pendingCommitRef = useRef<{
    startedAt: number;
    request: Pick<CatalogPageRequest, "providerType" | "kind" | "limit">;
    rowsReturned: number;
    hasMore: boolean;
  } | null>(null);
  const stalkerLive = provider?.type === "stalker" && kind === "live";
  const effectiveProviderType: CatalogPageProviderType | null = stalkerLive ? "stalker" : providerType;
  const effectiveEnabled = stalkerLive ? true : enabled;

  const baseRequest = useMemo<CatalogPageRequest | null>(() => {
    if (!provider || !effectiveProviderType) return null;
    return {
      providerId: provider.id,
      providerType: effectiveProviderType,
      kind,
      categoryId,
      search,
      sort,
      limit: 100,
    };
  }, [provider?.id, effectiveProviderType, kind, categoryId, search, sort]);

  const queryKey = useMemo(
    () => baseRequest ? catalogPageQueryKey(baseRequest) : null,
    [baseRequest],
  );

  const resolvedSnapshotTotal = resolveCatalogTotalCount({
    persistedTotal: null,
    persistedCountKnown: false,
    snapshotTotal: snapshotCount?.totalCount ?? null,
    snapshotCountKnown: snapshotCount?.countKnown ?? false,
  });

  useEffect(() => {
    if (!stalkerLive || !provider?.id) {
      observedStalkerLivePublishRevisionRef.current = 0;
      setStalkerLivePublishRevision(0);
      return;
    }
    const currentRevision = readStalkerLivePublishRevision(provider.id, "live");
    observedStalkerLivePublishRevisionRef.current = currentRevision;
    setStalkerLivePublishRevision(currentRevision);
    return subscribeStalkerLivePublishRevision(
      provider.id,
      "live",
      setStalkerLivePublishRevision,
    );
  }, [stalkerLive, provider?.id]);

  const loadPage = useCallback(async (
    cursor: string | null,
    mode: "initial" | "more",
    generation: number,
  ) => {
    if (!provider || !baseRequest || !queryKey || !effectiveEnabled) return;
    const request: CatalogPageRequest & { kind: K } = {
      ...baseRequest,
      kind,
      cursor: cursor ?? undefined,
    };
    const flightKey = `${queryKey}|${cursor ?? "first"}`;
    if (!flightGuardRef.current.tryStart(flightKey)) return;

    setState((current) => ({
      ...current,
      loadingInitial: mode === "initial" ? current.items.length === 0 : current.loadingInitial,
      loadingMore: mode === "more" ? true : current.loadingMore,
    }));

    try {
      const result = stalkerLive
        ? await getCachedStalkerLivePage(
            provider,
            request as CatalogPageRequest & { kind: "live" },
          )
        : await getCachedCatalogPage(provider, request);
      if (generationRef.current !== generation) return;
      pendingCommitRef.current = {
        startedAt: Date.now(),
        request,
        rowsReturned: result.items.length,
        hasMore: result.hasMore,
      };
      setState((current) => {
        const totalCount = resolveCatalogTotalCountUpdate({
          currentTotal: current.totalCount,
          currentCountKnown: current.countKnown,
          persistedTotal: result.totalCount,
          persistedCountKnown: result.countKnown,
          snapshotTotal: snapshotCount?.totalCount ?? null,
          snapshotCountKnown: snapshotCount?.countKnown ?? false,
        });
        const countKnown = totalCount !== null;
        const incomingItems = result.items as ItemForKind<K>[];
        const mergedItems = mode === "more"
          ? mergeCatalogPageItems(
              current.items,
              incomingItems,
              (item) => itemKey(kind, item),
            )
          : incomingItems;
        const mergedHasMore = countKnown
          ? mergedItems.length < (totalCount ?? 0) && (result.hasMore || result.nextCursor !== null)
          : result.hasMore;
        return {
          items: mergedItems,
          totalCount,
          countKnown,
          loadingInitial: false,
          loadingMore: false,
          hasMore: mergedHasMore,
          nextCursor: mergedHasMore ? result.nextCursor : null,
          queryKey,
        };
      });
    } finally {
      flightGuardRef.current.finish(flightKey);
      if (generationRef.current === generation) {
        setState((current) => ({
          ...current,
          loadingInitial: false,
          loadingMore: false,
        }));
      }
    }
  }, [provider, baseRequest, queryKey, effectiveEnabled, kind, stalkerLive, snapshotCount?.totalCount, snapshotCount?.countKnown]);

  useEffect(() => {
    const pending = pendingCommitRef.current;
    if (!pending) return;
    pendingCommitRef.current = null;
    noteCatalogPageCommit(
      pending.request,
      pending.rowsReturned,
      pending.hasMore,
      Date.now() - pending.startedAt,
    );
  }, [state.items, state.loadingInitial, state.loadingMore]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    flightGuardRef.current.clear();
    setState({
      ...emptyState<ItemForKind<K>>(),
      totalCount: resolvedSnapshotTotal,
      countKnown: resolvedSnapshotTotal !== null,
      loadingInitial: Boolean(effectiveEnabled && provider && baseRequest),
      queryKey,
    });
    if (effectiveEnabled && provider && baseRequest && queryKey) {
      void loadPage(null, "initial", generation);
    }
  }, [queryKey, effectiveEnabled, provider?.id]);

  useEffect(() => {
    if (resolvedSnapshotTotal === null) return;
    setState((current) => {
      if (current.totalCount !== null && current.countKnown) return current;
      return {
        ...current,
        totalCount: resolvedSnapshotTotal,
        countKnown: true,
        hasMore: current.items.length < resolvedSnapshotTotal,
      };
    });
  }, [resolvedSnapshotTotal]);

  const loadMore = useCallback(() => {
    if (
      !effectiveEnabled ||
      !state.hasMore ||
      state.loadingInitial ||
      state.loadingMore ||
      !state.nextCursor
    ) {
      return;
    }
    void loadPage(state.nextCursor, "more", generationRef.current);
  }, [effectiveEnabled, state.hasMore, state.loadingInitial, state.loadingMore, state.nextCursor, loadPage]);

  const reload = useCallback(() => {
    if (!effectiveEnabled || !provider || !baseRequest || !queryKey) return;
    generationRef.current += 1;
    const generation = generationRef.current;
    flightGuardRef.current.clear();
    setState({
      ...emptyState<ItemForKind<K>>(),
      totalCount: resolvedSnapshotTotal,
      countKnown: resolvedSnapshotTotal !== null,
      loadingInitial: true,
      queryKey,
    });
    void loadPage(null, "initial", generation);
  }, [effectiveEnabled, provider, baseRequest, queryKey, resolvedSnapshotTotal, loadPage]);

  useEffect(() => {
    if (!stalkerLive || stalkerLivePublishRevision <= 0) return;
    if (observedStalkerLivePublishRevisionRef.current === stalkerLivePublishRevision) return;
    observedStalkerLivePublishRevisionRef.current = stalkerLivePublishRevision;
    reload();
  }, [stalkerLive, stalkerLivePublishRevision, reload]);

  return {
    ...state,
    loadMore,
    reload,
  };
}
