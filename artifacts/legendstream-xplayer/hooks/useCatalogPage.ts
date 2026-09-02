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
  type CatalogPageItems,
} from "@/lib/catalogPageRepository";
import type { CatalogRuntimeProvider } from "@/lib/catalogRuntime";

type ItemForKind<K extends CatalogPageKind> = CatalogPageItems[K] extends Array<infer T> ? T : never;

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
  const flightGuardRef = useRef(new CatalogPageFlightGuard());
  const generationRef = useRef(0);
  const pendingCommitRef = useRef<{
    startedAt: number;
    request: Pick<CatalogPageRequest, "providerType" | "kind" | "limit">;
    rowsReturned: number;
    hasMore: boolean;
  } | null>(null);

  const baseRequest = useMemo<CatalogPageRequest | null>(() => {
    if (!provider || !providerType) return null;
    return {
      providerId: provider.id,
      providerType,
      kind,
      categoryId,
      search,
      sort,
      limit: 100,
    };
  }, [provider?.id, providerType, kind, categoryId, search, sort]);

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

  const loadPage = useCallback(async (
    cursor: string | null,
    mode: "initial" | "more",
    generation: number,
  ) => {
    if (!provider || !baseRequest || !queryKey || !enabled) return;
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
      const result = await getCachedCatalogPage(provider, request);
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
        const mergedItems = mode === "more"
          ? mergeCatalogPageItems(
              current.items,
              result.items,
              (item) => itemKey(kind, item),
            )
          : result.items;
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
  }, [provider, baseRequest, queryKey, enabled, kind, snapshotCount?.totalCount, snapshotCount?.countKnown]);

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
      loadingInitial: Boolean(enabled && provider && baseRequest),
      queryKey,
    });
    if (enabled && provider && baseRequest && queryKey) {
      void loadPage(null, "initial", generation);
    }
  }, [queryKey, enabled, provider?.id]);

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
      !enabled ||
      !state.hasMore ||
      state.loadingInitial ||
      state.loadingMore ||
      !state.nextCursor
    ) {
      return;
    }
    void loadPage(state.nextCursor, "more", generationRef.current);
  }, [enabled, state.hasMore, state.loadingInitial, state.loadingMore, state.nextCursor, loadPage]);

  const reload = useCallback(() => {
    if (!enabled || !provider || !baseRequest || !queryKey) return;
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
  }, [enabled, provider, baseRequest, queryKey, resolvedSnapshotTotal, loadPage]);

  return {
    ...state,
    loadMore,
    reload,
  };
}