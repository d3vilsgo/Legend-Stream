import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { useI18n } from "@/context/I18nContext";
import { useColors } from "@/hooks/useColors";
import { shouldUseWholeCatalogLoadingSkeleton } from "@/lib/catalogSearchPresentation";
import {
  useStalkerMoviesCatalog,
  type StalkerMoviePlayable,
} from "@/hooks/useStalkerMoviesCatalog";
import type { StalkerProductProviderIdentity } from "@/lib/stalkerProductSession";
import { isStalkerVodGlobalCategory, type StalkerVodItem } from "@/lib/stalkerVod";

export type { StalkerMoviePlayable } from "@/hooks/useStalkerMoviesCatalog";

type CatalogSortMode = "default" | "alphaAsc" | "alphaDesc" | "idAsc" | "idDesc";
type CategoryOption = { id: string; name: string; order: number };

export function StalkerGoldenMoviesCatalog({
  provider,
  onPlayable,
  onError,
  onDrawerVisibilityChange,
}: {
  provider: StalkerProductProviderIdentity;
  onPlayable: (playable: StalkerMoviePlayable) => void;
  onError: (error: string | null) => void;
  onDrawerVisibilityChange: (visible: boolean) => void;
}) {
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const [sort, setSort] = useState<CatalogSortMode>("default");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const catalog = useStalkerMoviesCatalog({ provider, moviesLabel: t("movies"), onPlayable });

  useEffect(() => {
    onDrawerVisibilityChange(drawerOpen);
    return () => onDrawerVisibilityChange(false);
  }, [drawerOpen, onDrawerVisibilityChange]);

  useEffect(() => {
    onError(catalog.error);
    return () => onError(null);
  }, [catalog.error, onError]);

  const categoryOptions = useMemo<CategoryOption[]>(
    () => catalog.categories.map((category, order) => ({
      id: category.id,
      name: category.id === "*" ? t("all") : category.title,
      order,
    })),
    [catalog.categories, t],
  );
  const sortedItems = useMemo(() => sortMovies(catalog.visibleItems, sort), [catalog.visibleItems, sort]);
  const globalCategoryId = catalog.categories.find(isStalkerVodGlobalCategory)?.id;
  const activeCategoryLabel = catalog.categories.find((category) =>
    category.id === catalog.selectedCategoryId && category.id !== globalCategoryId,
  )?.title;
  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true), drawerOpen);
  const columns = width >= 900 ? 5 : width >= 650 ? 4 : width >= 420 ? 3 : 2;

  if (shouldUseWholeCatalogLoadingSkeleton(catalog.loadingInitial, catalog.visibleItems.length, catalog.search)) {
    return <CatalogLoadingSkeleton text={t("loadingMovies")} />;
  }

  return <View style={{ flex: 1 }} {...drawerSwipe.panHandlers}>
    <FlatList
      key={`stalker-movies-${columns}`}
      style={{ flex: 1 }}
      contentContainerStyle={s.gridListContent}
      data={sortedItems}
      numColumns={columns}
      keyExtractor={(item) => item.portalId}
      ListHeaderComponent={<CatalogHeader
        title={t("movies")}
        detail={t("titles", { count: catalog.totalItems?.toLocaleString() ?? "—" })}
        search={catalog.search}
        onSearch={catalog.setSearch}
        loading={catalog.loadingInitial || catalog.searching}
        onRefresh={() => void catalog.refresh()}
        activeCategoryLabel={activeCategoryLabel}
      >
        <SortControl selected={sort} onSelect={setSort} />
      </CatalogHeader>}
      ListFooterComponent={<PageFooter loading={catalog.loadingMore} />}
      ListEmptyComponent={catalog.loadingInitial || catalog.searching
        ? <CatalogLoadingSkeleton text={t("loadingMovies")} />
        : <View style={s.emptyGrid}><Text>—</Text></View>}
      onEndReached={catalog.loadMore}
      onEndReachedThreshold={0.55}
      renderItem={({ item }) => <View style={{ width: `${100 / columns}%` }}>
        <GridCard
          title={item.title}
          image={item.posterUrl}
          onPress={() => void catalog.openMovie(item)}
        />
      </View>}
      initialNumToRender={Math.max(8, columns * 3)}
      maxToRenderPerBatch={Math.max(8, columns * 3)}
      windowSize={7}
      removeClippedSubviews={Platform.OS !== "web"}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    />
    <CategoryDrawer
      visible={drawerOpen}
      items={categoryOptions}
      selected={catalog.selectedCategoryId ?? ""}
      onClose={() => setDrawerOpen(false)}
      onSelect={catalog.selectCategory}
    />
  </View>;
}

function sortMovies(items: readonly StalkerVodItem[], sort: CatalogSortMode) {
  if (sort === "default") return items;
  return [...items].sort((left, right) => {
    if (sort === "alphaAsc" || sort === "alphaDesc") {
      const compared = left.title.localeCompare(right.title, "tr", { sensitivity: "base" });
      return sort === "alphaAsc" ? compared : -compared;
    }
    const leftNumber = Number(left.portalId);
    const rightNumber = Number(right.portalId);
    const compared = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
      ? leftNumber - rightNumber
      : left.portalId.localeCompare(right.portalId);
    return sort === "idAsc" ? compared : -compared;
  });
}

function CatalogLoadingSkeleton({ text }: { text: string }) {
  const colors = useColors();
  return <View style={s.skeletonRoot}>
    <ActivityIndicator size="small" color={colors.primary} />
    <Text style={{ color: colors.mutedForeground, fontWeight: "600" }}>{text}</Text>
  </View>;
}

function CatalogHeader({ title, detail, search, onSearch, loading, onRefresh, children, activeCategoryLabel }: {
  title: string;
  detail: string;
  search: string;
  onSearch: (value: string) => void;
  loading: boolean;
  onRefresh: () => void;
  children?: React.ReactNode;
  activeCategoryLabel?: string;
}) {
  const colors = useColors();
  const { t } = useI18n();
  return <View style={s.catalogHeaderRoot}>
    <View style={s.catalogHead}>
      <View>
        <Text style={[s.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={{ color: colors.mutedForeground }}>{detail}</Text>
      </View>
      <FocusButton label={loading ? t("loading") : t("refresh")} icon="refresh-cw" variant="ghost" onPress={onRefresh} disabled={loading} />
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
    {activeCategoryLabel ? <View style={[s.activeCategoryChip, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Feather name="tag" size={14} color={colors.primary} />
      <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "700", flex: 1 }}>{activeCategoryLabel}</Text>
    </View> : null}
    {children}
  </View>;
}

function SortControl({ selected, onSelect }: { selected: CatalogSortMode; onSelect: (mode: CatalogSortMode) => void }) {
  const colors = useColors();
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  const options: Array<{ id: CatalogSortMode; label: string; short: string }> = [
    { id: "default", label: t("providerOrder"), short: language === "tr" ? "Varsayılan" : "Default" },
    { id: "alphaAsc", label: language === "tr" ? "Alfabetik — Artan (A-Z)" : "Alphabetical — Ascending (A-Z)", short: "A-Z ↑" },
    { id: "alphaDesc", label: language === "tr" ? "Alfabetik — Azalan (Z-A)" : "Alphabetical — Descending (Z-A)", short: "Z-A ↓" },
    { id: "idAsc", label: language === "tr" ? "ID — Artan" : "ID — Ascending", short: "ID ↑" },
    { id: "idDesc", label: language === "tr" ? "ID — Azalan" : "ID — Descending", short: "ID ↓" },
  ];
  const active = options.find((option) => option.id === selected) ?? options[0]!;
  return <View style={s.sortDropdownWrap}>
    <Pressable onPress={() => setOpen((value) => !value)} style={[s.sortDropdownButton, { borderColor: open ? colors.primary : colors.border, backgroundColor: colors.card }]}>
      <Feather name="sliders" size={16} color={open ? colors.primary : colors.mutedForeground} />
      <Text style={{ flex: 1, color: colors.foreground, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>
        {language === "tr" ? "Sırala" : "Sort"}: {active.short}
      </Text>
      <Feather name={open ? "chevron-up" : "chevron-down"} size={17} color={colors.mutedForeground} />
    </Pressable>
    {open ? <View style={[s.sortDropdownMenu, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {options.map((option) => {
        const activeOption = option.id === selected;
        return <Pressable key={option.id} onPress={() => { onSelect(option.id); setOpen(false); }} style={[s.sortDropdownItem, { borderColor: activeOption ? colors.primary : "transparent" }]}>
          <View style={[s.drawerDot, { backgroundColor: activeOption ? colors.primary : "transparent", borderColor: activeOption ? colors.primary : colors.mutedForeground }]} />
          <Text style={{ flex: 1, color: activeOption ? colors.primary : colors.foreground, fontWeight: activeOption ? "800" : "600" }}>{option.label}</Text>
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
      <Animated.View style={[s.drawerPanel, {
        width: drawerWidth,
        paddingTop: Math.max(insets.top, 16),
        paddingBottom: Math.max(insets.bottom, 16),
        backgroundColor: colors.background,
        borderColor: colors.border,
        transform: [{ translateX }],
      }]}>
        <View style={s.drawerHeader} {...closeSwipe.panHandlers}>
          <Text style={[s.drawerTitle, { color: colors.foreground }]}>Kategoriler</Text>
          <Pressable onPress={closeAnimated} style={s.iconButton}><Feather name="x" size={22} color={colors.mutedForeground} /></Pressable>
        </View>
        <FlatList
          style={s.drawerScroll}
          contentContainerStyle={s.drawerList}
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const active = selected === item.id;
            return <Pressable onPress={() => { onSelect(item.id); closeAnimated(); }} style={[s.drawerItem, { borderColor: active ? colors.primary : colors.border, backgroundColor: colors.card }]}>
              <View style={[s.drawerDot, { backgroundColor: active ? colors.primary : "transparent", borderColor: active ? colors.primary : colors.mutedForeground }]} />
              <Text numberOfLines={2} style={{ flex: 1, color: active ? colors.primary : colors.foreground, fontWeight: active ? "800" : "600" }}>{item.name || "—"}</Text>
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

function GridCard({ title, image, onPress }: { title: string; image?: string; onPress: () => void }) {
  const colors = useColors();
  return <Pressable onPress={onPress} style={s.card}>
    <View style={[s.media, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {image
        ? <Image source={{ uri: image }} style={s.posterBig} resizeMode="cover" />
        : <View style={[s.posterBig, { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }]}><Feather name="play-circle" size={30} color={colors.primary} /></View>}
      <Text numberOfLines={2} style={{ color: colors.foreground, fontWeight: "700", padding: 9 }}>{title}</Text>
    </View>
  </Pressable>;
}

function PageFooter({ loading }: { loading: boolean }) {
  const colors = useColors();
  return loading
    ? <View style={s.pageFooter}><ActivityIndicator size="small" color={colors.primary} /></View>
    : <View style={s.pageFooterSpacer} />;
}

const s = StyleSheet.create({
  catalogHeaderRoot: { paddingBottom: 4 },
  catalogHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: "800", marginBottom: 6 },
  search: { borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  activeCategoryChip: { alignSelf: "flex-start", maxWidth: "100%", borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 7 },
  sortDropdownWrap: { paddingTop: 10, paddingBottom: 10, alignSelf: "stretch" },
  sortDropdownButton: { minHeight: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  sortDropdownMenu: { marginTop: 6, borderWidth: 1, borderRadius: 12, padding: 6, gap: 3 },
  sortDropdownItem: { minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 9 },
  gridListContent: { padding: 18, paddingBottom: 40, maxWidth: 1500, width: "100%", alignSelf: "center" },
  card: { padding: 6 },
  media: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  posterBig: { width: "100%", aspectRatio: 2 / 3 },
  pageFooter: { height: 64, alignItems: "center", justifyContent: "center" },
  pageFooterSpacer: { height: 20 },
  skeletonRoot: { flex: 1, minHeight: 220, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  emptyGrid: { padding: 30, alignItems: "center" },
  iconButton: { padding: 10 },
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
