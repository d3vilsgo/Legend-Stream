import { useEffect, useMemo, useRef, useState } from "react";
import { redactSensitiveText } from "@/lib/safeLog";
import {
  isCurrentStalkerProductSession,
  readCurrentStalkerProductSession,
  type StalkerProductProviderIdentity,
} from "@/lib/stalkerProductSession";
import {
  findStalkerVodGlobalCategory,
  isStalkerVodGlobalCategory,
  loadStalkerVodCategories,
  loadStalkerVodPage,
  mergeStalkerVodItems,
  resolveStalkerVodLink,
  searchStalkerVodCatalog,
  type StalkerVodCategory,
  type StalkerVodItem,
} from "@/lib/stalkerVod";
import { writeStalkerProductCount } from "@/lib/stalkerProductCounts";
import { writeStalkerMovieHomePreview } from "@/lib/stalkerHomeSummary";

export type StalkerMoviePlayable = {
  title: string;
  subtitle?: string;
  url: string;
  itemId: string;
  categoryId: string;
};

export function useStalkerMoviesCatalog({
  provider,
  moviesLabel,
  onPlayable,
}: {
  provider: StalkerProductProviderIdentity;
  moviesLabel: string;
  onPlayable: (playable: StalkerMoviePlayable) => void;
}) {
  const current = useMemo(
    () => readCurrentStalkerProductSession(provider),
    [provider.id, provider.mac, provider.playlistUrl, provider.url],
  );
  const session = current.session;
  const [categories, setCategories] = useState<StalkerVodCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [items, setItems] = useState<StalkerVodItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState<number | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<StalkerVodItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolvingItemId, setResolvingItemId] = useState<string | null>(null);
  const categoryAbortRef = useRef<AbortController | null>(null);
  const pageAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const playbackAbortRef = useRef<AbortController | null>(null);
  const categorySequenceRef = useRef(0);
  const pageSequenceRef = useRef(0);
  const searchSequenceRef = useRef(0);
  const searchWasActiveRef = useRef(false);
  const playbackSequenceRef = useRef(0);

  const sessionStillCurrent = () => isCurrentStalkerProductSession(provider, session);
  const safeError = (caught: unknown, fallback: string) =>
    redactSensitiveText(caught instanceof Error ? caught.message : fallback);

  const loadPage = async (category: StalkerVodCategory, page: number, append: boolean) => {
    pageAbortRef.current?.abort();
    const abort = new AbortController();
    pageAbortRef.current = abort;
    const sequence = ++pageSequenceRef.current;
    if (append) setLoadingMore(true);
    else {
      setLoadingInitial(true);
      setItems([]);
    }
    setError(null);
    try {
      const result = await loadStalkerVodPage(session, category, page, { signal: abort.signal });
      if (abort.signal.aborted || sequence !== pageSequenceRef.current || !sessionStillCurrent()) return;
      setItems((previous) => append ? mergeStalkerVodItems(previous, result.items) : result.items);
      setCurrentPage(Math.max(page, result.currentPage));
      setTotalItems(result.totalItems ?? null);
      setHasNextPage(result.hasNextPage);
      if (page === 1 && isStalkerVodGlobalCategory(category) && result.totalItems != null) {
        void writeStalkerProductCount(provider.id, "vod", result.totalItems).catch(() => undefined);
      }
      const previewCategory = categories[0] ?? category;
      if (page === 1 && (isStalkerVodGlobalCategory(category) || previewCategory.id === category.id)) {
        void writeStalkerMovieHomePreview(provider.id, result.items).catch(() => undefined);
      }
    } catch (caught) {
      if (abort.signal.aborted || sequence !== pageSequenceRef.current || !sessionStillCurrent()) return;
      setError(safeError(caught, "Filmler yüklenemedi."));
    } finally {
      if (sequence === pageSequenceRef.current) {
        setLoadingInitial(false);
        setLoadingMore(false);
      }
    }
  };

  const refresh = async () => {
    categoryAbortRef.current?.abort();
    pageAbortRef.current?.abort();
    searchAbortRef.current?.abort();
    const abort = new AbortController();
    categoryAbortRef.current = abort;
    const sequence = ++categorySequenceRef.current;
    setLoadingInitial(true);
    setError(null);
    setItems([]);
    setSearchResults([]);
    try {
      const next = await loadStalkerVodCategories(session, { signal: abort.signal });
      if (abort.signal.aborted || sequence !== categorySequenceRef.current || !sessionStillCurrent()) return;
      setCategories(next);
      const initial = findStalkerVodGlobalCategory(next) ?? next[0] ?? null;
      setSelectedCategoryId(initial?.id ?? null);
      if (initial) await loadPage(initial, 1, false);
      else setLoadingInitial(false);
    } catch (caught) {
      if (abort.signal.aborted || sequence !== categorySequenceRef.current || !sessionStillCurrent()) return;
      setError(safeError(caught, "Film kategorileri yüklenemedi."));
      setLoadingInitial(false);
    }
  };

  useEffect(() => {
    void refresh();
    return () => {
      categoryAbortRef.current?.abort();
      pageAbortRef.current?.abort();
      searchAbortRef.current?.abort();
      playbackAbortRef.current?.abort();
      categorySequenceRef.current += 1;
      pageSequenceRef.current += 1;
      searchSequenceRef.current += 1;
      playbackSequenceRef.current += 1;
    };
  }, [session]);

  useEffect(() => {
    searchAbortRef.current?.abort();
    const query = search.trim();
    const wasActive = searchWasActiveRef.current;
    searchWasActiveRef.current = Boolean(query);
    const sequence = ++searchSequenceRef.current;
    const selected = categories.find((category) => category.id === selectedCategoryId) ?? null;
    if (!query) {
      setSearching(false);
      setSearchResults([]);
      if (wasActive && selected) void loadPage(selected, 1, false);
      return;
    }
    if (!selected) return;
    setSearchResults([]);
    const timer = setTimeout(() => {
      const abort = new AbortController();
      searchAbortRef.current = abort;
      setSearching(true);
      setError(null);
      void searchStalkerVodCatalog(session, categories, query, { signal: abort.signal, categoryId: selected.id })
        .then((results) => {
          if (abort.signal.aborted || sequence !== searchSequenceRef.current || !sessionStillCurrent()) return;
          setSearchResults(results);
        })
        .catch((caught) => {
          if (abort.signal.aborted || sequence !== searchSequenceRef.current || !sessionStillCurrent()) return;
          setSearchResults([]);
          setError(safeError(caught, "Film araması tamamlanamadı."));
        })
        .finally(() => {
          if (!abort.signal.aborted && sequence === searchSequenceRef.current && sessionStillCurrent()) setSearching(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [categories, search, selectedCategoryId, session]);

  const selectCategory = (id: string) => {
    const category = categories.find((item) => item.id === id);
    if (!category || category.id === selectedCategoryId) return;
    searchAbortRef.current?.abort();
    setSearchResults([]);
    setSelectedCategoryId(category.id);
    setCurrentPage(1);
    setTotalItems(null);
    setHasNextPage(false);
    void loadPage(category, 1, false);
  };

  const loadMore = () => {
    const selected = categories.find((category) => category.id === selectedCategoryId);
    if (search.trim() || !hasNextPage || loadingMore || !selected) return;
    void loadPage(selected, currentPage + 1, true);
  };

  const openMovie = async (item: StalkerVodItem) => {
    playbackAbortRef.current?.abort();
    const abort = new AbortController();
    playbackAbortRef.current = abort;
    const sequence = ++playbackSequenceRef.current;
    setResolvingItemId(item.portalId);
    setError(null);
    try {
      const url = await resolveStalkerVodLink(session, item, { signal: abort.signal });
      if (abort.signal.aborted || sequence !== playbackSequenceRef.current || !sessionStillCurrent()) return;
      const category = categories.find((candidate) => candidate.id === (item.categoryId ?? selectedCategoryId));
      onPlayable({
        title: item.title,
        subtitle: item.genre || category?.title || moviesLabel,
        url,
        itemId: item.portalId,
        categoryId: item.categoryId ?? selectedCategoryId ?? category?.id ?? "*",
      });
    } catch (caught) {
      if (abort.signal.aborted || sequence !== playbackSequenceRef.current || !sessionStillCurrent()) return;
      setError(safeError(caught, "Film başlatılamadı."));
    } finally {
      if (sequence === playbackSequenceRef.current) setResolvingItemId(null);
    }
  };

  return {
    categories,
    selectedCategoryId,
    visibleItems: search.trim() ? searchResults : items,
    totalItems: search.trim() ? searchResults.length : totalItems,
    loadingInitial,
    loadingMore,
    error,
    search,
    searching,
    resolvingItemId,
    setSearch,
    refresh,
    selectCategory,
    loadMore,
    openMovie,
  };
}
