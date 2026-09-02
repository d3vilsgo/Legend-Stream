import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FocusButton } from "@/components/FocusButton";
import type { EpgProgram, ProviderConfig, ProviderType } from "@/context/PlayerContext";
import { selectProgramsAt } from "@/context/PlayerContext";
import { useI18n } from "@/context/I18nContext";
import { useColors } from "@/hooks/useColors";
import { useCatalogPage } from "@/hooks/useCatalogPage";
import { getCachedCatalogCategories } from "@/lib/catalogPageRepository";
import {
  readCatalogCategorySelection,
  rememberCatalogCategorySelection,
  validateCatalogCategorySelection,
  type CatalogCategoryMemoryKind,
} from "@/lib/catalogCategoryMemory";
import type { CatalogPageProviderType, CatalogPageSort } from "@/lib/catalogPaging";
import type { Channel } from "@/lib/iptv";
import type {
  XtreamCategory,
  XtreamEpisode,
  XtreamSeriesInfo,
  XtreamSeriesItem,
  XtreamVodItem,
} from "@/lib/xtreamCatalog";

export type CatalogSortMode = CatalogPageSort;
type CategoryOption = { id: string; name: string };
type SnapshotCount = { totalCount: number | null; countKnown: boolean };

function pagedProviderType(type: ProviderType): CatalogPageProviderType | null {
  return type === "m3u" || type === "xtream" ? type : null;
}

function allOnlySnapshotCount(
  category: string,
  search: string,
  snapshotCount: SnapshotCount,
): SnapshotCount | undefined {
  return category === "__all__" && search.trim() === "" ? snapshotCount : undefined;
}

function useCategories(providerId: string, kind: "live" | "vod" | "series") {
  const [result, setResult] = useState<{
    providerId: string | null;
    categories: XtreamCategory[];
  }>({ providerId: null, categories: [] });
  const generationRef = useRef(0);
  const reload = () => {
    const generation = ++generationRef.current;
    void getCachedCatalogCategories(providerId, kind)
      .then((next) => {
        if (generationRef.current === generation) {
          setResult({ providerId, categories: next });
        }
      })
      .catch(() => {
        if (generationRef.current === generation) {
          setResult({ providerId, categories: [] });
        }
      });
  };
  useEffect(() => {
    setResult({ providerId: null, categories: [] });
    reload();
    return () => {
      generationRef.current += 1;
    };
  }, [providerId, kind]);
  const ready = result.providerId === providerId;
  return {
    categories: ready ? result.categories : [],
    ready,
    reload,
  };
}

function useRememberedCategory(
  providerId: string,
  kind: CatalogCategoryMemoryKind,
  categories: XtreamCategory[],
  categoriesReady: boolean,
) {
  const [category, setCategoryState] = useState(() =>
    readCatalogCategorySelection(providerId, kind),
  );

  useEffect(() => {
    setCategoryState(readCatalogCategorySelection(providerId, kind));
  }, [providerId, kind]);

  useEffect(() => {
    if (!categoriesReady) return;
    const valid = validateCatalogCategorySelection(
      providerId,
      kind,
      categories.map((item) => String(item.category_id)),
    );
    setCategoryState((current) => current === valid ? current : valid);
  }, [providerId, kind, categories, categoriesReady]);

  const setCategory = useCallback((categoryId: string) => {
    setCategoryState(rememberCatalogCategorySelection(providerId, kind, categoryId));
  }, [providerId, kind]);

  return [category, setCategory] as const;
}

function countText(totalCount: number | null, countKnown: boolean) {
  return countKnown && totalCount !== null ? totalCount.toLocaleString() : "—";
}

function PageFooter({ loading }: { loading: boolean }) {
  const colors = useColors();
  if (!loading) return <View style={s.pageFooterSpacer} />;
  return <View style={s.pageFooter}>
    <ActivityIndicator size="small" color={colors.primary} />
  </View>;
}

function CatalogLoadingSkeleton({ text }: { text: string }) {
  const colors = useColors();
  return <View style={s.skeletonRoot}>
    <ActivityIndicator size="small" color={colors.primary} />
    <Text style={{ color: colors.mutedForeground, fontWeight: "600" }}>{text}</Text>
  </View>;
}

function CatalogHeader({
  title,
  detail,
  search,
  onSearch,
  loading,
  onRefresh,
  children,
}: {
  title: string;
  detail: string;
  search: string;
  onSearch: (value: string) => void;
  loading: boolean;
  onRefresh: () => void;
  children?: React.ReactNode;
}) {
  const colors = useColors();
  const { t } = useI18n();
  return <View style={s.catalogHeaderRoot}>
    <View style={s.catalogHead}>
      <View>
        <Text style={[s.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={{ color: colors.mutedForeground }}>{detail}</Text>
      </View>
      <FocusButton
        label={loading ? t("loading") : t("refresh")}
        icon="refresh-cw"
        variant="ghost"
        onPress={onRefresh}
        disabled={loading}
      />
    </View>
    <View style={[s.search, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Feather name="search" size={18} color={colors.mutedForeground} />
      <TextInput
        value={search}
        onChangeText={onSearch}
        placeholder={`${t("search")} ${title.toLowerCase()}`}
        placeholderTextColor={colors.mutedForeground}
        style={{ flex: 1, color: colors.foreground, minHeight: 44 }}
      />
    </View>
    {children}
  </View>;
}

function SortControl({
  selected,
  supportsAdded,
  onSelect,
}: {
  selected: CatalogSortMode;
  supportsAdded: boolean;
  onSelect: (mode: CatalogSortMode) => void;
}) {
  const colors = useColors();
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  const options: Array<{ id: CatalogSortMode; label: string; short: string }> = [
    { id: "default", label: t("providerOrder"), short: language === "tr" ? "Varsayılan" : "Default" },
    { id: "alphaAsc", label: language === "tr" ? "Alfabetik — Artan (A-Z)" : "Alphabetical — Ascending (A-Z)", short: "A-Z ↑" },
    { id: "alphaDesc", label: language === "tr" ? "Alfabetik — Azalan (Z-A)" : "Alphabetical — Descending (Z-A)", short: "Z-A ↓" },
    { id: "idAsc", label: language === "tr" ? "ID — Artan" : "ID — Ascending", short: "ID ↑" },
    { id: "idDesc", label: language === "tr" ? "ID — Azalan" : "ID — Descending", short: "ID ↓" },
    ...(supportsAdded
      ? [{
          id: "added" as const,
          label: language === "tr" ? "Son eklenen (yeni → eski)" : "Newest added",
          short: language === "tr" ? "Son eklenen" : "Newest",
        }]
      : []),
  ];
  const active = options.find((option) => option.id === selected) ?? options[0];
  return <View style={s.sortDropdownWrap}>
    <Pressable
      onPress={() => setOpen((value) => !value)}
      style={[s.sortDropdownButton, { borderColor: open ? colors.primary : colors.border, backgroundColor: colors.card }]}
    >
      <Feather name="sliders" size={16} color={open ? colors.primary : colors.mutedForeground} />
      <Text style={{ flex: 1, color: colors.foreground, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>
        {language === "tr" ? "Sırala" : "Sort"}: {active.short}
      </Text>
      <Feather name={open ? "chevron-up" : "chevron-down"} size={17} color={colors.mutedForeground} />
    </Pressable>
    {open ? <View style={[s.sortDropdownMenu, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {options.map((option) => {
        const activeOption = option.id === selected;
        return <Pressable
          key={option.id}
          onPress={() => {
            onSelect(option.id);
            setOpen(false);
          }}
          style={[s.sortDropdownItem, { borderColor: activeOption ? colors.primary : "transparent" }]}
        >
          <View style={[s.drawerDot, { backgroundColor: activeOption ? colors.primary : "transparent", borderColor: activeOption ? colors.primary : colors.mutedForeground }]} />
          <Text style={{ flex: 1, color: activeOption ? colors.primary : colors.foreground, fontWeight: activeOption ? "800" : "600" }}>
            {option.label}
          </Text>
          {activeOption ? <Feather name="check" size={17} color={colors.primary} /> : null}
        </Pressable>;
      })}
    </View> : null}
  </View>;
}

function useCategoryDrawerSwipe(onOpen: () => void, disabled = false) {
  return useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        !disabled && gesture.dx > 18 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35,
      onPanResponderRelease: (_event, gesture) => {
        if (!disabled && gesture.dx > 55) onOpen();
      },
      onPanResponderTerminate: () => undefined,
    }),
    [disabled, onOpen],
  );
}

function CategoryDrawer({ visible, items, selected, onSelect, onClose }: {
  visible: boolean;
  items: CategoryOption[];
  selected: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.78, 560);
  const translateX = useRef(new Animated.Value(-drawerWidth)).current;
  const closingRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    closingRef.current = false;
    translateX.setValue(-drawerWidth);
    Animated.timing(translateX, { toValue: 0, duration: 190, useNativeDriver: true }).start();
  }, [drawerWidth, translateX, visible]);

  const closeAnimated = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    Animated.timing(translateX, { toValue: -drawerWidth, duration: 170, useNativeDriver: true }).start(() => {
      closingRef.current = false;
      onClose();
    });
  };

  const closeSwipe = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gesture) => gesture.dx < -18 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx < -45) closeAnimated();
      },
      onPanResponderTerminationRequest: () => true,
    }),
    [drawerWidth, translateX],
  );

  return <Modal visible={visible} transparent statusBarTranslucent animationType="fade" onRequestClose={closeAnimated}>
    <View style={s.drawerBackdrop}>
      <Animated.View
        style={[
          s.drawerPanel,
          {
            width: drawerWidth,
            paddingTop: Math.max(insets.top, 16),
            paddingBottom: Math.max(insets.bottom, 16),
            backgroundColor: colors.background,
            borderColor: colors.border,
            transform: [{ translateX }],
          },
        ]}
      >
        <View style={s.drawerHeader} {...closeSwipe.panHandlers}>
          <Text style={[s.drawerTitle, { color: colors.foreground }]}>Kategoriler</Text>
          <Pressable onPress={closeAnimated} style={s.iconButton}>
            <Feather name="x" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <FlatList
          style={s.drawerScroll}
          contentContainerStyle={s.drawerList}
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const active = selected === item.id;
            return <Pressable
              onPress={() => {
                onSelect(item.id);
                closeAnimated();
              }}
              style={[s.drawerItem, { borderColor: active ? colors.primary : colors.border, backgroundColor: colors.card }]}
            >
              <View style={[s.drawerDot, { backgroundColor: active ? colors.primary : "transparent", borderColor: active ? colors.primary : colors.mutedForeground }]} />
              <Text numberOfLines={2} style={{ flex: 1, color: active ? colors.primary : colors.foreground, fontWeight: active ? "800" : "600" }}>
                {item.name || "—"}
              </Text>
              {active ? <Feather name="check" size={18} color={colors.primary} /> : null}
            </Pressable>;
          }}
          nestedScrollEnabled
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
          initialNumToRender={16}
          maxToRenderPerBatch={20}
          windowSize={7}
        />
      </Animated.View>
      <Pressable style={s.drawerDismiss} onPress={closeAnimated} />
    </View>
  </Modal>;
}

function categoryOptions(categories: XtreamCategory[], allLabel: string): CategoryOption[] {
  return [
    { id: "__all__", name: allLabel },
    ...categories.map((item) => ({
      id: String(item.category_id),
      name: item.category_name || String(item.category_id),
    })),
  ];
}

function Poster({ uri, title }: { uri?: string; title: string }) {
  const colors = useColors();
  return uri
    ? <Image source={{ uri }} style={s.logo} />
    : <View style={[s.logo, { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }]}>
        <Text style={{ color: colors.primary, fontWeight: "800" }}>{title.slice(0, 2).toUpperCase()}</Text>
      </View>;
}

function GridCard({ title, image, onPress }: { title: string; image?: string; onPress: () => void }) {
  const colors = useColors();
  return <Pressable onPress={onPress} style={s.card}>
    <View style={[s.media, { borderColor: colors.border, backgroundColor: colors.card }]}> 
      {image
        ? <Image source={{ uri: image }} style={s.posterBig} resizeMode="cover" />
        : <View style={[s.posterBig, { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }]}>
            <Feather name="play-circle" size={30} color={colors.primary} />
          </View>}
      <Text numberOfLines={2} style={{ color: colors.foreground, fontWeight: "700", padding: 9 }}>{title}</Text>
    </View>
  </Pressable>;
}

export function PagedLiveCatalog({
  provider,
  snapshotCount,
  epgByChannel,
  favorites,
  epgLoading,
  refreshing,
  onRefresh,
  onOpen,
  onFavorite,
  onDrawerVisibilityChange,
}: {
  provider: ProviderConfig;
  snapshotCount: SnapshotCount;
  epgByChannel: ReadonlyMap<string, readonly EpgProgram[]>;
  favorites: string[];
  epgLoading: boolean;
  refreshing: boolean;
  onRefresh: () => Promise<void> | void;
  onOpen: (channel: Channel) => void;
  onFavorite: (id: string) => void;
  onDrawerVisibilityChange: (visible: boolean) => void;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [epgClock, setEpgClock] = useState(() => Date.now());
  const { categories, ready: categoriesReady, reload: reloadCategories } = useCategories(provider.id, "live");
  const [category, setCategory] = useRememberedCategory(provider.id, "live", categories, categoriesReady);
  const providerType = pagedProviderType(provider.type);
  const page = useCatalogPage({
    provider,
    providerType,
    kind: "live",
    categoryId: category,
    search,
    sort: "default",
    enabled: providerType !== null,
    snapshotCount: allOnlySnapshotCount(category, search, snapshotCount),
  });
  const drawerItems = useMemo(() => categoryOptions(categories, t("all")), [categories, t]);
  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true), drawerOpen);

  useEffect(() => {
    onDrawerVisibilityChange(drawerOpen);
  }, [drawerOpen, onDrawerVisibilityChange]);
  useEffect(() => () => onDrawerVisibilityChange(false), [onDrawerVisibilityChange]);
  useEffect(() => {
    const timer = setInterval(() => setEpgClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setEpgClock(Date.now()), [category, search]);
  const initialEmpty = page.loadingInitial && page.items.length === 0;
  if (initialEmpty) return <CatalogLoadingSkeleton text={t("loading")} />;

  return <View style={{ flex: 1 }} {...drawerSwipe.panHandlers}>
    <FlatList
      style={{ flex: 1 }}
      contentContainerStyle={s.liveListContent}
      data={page.items}
      keyExtractor={(channel) => channel.id}
      ListHeaderComponent={<CatalogHeader
        title={t("liveTv")}
        detail={`${t("channels", { count: countText(page.totalCount, page.countKnown) })}${epgLoading ? " · EPG…" : ""}`}
        search={search}
        onSearch={setSearch}
        loading={refreshing || page.loadingInitial}
        onRefresh={() => {
          void Promise.resolve(onRefresh()).finally(() => {
            reloadCategories();
            page.reload();
          });
        }}
      />}
      ListEmptyComponent={<Text style={{ color: colors.mutedForeground, textAlign: "center", paddingVertical: 30 }}>—</Text>}
      ListFooterComponent={<PageFooter loading={page.loadingMore} />}
      onEndReached={page.loadMore}
      onEndReachedThreshold={0.45}
      renderItem={({ item: channel }) => {
        const current = selectProgramsAt(epgByChannel.get(channel.id), epgClock).now;
        const endLabel = current
          ? new Date(current.end).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
          : undefined;
        return <View style={[s.liveRow, { borderColor: colors.border, backgroundColor: colors.card }]}> 
          <Pressable style={s.liveMain} onPress={() => onOpen(channel)}>
            <Poster uri={channel.logoUrl} title={channel.name} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "700" }}>{channel.name}</Text>
              <Text numberOfLines={1} style={[s.liveProgram, { color: current ? colors.foreground : colors.mutedForeground }]}> 
                {current ? `Şu an: ${current.title}${endLabel ? ` · ${endLabel}` : ""}` : "—"}
              </Text>
            </View>
          </Pressable>
          <Pressable onPress={() => onFavorite(channel.id)} style={s.iconButton}>
            <Feather name="star" size={20} color={favorites.includes(channel.id) ? colors.primary : colors.mutedForeground} />
          </Pressable>
        </View>;
      }}
      extraData={{ favorites, epgByChannel, epgClock }}
      initialNumToRender={16}
      maxToRenderPerBatch={12}
      windowSize={9}
      updateCellsBatchingPeriod={50}
      removeClippedSubviews={Platform.OS !== "web"}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    />
    <CategoryDrawer
      visible={drawerOpen}
      items={drawerItems}
      selected={category}
      onClose={() => setDrawerOpen(false)}
      onSelect={setCategory}
    />
  </View>;
}

export function PagedMoviesCatalog({
  provider,
  snapshotCount,
  sortMode,
  onSort,
  refreshing,
  onRefresh,
  onOpen,
  onDrawerVisibilityChange,
}: {
  provider: ProviderConfig;
  snapshotCount: SnapshotCount;
  sortMode: CatalogSortMode;
  onSort: (mode: CatalogSortMode) => void;
  refreshing: boolean;
  onRefresh: () => Promise<void> | void;
  onOpen: (item: XtreamVodItem) => void;
  onDrawerVisibilityChange: (visible: boolean) => void;
}) {
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { categories, ready: categoriesReady, reload: reloadCategories } = useCategories(provider.id, "vod");
  const [category, setCategory] = useRememberedCategory(provider.id, "vod", categories, categoriesReady);
  const providerType = pagedProviderType(provider.type);
  const effectiveSort: CatalogSortMode = provider.type === "m3u" && sortMode === "added" ? "default" : sortMode;
  const page = useCatalogPage({
    provider,
    providerType,
    kind: "vod",
    categoryId: category,
    search,
    sort: effectiveSort,
    enabled: providerType !== null,
    snapshotCount: allOnlySnapshotCount(category, search, snapshotCount),
  });
  const drawerItems = useMemo(() => categoryOptions(categories, t("all")), [categories, t]);
  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true), drawerOpen);
  const columns = width >= 900 ? 5 : width >= 650 ? 4 : width >= 420 ? 3 : 2;

  useEffect(() => onDrawerVisibilityChange(drawerOpen), [drawerOpen, onDrawerVisibilityChange]);
  useEffect(() => () => onDrawerVisibilityChange(false), [onDrawerVisibilityChange]);
  if (page.loadingInitial && page.items.length === 0) return <CatalogLoadingSkeleton text={t("loadingMovies")} />;

  return <View style={{ flex: 1 }} {...drawerSwipe.panHandlers}>
    <FlatList
      key={`movies-${columns}`}
      style={{ flex: 1 }}
      contentContainerStyle={s.gridListContent}
      data={page.items}
      numColumns={columns}
      keyExtractor={(item) => String(item.stream_id)}
      ListHeaderComponent={<CatalogHeader
        title={t("movies")}
        detail={t("titles", { count: countText(page.totalCount, page.countKnown) })}
        search={search}
        onSearch={setSearch}
        loading={refreshing || page.loadingInitial}
        onRefresh={() => {
          void Promise.resolve(onRefresh()).finally(() => {
            reloadCategories();
            page.reload();
          });
        }}
      >
        <SortControl selected={effectiveSort} supportsAdded={provider.type === "xtream"} onSelect={onSort} />
      </CatalogHeader>}
      ListFooterComponent={<PageFooter loading={page.loadingMore} />}
      ListEmptyComponent={<View style={s.emptyGrid}><Text>—</Text></View>}
      onEndReached={page.loadMore}
      onEndReachedThreshold={0.55}
      renderItem={({ item }) => <View style={{ width: `${100 / columns}%` }}>
        <GridCard title={item.name} image={item.stream_icon} onPress={() => onOpen(item)} />
      </View>}
      initialNumToRender={Math.max(8, columns * 3)}
      maxToRenderPerBatch={Math.max(8, columns * 3)}
      windowSize={7}
      removeClippedSubviews={Platform.OS !== "web"}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    />
    <CategoryDrawer visible={drawerOpen} items={drawerItems} selected={category} onClose={() => setDrawerOpen(false)} onSelect={setCategory} />
  </View>;
}

export function PagedSeriesCatalog({
  provider,
  snapshotCount,
  sortMode,
  onSort,
  refreshing,
  onRefresh,
  selected,
  info,
  onOpen,
  onBack,
  onEpisode,
  onDrawerVisibilityChange,
}: {
  provider: ProviderConfig;
  snapshotCount: SnapshotCount;
  sortMode: CatalogSortMode;
  onSort: (mode: CatalogSortMode) => void;
  refreshing: boolean;
  onRefresh: () => Promise<void> | void;
  selected: XtreamSeriesItem | null;
  info: XtreamSeriesInfo | null;
  onOpen: (item: XtreamSeriesItem) => void;
  onBack: () => void;
  onEpisode: (episode: XtreamEpisode) => void;
  onDrawerVisibilityChange: (visible: boolean) => void;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { categories, ready: categoriesReady, reload: reloadCategories } = useCategories(provider.id, "series");
  const [category, setCategory] = useRememberedCategory(provider.id, "series", categories, categoriesReady);
  const providerType = pagedProviderType(provider.type);
  const effectiveSort: CatalogSortMode = provider.type === "m3u" && sortMode === "added" ? "default" : sortMode;
  const page = useCatalogPage({
    provider,
    providerType,
    kind: "series",
    categoryId: category,
    search,
    sort: effectiveSort,
    enabled: providerType !== null && selected === null,
    snapshotCount: allOnlySnapshotCount(category, search, snapshotCount),
  });
  const drawerItems = useMemo(() => categoryOptions(categories, t("all")), [categories, t]);
  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true), drawerOpen);
  const columns = width >= 900 ? 5 : width >= 650 ? 4 : width >= 420 ? 3 : 2;

  useEffect(() => onDrawerVisibilityChange(drawerOpen), [drawerOpen, onDrawerVisibilityChange]);
  useEffect(() => () => onDrawerVisibilityChange(false), [onDrawerVisibilityChange]);
  if (selected) {
    const groups = Object.entries(info?.episodes || {});
    return <View style={s.seriesDetail}>
      <FocusButton label={t("back")} icon="arrow-left" variant="ghost" onPress={onBack} />
      <Text style={[s.title, { color: colors.foreground, marginTop: 14 }]}>{selected.name}</Text>
      {!info
        ? <CatalogLoadingSkeleton text={t("loadingEpisodes")} />
        : groups.length
          ? groups.map(([season, episodes]) => <View key={season} style={{ marginTop: 18 }}>
              <Text style={[s.section, { color: colors.foreground }]}>{t("season")} {season}</Text>
              <View style={s.list}>{episodes.map((episode) => <Pressable
                key={String(episode.id)}
                onPress={() => onEpisode(episode)}
                style={[s.episode, { borderColor: colors.border, backgroundColor: colors.card }]}
              >
                <Text style={{ color: colors.foreground, flex: 1 }}>{episode.title || `${t("episode")} ${episode.episode_num ?? ""}`}</Text>
                <Feather name="play-circle" size={24} color={colors.primary} />
              </Pressable>)}</View>
            </View>)
          : <Text style={{ color: colors.mutedForeground }}>{t("noEpisodes")}</Text>}
    </View>;
  }

  if (page.loadingInitial && page.items.length === 0) return <CatalogLoadingSkeleton text={t("loadingSeries")} />;

  return <View style={{ flex: 1 }} {...drawerSwipe.panHandlers}>
    <FlatList
      key={`series-${columns}`}
      style={{ flex: 1 }}
      contentContainerStyle={s.gridListContent}
      data={page.items}
      numColumns={columns}
      keyExtractor={(item) => String(item.series_id)}
      ListHeaderComponent={<CatalogHeader
        title={t("series")}
        detail={t("seriesCount", { count: countText(page.totalCount, page.countKnown) })}
        search={search}
        onSearch={setSearch}
        loading={refreshing || page.loadingInitial}
        onRefresh={() => {
          void Promise.resolve(onRefresh()).finally(() => {
            reloadCategories();
            page.reload();
          });
        }}
      >
        <SortControl selected={effectiveSort} supportsAdded={provider.type === "xtream"} onSelect={onSort} />
      </CatalogHeader>}
      ListFooterComponent={<PageFooter loading={page.loadingMore} />}
      ListEmptyComponent={<View style={s.emptyGrid}><Text>—</Text></View>}
      onEndReached={page.loadMore}
      onEndReachedThreshold={0.55}
      renderItem={({ item }) => <View style={{ width: `${100 / columns}%` }}>
        <GridCard title={item.name} image={item.cover} onPress={() => onOpen(item)} />
      </View>}
      initialNumToRender={Math.max(8, columns * 3)}
      maxToRenderPerBatch={Math.max(8, columns * 3)}
      windowSize={7}
      removeClippedSubviews={Platform.OS !== "web"}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    />
    <CategoryDrawer visible={drawerOpen} items={drawerItems} selected={category} onClose={() => setDrawerOpen(false)} onSelect={setCategory} />
  </View>;
}

const s = StyleSheet.create({
  catalogHeaderRoot: { paddingBottom: 4 },
  catalogHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: "800", marginBottom: 6 },
  section: { fontSize: 20, fontWeight: "800" },
  search: { borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  sortDropdownWrap: { paddingTop: 10, paddingBottom: 10, alignSelf: "stretch" },
  sortDropdownButton: { minHeight: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  sortDropdownMenu: { marginTop: 6, borderWidth: 1, borderRadius: 12, padding: 6, gap: 3 },
  sortDropdownItem: { minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 9 },
  liveListContent: { padding: 18, paddingBottom: 40, maxWidth: 1500, width: "100%", alignSelf: "center", gap: 8 },
  gridListContent: { padding: 18, paddingBottom: 40, maxWidth: 1500, width: "100%", alignSelf: "center" },
  liveRow: { borderWidth: 1, borderRadius: 14, padding: 8, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  liveMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  liveProgram: { fontSize: 12.5, marginTop: 3 },
  logo: { width: 50, height: 50, borderRadius: 10 },
  iconButton: { padding: 10 },
  card: { padding: 6 },
  media: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  posterBig: { width: "100%", aspectRatio: 2 / 3 },
  pageFooter: { height: 64, alignItems: "center", justifyContent: "center" },
  pageFooterSpacer: { height: 20 },
  skeletonRoot: { flex: 1, minHeight: 220, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  emptyGrid: { padding: 30, alignItems: "center" },
  seriesDetail: { flex: 1, padding: 18, maxWidth: 1500, width: "100%", alignSelf: "center" },
  list: { gap: 8 },
  episode: { borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  drawerBackdrop: { flex: 1, flexDirection: "row", backgroundColor: "rgba(0,0,0,0.52)" },
  drawerPanel: { height: "100%", minHeight: 0, borderRightWidth: StyleSheet.hairlineWidth, elevation: 18, shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 7, height: 0 } },
  drawerScroll: { flex: 1, minHeight: 0 },
  drawerDismiss: { flex: 1 },
  drawerHeader: { minHeight: 58, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth },
  drawerTitle: { fontSize: 22, fontWeight: "900" },
  drawerList: { padding: 12, gap: 7, paddingBottom: 24 },
  drawerItem: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  drawerDot: { width: 8, height: 8, borderRadius: 8, borderWidth: 1 },
});
