import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { NativeVideoPlayer } from "@/components/NativeVideoPlayer";
import { StalkerCategoryPager } from "@/components/stalker/StalkerCategoryPager";
import { StalkerSeriesProductCatalog, type StalkerSeriesProductScreen } from "@/components/stalker/StalkerSeriesProductCatalog";
import { redactSensitiveText } from "@/lib/safeLog";
import { isCurrentStalkerProductSession, readCurrentStalkerProductSession } from "@/lib/stalkerProductSession";
import {
  buildStalkerSeriesPlayerHandoff,
  createStalkerSeriesProductController,
  firstStalkerSeriesSeasonId,
  mergeStalkerSeriesItems,
  searchStalkerSeriesCatalog,
  stalkerSeriesEpisodeIdentity,
  StalkerSeriesPlaybackOwnership,
  type StalkerSeriesPlayerHandoff,
  type StalkerSeriesProductCategory,
  type StalkerSeriesProductDetail,
  type StalkerSeriesProductItem,
} from "@/lib/stalkerSeriesProduct";

const visibleError = (caught: unknown, fallback: string) =>
  redactSensitiveText(caught instanceof Error ? caught.message : fallback);

export function StalkerSeriesProductSurface() {
  const current = readCurrentStalkerProductSession();
  const session = current?.session ?? null;
  const providerScopeId = current?.providerScopeId ?? "stalker-session-unavailable";
  const controller = useMemo(
    () => session ? createStalkerSeriesProductController(session, providerScopeId) : null,
    [providerScopeId, session],
  );
  const ownership = useMemo(() => new StalkerSeriesPlaybackOwnership(providerScopeId), [providerScopeId]);

  const [screen, setScreen] = useState<StalkerSeriesProductScreen>("categories");
  const [categories, setCategories] = useState<StalkerSeriesProductCategory[]>([]);
  const [items, setItems] = useState<StalkerSeriesProductItem[]>([]);
  const [detail, setDetail] = useState<StalkerSeriesProductDetail | null>(null);
  const [selectedSeriesItem, setSelectedSeriesItem] = useState<StalkerSeriesProductItem | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
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
  const [player, setPlayer] = useState<StalkerSeriesPlayerHandoff | null>(null);
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

  const beginRequest = () => {
    requestAbort.current?.abort();
    const abort = new AbortController();
    requestAbort.current = abort;
    return { abort, sequence: ++requestSequence.current };
  };
  const currentRequest = (sequence: number) =>
    requestSequence.current === sequence && Boolean(session && isCurrentStalkerProductSession(session));

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
    if (!controller || !session) {
      setError("Stalker oturumu kullanılamıyor.");
      return;
    }
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
      setSelectedSeasonId(null);
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
    if (!controller || !session) return;
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
      setSelectedSeasonId(null);
    }
    try {
      const result = await controller.loadPage(category, page, request.abort.signal);
      if (!currentRequest(request.sequence) || selectedCategoryId && selectedCategoryId !== category.id && append) return;
      setItems((previous) => append ? mergeStalkerSeriesItems(previous, result.items) : result.items);
      setCurrentPage(Math.max(page, result.currentPage));
      setTotalItems(result.totalItems);
      setMaxPageItems(result.maxPageItems);
      setHasNextPage(result.hasNextPage);
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
    setSelectedSeasonId(null);
    resetPaging();
    void loadPage(category, 1, false);
  };

  useEffect(() => {
    if (
      categories.length
      && screen === "categories"
      && !selectedCategoryId
      && !initialCategoryOpenedRef.current
    ) {
      initialCategoryOpenedRef.current = true;
      selectCategoryById(categories[0]!.id);
    }
  }, [categories, screen, selectedCategoryId]);

  const loadDetail = async (item: StalkerSeriesProductItem) => {
    if (!controller || !session) return;
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
      setSelectedSeasonId(firstStalkerSeriesSeasonId(next.seasons));
    } catch (caught) {
      if (!currentRequest(request.sequence)) return;
      setError(visibleError(caught, "Dizi detayı yüklenemedi."));
    } finally {
      if (currentRequest(request.sequence)) setLoading(false);
    }
  };

  const playEpisode = async (seasonId: string, episodeId: string) => {
    if (!controller || !session || !detail) return;
    const episodeKey = stalkerSeriesEpisodeIdentity(providerScopeId, detail.seriesId, seasonId, episodeId);
    const ticket = ownership.begin(episodeKey);
    const request = beginRequest();
    setPlaybackLoading(true);
    setPlaybackError(null);
    try {
      const source = await controller.resolveEpisode(detail.seriesId, seasonId, episodeId, request.abort.signal);
      if (!currentRequest(request.sequence) || !ownership.isCurrent(ticket)) return;
      setPlayer(buildStalkerSeriesPlayerHandoff(detail, seasonId, episodeId, source));
    } catch (caught) {
      if (!currentRequest(request.sequence) || !ownership.isCurrent(ticket)) return;
      setPlaybackError(visibleError(caught, "Bölüm oynatma bağlantısı alınamadı."));
    } finally {
      if (currentRequest(request.sequence) && ownership.isCurrent(ticket)) setPlaybackLoading(false);
    }
  };

  useEffect(() => {
    void loadCategories();
    return () => {
      requestAbort.current?.abort();
      searchAbort.current?.abort();
      requestSequence.current += 1;
      searchSequence.current += 1;
      ownership.invalidate();
      controller?.clear();
    };
    // Controller and session are stable for this mounted product session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!controller || !categories.length) return;
    const timer = setTimeout(() => {
      const abort = new AbortController();
      searchAbort.current = abort;
      setScreen("search");
      setSearchLoading(true);
      setSearchError(null);
      void searchStalkerSeriesCatalog(controller, categories, query, abort.signal)
        .then((results) => {
          if (searchSequence.current !== sequence || abort.signal.aborted) return;
          setSearchResults(results);
        })
        .catch((caught) => {
          if (searchSequence.current !== sequence || abort.signal.aborted) return;
          setSearchError(visibleError(caught, "Dizi araması tamamlanamadı."));
          setSearchResults([]);
        })
        .finally(() => {
          if (searchSequence.current === sequence && !abort.signal.aborted) setSearchLoading(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [categories, controller, searchQuery, searchReturnScreen, screen]);

  if (player) {
    return <View style={{ flex: 1, minHeight: 420 }}>
      <NativeVideoPlayer
        source={player.source}
        title={player.title}
        subtitle={player.subtitle}
        mediaKind={player.mediaKind}
        autoFullscreen
        allowDownload={false}
        onFullscreenExit={() => setPlayer(null)}
      />
    </View>;
  }

  return <StalkerCategoryPager
    categories={categories}
    activeId={selectedCategoryId}
    disabled={screen !== "list" || searchQuery.trim().length > 0}
    showControls={screen === "list"}
    onSelect={selectCategoryById}
  >
    <StalkerSeriesProductCatalog
      screen={screen}
      categories={categories}
      items={visibleItems}
      detail={detail}
      selectedCategoryId={selectedCategoryId}
      selectedCategoryTitle={selectedCategory?.title}
      selectedSeasonId={selectedSeasonId}
      currentPage={currentPage}
      totalItems={totalItems}
      maxPageItems={maxPageItems}
      hasNextPage={hasNextPage}
      loading={loading}
      loadingMore={loadingMore}
      error={error}
      pagingError={pagingError}
      playbackLoading={playbackLoading}
      playbackError={playbackError}
      searchQuery={searchQuery}
      searchLoading={searchLoading}
      searchError={searchError}
      onSearchQueryChange={(value) => {
        if (!searchQuery.trim() && value.trim()) setSearchReturnScreen(screen === "list" ? "list" : "categories");
        setSearchQuery(value);
      }}
      onRetry={() => {
        if (screen === "categories") void loadCategories();
        else if (screen === "search") {
          const value = searchQuery;
          setSearchQuery("");
          setTimeout(() => setSearchQuery(value), 0);
        } else if (screen === "list" && selectedCategory) void loadPage(selectedCategory, 1, false);
        else if (screen === "detail" && selectedSeriesItem) void loadDetail(selectedSeriesItem);
      }}
      onRetryNextPage={() => {
        if (selectedCategory && failedPage != null) void loadPage(selectedCategory, failedPage, true);
      }}
      onBack={() => {
        requestAbort.current?.abort();
        requestSequence.current += 1;
        ownership.invalidate();
        setPlaybackLoading(false);
        setPlaybackError(null);
        setError(null);
        if (screen === "detail") {
          setDetail(null);
          setSelectedSeriesItem(null);
          setScreen(searchQuery.trim() ? "search" : selectedCategory ? "list" : "categories");
        } else {
          setItems([]);
          setSelectedCategoryId(null);
          resetPaging();
          setScreen("categories");
        }
      }}
      onSelectCategory={selectCategoryById}
      onSelectSeries={(id) => {
        const item = visibleItems.find((candidate) => candidate.id === id);
        if (item) void loadDetail(item);
      }}
      onSelectSeason={setSelectedSeasonId}
      onSelectEpisode={(seasonId, episodeId) => void playEpisode(seasonId, episodeId)}
      onLoadMore={() => {
        if (selectedCategory && hasNextPage && !loadingMore && !pagingError) {
          void loadPage(selectedCategory, currentPage + 1, true);
        }
      }}
    />
  </StalkerCategoryPager>;
}
