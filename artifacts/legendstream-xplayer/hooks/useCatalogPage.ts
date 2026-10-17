import { refreshCatalogWindow } from "@/lib/catalogRefreshWindow";
import { beginPerformanceMeasurement, finishPerformanceMeasurement } from "@/lib/performanceDiagnostics";
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
import { getStalkerLazyLivePage } from "@/lib/stalkerLazyLivePageRepository";
import {
  readStalkerLivePublishRevision,
  subscribeStalkerLivePublishRevision,
} from "@/lib/stalkerLivePublishRevision";
import type { CatalogRuntimeProvider } from "@/lib/catalogRuntime";
import { isStalkerLiveGlobalCategoryId } from "@/lib/stalkerLiveCategoryIntent";

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
  catalogRevision?: number;
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
  catalogRevision = 0,
}: UseCatalogPageInput<K>) {
  const [state, setState] = useState<CatalogPageState<ItemForKind<K>>>(() => emptyState());
  const currentState = useRef(state);
  currentState.current = state;
  const [stalkerLivePublishRevision, setStalkerLivePublishRevision] = useState(0);
  const flightGuardRef = useRef(new CatalogPageFlightGuard());
  const generationRef = useRef(0);
  const stalkerRequestRef = useRef<AbortController | null>(null);
  const observedStalkerLivePublishRevisionRef = useRef(0);
  const observedCatalogRevisionRef = useRef(catalogRevision);
  const activeQueryKeyRef = useRef<string | null>(null);
  const pendingCommitRef = useRef<{
    startedAt: number;
    request: Pick<CatalogPageRequest, "providerType" | "kind" | "limit">;
    rowsReturned: number;
    measurement: number | null;
    hasMore: boolean;
  } | null>(null);
  const stalkerLive = provider?.type === "stalker" && kind === "live";
  const effectiveProviderType: CatalogPageProviderType | null = stalkerLive ? "stalker" : providerType;
  const effectiveEnabled = enabled;

  const baseRequest = useMemo<CatalogPageRequest | null>(() => {
    if (!provider || !effectiveProviderType) return null;
    const normalizedSearch = search?.trim() ?? "";
    const effectiveCategoryId = stalkerLive
      && normalizedSearch
      && isStalkerLiveGlobalCategoryId(categoryId)
      ? undefined
      : categoryId;
    return {
      providerId: provider.id,
      providerType: effectiveProviderType,
      kind,
      categoryId: effectiveCategoryId,
      search,
      sort,
      limit: 100,
    };
  }, [provider?.id, effectiveProviderType, kind, categoryId, search, sort, stalkerLive]);

  const queryKey = useMemo(
    () => baseRequest ? catalogPageQueryKey(baseRequest) : null,
    [baseRequest],
  );
  activeQueryKeyRef.current = effectiveEnabled ? queryKey : null;

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
    mode: "initial" | "more" | "refresh",
    generation: number,
  ) => {
    if (!provider || !baseRequest || !queryKey || !effectiveEnabled) return;
    const requestQueryKey = queryKey;
    if (activeQueryKeyRef.current !== requestQueryKey) return;
    const request: CatalogPageRequest & { kind: K } = {
      ...baseRequest,
      kind,
      cursor: cursor ?? undefined,
    };
    const flightKey = `${queryKey}|${cursor ?? "first"}`;
    if (!flightGuardRef.current.tryStart(flightKey)) return;

    const measurement = mode === "initial" ? beginPerformanceMeasurement("FIRST_CONTENT", provider.type === "xtream" || provider.type === "m3u" || provider.type === "stalker" ? provider.type : "unknown") : null;
    let stalkerController: AbortController | null = null;
    if (stalkerLive) {
      if (mode !== "more") stalkerRequestRef.current?.abort();
      stalkerController = new AbortController();
      stalkerRequestRef.current = stalkerController;
    }

    setState((current) => ({
      ...current,
      loadingInitial: mode === "initial" ? current.items.length === 0 : current.loadingInitial,
      loadingMore: mode !== "initial" ? true : current.loadingMore,
    }));

    try {
      const stalkerPersistedSearch = stalkerLive && Boolean(request.search?.trim());
      const read = (cursor: string | null) => {
        const request: CatalogPageRequest & { kind: K } = { ...baseRequest, kind, cursor: cursor ?? undefined };
        return stalkerLive && !stalkerPersistedSearch
          ? getStalkerLazyLivePage({ provider, categoryId: request.categoryId, cursor: request.cursor, signal: stalkerController?.signal })
          : getCachedCatalogPage(provider, request);
      };
      const result = mode === "refresh"
        ? await refreshCatalogWindow<unknown, { items: unknown[]; totalCount: number | null; countKnown: boolean; nextCursor: string | null; hasMore: boolean }>({ loadedRows: currentState.current.items.length, load: read, isCurrent: () => generationRef.current === generation && activeQueryKeyRef.current === requestQueryKey && !stalkerController?.signal.aborted })
        : await read(cursor);
      if (!result) return;
      if (
        generationRef.current !== generation ||
        stalkerController?.signal.aborted ||
        activeQueryKeyRef.current !== requestQueryKey
      ) return;
      pendingCommitRef.current = {
        startedAt: Date.now(),
        request,
        rowsReturned: result.items.length,
        measurement,
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
    } catch {
      finishPerformanceMeasurement(measurement, "ERROR");
      if (generationRef.current !== generation || stalkerController?.signal.aborted) return;
      setState((current) => ({
        ...current,
        loadingInitial: false,
        loadingMore: false,
        hasMore: mode === "refresh" ? current.hasMore : false,
      }));
    } finally {
      if (generationRef.current !== generation || stalkerController?.signal.aborted) finishPerformanceMeasurement(measurement, "CANCELLED");
      flightGuardRef.current.finish(flightKey);
      if (stalkerController && stalkerRequestRef.current === stalkerController) {
        stalkerRequestRef.current = null;
      }
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
    finishPerformanceMeasurement(pending.measurement);
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
    stalkerRequestRef.current?.abort();
    stalkerRequestRef.current = null;
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
    return () => {
      if (generationRef.current === generation) {
        stalkerRequestRef.current?.abort();
        stalkerRequestRef.current = null;
      }
    };
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
      !queryKey ||
      state.queryKey !== queryKey ||
      activeQueryKeyRef.current !== queryKey ||
      !state.hasMore ||
      state.loadingInitial ||
      state.loadingMore ||
      !state.nextCursor
    ) {
      return;
    }
    void loadPage(state.nextCursor, "more", generationRef.current);
  }, [effectiveEnabled, queryKey, state.queryKey, state.hasMore, state.loadingInitial, state.loadingMore, state.nextCursor, loadPage]);

  const reload = useCallback(() => {
    if (!effectiveEnabled || !provider || !baseRequest || !queryKey || activeQueryKeyRef.current !== queryKey) return;
    generationRef.current += 1;
    const generation = generationRef.current;
    stalkerRequestRef.current?.abort();
    stalkerRequestRef.current = null;
    flightGuardRef.current.clear();
    setState(current => current.queryKey === queryKey ? { ...current, loadingInitial: current.items.length === 0, loadingMore: current.items.length > 0 } : { ...emptyState<ItemForKind<K>>(), totalCount: resolvedSnapshotTotal, countKnown: resolvedSnapshotTotal !== null, loadingInitial: true, queryKey });
    void loadPage(null, "refresh", generation);
  }, [effectiveEnabled, provider, baseRequest, queryKey, resolvedSnapshotTotal, loadPage]);

  useEffect(() => {
    observedCatalogRevisionRef.current = catalogRevision;
  }, [provider?.id]);

  useEffect(() => {
    if (
      !provider || stalkerLive ||
      catalogRevision <= 0 ||
      catalogRevision <= observedCatalogRevisionRef.current
    ) return;
    observedCatalogRevisionRef.current = catalogRevision;
    reload();
  }, [provider?.id, provider?.type, catalogRevision, reload]);

  useEffect(() => {
    if (!stalkerLive || stalkerLivePublishRevision <= 0) return;
    if (observedStalkerLivePublishRevisionRef.current === stalkerLivePublishRevision) return;
    observedStalkerLivePublishRevisionRef.current = stalkerLivePublishRevision;
    reload();
  }, [stalkerLive, stalkerLivePublishRevision, reload]);

  useEffect(() => () => {
    stalkerRequestRef.current?.abort();
    stalkerRequestRef.current = null;
  }, []);

  return {
    ...state,
    loadMore,
    reload,
  };
}
