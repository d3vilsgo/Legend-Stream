import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { NativeVideoPlayer } from "@/components/NativeVideoPlayer";
import { useColors } from "@/hooks/useColors";
import { readLatestIsolatedStalkerSessionForProbe } from "@/lib/stalkerIsolatedLogin";
import { redactSensitiveText } from "@/lib/safeLog";
import {
  loadStalkerVodCategories,
  loadStalkerVodPage,
  resolveStalkerVodLink,
  type StalkerVodCategory,
  type StalkerVodItem,
} from "@/lib/stalkerVod";

type CategoryStatus = "VOD_IDLE" | "VOD_CATEGORIES_LOADING" | "VOD_CATEGORIES_READY" | "VOD_CATEGORIES_ERROR";
type ListStatus = "VOD_LIST_IDLE" | "VOD_LIST_LOADING" | "VOD_LIST_READY" | "VOD_LIST_ERROR";
type PlaybackStatus = "VOD_PLAYBACK_IDLE" | "VOD_PLAYBACK_LOADING" | "VOD_PLAYBACK_READY" | "VOD_PLAYBACK_ERROR";
type ViewMode = "categories" | "list" | "details" | "player";

export function StalkerVodSurface({ onBack }: { onBack: () => void }) {
  const colors = useColors();
  const [view, setView] = useState<ViewMode>("categories");
  const [categoryStatus, setCategoryStatus] = useState<CategoryStatus>("VOD_IDLE");
  const [categories, setCategories] = useState<StalkerVodCategory[]>([]);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [listStatus, setListStatus] = useState<ListStatus>("VOD_LIST_IDLE");
  const [items, setItems] = useState<StalkerVodItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState<number | undefined>(undefined);
  const [maxPageItems, setMaxPageItems] = useState<number | undefined>(undefined);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [failedPage, setFailedPage] = useState<number | null>(null);
  const [selectedVodId, setSelectedVodId] = useState<string | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus>("VOD_PLAYBACK_IDLE");
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playableUrl, setPlayableUrl] = useState<string | null>(null);

  const categoryRequestRef = useRef({ inFlight: false, loaded: false, sequence: 0 });
  const pageRequestRef = useRef<{ key: string | null; sequence: number }>({ key: null, sequence: 0 });
  const activeCategoryRef = useRef<string | null>(null);
  const playbackRequestRef = useRef<{ key: string | null; sequence: number }>({ key: null, sequence: 0 });

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId],
  );
  const selectedVodItem = useMemo(
    () => items.find((item) => item.portalId === selectedVodId) ?? null,
    [items, selectedVodId],
  );

  const safeError = (caught: unknown, fallback: string) =>
    redactSensitiveText(caught instanceof Error ? caught.message : fallback);

  const loadCategories = async (force = false) => {
    const session = readLatestIsolatedStalkerSessionForProbe();
    const request = categoryRequestRef.current;
    if (!session || request.inFlight || (!force && request.loaded)) return;
    const sequence = request.sequence + 1;
    categoryRequestRef.current = { inFlight: true, loaded: false, sequence };
    setCategoryStatus("VOD_CATEGORIES_LOADING");
    setCategoryError(null);
    try {
      const next = await loadStalkerVodCategories(session);
      if (categoryRequestRef.current.sequence !== sequence) return;
      setCategories(next);
      setCategoryStatus("VOD_CATEGORIES_READY");
      categoryRequestRef.current = { inFlight: false, loaded: true, sequence };
    } catch (caught) {
      if (categoryRequestRef.current.sequence !== sequence) return;
      setCategoryError(safeError(caught, "Film kategorileri yüklenemedi."));
      setCategoryStatus("VOD_CATEGORIES_ERROR");
      categoryRequestRef.current = { inFlight: false, loaded: false, sequence };
    }
  };

  useEffect(() => {
    void loadCategories();
  }, []);

  const loadPage = async (category: StalkerVodCategory, page: number, force = false) => {
    const session = readLatestIsolatedStalkerSessionForProbe();
    if (!session) return;
    const key = `${category.id}:${page}`;
    const currentRequest = pageRequestRef.current;
    if (!force && currentRequest.key === key && listStatus === "VOD_LIST_LOADING") return;
    if (!force && currentRequest.key === key && listStatus === "VOD_LIST_READY" && currentPage === page) return;

    const sequence = currentRequest.sequence + 1;
    pageRequestRef.current = { key, sequence };
    activeCategoryRef.current = category.id;
    setSelectedCategoryId(category.id);
    setSelectedVodId(null);
    setPlaybackStatus("VOD_PLAYBACK_IDLE");
    setPlaybackError(null);
    setPlayableUrl(null);
    setListStatus("VOD_LIST_LOADING");
    setListError(null);
    setFailedPage(null);
    setView("list");

    try {
      const result = await loadStalkerVodPage(session, category, page);
      if (pageRequestRef.current.sequence !== sequence || activeCategoryRef.current !== category.id) return;
      setItems(result.items);
      setCurrentPage(result.currentPage);
      setTotalItems(result.totalItems);
      setMaxPageItems(result.maxPageItems);
      setHasNextPage(result.hasNextPage);
      setListStatus("VOD_LIST_READY");
    } catch (caught) {
      if (pageRequestRef.current.sequence !== sequence || activeCategoryRef.current !== category.id) return;
      setListError(safeError(caught, "Filmler yüklenemedi."));
      setFailedPage(page);
      setListStatus("VOD_LIST_ERROR");
    }
  };

  const selectCategory = (category: StalkerVodCategory) => {
    if (activeCategoryRef.current !== category.id) {
      pageRequestRef.current = { key: null, sequence: pageRequestRef.current.sequence + 1 };
      activeCategoryRef.current = category.id;
      setItems([]);
      setCurrentPage(1);
      setTotalItems(undefined);
      setMaxPageItems(undefined);
      setHasNextPage(false);
    }
    void loadPage(category, 1);
  };

  const openMovie = (item: StalkerVodItem) => {
    setSelectedVodId(item.portalId);
    setPlaybackStatus("VOD_PLAYBACK_IDLE");
    setPlaybackError(null);
    setPlayableUrl(null);
    setView("details");
  };

  const playMovie = async (item: StalkerVodItem, force = false) => {
    const session = readLatestIsolatedStalkerSessionForProbe();
    if (!session) return;
    const currentRequest = playbackRequestRef.current;
    if (!force && currentRequest.key === item.portalId && playbackStatus === "VOD_PLAYBACK_LOADING") return;
    const sequence = currentRequest.sequence + 1;
    playbackRequestRef.current = { key: item.portalId, sequence };
    setSelectedVodId(item.portalId);
    setPlaybackStatus("VOD_PLAYBACK_LOADING");
    setPlaybackError(null);
    try {
      const source = await resolveStalkerVodLink(session, item);
      if (playbackRequestRef.current.sequence !== sequence || playbackRequestRef.current.key !== item.portalId) return;
      setPlayableUrl(source);
      setPlaybackStatus("VOD_PLAYBACK_READY");
      setView("player");
    } catch (caught) {
      if (playbackRequestRef.current.sequence !== sequence || playbackRequestRef.current.key !== item.portalId) return;
      setPlaybackError(safeError(caught, "Film başlatılamadı."));
      setPlaybackStatus("VOD_PLAYBACK_ERROR");
      setView("details");
    }
  };

  if (view === "player" && selectedVodItem && playableUrl) {
    return <View style={styles.player}>
      <NativeVideoPlayer
        source={playableUrl}
        title={selectedVodItem.title}
        subtitle={selectedCategory?.title}
        mediaKind="movie"
        autoFullscreen
        onFullscreenExit={() => setView("details")}
      />
    </View>;
  }

  if (view === "details" && selectedVodItem) {
    return <View style={styles.section}>
      <View style={styles.titleRow}>
        <FocusButton label="Geri" icon="arrow-left" variant="ghost" onPress={() => setView("list")} />
        <Text style={[styles.title, { color: colors.foreground }]}>{selectedVodItem.title}</Text>
      </View>
      <View style={[styles.details, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Poster item={selectedVodItem} large />
        <View style={styles.detailText}>
          {selectedVodItem.year ? <Text style={{ color: colors.mutedForeground }}>Yıl: {selectedVodItem.year}</Text> : null}
          {selectedVodItem.genre ? <Text style={{ color: colors.mutedForeground }}>Tür: {selectedVodItem.genre}</Text> : null}
          {selectedVodItem.rating ? <Text style={{ color: colors.mutedForeground }}>Puan: {selectedVodItem.rating}</Text> : null}
          {selectedVodItem.director ? <Text style={{ color: colors.mutedForeground }}>Yönetmen: {selectedVodItem.director}</Text> : null}
          {selectedVodItem.actors ? <Text style={{ color: colors.mutedForeground }}>Oyuncular: {selectedVodItem.actors}</Text> : null}
          {selectedVodItem.description ? <Text style={{ color: colors.foreground, lineHeight: 20 }}>{selectedVodItem.description}</Text> : null}
          {playbackStatus === "VOD_PLAYBACK_LOADING" ? <StateCard text="Film hazırlanıyor" /> : null}
          {playbackStatus === "VOD_PLAYBACK_ERROR" && playbackError ? <ErrorCard text={playbackError} /> : null}
          <FocusButton
            label={playbackStatus === "VOD_PLAYBACK_LOADING" ? "Hazırlanıyor" : "Oynat"}
            icon="play"
            variant="primary"
            disabled={playbackStatus === "VOD_PLAYBACK_LOADING"}
            onPress={() => void playMovie(selectedVodItem, playbackStatus === "VOD_PLAYBACK_ERROR")}
          />
        </View>
      </View>
    </View>;
  }

  if (view === "list" && selectedCategory) {
    const displayTitle = selectedCategory.id === "*" ? "Tümü" : selectedCategory.title;
    return <View style={styles.section}>
      <View style={styles.titleRow}>
        <FocusButton label="Kategoriler" icon="arrow-left" variant="ghost" onPress={() => setView("categories")} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>{displayTitle}</Text>
          <Text style={{ color: colors.mutedForeground }}>
            Sayfa {currentPage}{totalItems != null ? ` · ${totalItems} film` : ""}{maxPageItems != null ? ` · sayfa başına ${maxPageItems}` : ""}
          </Text>
        </View>
      </View>
      {listStatus === "VOD_LIST_LOADING" ? <StateCard text="Filmler yükleniyor" /> : null}
      {listStatus === "VOD_LIST_ERROR" && listError ? <View style={styles.section}>
        <ErrorCard text={listError} />
        <FocusButton label="Tekrar dene" icon="refresh-cw" variant="secondary" onPress={() => void loadPage(selectedCategory, failedPage ?? currentPage, true)} />
      </View> : null}
      {listStatus === "VOD_LIST_READY" ? <>
        <View style={styles.grid}>
          {items.map((item) => <Pressable
            key={item.portalId}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() => openMovie(item)}
            style={[styles.movieCard, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <Poster item={item} />
            <Text numberOfLines={2} style={[styles.movieTitle, { color: colors.foreground }]}>{item.title}</Text>
            <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 12 }}>
              {[item.year, item.rating].filter(Boolean).join(" · ")}
            </Text>
          </Pressable>)}
        </View>
        {!items.length ? <StateCard text="Bu sayfada film bulunamadı" /> : null}
        <View style={styles.pager}>
          <FocusButton
            label="Önceki"
            icon="chevron-left"
            variant="secondary"
            disabled={currentPage <= 1}
            onPress={() => void loadPage(selectedCategory, currentPage - 1)}
          />
          <FocusButton
            label="Sonraki"
            icon="chevron-right"
            variant="secondary"
            disabled={!hasNextPage}
            onPress={() => void loadPage(selectedCategory, currentPage + 1)}
          />
        </View>
      </> : null}
    </View>;
  }

  return <View style={styles.section}>
    <View style={styles.titleRow}>
      <FocusButton label="Geri" icon="arrow-left" variant="ghost" onPress={onBack} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.foreground }]}>Filmler</Text>
        <Text style={{ color: colors.mutedForeground }}>Kategori seçin</Text>
      </View>
    </View>
    {categoryStatus === "VOD_CATEGORIES_LOADING" ? <StateCard text="Film kategorileri yükleniyor" /> : null}
    {categoryStatus === "VOD_CATEGORIES_ERROR" && categoryError ? <View style={styles.section}>
      <ErrorCard text={categoryError} />
      <FocusButton label="Tekrar dene" icon="refresh-cw" variant="secondary" onPress={() => void loadCategories(true)} />
    </View> : null}
    {categoryStatus === "VOD_CATEGORIES_READY" ? <View style={styles.categoryList}>
      {categories.map((category) => <Pressable
        key={category.id}
        accessibilityRole="button"
        accessibilityLabel={category.id === "*" ? "Tümü" : category.title}
        onPress={() => selectCategory(category)}
        style={[styles.categoryCard, { borderColor: colors.border, backgroundColor: colors.card }]}
      >
        <Text style={{ color: colors.foreground, fontWeight: "800", flex: 1 }}>{category.id === "*" ? "Tümü" : category.title}</Text>
        <Text style={{ color: colors.mutedForeground }}>›</Text>
      </Pressable>)}
      {!categories.length ? <StateCard text="Kullanılabilir film kategorisi bulunamadı" /> : null}
    </View> : null}
  </View>;
}

function Poster({ item, large = false }: { item: StalkerVodItem; large?: boolean }) {
  const colors = useColors();
  const style = large ? styles.posterLarge : styles.poster;
  return <View style={[style, { backgroundColor: colors.secondary }]}>
    {item.posterUrl ? <Image source={{ uri: item.posterUrl }} style={styles.posterImage} resizeMode="cover" /> : <Text style={{ color: colors.mutedForeground }}>Film</Text>}
  </View>;
}

function StateCard({ text }: { text: string }) {
  const colors = useColors();
  return <View style={[styles.state, { borderColor: colors.border, backgroundColor: colors.card }]}>
    <ActivityIndicator size="small" color={colors.primary} />
    <Text style={{ color: colors.mutedForeground }}>{text}</Text>
  </View>;
}

function ErrorCard({ text }: { text: string }) {
  const colors = useColors();
  return <View style={[styles.state, { borderColor: colors.destructive, backgroundColor: colors.card }]}>
    <Text style={{ color: colors.destructive, flex: 1 }}>{text}</Text>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 28, fontWeight: "900", flexShrink: 1 },
  categoryList: { gap: 8 },
  categoryCard: { borderWidth: 1, borderRadius: 14, padding: 16, minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  movieCard: { borderWidth: 1, borderRadius: 14, width: 160, padding: 8, gap: 6 },
  poster: { width: "100%", aspectRatio: 2 / 3, borderRadius: 10, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  posterLarge: { width: 220, aspectRatio: 2 / 3, borderRadius: 14, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  posterImage: { width: "100%", height: "100%" },
  movieTitle: { fontWeight: "800", minHeight: 38 },
  details: { borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: "row", flexWrap: "wrap", gap: 16 },
  detailText: { flex: 1, minWidth: 220, gap: 8 },
  pager: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  state: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  player: { minHeight: 520, flex: 1 },
});