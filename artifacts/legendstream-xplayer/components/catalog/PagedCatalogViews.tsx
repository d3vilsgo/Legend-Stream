import { filterCategoryOptions } from "@/lib/categoryPresentation";
import { SeriesInfoModal } from "@/components/series/SeriesInfoModal";
import { pagedSeriesDetail } from "@/lib/seriesInfo";
import { beginPerformanceMeasurement, finishPerformanceMeasurement } from "@/lib/performanceDiagnostics";
import { MovieInfoModal } from "@/components/tmdb/MovieInfoModal";
import { currentMovie, pagedMovieInput, localXtreamMovie } from "@/lib/tmdb/movieInfoModel";
import { EliteLiveCatalog } from "@/components/elite/EliteLiveCatalog";
import { useNativeTvLayout } from "@/hooks/useNativeTvLayout";
import { useResponsiveCatalogGrid } from "@/hooks/useResponsiveCatalogGrid";
import {TVRemoteInspectorOverlay} from "@/components/tvPreview/TVRemoteInspector";
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
import { TVPreviewPressable, useTVPreviewFocus } from "@/components/tvPreview/TVPreviewFocus";
import { useUiPresentation } from "@/context/UiPresentationContext";
import { ManualEpgControl } from "@/components/catalog/ManualEpgControl";
import type { EpgProgram, ProviderConfig, ProviderType } from "@/context/PlayerContext";
import { selectProgramsAt } from "@/context/PlayerContext";
import { useI18n } from "@/context/I18nContext";
import { useColors } from "@/hooks/useColors";
import { useCatalogPage } from "@/hooks/useCatalogPage";
import { shouldUseWholeCatalogLoadingSkeleton } from "@/lib/catalogSearchPresentation";
import {
  recordM3ULivePress,
  recordM3ULivePressIn,
  recordM3ULivePressOut,
  recordM3UPagedLiveState,
} from "@/lib/m3uInAppDiagnostics";
import { getCachedCatalogCategories } from "@/lib/catalogPageRepository";
import {
  EPG_PAGED_SEED_LIMIT,
  registerEpgChannels,
} from "@/lib/epgRuntime";
import {
  readCatalogCategorySelection,
  rememberCatalogCategorySelection,
  validateCatalogCategorySelection,
  type CatalogCategoryMemoryKind,
} from "@/lib/catalogCategoryMemory";
import type { CatalogPageProviderType, CatalogPageSort } from "@/lib/catalogPaging";
import type { Channel } from "@/lib/iptv";
import {
  type GoldenSeriesCardModel,
  type GoldenSeriesDetailModel,
  type GoldenSeriesEpisodeModel,
  type GoldenSeriesSeasonModel,
} from "@/lib/goldenSeriesDetail";
import {
  findStalkerLiveProviderGlobalCategory,
  isStalkerLiveGlobalCategory,
} from "@/lib/stalkerLiveCategoryIntent";
import type {
  XtreamCategory,
  XtreamEpisode,
  XtreamSeriesInfo,
  XtreamSeriesItem,
  XtreamVodItem,
} from "@/lib/xtreamCatalog";

export type CatalogSortMode = CatalogPageSort;
export type CategoryOption = { id: string; name: string };
type SnapshotCount = { totalCount: number | null; countKnown: boolean };

export type {
  GoldenSeriesCardModel,
  GoldenSeriesDetailModel,
  GoldenSeriesEpisodeModel,
  GoldenSeriesSeasonModel,
} from "@/lib/goldenSeriesDetail";

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

function useCategories(providerId: string, kind: "live" | "vod" | "series", diagnosticM3U = false) {
  const [result, setResult] = useState<{
    providerId: string | null;
    categories: XtreamCategory[];
  }>({ providerId: null, categories: [] });
  const generationRef = useRef(0);
  const reload = () => {
    const generation = ++generationRef.current;
    const measurement = beginPerformanceMeasurement("FIRST_CATEGORY");
    void getCachedCatalogCategories(providerId, kind, diagnosticM3U)
      .then((next) => {
        if (generationRef.current === generation) {
          setResult({ providerId, categories: next });
          finishPerformanceMeasurement(measurement);
        } else finishPerformanceMeasurement(measurement, "CANCELLED");
      })
      .catch(() => {
        finishPerformanceMeasurement(measurement, generationRef.current === generation ? "ERROR" : "CANCELLED");
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
  }, [providerId, kind, diagnosticM3U]);
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

function useLiveCategorySelection(
  providerId: string,
  categories: XtreamCategory[],
  categoriesReady: boolean,
  explicitSelectionRequired: boolean,
  providerGlobalCategoryId: string | null,
) {
  const read = () => explicitSelectionRequired
    ? readCatalogCategorySelection(providerId, "live", null)
    : readCatalogCategorySelection(providerId, "live");
  const [category, setCategoryState] = useState<string | null>(read);

  useEffect(() => {
    setCategoryState(read());
  }, [providerId, explicitSelectionRequired]);

  useEffect(() => {
    if (!categoriesReady) return;
    const remembered = read();
    const validated = explicitSelectionRequired && remembered === "__all__" && providerGlobalCategoryId
      ? rememberCatalogCategorySelection(providerId, "live", providerGlobalCategoryId)
      : explicitSelectionRequired
        ? validateCatalogCategorySelection(
            providerId,
            "live",
            categories.map((item) => String(item.category_id)),
            null,
          )
        : validateCatalogCategorySelection(
            providerId,
            "live",
            categories.map((item) => String(item.category_id)),
          );
    const valid = explicitSelectionRequired && validated === null
      ? rememberCatalogCategorySelection(providerId, "live", providerGlobalCategoryId ?? "__all__")
      : validated;
    setCategoryState((current) => current === valid ? current : valid);
  }, [providerId, categories, categoriesReady, explicitSelectionRequired, providerGlobalCategoryId]);

  const setCategory = useCallback((categoryId: string) => {
    setCategoryState(rememberCatalogCategorySelection(providerId, "live", categoryId));
  }, [providerId]);

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

function CatalogLoadingSkeleton({ text, children }: { text: string; children?: React.ReactNode }) {
  const colors = useColors();
  return <View style={s.skeletonRoot}>
    {children}
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
  activeCategoryLabel,
  searchEnabled = true,
  onCategories,
}: {
  title: string;
  detail: string;
  search: string;
  onSearch: (value: string) => void;
  loading: boolean;
  onRefresh: () => void;
  children?: React.ReactNode;
  activeCategoryLabel?: string;
  searchEnabled?: boolean;
  onCategories?: () => void;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (searchOpen && searchEnabled) searchInputRef.current?.focus();
    else searchInputRef.current?.blur();
  }, [searchOpen, searchEnabled]);
  return <View style={s.catalogHeaderRoot}>
    <View style={s.catalogHead}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={Platform.isTV ? 1 : undefined} style={[s.title, { color: colors.foreground }]}>{title}</Text>
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
    <View style={Platform.isTV ? { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 } : undefined}>
    <TVPreviewPressable
      focusId="catalog:search-toggle"
      accessibilityRole="button"
      accessibilityLabel={searchOpen ? "Aramayı kapat" : `${title} ara`}
      accessibilityState={{ expanded: searchOpen }}
      onPress={() => setSearchOpen((value) => !value)}
      style={[s.sortDropdownButton, { borderColor: colors.border, backgroundColor: colors.card }]}
    >
      <Feather name={searchOpen ? "x" : "search"} size={18} color={colors.foreground} />
      <Text style={{ color: colors.foreground, fontWeight: "700" }}>{searchOpen ? "Aramayı kapat" : "Ara"}</Text>
    </TVPreviewPressable>
    {searchOpen ? <View style={[s.search, Platform.isTV && { flexGrow: 1, flexBasis: 240, minWidth: 180, marginBottom: 0 }, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Feather name="search" size={18} color={colors.mutedForeground} />
      <TextInput
        ref={searchInputRef}
        accessibilityLabel={`${title} arama sorgusu`}
        returnKeyType="search"
        value={search}
        onChangeText={onSearch}
        editable={searchEnabled}
        placeholder={`${t("search")} ${title.toLowerCase()}`}
        placeholderTextColor={colors.mutedForeground}
        style={{ flex: 1, color: colors.foreground, minHeight: 44, opacity: searchEnabled ? 1 : 0.55 }}
      />
    </View> : null}
    {activeCategoryLabel ? <View style={[s.activeCategoryChip, Platform.isTV && { maxWidth: 240 }, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Feather name="tag" size={14} color={colors.primary} />
      <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "700", flex: 1 }}>{activeCategoryLabel}</Text>
    </View> : null}
    {Platform.isTV && onCategories ? <TVPreviewPressable focusId="catalog:categories" accessibilityRole="button" accessibilityLabel="Kategoriler" onPress={onCategories} style={[s.sortDropdownButton, { borderColor: colors.border, backgroundColor: colors.card }]}><Feather name="grid" size={22} color={colors.foreground} /><Text style={{ color: colors.foreground, fontSize: 18 }}>Kategoriler</Text></TVPreviewPressable> : null}
    <View style={Platform.isTV ? { flexBasis: 200, flexGrow: 0, minWidth: 0, maxWidth: "100%" } : undefined}>{children}</View>
    </View>
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
    <TVPreviewPressable
      focusId="catalog:sort" accessibilityLabel="Sırala"
      onPress={() => setOpen((value) => !value)}
      style={[s.sortDropdownButton, { borderColor: open ? colors.primary : colors.border, backgroundColor: colors.card }]}
    >
      <Feather name="sliders" size={16} color={open ? colors.primary : colors.mutedForeground} />
      <Text style={{ flex: 1, color: colors.foreground, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>
        {language === "tr" ? "Sırala" : "Sort"}: {active.short}
      </Text>
      <Feather name={open ? "chevron-up" : "chevron-down"} size={17} color={colors.mutedForeground} />
    </TVPreviewPressable>
    {open ? <View style={[s.sortDropdownMenu, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {options.map((option) => {
        const activeOption = option.id === selected;
        return <TVPreviewPressable
          key={option.id}
          focusId={`catalog:sort:${option.id}`} accessibilityLabel={option.label}
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
        </TVPreviewPressable>;
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
  selected: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [categoryQuery,setCategoryQuery]=useState("");
  const filteredItems=useMemo(()=>filterCategoryOptions(items,categoryQuery),[items,categoryQuery]);
  const mobileSheet=!Platform.isTV;
  const drawerWidth = mobileSheet ? width : Math.min(width * 0.78, 560);
  const translateX = useRef(new Animated.Value(-drawerWidth)).current;
  const closingRef = useRef(false);
  const focus = useTVPreviewFocus();

  useEffect(() => {
    if (!visible) return;
    closingRef.current = false;
    setCategoryQuery("");
    translateX.setValue(-drawerWidth);
    Animated.timing(translateX, { toValue: 0, duration: 190, useNativeDriver: true }).start();
  }, [drawerWidth, translateX, visible]);

  const closeAnimated = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    Animated.timing(translateX, { toValue: -drawerWidth, duration: 170, useNativeDriver: true }).start(() => {
      closingRef.current = false;
      onClose();
    });
  }, [drawerWidth, onClose, translateX]);

  useEffect(() => {
    if (!visible) return;
    const popScope = focus.pushFocusScope("category-drawer");
    const unregisterBack = focus.registerBackAction(closeAnimated);
    return () => { unregisterBack(); popScope(); };
  }, [closeAnimated, focus.pushFocusScope, focus.registerBackAction, visible]);

  const closeSwipe = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gesture) => gesture.dx < -18 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx < -45) closeAnimated();
      },
      onPanResponderTerminationRequest: () => true,
    }),
    [closeAnimated, drawerWidth, translateX],
  );

  return <Modal visible={visible} transparent statusBarTranslucent animationType="fade" onRequestClose={closeAnimated}>
    <View style={[s.drawerBackdrop, mobileSheet && {justifyContent:"flex-end",flexDirection:"column"} ]}>
      <Animated.View
        style={[
          s.drawerPanel,
          {
            width: drawerWidth,
            paddingTop: Math.max(insets.top, 16),
            paddingBottom: Math.max(insets.bottom, 16),
            backgroundColor: colors.background,
            borderColor: colors.border,
            transform: mobileSheet ? [] : [{ translateX }],
            ...(mobileSheet ? {borderTopLeftRadius:24,borderTopRightRadius:24,maxHeight:"78%" as const,width:"100%" as const} : {}),
          },
        ]}
      >
        <View style={s.drawerHeader} {...closeSwipe.panHandlers}>
          <Text style={[s.drawerTitle, { color: colors.foreground }]}>Kategoriler</Text>
          <TVPreviewPressable focusId="category-drawer:close" focusScope="category-drawer" hasTVPreferredFocus={Platform.isTV && !items.some((item) => item.id === selected)} accessibilityRole="button" accessibilityLabel="Kategorileri kapat" onPress={closeAnimated} style={s.iconButton}>
            <Feather name="x" size={22} color={colors.mutedForeground} />
          </TVPreviewPressable>
        </View>
        <TextInput accessibilityLabel="Kategori ara" placeholder="Kategori ara…" placeholderTextColor={colors.mutedForeground} value={categoryQuery} onChangeText={setCategoryQuery} style={{marginHorizontal:18,marginBottom:12,minHeight:48,padding:14,borderRadius:14,borderWidth:1,borderColor:colors.border,color:colors.foreground}} />
        <FlatList
          ListEmptyComponent={<Text style={{color:colors.mutedForeground,padding:20}}>Kategori bulunamadı</Text>}
          style={s.drawerScroll}
          contentContainerStyle={s.drawerList}
          data={filteredItems}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const active = selected === item.id;
            return <TVPreviewPressable
              focusId={`category-drawer:item:${item.id}`}
              focusScope="category-drawer"
              hasTVPreferredFocus={Platform.isTV && item.id === selected}
              accessibilityRole="button"
              accessibilityLabel={item.name || "—"}
              accessibilityState={{ selected: active }}
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
            </TVPreviewPressable>;
          }}
          nestedScrollEnabled
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
          initialNumToRender={16}
          maxToRenderPerBatch={20}
          windowSize={7}
        />
      </Animated.View>
      <Pressable focusable={!Platform.isTV} style={[s.drawerDismiss, mobileSheet && {position:"absolute",top:0,left:0,right:0,height:"22%"}]} onPress={closeAnimated} />
    </View>
    <TVRemoteInspectorOverlay />
  </Modal>;
}

function categoryOptions(
  categories: XtreamCategory[],
  allLabel: string,
  preserveProviderGlobal = false,
): CategoryOption[] {
  const providerGlobal = preserveProviderGlobal ? findStalkerLiveProviderGlobalCategory(categories) : null;
  const options = [
    { id: providerGlobal ? String(providerGlobal.category_id) : "__all__", name: allLabel },
    ...categories.map((item) => ({
      id: String(item.category_id),
      name: item.category_name || String(item.category_id),
    })),
  ];
  if (!preserveProviderGlobal) {
    return options.filter((item, index) => index === 0 || !/^(?:all|tümü|tum)$/i.test(item.name.trim()));
  }
  return options.filter((item, index) => index === 0 || !isStalkerLiveGlobalCategory({
    category_id: item.id,
    category_name: item.name,
  }));
}

function Poster({ uri, title }: { uri?: string; title: string }) {
  const colors = useColors();
  return uri
    ? <Image source={{ uri }} style={s.logo} />
    : <View style={[s.logo, { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }]}>
        <Text style={{ color: colors.primary, fontWeight: "800" }}>{title.slice(0, 2).toUpperCase()}</Text>
      </View>;
}

function GridCard({ focusId, title, image, cardWidth, onPress }: { focusId: string; title: string; image?: string; cardWidth: number; onPress: () => void }) {
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  const titleFont = Math.max(12, Math.min(17, Math.round(cardWidth / 12)));
  const titleLine = Math.ceil(titleFont * 1.3);
  return <TVPreviewPressable eliteVisual focusId={focusId} accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={s.card}>
    <View style={[s.media, { borderColor: colors.border, backgroundColor: colors.card }]}> 
      {image
        ? <Image source={{ uri: image }} style={s.posterBig} resizeMode={Platform.isTV ? "contain" : "cover"} />
        : <View style={[s.posterBig, { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }]}>
            <Feather name="play-circle" size={30} color={colors.primary} />
          </View>}
      <Text numberOfLines={2} style={{ color: colors.foreground, fontWeight: "700", fontSize: titleFont, lineHeight: titleLine, minHeight: Math.ceil(titleLine * 2 * fontScale + 18), padding: cardWidth < 130 ? 6 : 9 }}>{title}</Text>
    </View>
  </TVPreviewPressable>;
}

export function PagedLiveCatalog({
  provider,
  snapshotCount,
  catalogRevision,
  hasMeaningfulM3ULiveGroups,
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
  catalogRevision?: number;
  hasMeaningfulM3ULiveGroups: boolean | null;
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
  const tvLayout = useNativeTvLayout();
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [epgClock, setEpgClock] = useState(() => Date.now());
  const liveUserScrolledRef = useRef(false);
  const { categories, ready: categoriesReady, reload: reloadCategories } = useCategories(provider.id, "live", provider.type === "m3u");
  const stalkerLive = provider.type === "stalker";
  const providerGlobal = stalkerLive ? findStalkerLiveProviderGlobalCategory(categories) : null;
  const [category, setCategory] = useLiveCategorySelection(
    provider.id,
    categories,
    categoriesReady,
    stalkerLive,
    providerGlobal ? String(providerGlobal.category_id) : null,
  );
  const requestCategory = category === "__all__" && providerGlobal
    ? String(providerGlobal.category_id)
    : category;
  const requestReady = !stalkerLive || (categoriesReady && requestCategory !== null);
  const providerType = pagedProviderType(provider.type);
  const page = useCatalogPage({
    provider,
    providerType,
    kind: "live",
    catalogRevision,
    categoryId: requestCategory ?? undefined,
    search,
    sort: "default",
    enabled: stalkerLive ? requestReady : providerType !== null,
    snapshotCount: requestCategory !== null
      && requestCategory === (providerGlobal ? String(providerGlobal.category_id) : "__all__")
      && search.trim() === ""
        ? snapshotCount
        : undefined,
  });
  const drawerItems = useMemo(
    () => categoryOptions(categories, t("all"), stalkerLive),
    [categories, stalkerLive, t],
  );
  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true), drawerOpen);
  const epgSeedKey = useMemo(
    () => page.items.slice(0, EPG_PAGED_SEED_LIMIT).map((channel) => channel.id).join("|"),
    [page.items],
  );

  useEffect(() => {
    onDrawerVisibilityChange(drawerOpen);
  }, [drawerOpen, onDrawerVisibilityChange]);
  useEffect(() => {
    if (provider.type !== "m3u") return;
    recordM3UPagedLiveState({
      pageLoadingInitial: page.loadingInitial,
      pageLoadingMore: page.loadingMore,
      pageItemsCount: page.items.length,
      parentRefreshing: refreshing,
      isEpgLoading: epgLoading,
      categoriesReady,
      selectedCategory: category,
    });
  }, [
    provider.type,
    page.loadingInitial,
    page.loadingMore,
    page.items.length,
    refreshing,
    epgLoading,
    categoriesReady,
    category,
  ]);
  useEffect(() => () => onDrawerVisibilityChange(false), [onDrawerVisibilityChange]);
  useEffect(() => {
    const timer = setInterval(() => setEpgClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    liveUserScrolledRef.current = false;
    setEpgClock(Date.now());
  }, [category, search]);
  useEffect(() => {
    if (stalkerLive && category === null && search) setSearch("");
  }, [stalkerLive, category, search]);
  useEffect(() => {
    if (!epgSeedKey) return;
    const seed = page.items.slice(0, EPG_PAGED_SEED_LIMIT);
    registerEpgChannels(provider.id, seed);
  }, [epgSeedKey, provider.id]);
  const initialEmpty = shouldUseWholeCatalogLoadingSkeleton(page.loadingInitial, page.items.length, search);
  if (stalkerLive && !categoriesReady) return <CatalogLoadingSkeleton text={t("loading")} />;
  if (initialEmpty && !Platform.isTV) return <CatalogLoadingSkeleton text={t("loading")} />;

  if (Platform.isTV) return <EliteLiveCatalog
    key={provider.id} idPrefix="live" categories={drawerItems} category={category} onCategory={setCategory}
    channels={page.items} epgByChannel={epgByChannel} clock={epgClock} favorites={favorites}
    loading={refreshing || page.loadingInitial} loadingMore={page.loadingMore} error={page.error}
    search={search} onSearch={setSearch} onLoadMore={page.loadMore}
    onRefresh={() => { void Promise.resolve(onRefresh()).finally(() => { reloadCategories(); page.reload(); }); }}
    onOpen={channel => { if(provider.type === "m3u") recordM3ULivePress(); onOpen(channel); }} onFavorite={onFavorite}
  />;

  return <View style={{ flex: 1, minHeight: 0 }} {...drawerSwipe.panHandlers}>
    <FlatList
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={[s.liveListContent, Platform.isTV && { paddingLeft: tvLayout.left, paddingRight: tvLayout.right, paddingBottom: tvLayout.bottom }]}
      data={page.items}
      keyExtractor={(channel) => channel.id}
      ListHeaderComponent={<CatalogHeader
        title={t("liveTv")}
        onCategories={() => setDrawerOpen(true)}
        detail={stalkerLive && category === null
          ? t("categoryNotSelected")
          : `${t("channels", { count: countText(page.totalCount, page.countKnown) })}${epgLoading ? " · EPG…" : ""}`}
        search={search}
        onSearch={setSearch}
        searchEnabled={!stalkerLive || category !== null}
        loading={refreshing || page.loadingInitial}
        onRefresh={() => {
          void Promise.resolve(onRefresh()).finally(() => {
            reloadCategories();
            page.reload();
          });
        }}
      >
        <ManualEpgControl providerId={provider.id} enabled={page.items.length > 0} />
        {provider.type === "m3u" && page.countKnown && hasMeaningfulM3ULiveGroups === false
          ? <Text style={[s.m3uHint, { color: colors.mutedForeground }]}>{t("m3uNoGroups")}</Text>
          : null}
      </CatalogHeader>}
      ListEmptyComponent={stalkerLive && category === null
        ? <View style={s.intentionalEmptyState}>
            <Text style={[s.intentionalEmptyTitle, { color: colors.foreground }]}>{t("selectCategory")}</Text>
            <Text style={{ color: colors.mutedForeground, textAlign: "center" }}>{t("selectCategoryHint")}</Text>
          </View>
        : page.loadingInitial
          ? <CatalogLoadingSkeleton text={t("loading")} />
          : <Text style={{ color: colors.mutedForeground, textAlign: "center", paddingVertical: 30 }}>—</Text>}
      ListFooterComponent={<PageFooter loading={page.loadingMore} />}
      onScroll={(event) => {
        if (Platform.isTV && event.nativeEvent.contentOffset.y > 0) liveUserScrolledRef.current = true;
      }}
      scrollEventThrottle={16}
      onScrollBeginDrag={() => {
        liveUserScrolledRef.current = true;
      }}
      onEndReached={() => {
        if (liveUserScrolledRef.current) page.loadMore();
      }}
      onEndReachedThreshold={0.45}
      renderItem={({ item: channel }) => {
        const current = selectProgramsAt(epgByChannel.get(channel.id), epgClock).now;
        const endLabel = current
          ? new Date(current.end).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
          : undefined;
        return <View style={[s.liveRow, { borderColor: colors.border, backgroundColor: colors.card }]}> 
          <TVPreviewPressable
            focusId={`live:${channel.id}`}
            accessibilityRole="button"
            accessibilityLabel={channel.name}
            style={s.liveMain}
            onPressIn={() => {
              if (provider.type === "m3u") recordM3ULivePressIn();
            }}
            onPress={() => {
              if (provider.type === "m3u") recordM3ULivePress();
              onOpen(channel);
            }}
            onPressOut={() => {
              if (provider.type === "m3u") recordM3ULivePressOut();
            }}
          >
            <Poster uri={channel.logoUrl} title={channel.name} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "700" }}>{channel.name}</Text>
              <Text numberOfLines={1} style={[s.liveProgram, { color: current ? colors.foreground : colors.mutedForeground }]}> 
                {current ? `Şu an: ${current.title}${endLabel ? ` · ${endLabel}` : ""}` : "—"}
              </Text>
            </View>
          </TVPreviewPressable>
          <TVPreviewPressable focusId={`live-favorite:${channel.id}`} accessibilityLabel={`${channel.name} favori`} onPress={() => onFavorite(channel.id)} style={s.iconButton}>
            <Feather name="star" size={20} color={favorites.includes(channel.id) ? colors.primary : colors.mutedForeground} />
          </TVPreviewPressable>
        </View>;
      }}
      extraData={{ favorites, epgByChannel, epgClock }}
      initialNumToRender={16}
      maxToRenderPerBatch={12}
      windowSize={9}
      updateCellsBatchingPeriod={50}
      removeClippedSubviews={!Platform.isTV && Platform.OS !== "web"}
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
  catalogRevision,
  sortMode,
  onSort,
  refreshing,
  onRefresh,
  onOpen,
  onDrawerVisibilityChange,
}: {
  provider: ProviderConfig;
  snapshotCount: SnapshotCount;
  catalogRevision?: number;
  sortMode: CatalogSortMode;
  onSort: (mode: CatalogSortMode) => void;
  refreshing: boolean;
  onRefresh: () => Promise<void> | void;
  onOpen: (item: XtreamVodItem) => void;
  onDrawerVisibilityChange: (visible: boolean) => void;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const { tvPreview } = useUiPresentation();
  const [infoSelection, setInfoSelection] = useState<{
    scope: string;
    item: XtreamVodItem;
  } | null>(null);
  // An identical stream_id under another provider/session is not the same film.
  const infoScope = JSON.stringify([provider.id, catalogRevision ?? null]);
  const currentInfoScope = useRef(infoScope);
  currentInfoScope.current = infoScope;
  const infoMovie = infoSelection?.scope === infoScope ? infoSelection.item : null;
  const setInfoMovie = (item: XtreamVodItem | null) =>
    setInfoSelection(item ? { scope: infoScope, item } : null);
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { categories, ready: categoriesReady, reload: reloadCategories } = useCategories(provider.id, "vod", provider.type === "m3u");
  const [category, setCategory] = useRememberedCategory(provider.id, "vod", categories, categoriesReady);
  const providerType = pagedProviderType(provider.type);
  const effectiveSort: CatalogSortMode = provider.type === "m3u" && sortMode === "added" ? "default" : sortMode;
  const page = useCatalogPage({
    provider,
    providerType,
    kind: "vod",
    categoryId: category,
    catalogRevision,
    search,
    sort: effectiveSort,
    enabled: providerType !== null,
    snapshotCount: allOnlySnapshotCount(category, search, snapshotCount),
  });
  const drawerItems = useMemo(() => categoryOptions(categories, t("all")), [categories, t]);
  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true), drawerOpen);
  const grid = useResponsiveCatalogGrid<(typeof page.items)[number]>(page.items.map(item => `vod:${item.stream_id}`), JSON.stringify([provider.id, catalogRevision ?? null, category, search, effectiveSort]));
  const columns = grid.columns;

  useEffect(() => { if (infoMovie && !currentMovie(page.items, String(infoMovie.stream_id), item => String(item.stream_id))) setInfoSelection(null); }, [page.items, infoMovie]);
  useEffect(() => onDrawerVisibilityChange(drawerOpen || infoMovie !== null), [drawerOpen, infoMovie, onDrawerVisibilityChange]);
  useEffect(() => () => onDrawerVisibilityChange(false), [onDrawerVisibilityChange]);
  if (shouldUseWholeCatalogLoadingSkeleton(page.loadingInitial, page.items.length, search)) return <CatalogLoadingSkeleton text={t("loadingMovies")} />;

  return <View style={{ flex: 1, minHeight: 0 }} {...drawerSwipe.panHandlers}>
    <FlatList
      {...grid.listProps}
      key={`movies-${columns}`}
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={[s.gridListContent, grid.contentStyle]}
      data={page.items}
      numColumns={columns}
      keyExtractor={(item) => String(item.stream_id)}
      ListHeaderComponent={<CatalogHeader
        title={t("movies")}
        onCategories={() => setDrawerOpen(true)}
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
      ListEmptyComponent={page.loadingInitial
        ? <CatalogLoadingSkeleton text={t("loadingMovies")} />
        : <View style={s.emptyGrid}><Text style={{ color: colors.mutedForeground }}>Katalogda film bulunamadı.</Text></View>}
      onEndReached={page.loadMore}
      onEndReachedThreshold={0.55}
      renderItem={({ item }) => <View style={{ width: `${100 / columns}%` }}>
        <GridCard focusId={`vod:${item.stream_id}`} title={item.name} image={item.stream_icon} cardWidth={grid.cardWidth} onPress={() => setInfoMovie(item)} />
      </View>}
      initialNumToRender={Math.max(8, columns * 3)}
      maxToRenderPerBatch={Math.max(8, columns * 3)}
      windowSize={7}
      removeClippedSubviews={!Platform.isTV && Platform.OS !== "web"}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    />
    {infoMovie ? <MovieInfoModal
      key={`${provider.id}:${infoMovie.stream_id}`}
      input={pagedMovieInput(provider.id,provider.type === "m3u" ? "m3u" : "xtream",String(catalogRevision ?? "catalog"),infoMovie)}
      local={localXtreamMovie(infoMovie)} onClose={() => setInfoMovie(null)} onPlay={() => { if (currentInfoScope.current !== infoScope) return; const current=currentMovie(page.items,String(infoMovie.stream_id),item=>String(item.stream_id)); if(current) onOpen(current); }}
    /> : null}
    <CategoryDrawer visible={drawerOpen} items={drawerItems} selected={category} onClose={() => setDrawerOpen(false)} onSelect={setCategory} />
  </View>;
}

export function GoldenSeriesCatalog({
  providerId,
  categories,
  selectedCategory,
  onSelectCategory,
  search,
  onSearch,
  sortMode,
  supportsAdded,
  onSort,
  refreshing,
  onRefresh,
  items,
  totalCount,
  countKnown,
  loadingInitial,
  loadingMore,
  onLoadMore,
  detail,
  detailLoading,
  error,
  onRetry,
  footerError,
  onRetryMore,
  onOpen,
  onBack,
  onEpisode,
  onDrawerVisibilityChange,
  activeCategoryLabel,
  detailSuspended = false,
  detailOnly = false,
  playbackBusy = false,
}: {
  providerId: string;
  categories: CategoryOption[];
  selectedCategory: string;
  onSelectCategory: (id: string) => void;
  search: string;
  onSearch: (value: string) => void;
  sortMode: CatalogSortMode;
  supportsAdded: boolean;
  onSort: (mode: CatalogSortMode) => void;
  refreshing: boolean;
  onRefresh: () => void;
  items: GoldenSeriesCardModel[];
  totalCount: number | null;
  countKnown: boolean;
  loadingInitial: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  detail: GoldenSeriesDetailModel | null;
  detailLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
  footerError?: string | null;
  onRetryMore?: () => void;
  onOpen: (id: string) => void;
  onBack: () => void;
  onEpisode: (seasonId: string, episodeId: string) => void;
  onDrawerVisibilityChange: (visible: boolean) => void;
  activeCategoryLabel?: string;
  detailSuspended?: boolean;
  detailOnly?: boolean;
  playbackBusy?: boolean;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const { tvPreview } = useUiPresentation();
  const { registerBackAction } = useTVPreviewFocus();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true), drawerOpen);
  const grid = useResponsiveCatalogGrid<(typeof items)[number]>(items.map(item => `series:${item.id}`), JSON.stringify([providerId, selectedCategory, search, sortMode]));
  const columns = grid.columns;
  useEffect(() => onDrawerVisibilityChange(drawerOpen || Boolean(detail)), [drawerOpen, detail, onDrawerVisibilityChange]);
  useEffect(() => () => onDrawerVisibilityChange(false), [onDrawerVisibilityChange]);

  const seriesModal = detail ? <SeriesInfoModal key={detail.id} providerId={providerId} detail={detail} loading={detailLoading} error={error} busy={playbackBusy} visible={!detailSuspended} onClose={onBack} onRetry={onRetry} onEpisode={onEpisode}/> : null;
  if(detailOnly) return seriesModal;
  if (!detail && shouldUseWholeCatalogLoadingSkeleton(loadingInitial, items.length, search)) return <CatalogLoadingSkeleton text={t("loadingSeries")} />;

  return <View style={{ flex: 1, minHeight: 0 }} {...drawerSwipe.panHandlers}>
    <FlatList
      {...grid.listProps}
      key={`golden-series-${columns}`}
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={[s.gridListContent, grid.contentStyle]}
      data={items}
      numColumns={columns}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={<CatalogHeader
        title={t("series")}
        onCategories={() => setDrawerOpen(true)}
        detail={t("seriesCount", { count: countText(totalCount, countKnown) })}
        search={search}
        onSearch={onSearch}
        loading={refreshing || loadingInitial}
        onRefresh={onRefresh}
        activeCategoryLabel={activeCategoryLabel}
      >
        <SortControl selected={sortMode} supportsAdded={supportsAdded} onSelect={onSort} />
      </CatalogHeader>}
      ListFooterComponent={footerError
        ? <CatalogErrorState message={footerError} onRetry={onRetryMore} />
        : <PageFooter loading={loadingMore} />}
      ListEmptyComponent={loadingInitial
        ? <CatalogLoadingSkeleton text={t("loadingSeries")} />
        : error
          ? <CatalogErrorState message={error} onRetry={onRetry} />
          : <View style={s.emptyGrid}><Text style={{ color: colors.mutedForeground }}>Katalogda dizi bulunamadı.</Text></View>}
      onEndReached={onLoadMore}
      onEndReachedThreshold={0.55}
      renderItem={({ item }) => <View style={{ width: `${100 / columns}%` }}>
        <GridCard focusId={`series:${item.id}`} title={item.title} image={item.image} cardWidth={grid.cardWidth} onPress={() => onOpen(item.id)} />
      </View>}
      initialNumToRender={Math.max(8, columns * 3)}
      maxToRenderPerBatch={Math.max(8, columns * 3)}
      windowSize={7}
      removeClippedSubviews={!Platform.isTV && Platform.OS !== "web"}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    />
    {seriesModal}
    <CategoryDrawer visible={drawerOpen} items={categories} selected={selectedCategory} onClose={() => setDrawerOpen(false)} onSelect={onSelectCategory} />
  </View>;
}

function CatalogErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const colors = useColors();
  const { t } = useI18n();
  return <View style={[s.catalogError, { borderColor: colors.destructive, backgroundColor: colors.card }]}>
    <Text style={{ color: colors.mutedForeground, flex: 1 }}>{message}</Text>
    {onRetry ? <FocusButton label={t("refresh")} icon="refresh-cw" variant="secondary" onPress={onRetry} /> : null}
  </View>;
}

export function PagedSeriesCatalog({
  provider,
  snapshotCount,
  catalogRevision,
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
  detailSuspended = false,
  detailLoading,
  detailError,
  onRetryDetail,
  playbackBusy = false,
}: {
  provider: ProviderConfig;
  snapshotCount: SnapshotCount;
  catalogRevision?: number;
  sortMode: CatalogSortMode;
  onSort: (mode: CatalogSortMode) => void;
  refreshing: boolean;
  onRefresh: () => Promise<void> | void;
  selected: XtreamSeriesItem | null;
  info: XtreamSeriesInfo | null;
  onOpen: (item: XtreamSeriesItem) => void;
  onBack: () => void;
  onEpisode: (episode: XtreamEpisode, seasonId: string) => void;
  detailSuspended?: boolean;
  detailLoading?: boolean;
  detailError?: string | null;
  onRetryDetail?: () => void;
  playbackBusy?: boolean;
  onDrawerVisibilityChange: (visible: boolean) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const { categories, ready: categoriesReady, reload: reloadCategories } = useCategories(provider.id, "series", provider.type === "m3u");
  const [category, setCategory] = useRememberedCategory(provider.id, "series", categories, categoriesReady);
  const providerType = pagedProviderType(provider.type);
  const effectiveSort: CatalogSortMode = provider.type === "m3u" && sortMode === "added" ? "default" : sortMode;
  const page = useCatalogPage({
    provider,
    providerType,
    kind: "series",
    categoryId: category,
    catalogRevision,
    search,
    sort: effectiveSort,
    enabled: providerType !== null,
    snapshotCount: allOnlySnapshotCount(category, search, snapshotCount),
  });
  const drawerItems = useMemo(() => categoryOptions(categories, t("all")), [categories, t]);
  const detail = selected ? pagedSeriesDetail(provider.id, provider.type === "m3u" ? "m3u" : "xtream", selected, info) : null;

  return <GoldenSeriesCatalog
    providerId={provider.id}
    categories={drawerItems}
    selectedCategory={category}
    onSelectCategory={setCategory}
    search={search}
    onSearch={setSearch}
    sortMode={effectiveSort}
    supportsAdded={provider.type === "xtream"}
    onSort={onSort}
    refreshing={refreshing}
    onRefresh={() => {
      void Promise.resolve(onRefresh()).finally(() => {
        reloadCategories();
        page.reload();
      });
    }}
    items={page.items.map((item) => ({ id: String(item.series_id), title: item.name, image: item.cover }))}
    totalCount={page.totalCount}
    countKnown={page.countKnown}
    loadingInitial={page.loadingInitial}
    loadingMore={page.loadingMore}
    onLoadMore={page.loadMore}
    detail={detail}
    detailLoading={detailLoading ?? Boolean(selected && !info)}
    detailSuspended={detailSuspended} playbackBusy={playbackBusy}
    error={detailError} onRetry={onRetryDetail}
    onOpen={(id) => { const item = page.items.find((candidate) => String(candidate.series_id) === id); if (item) onOpen(item); }}
    onBack={onBack}
    onEpisode={(seasonId, episodeId) => {
      const episode = info?.episodes?.[seasonId]?.find((candidate) => String(candidate.id) === episodeId);
      if (episode) onEpisode(episode, seasonId);
    }}
    onDrawerVisibilityChange={onDrawerVisibilityChange}
  />;
}

const s = StyleSheet.create({
  catalogHeaderRoot: { paddingBottom: 4 },
  m3uHint: { marginTop: 10, fontSize: 13 },
  catalogHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: "800", marginBottom: 6 },
  section: { fontSize: 20, fontWeight: "800" },
  search: { borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  activeCategoryChip: { alignSelf: "flex-start", maxWidth: "100%", borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 7 },
  sortDropdownWrap: { paddingTop: 10, paddingBottom: 10, alignSelf: "stretch" },
  sortDropdownButton: { minHeight: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  sortDropdownMenu: { marginTop: 6, borderWidth: 1, borderRadius: 12, padding: 6, gap: 3 },
  sortDropdownItem: { minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 9 },
  liveListContent: { padding: 18, paddingBottom: 40, maxWidth: 1500, width: "100%", alignSelf: "center", gap: 8 },
  gridListContent: { padding: 18, paddingBottom: 40, maxWidth: 1500, width: "100%", alignSelf: "center" },
  liveRow: { borderWidth: 1, borderRadius: 14, padding: 8, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  liveMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  liveProgram: { fontSize: 12.5, marginTop: 3 },
  intentionalEmptyState: { paddingHorizontal: 24, paddingVertical: 42, alignItems: "center", gap: 8 },
  intentionalEmptyTitle: { fontSize: 18, fontWeight: "800", textAlign: "center" },
  logo: { width: 50, height: 50, borderRadius: 10 },
  iconButton: { padding: 10 },
  card: { padding: 6 },
  media: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  posterBig: { width: "100%", aspectRatio: 2 / 3 },
  pageFooter: { height: 64, alignItems: "center", justifyContent: "center" },
  pageFooterSpacer: { height: 20 },
  skeletonRoot: { flex: 1, minHeight: 220, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  emptyGrid: { padding: 30, alignItems: "center" },
  catalogError: { margin: 18, borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  seriesDetail: { flex: 1, padding: 18, maxWidth: 1500, width: "100%", alignSelf: "center" },
  seriesDetailList: { flex: 1, maxWidth: 1500, width: "100%", alignSelf: "center" },
  seriesEpisodeListContent: { padding: 18, paddingBottom: 40 },
  seriesDetailMessage: { paddingVertical: 32, textAlign: "center", fontSize: 16 },
  seasonSelectorContent: { gap: 8, paddingVertical: 10, paddingRight: 18 },
  seasonChip: { minHeight: 42, borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
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
