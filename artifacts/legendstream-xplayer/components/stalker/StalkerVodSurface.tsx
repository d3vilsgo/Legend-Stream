import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { NativeVideoPlayer } from "@/components/NativeVideoPlayer";
import { StalkerCategoryPager } from "@/components/stalker/StalkerCategoryPager";
import { useColors } from "@/hooks/useColors";
import { readLatestIsolatedStalkerSessionForProbe } from "@/lib/stalkerIsolatedLogin";
import { redactSensitiveText } from "@/lib/safeLog";
import {
  loadStalkerVodCategories,
  loadStalkerVodPage,
  mergeStalkerVodItems,
  resolveStalkerVodLink,
  searchStalkerVodCatalog,
  type StalkerVodCategory,
  type StalkerVodItem,
} from "@/lib/stalkerVod";

type CategoryStatus = "VOD_IDLE" | "VOD_CATEGORIES_LOADING" | "VOD_CATEGORIES_READY" | "VOD_CATEGORIES_ERROR";
type ListStatus = "VOD_LIST_IDLE" | "VOD_LIST_LOADING" | "VOD_LIST_READY" | "VOD_LIST_ERROR";
type PlaybackStatus = "VOD_PLAYBACK_IDLE" | "VOD_PLAYBACK_LOADING" | "VOD_PLAYBACK_READY" | "VOD_PLAYBACK_ERROR";
type ViewMode = "categories" | "list" | "search" | "details" | "player";

export function StalkerVodSurface({
  onBack,
  onPlayerActiveChange,
}: {
  onBack: () => void;
  onPlayerActiveChange?: (active: boolean) => void;
}) {
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [pagingError, setPagingError] = useState<string | null>(null);
  const [failedPage, setFailedPage] = useState<number | null>(null);
  const [selectedVodItem, setSelectedVodItem] = useState<StalkerVodItem | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus>("VOD_PLAYBACK_IDLE");
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playableUrl, setPlayableUrl] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<StalkerVodItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchReturnView, setSearchReturnView] = useState<"categories" | "list">("categories");

  const categoryRequestRef = useRef({ inFlight: false, loaded: false, sequence: 0 });
  const pageRequestRef = useRef<{ key: string | null; sequence: number }>({ key: null, sequence: 0 });
  const activeCategoryRef = useRef<string | null>(null);
  const pageAbortRef = useRef<AbortController | null>(null);
  const playbackRequestRef = useRef<{ key: string | null; sequence: number }>({ key: null, sequence: 0 });
  const playbackAbortRef = useRef<AbortController | null>(null);
  const searchSequenceRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const initialCategoryOpenedRef = useRef(false);

  const selectedCategory = categories.find((category) => category.id === selectedCategoryId) ?? null;
  const visibleItems = view === "search" ? searchResults : items;

  const safeError = (caught: unknown, fallback: string) =>
    redactSensitiveText(caught instanceof Error ? caught.message : fallback);

  const sessionStillCurrent = (session: ReturnType<typeof readLatestIsolatedStalkerSessionForProbe>) =>
    Boolean(session && readLatestIsolatedStalkerSessionForProbe() === session);

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
      if (categoryRequestRef.current.sequence !== sequence || !sessionStillCurrent(session)) return;
      setCategories(next);
      setCategoryStatus("VOD_CATEGORIES_READY");
      categoryRequestRef.current = { inFlight: false, loaded: true, sequence };
    } catch (caught) {
      if (categoryRequestRef.current.sequence !== sequence || !sessionStillCurrent(session)) return;
      setCategoryError(safeError(caught, "Film kategorileri yüklenemedi."));
      setCategoryStatus("VOD_CATEGORIES_ERROR");
      categoryRequestRef.current = { inFlight: false, loaded: false, sequence };
    }
  };

  useEffect(() => {
    void loadCategories();
    return () => {
      pageAbortRef.current?.abort();
      playbackAbortRef.current?.abort();
      searchAbortRef.current?.abort();
      categoryRequestRef.current.sequence += 1;
      pageRequestRef.current.sequence += 1;
      playbackRequestRef.current.sequence += 1;
      searchSequenceRef.current += 1;
      onPlayerActiveChange?.(false);
    };
    // Session is owned by the mounted Stalker product surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onPlayerActiveChange?.(view === "player");
  }, [onPlayerActiveChange, view]);

  const loadPage = async (category: StalkerVodCategory, page: number, append = false, force = false) => {
    const session = readLatestIsolatedStalkerSessionForProbe();
    if (!session) return;
    const key = `${category.id}:${page}`;
    const currentRequest = pageRequestRef.current;
    if (!force && currentRequest.key === key && (listStatus === "VOD_LIST_LOADING" || loadingMore)) return;

    pageAbortRef.current?.abort();
    const abort = new AbortController();
    pageAbortRef.current = abort;
    const sequence = currentRequest.sequence + 1;
    pageRequestRef.current = { key, sequence };
    activeCategoryRef.current = category.id;
    setSelectedCategoryId(category.id);
    setSelectedVodItem(null);
    setPlaybackStatus("VOD_PLAYBACK_IDLE");
    setPlaybackError(null);
    setPlayableUrl(null);
    if (append) setLoadingMore(true);
    else setListStatus("VOD_LIST_LOADING");
    setListError(null);
    setPagingError(null);
    setFailedPage(null);
    setView("list");

    try {
      const result = await loadStalkerVodPage(session, category, page, { signal: abort.signal });
      if (
        pageRequestRef.current.sequence !== sequence ||
        activeCategoryRef.current !== category.id ||
        !sessionStillCurrent(session)
      ) return;
      setItems((previous) => append ? mergeStalkerVodItems(previous, result.items) : result.items);
      setCurrentPage(Math.max(page, result.currentPage));
      setTotalItems(result.totalItems);
      setMaxPageItems(result.maxPageItems);
      setHasNextPage(result.hasNextPage);
      setListStatus("VOD_LIST_READY");
    } catch (caught) {
      if (abort.signal.aborted || pageRequestRef.current.sequence !== sequence || !sessionStillCurrent(session)) return;
      if (append) {
        setPagingError(safeError(caught, "Sonraki film sayfası yüklenemedi."));
        setFailedPage(page);
      } else {
        setListError(safeError(caught, "Filmler yüklenemedi."));
        setListStatus("VOD_LIST_ERROR");
        setFailedPage(page);
      }
    } finally {
      if (pageRequestRef.current.sequence === sequence) {
        setLoadingMore(false);
        pageRequestRef.current = { key: null, sequence };
      }
    }
  };

  const selectCategory = (category: StalkerVodCategory) => {
    if (activeCategoryRef.current !== category.id) {
      pageAbortRef.current?.abort();
      pageRequestRef.current = { key: null, sequence: pageRequestRef.current.sequence + 1 };
      activeCategoryRef.current = category.id;
      setItems([]);
      setCurrentPage(1);
      setTotalItems(undefined);
      setMaxPageItems(undefined);
      setHasNextPage(false);
      setPagingError(null);
      setFailedPage(null);
      setListError(null);
    }
    searchAbortRef.current?.abort();
    setSearchQuery("");
    setSearchResults([]);
    void loadPage(category, 1);
  };

  useEffect(() => {
    if (
      categoryStatus === "VOD_CATEGORIES_READY"
      && categories.length
      && !selectedCategoryId
      && !initialCategoryOpenedRef.current
    ) {
      initialCategoryOpenedRef.current = true;
      selectCategory(categories[0]!);
    }
  }, [categories, categoryStatus, selectedCategoryId]);

  const openMovie = (item: StalkerVodItem) => {
    setSelectedVodItem(item);
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
    playbackAbortRef.current?.abort();
    const abort = new AbortController();
    playbackAbortRef.current = abort;
    const sequence = currentRequest.sequence + 1;
    playbackRequestRef.current = { key: item.portalId, sequence };
    setSelectedVodItem(item);
    setPlaybackStatus("VOD_PLAYBACK_LOADING");
    setPlaybackError(null);
    try {
      const source = await resolveStalkerVodLink(session, item, { signal: abort.signal });
      if (
        abort.signal.aborted ||
        playbackRequestRef.current.sequence !== sequence ||
        playbackRequestRef.current.key !== item.portalId ||
        !sessionStillCurrent(session)
      ) return;
      setPlayableUrl(source);
      setPlaybackStatus("VOD_PLAYBACK_READY");
      setView("player");
    } catch (caught) {
      if (abort.signal.aborted || playbackRequestRef.current.sequence !== sequence || !sessionStillCurrent(session)) return;
      setPlaybackError(safeError(caught, "Film başlatılamadı."));
      setPlaybackStatus("VOD_PLAYBACK_ERROR");
      setView("details");
    }
  };

  useEffect(() => {
    const query = searchQuery.trim();
    searchAbortRef.current?.abort();
    const sequence = ++searchSequenceRef.current;
    if (!query) {
      setSearchLoading(false);
      setSearchError(null);
      setSearchResults([]);
      if (view === "search") setView(searchReturnView);
      return;
    }
    if (!categories.length) return;
    const timer = setTimeout(() => {
      const session = readLatestIsolatedStalkerSessionForProbe();
      if (!session) return;
      const abort = new AbortController();
      searchAbortRef.current = abort;
      setView("search");
      setSearchLoading(true);
      setSearchError(null);
      void searchStalkerVodCatalog(session, categories, query, { signal: abort.signal })
        .then((results) => {
          if (searchSequenceRef.current !== sequence || abort.signal.aborted || !sessionStillCurrent(session)) return;
          setSearchResults(results);
        })
        .catch((caught) => {
          if (searchSequenceRef.current !== sequence || abort.signal.aborted || !sessionStillCurrent(session)) return;
          setSearchError(safeError(caught, "Film araması tamamlanamadı."));
          setSearchResults([]);
        })
        .finally(() => {
          if (searchSequenceRef.current === sequence && !abort.signal.aborted) setSearchLoading(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [categories, searchQuery, searchReturnView, view]);

  const setQuery = (value: string) => {
    if (!searchQuery.trim() && value.trim()) setSearchReturnView(view === "list" ? "list" : "categories");
    setSearchQuery(value);
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
    return <ScrollView style={styles.screen} contentContainerStyle={styles.section} showsVerticalScrollIndicator={false}>
      <View style={styles.titleRow}>
        <FocusButton label="Geri" icon="arrow-left" variant="ghost" onPress={() => setView(searchQuery.trim() ? "search" : "list")} />
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
    </ScrollView>;
  }

  const searchBox = <SearchBox value={searchQuery} onChange={setQuery} />;

  if (view === "categories") {
    return <FlatList
      style={styles.screen}
      contentContainerStyle={styles.section}
      data={categories}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={<View style={styles.headerBlock}>
        <View style={styles.titleRow}>
          <FocusButton label="Geri" icon="arrow-left" variant="ghost" onPress={onBack} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>Filmler</Text>
            <Text style={{ color: colors.mutedForeground }}>Kategori seçin</Text>
          </View>
        </View>
        {searchBox}
        {categoryStatus === "VOD_CATEGORIES_LOADING" ? <StateCard text="Film kategorileri yükleniyor" /> : null}
        {categoryStatus === "VOD_CATEGORIES_ERROR" && categoryError ? <View style={styles.headerBlock}>
          <ErrorCard text={categoryError} />
          <FocusButton label="Tekrar dene" icon="refresh-cw" variant="secondary" onPress={() => void loadCategories(true)} />
        </View> : null}
      </View>}
      renderItem={({ item }) => <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.id === "*" ? "Tümü" : item.title}
        accessibilityState={{ selected: item.id === selectedCategoryId }}
        onPress={() => selectCategory(item)}
        style={[styles.categoryCard, { borderColor: item.id === selectedCategoryId ? colors.primary : colors.border, backgroundColor: colors.card }]}
      >
        <Text style={{ color: colors.foreground, fontWeight: "800", flex: 1 }}>{item.id === "*" ? "Tümü" : item.title}</Text>
        <Text style={{ color: colors.mutedForeground }}>›</Text>
      </Pressable>}
      ListEmptyComponent={categoryStatus === "VOD_CATEGORIES_READY" ? <StateCard text="Kullanılabilir film kategorisi bulunamadı" /> : null}
    />;
  }

  const displayTitle = view === "search"
    ? "Tüm filmlerde arama"
    : selectedCategory?.id === "*" ? "Tümü" : selectedCategory?.title || "Filmler";

  return <StalkerCategoryPager
    categories={categories}
    activeId={selectedCategoryId}
    disabled={view !== "list" || searchQuery.trim().length > 0}
    showControls={view === "list"}
    onSelect={(id) => {
      const category = categories.find((item) => item.id === id);
      if (category) selectCategory(category);
    }}
  >
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.section}
      data={visibleItems}
      keyExtractor={(item) => item.portalId}
      numColumns={2}
      columnWrapperStyle={styles.gridRow}
      ListHeaderComponent={<View style={styles.headerBlock}>
        <View style={styles.titleRow}>
          {view === "list" ? <FocusButton label="Kategoriler" icon="arrow-left" variant="ghost" onPress={() => setView("categories")} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>{displayTitle}</Text>
            <Text style={{ color: colors.mutedForeground }}>
              {view === "search" ? "Provider All kataloğunda global arama" : `${items.length} yüklendi${totalItems != null ? ` · ${totalItems} film` : ""}${maxPageItems != null ? ` · sayfa başına ${maxPageItems}` : ""}`}
            </Text>
          </View>
        </View>
        {searchBox}
        {searchLoading ? <StateCard text="Tüm film kataloğu taranıyor" /> : null}
        {searchError ? <ErrorCard text={searchError} /> : null}
        {view === "list" && listStatus === "VOD_LIST_LOADING" ? <StateCard text="Filmler yükleniyor" /> : null}
        {view === "list" && listStatus === "VOD_LIST_ERROR" && listError ? <View style={styles.headerBlock}>
          <ErrorCard text={listError} />
          <FocusButton label="Tekrar dene" icon="refresh-cw" variant="secondary" onPress={() => selectedCategory && void loadPage(selectedCategory, failedPage ?? 1, false, true)} />
        </View> : null}
      </View>}
      renderItem={({ item }) => <Pressable
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
      </Pressable>}
      ListEmptyComponent={
        !searchLoading && !searchError && listStatus !== "VOD_LIST_LOADING" && listStatus !== "VOD_LIST_ERROR"
          ? <StateCard text={view === "search" ? "Aramanızla eşleşen film bulunamadı" : "Bu kategoride film bulunamadı"} />
          : null
      }
      onEndReached={view === "list" && hasNextPage && !pagingError
        ? () => selectedCategory && void loadPage(selectedCategory, currentPage + 1, true)
        : undefined}
      onEndReachedThreshold={0.55}
      ListFooterComponent={view === "list" ? <View style={styles.footer}>
        {loadingMore ? <StateCard text={`Sayfa ${currentPage + 1} yükleniyor`} /> : null}
        {pagingError ? <View style={styles.footer}>
          <ErrorCard text={pagingError} />
          <FocusButton label="Tekrar dene" icon="refresh-cw" variant="secondary" onPress={() => selectedCategory && failedPage != null && void loadPage(selectedCategory, failedPage, true, true)} />
        </View> : null}
        {!hasNextPage && items.length ? <Text style={{ color: colors.mutedForeground, textAlign: "center" }}>Kategori sonu</Text> : null}
      </View> : null}
    />
  </StalkerCategoryPager>;
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const colors = useColors();
  return <View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
    <Text style={{ color: colors.mutedForeground }}>⌕</Text>
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="Film ara..."
      placeholderTextColor={colors.mutedForeground}
      autoCorrect={false}
      style={[styles.searchInput, { color: colors.foreground }]}
    />
    {value ? <Pressable accessibilityRole="button" accessibilityLabel="Aramayı temizle" onPress={() => onChange("")}>
      <Text style={{ color: colors.mutedForeground, fontSize: 18 }}>×</Text>
    </Pressable> : null}
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
  return <View style={[styles.stateCard, { borderColor: colors.border, backgroundColor: colors.card }]}> 
    <ActivityIndicator size="small" color={colors.primary} />
    <Text style={{ color: colors.mutedForeground }}>{text}</Text>
  </View>;
}

function ErrorCard({ text }: { text: string }) {
  const colors = useColors();
  return <View style={[styles.stateCard, { borderColor: colors.destructive, backgroundColor: colors.card }]}>
    <Text style={{ color: colors.destructive, fontWeight: "800" }}>İşlem tamamlanamadı</Text>
    <Text style={{ color: colors.mutedForeground, flex: 1 }}>{text}</Text>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  player: { flex: 1, minHeight: 420 },
  section: { padding: 18, paddingBottom: 40, width: "100%", maxWidth: 1200, alignSelf: "center", gap: 12 },
  headerBlock: { gap: 12, marginBottom: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 26, fontWeight: "900", flexShrink: 1 },
  categoryCard: { borderWidth: 1, borderRadius: 14, minHeight: 62, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 9 },
  gridRow: { gap: 12, marginBottom: 12 },
  movieCard: { flex: 1, maxWidth: 260, borderWidth: 1, borderRadius: 14, padding: 8, gap: 7 },
  movieTitle: { fontWeight: "800", fontSize: 14, lineHeight: 18 },
  poster: { width: "100%", aspectRatio: 2 / 3, borderRadius: 10, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  posterLarge: { width: 210, aspectRatio: 2 / 3, borderRadius: 14, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  posterImage: { width: "100%", height: "100%" },
  details: { borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: "row", flexWrap: "wrap", gap: 16 },
  detailText: { flex: 1, minWidth: 220, gap: 9 },
  stateCard: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  footer: { gap: 10, paddingVertical: 8 },
  searchBox: { borderWidth: 1, borderRadius: 14, minHeight: 50, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 10 },
});
