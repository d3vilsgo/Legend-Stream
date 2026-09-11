import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { NativeVideoPlayer } from "@/components/NativeVideoPlayer";
import { StalkerSeriesProductCatalog, type StalkerSeriesProductScreen } from "@/components/stalker/StalkerSeriesProductCatalog";
import { redactSensitiveText } from "@/lib/safeLog";
import { isCurrentStalkerProductSession, readCurrentStalkerProductSession } from "@/lib/stalkerProductSession";
import {
  buildStalkerSeriesPlayerHandoff,
  createStalkerSeriesProductController,
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
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState<number | undefined>(undefined);
  const [maxPageItems, setMaxPageItems] = useState<number | undefined>(undefined);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [player, setPlayer] = useState<StalkerSeriesPlayerHandoff | null>(null);
  const requestSequence = useRef(0);
  const requestAbort = useRef<AbortController | null>(null);

  const selectedCategory = categories.find((item) => item.id === selectedCategoryId) ?? null;

  const beginRequest = () => {
    requestAbort.current?.abort();
    const abort = new AbortController();
    requestAbort.current = abort;
    return { abort, sequence: ++requestSequence.current };
  };
  const currentRequest = (sequence: number) =>
    requestSequence.current === sequence && Boolean(session && isCurrentStalkerProductSession(session));

  const resetPaging = () => {
    setCurrentPage(1);
    setTotalItems(undefined);
    setMaxPageItems(undefined);
    setHasNextPage(false);
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

  const loadPage = async (category: StalkerSeriesProductCategory, page: number) => {
    if (!controller || !session) return;
    const request = beginRequest();
    ownership.invalidate();
    setSelectedCategoryId(category.id);
    setScreen("list");
    setLoading(true);
    setError(null);
    setPlaybackError(null);
    setDetail(null);
    setSelectedSeasonId(null);
    try {
      const result = await controller.loadPage(category, page, request.abort.signal);
      if (!currentRequest(request.sequence)) return;
      setItems(result.items);
      setCurrentPage(result.currentPage);
      setTotalItems(result.totalItems);
      setMaxPageItems(result.maxPageItems);
      setHasNextPage(result.hasNextPage);
    } catch (caught) {
      if (!currentRequest(request.sequence)) return;
      setError(visibleError(caught, "Diziler yüklenemedi."));
    } finally {
      if (currentRequest(request.sequence)) setLoading(false);
    }
  };

  const loadDetail = async (item: StalkerSeriesProductItem) => {
    if (!controller || !session) return;
    const request = beginRequest();
    ownership.invalidate();
    setScreen("detail");
    setLoading(true);
    setError(null);
    setPlaybackError(null);
    setDetail(null);
    setSelectedSeasonId(null);
    try {
      const next = await controller.loadDetail(item, request.abort.signal);
      if (!currentRequest(request.sequence)) return;
      setDetail(next);
      setSelectedSeasonId(next.seasons[0]?.id ?? null);
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
      requestSequence.current += 1;
      ownership.invalidate();
      controller?.clear();
    };
    // Controller and session are stable for this mounted product session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, session]);

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

  return <StalkerSeriesProductCatalog
    screen={screen}
    categories={categories}
    items={items}
    detail={detail}
    selectedCategoryTitle={selectedCategory?.title}
    selectedSeasonId={selectedSeasonId}
    currentPage={currentPage}
    totalItems={totalItems}
    maxPageItems={maxPageItems}
    hasNextPage={hasNextPage}
    loading={loading}
    error={error}
    playbackLoading={playbackLoading}
    playbackError={playbackError}
    onRetry={() => {
      if (screen === "categories") void loadCategories();
      else if (screen === "list" && selectedCategory) void loadPage(selectedCategory, currentPage);
      else if (screen === "detail" && detail) {
        const item = items.find((candidate) => candidate.id === detail.seriesId) ?? { id: detail.seriesId, title: detail.title };
        void loadDetail(item);
      }
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
        setSelectedSeasonId(null);
        setScreen("list");
      } else {
        setItems([]);
        setSelectedCategoryId(null);
        resetPaging();
        setScreen("categories");
      }
    }}
    onSelectCategory={(id) => {
      const category = categories.find((item) => item.id === id);
      if (category) {
        setItems([]);
        resetPaging();
        void loadPage(category, 1);
      }
    }}
    onSelectSeries={(id) => {
      const item = items.find((candidate) => candidate.id === id);
      if (item) void loadDetail(item);
    }}
    onSelectSeason={setSelectedSeasonId}
    onSelectEpisode={(seasonId, episodeId) => void playEpisode(seasonId, episodeId)}
    onPreviousPage={() => {
      if (selectedCategory && currentPage > 1) void loadPage(selectedCategory, currentPage - 1);
    }}
    onNextPage={() => {
      if (selectedCategory && hasNextPage) void loadPage(selectedCategory, currentPage + 1);
    }}
  />;
}
