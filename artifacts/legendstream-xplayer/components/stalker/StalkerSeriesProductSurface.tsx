import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  GoldenSeriesCatalog,
  type CatalogSortMode,
  type GoldenSeriesDetailModel,
} from "@/components/catalog/PagedCatalogViews";
import { useI18n } from "@/context/I18nContext";
import { redactSensitiveText } from "@/lib/safeLog";
import {
  isCurrentStalkerProductSession,
  readCurrentStalkerProductSession,
  type StalkerProductProviderIdentity,
} from "@/lib/stalkerProductSession";
import {
  buildStalkerSeriesPlayableIntent,
  createStalkerSeriesProductController,
  findStalkerSeriesGlobalCategory,
  mergeStalkerSeriesItems,
  searchStalkerSeriesCatalog,
  sortStalkerSeriesItems,
  stalkerSeriesEpisodeIdentity,
  stalkerSeriesEpisodeIdentityKey,
  StalkerSeriesPlaybackOwnership,
  type StalkerSeriesPlayableIntent,
  type StalkerSeriesProductCategory,
  type StalkerSeriesProductDetail,
  type StalkerSeriesProductItem,
} from "@/lib/stalkerSeriesProduct";
import { writeStalkerProductCount } from "@/lib/stalkerProductCounts";
import { writeStalkerSeriesHomePreview } from "@/lib/stalkerHomeSummary";

const visibleError = (caught: unknown, fallback: string) =>
  redactSensitiveText(caught instanceof Error ? caught.message : fallback);

export function StalkerSeriesProductSurface({
  provider,
  onPlayable,
  onDrawerVisibilityChange = () => undefined,
}: {
  provider: StalkerProductProviderIdentity;
  onPlayable?: (intent: StalkerSeriesPlayableIntent) => void;
  onDrawerVisibilityChange?: (visible: boolean) => void;
}) {
  const { t } = useI18n();
  const current = useMemo(
    () => readCurrentStalkerProductSession(provider),
    [provider.id, provider.url, provider.playlistUrl, provider.mac],
  );
  const session = current.session;
  const providerScopeId = current.providerScopeId;
  const controller = useMemo(
    () => createStalkerSeriesProductController(session, provider.id),
    [provider.id, session],
  );
  const ownership = useMemo(() => new StalkerSeriesPlaybackOwnership(providerScopeId), [providerScopeId]);

  const [screen, setScreen] = useState<"categories" | "list" | "search" | "detail">("categories");
  const [sortMode, setSortMode] = useState<CatalogSortMode>("default");
  const [categories, setCategories] = useState<StalkerSeriesProductCategory[]>([]);
  const [items, setItems] = useState<StalkerSeriesProductItem[]>([]);
  const [detail, setDetail] = useState<StalkerSeriesProductDetail | null>(null);
  const [selectedSeriesItem, setSelectedSeriesItem] = useState<StalkerSeriesProductItem | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState<number | undefined>(undefined);
  const [maxPageItems, setMaxPageItems] = useState<number | undefined>(undefined);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagingError, setPagingError] = useState<string | null>(null);
  const [failedPage, setFailedPage] = useState<number | null>(null);
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<StalkerSeriesProductItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchReturnScreen, setSearchReturnScreen] = useState<"categories" | "list">("categories");

  const requestSequence = useRef(0);
  const requestAbort = useRef<AbortController | null>(null);
  const searchSequence = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);
  const pageInFlight = useRef<string | null>(null);
  const initialCategoryOpenedRef = useRef(false);

  const selectedCategory = categories.find((item) => item.id === selectedCategoryId) ?? null;
  const visibleItems = screen === "search" ? searchResults : items;
  const sortedVisibleItems = useMemo(
    () => sortStalkerSeriesItems(visibleItems, sortMode === "added" ? "default" : sortMode),
    [sortMode, visibleItems],
  );
  const globalCategory = useMemo(() => findStalkerSeriesGlobalCategory(categories), [categories]);
  const goldenCategories = useMemo(() => categories.map((category) => ({
    id: category.id,
    name: category.id === globalCategory?.id ? t("all") : category.title,
  })), [categories, globalCategory?.id, t]);
  const goldenDetail = useMemo<GoldenSeriesDetailModel | null>(() => {
    if (detail) return {
      id: `${providerScopeId}:${detail.seriesId}`,
      title: detail.title,
      seasons: detail.seasons.map((season) => ({
        id: season.id,
        label: season.label,
        episodes: season.episodes.map((episode) => ({
          id: episode.id,
          title: episode.label,
          seasonId: season.id,
        })),
      })),
    };
    if (screen === "detail" && selectedSeriesItem) return { id: `${providerScopeId}:${selectedSeriesItem.id}`, title: selectedSeriesItem.title, seasons: [] };
    return null;
  }, [detail, providerScopeId, screen, selectedSeriesItem]);

  const beginRequest = () => {
    requestAbort.current?.abort();
    const abort = new AbortController();
    requestAbort.current = abort;
    return { abort, sequence: ++requestSequence.current };
  };
  const currentRequest = (sequence: number) =>
    requestSequence.current === sequence && isCurrentStalkerProductSession(provider, session);

  const resetPaging = () => {
    pageInFlight.current = null;
    setCurrentPage(1);
    setTotalItems(undefined);
    setMaxPageItems(undefined);
    setHasNextPage(false);
    setPagingError(null);
    setFailedPage(null);
    setLoadingMore(false);
  };

  const loadCategories = async () => {
    const request = beginRequest();
    ownership.invalidate();
    setLoading(true);
    setError(null);
    setPlaybackError(null);
    try {
      const next = await controller.loadCategories(request.abort.signal);
      if (!currentRequest(request.sequence)) return;
      setCategories(next);
      setItems([]);
      setDetail(null);
      setSelectedSeriesItem(null);
      setSelectedCategoryId(null);
      resetPaging();
      setScreen("categories");
    } catch (caught) {
      if (!currentRequest(request.sequence)) return;
      setError(visibleError(caught, "Dizi kategorileri yüklenemedi."));
    } finally {
      if (currentRequest(request.sequence)) setLoading(false);
    }
  };

  const loadPage = async (category: StalkerSeriesProductCategory, page: number, append = false) => {
    const key = `${providerScopeId}:${category.id}:${page}`;
    if (pageInFlight.current === key) return;
    pageInFlight.current = key;
    const request = beginRequest();
    if (!append) ownership.invalidate();
    setSelectedCategoryId(category.id);
    setScreen("list");
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    setPagingError(null);
    setFailedPage(null);
    setPlaybackError(null);
    if (!append) {
      setDetail(null);
      setSelectedSeriesItem(null);
    }
    try {
      const result = await controller.loadPage(category, page, request.abort.signal);
      if (!currentRequest(request.sequence) || selectedCategoryId && selectedCategoryId !== category.id && append) return;
      setItems((previous) => append ? mergeStalkerSeriesItems(previous, result.items) : result.items);
      setCurrentPage(Math.max(page, result.currentPage));
      setTotalItems(result.totalItems);
      setMaxPageItems(result.maxPageItems);
      setHasNextPage(result.hasNextPage);
      if (page === 1 && globalCategory?.id === category.id && result.totalItems != null) {
        void writeStalkerProductCount(provider.id, "series", result.totalItems).catch(() => undefined);
      }
      const previewCategory = categories[0];
      if (page === 1 && (globalCategory?.id === category.id || previewCategory?.id === category.id)) {
        void writeStalkerSeriesHomePreview(provider.id, result.items).catch(() => undefined);
      }
    } catch (caught) {
      if (!currentRequest(request.sequence)) return;
      if (append) {
        setPagingError(visibleError(caught, "Sonraki dizi sayfası yüklenemedi."));
        setFailedPage(page);
      } else {
        setError(visibleError(caught, "Diziler yüklenemedi."));
      }
    } finally {
      if (pageInFlight.current === key) pageInFlight.current = null;
      if (currentRequest(request.sequence)) {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    }
  };

  const selectCategoryById = (id: string) => {
    const category = categories.find((item) => item.id === id);
    if (!category) return;
    searchAbort.current?.abort();
    requestAbort.current?.abort();
    requestSequence.current += 1;
    setSearchQuery("");
    setSearchResults([]);
    setItems([]);
    setDetail(null);
    setSelectedSeriesItem(null);
    resetPaging();
    void loadPage(category, 1, false);
  };

  useEffect(() => {
    if (categories.length && screen === "categories" && !selectedCategoryId && !initialCategoryOpenedRef.current) {
      initialCategoryOpenedRef.current = true;
      selectCategoryById(categories[0]!.id);
    }
  }, [categories, screen, selectedCategoryId]);

  const loadDetail = async (item: StalkerSeriesProductItem) => {
    const request = beginRequest();
    ownership.invalidate();
    setScreen("detail");
    setLoading(true);
    setError(null);
    setPlaybackError(null);
    setDetail(null);
    setSelectedSeriesItem(item);
    try {
      const next = await controller.loadDetail(item, request.abort.signal);
      if (!currentRequest(request.sequence)) return;
      setDetail(next);
    } catch (caught) {
      if (!currentRequest(request.sequence)) return;
      setError(visibleError(caught, "Dizi detayı yüklenemedi."));
    } finally {
      if (currentRequest(request.sequence)) setLoading(false);
    }
  };

  const playEpisode = async (seasonId: string, episodeId: string) => {
    if (!detail) return;
    const emitPlayable = onPlayable;
    if (!emitPlayable) {
      setPlaybackError("Üst seviye oynatıcı sahibi kullanılamıyor.");
      return;
    }
    const episodeKey = stalkerSeriesEpisodeIdentityKey(
      stalkerSeriesEpisodeIdentity(provider.id, detail.seriesId, seasonId, episodeId),
    );
    const ticket = ownership.begin(episodeKey);
    const request = beginRequest();
    setPlaybackLoading(true);
    setPlaybackError(null);
    try {
      const source = await controller.resolveEpisode(detail.seriesId, seasonId, episodeId, request.abort.signal);
      if (!currentRequest(request.sequence) || !ownership.isCurrent(ticket)) return;
      emitPlayable(buildStalkerSeriesPlayableIntent(provider.id, detail, seasonId, episodeId, source));
    } catch (caught) {
      if (!currentRequest(request.sequence) || !ownership.isCurrent(ticket)) return;
      setPlaybackError(visibleError(caught, "Bölüm oynatma bağlantısı alınamadı."));
    } finally {
      if (currentRequest(request.sequence) && ownership.isCurrent(ticket)) setPlaybackLoading(false);
    }
  };

  useEffect(() => {
    initialCategoryOpenedRef.current = false;
    void loadCategories();
    return () => {
      requestAbort.current?.abort();
      searchAbort.current?.abort();
      requestSequence.current += 1;
      searchSequence.current += 1;
      ownership.invalidate();
      controller.clear();
    };
  }, [controller, session]);

  useEffect(() => {
    const query = searchQuery.trim();
    searchAbort.current?.abort();
    const sequence = ++searchSequence.current;
    if (!query) {
      setSearchLoading(false);
      setSearchError(null);
      setSearchResults([]);
      if (screen === "search") setScreen(searchReturnScreen);
      return;
    }
    if (!categories.length) return;
    const timer = setTimeout(() => {
      const abort = new AbortController();
      searchAbort.current = abort;
      setScreen("search");
      setSearchLoading(true);
      setSearchError(null);
      void searchStalkerSeriesCatalog(controller, categories, query, abort.signal)
        .then((results) => {
          if (searchSequence.current !== sequence || abort.signal.aborted || !isCurrentStalkerProductSession(provider, session)) return;
          setSearchResults(results);
        })
        .catch((caught) => {
          if (searchSequence.current !== sequence || abort.signal.aborted || !isCurrentStalkerProductSession(provider, session)) return;
          setSearchError(visibleError(caught, "Dizi araması tamamlanamadı."));
          setSearchResults([]);
        })
        .finally(() => {
          if (searchSequence.current === sequence && !abort.signal.aborted && isCurrentStalkerProductSession(provider, session)) setSearchLoading(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [categories, controller, provider, searchQuery, searchReturnScreen, screen, session]);

  const retry = () => {
    if (screen === "categories") void loadCategories();
    else if (screen === "search") {
      const value = searchQuery;
      setSearchQuery("");
      setTimeout(() => setSearchQuery(value), 0);
    } else if (screen === "list" && selectedCategory) void loadPage(selectedCategory, 1, false);
    else if (screen === "detail" && selectedSeriesItem) void loadDetail(selectedSeriesItem);
  };

  return <GoldenSeriesCatalog
    categories={goldenCategories}
    selectedCategory={selectedCategoryId ?? goldenCategories[0]?.id ?? ""}
    onSelectCategory={selectCategoryById}
    search={searchQuery}
    onSearch={(value) => {
      if (!searchQuery.trim() && value.trim()) setSearchReturnScreen(screen === "list" ? "list" : "categories");
      setSearchQuery(value);
    }}
    sortMode={sortMode === "added" ? "default" : sortMode}
    supportsAdded={false}
    onSort={setSortMode}
    refreshing={loading || searchLoading}
    onRefresh={() => void loadCategories()}
    items={sortedVisibleItems.map((item) => ({ id: item.id, title: item.title, image: item.posterUrl }))}
    totalCount={screen === "search" ? searchResults.length : totalItems ?? null}
    countKnown={screen === "search" || totalItems != null}
    loadingInitial={(loading || searchLoading) && visibleItems.length === 0 && screen !== "detail"}
    loadingMore={loadingMore}
    onLoadMore={() => { if (screen === "list" && selectedCategory && hasNextPage && !loadingMore && !pagingError) void loadPage(selectedCategory, currentPage + 1, true); }}
    detail={goldenDetail}
    detailLoading={screen === "detail" && loading}
    error={playbackError || searchError || error}
    onRetry={retry}
    footerError={pagingError}
    onRetryMore={selectedCategory && failedPage != null
      ? () => void loadPage(selectedCategory, failedPage, true)
      : undefined}
    onOpen={(id) => { const item = visibleItems.find((candidate) => candidate.id === id); if (item) void loadDetail(item); }}
    onBack={() => {
      requestAbort.current?.abort();
      requestSequence.current += 1;
      ownership.invalidate();
      setPlaybackLoading(false);
      setPlaybackError(null);
      setError(null);
      setDetail(null);
      setSelectedSeriesItem(null);
      setScreen(searchQuery.trim() ? "search" : selectedCategory ? "list" : "categories");
    }}
    onEpisode={(seasonId, episodeId) => {
      void playEpisode(seasonId, episodeId);
    }}
    onDrawerVisibilityChange={onDrawerVisibilityChange}
    activeCategoryLabel={selectedCategory && selectedCategory.id !== globalCategory?.id ? selectedCategory.title : undefined}
  />;
}
