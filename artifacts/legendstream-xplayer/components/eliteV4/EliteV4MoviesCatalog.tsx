import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Image,
  ImageBackground,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { usePlayer } from "@/context/PlayerContext";
import { useCatalogSync } from "@/context/CatalogSyncContext";
import { useCatalogPage } from "@/hooks/useCatalogPage";
import {
  useStalkerMoviesCatalog,
  type StalkerMoviePlayable,
} from "@/hooks/useStalkerMoviesCatalog";
import {
  readCurrentStalkerProductSession,
  type StalkerProductProviderIdentity,
} from "@/lib/stalkerProductSession";
import { getCachedCatalogCategories } from "@/lib/catalogPageRepository";
import type { CatalogPageSort } from "@/lib/catalogPaging";
import { useMovieInfoService } from "@/components/tmdb/MovieInfoServiceProvider";
import { MovieInfoModal } from "@/components/tmdb/MovieInfoModal";
import {
  beginMovieEnrichment,
  type MovieEnrichment,
} from "@/lib/tmdb/movieInfoService";
import { tmdbImageUrl } from "@/lib/tmdb/metadata";
import { movieInfoPresentation } from "@/lib/tmdb/movieInfoModel";
import { matchCacheKey } from "@/lib/tmdb/cache";
import { hasPlayerBackOwner } from "@/lib/playerRemoteOwnership";
import { normalizeImageUrl } from "@/lib/imageUrl";
import { useOptionalTVPreviewFocus } from "@/components/tvPreview/TVPreviewFocus";
import {
  v4PagedMovies,
  v4StalkerMovies,
  v4MovieFocusId,
  v4MoviesLayout,
  type V4Movie,
  type V4CatalogCard,
} from "@/lib/eliteV4Movies";
import { EliteV4FocusButton, useEliteV4Focus } from "./EliteV4FocusSurface";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";

type Category = { id: string; name: string };
const actionStyle = {
  minHeight: 44,
  paddingHorizontal: 13,
  borderWidth: 1,
  borderColor: theme.color.border,
  borderRadius: theme.radius.small,
  backgroundColor: theme.color.surface,
  justifyContent: "center" as const,
};
const movieFocusStyle = {
  borderWidth: 1,
  borderColor: theme.color.focus,
  shadowColor: theme.color.focus,
  shadowRadius: 8,
  shadowOpacity: 0.28,
  elevation: 3,
};
const sorts: readonly { id: CatalogPageSort; name: string }[] = [
  { id: "default", name: "Sağlayıcı sırası" },
  { id: "alphaAsc", name: "A → Z" },
  { id: "alphaDesc", name: "Z → A" },
];

export function EliteV4MoviesHero({
  movie,
  height,
  nextFocusId,
  onInfo,
  onPlay,
  onFocused,
  disabled,
  series = false,
}: {
  movie: V4CatalogCard | null;
  series?: boolean;
  height: number;
  nextFocusId: string;
  onInfo: () => void;
  onPlay: () => void;
  onFocused: () => void;
  disabled: boolean;
}) {
  const prefix = series ? "v4-series-" : "v4-movies-";
  const sidebar = series ? "sidebar-series" : "sidebar-movies";
  const service = useMovieInfoService();
  const [result, setResult] = useState<{
    key: string;
    value: MovieEnrichment;
  } | null>(null);
  const key = movie ? matchCacheKey(movie.input) : "";
  useEffect(() => {
    if (!movie) return;
    return beginMovieEnrichment(service, movie.input, (value) =>
      setResult({ key, value }),
    );
  }, [service, key]);
  const metadata =
    result?.key === key && result.value.status === "enriched"
      ? result.value.metadata
      : undefined;
  const seriesMetadata =
    series && metadata?.kind === "series" ? metadata : undefined;
  const info = movie
    ? series
      ? {
          title: movie.title,
          poster:
            movie.poster || tmdbImageUrl(seriesMetadata?.posterPath, "w342"),
          backdrop:
            tmdbImageUrl(seriesMetadata?.backdropPath, "w1280") ||
            movie.backdrop,
          overview: movie.local.overview || seriesMetadata?.overview,
          genre:
            movie.local.genre ||
            seriesMetadata?.genres.map((g) => g.name).join(" · "),
          year: movie.input.year || seriesMetadata?.year,
          rating: seriesMetadata?.voteAverage,
        }
      : movieInfoPresentation(movie.local, movie.input, metadata)
    : null;
  const background = normalizeImageUrl(info?.backdrop || info?.poster);
  const compact = height < 230;
  return (
    <View
      style={{
        minHeight: height,
        backgroundColor: theme.color.surfaceRaised,
        borderRadius: theme.radius.hero,
        overflow: "hidden",
        marginBottom: 16,
      }}
    >
      {background ? (
        <ImageBackground
          source={{ uri: background }}
          resizeMode="cover"
          style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
        />
      ) : null}
      <LinearGradient
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        colors={["rgba(5,9,15,0.94)", "rgba(5,9,15,0.72)", "rgba(5,9,15,0.20)"]}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          padding: compact ? 16 : 24,
        }}
      >
        <Text
          style={{
            color: theme.color.accent,
            fontSize: 11,
            letterSpacing: 1.6,
            marginBottom: 6,
          }}
        >
          {series ? "DİZİLER" : "FİLMLER"}
        </Text>
        <Text
          numberOfLines={compact ? 1 : 2}
          style={{
            color: theme.color.foreground,
            fontSize: compact ? 26 : 34,
            lineHeight: compact ? 30 : 39,
            fontWeight: "600",
            maxWidth: 780,
          }}
        >
          {info?.title || (series ? "Dizi kataloğunuz" : "Film kataloğunuz")}
        </Text>
        <Text
          numberOfLines={compact ? 1 : 2}
          style={{
            color: theme.color.muted,
            fontSize: 14,
            lineHeight: 20,
            maxWidth: 680,
            marginTop: 5,
          }}
        >
          {info?.overview ||
            (movie
              ? [info?.year, info?.genre].filter(Boolean).join(" · ") ||
                "Sağlayıcı kataloğunuzdan"
              : series
                ? "Diziler yüklendiğinde burada gösterilir."
                : "Filmler yüklendiğinde burada gösterilir.")}
        </Text>
        {series && (info?.year || info?.genre) ? (
          <Text
            numberOfLines={1}
            style={{ color: theme.color.muted, fontSize: 12, marginTop: 4 }}
          >
            {[info.year, info.genre].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
        {info?.rating !== undefined ? (
          <Text
            style={{ color: theme.color.accent, fontSize: 12, marginTop: 6 }}
          >
            TMDB ★ {info.rating.toFixed(1)}
          </Text>
        ) : null}
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 10,
            marginTop: 14,
          }}
        >
          <EliteV4FocusButton
            focusId={`${prefix}hero`}
            region="content"
            initial
            disabled={disabled}
            onFocused={onFocused}
            neighbors={{
              left: sidebar,
              right: movie ? `${prefix}play` : undefined,
              up: `${prefix}search`,
              down: nextFocusId,
            }}
            onPress={onInfo}
            accessibilityLabel={
              movie
                ? `${movie.title}, ${series ? "dizi" : "film"} bilgileri`
                : series
                  ? "Dizi katalog alanı"
                  : "Film katalog alanı"
            }
            style={actionStyle}
          >
            <Text style={{ color: theme.color.foreground, fontSize: 13 }}>
              {movie
                ? series
                  ? "Sezonlar ve bölümler"
                  : "Film bilgileri"
                : "Katalog"}
            </Text>
          </EliteV4FocusButton>
          {movie ? (
            <EliteV4FocusButton
              focusId={`${prefix}play`}
              region="content"
              disabled={disabled}
              onFocused={onFocused}
              neighbors={{
                left: `${prefix}hero`,
                up: `${prefix}search`,
                down: nextFocusId,
              }}
              onPress={onPlay}
              accessibilityLabel={`${movie.title}, ${series ? "bölümleri aç" : "filmi izle"}`}
              style={{ ...actionStyle, backgroundColor: theme.color.accent }}
            >
              <Text
                style={{
                  color: theme.color.background,
                  fontSize: 13,
                  fontWeight: "600",
                }}
              >
                {series ? "Bölümleri aç" : "Filmi izle"}
              </Text>
            </EliteV4FocusButton>
          ) : null}
        </View>
      </View>
    </View>
  );
}

type MoviesViewProps<T extends V4CatalogCard> = {
  series?: boolean;
  renderInfo?: (item: T, origin: string, close: () => void) => React.ReactNode;
  items: readonly T[];
  categories: readonly Category[];
  category: string | null;
  onCategory: (id: string) => void;
  search: string;
  onSearch: (value: string) => void;
  sort: CatalogPageSort;
  onSort: (value: CatalogPageSort) => void;
  supportsAdded?: boolean;
  partialSort?: boolean;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: boolean;
  count: number | null;
  scope: string;
  onMore: () => void;
  onReload: () => void;
  onPlay: (movie: T, origin: string) => void;
  onBack: () => void;
  active?: boolean;
  busy?: boolean;
};
export function EliteV4MoviesView<T extends V4CatalogCard>(
  props: MoviesViewProps<T>,
) {
  const series = props.series ?? false;
  const prefix = series ? "v4-series-" : "v4-movies-";
  const sidebar = series ? "sidebar-series" : "sidebar-movies";
  const cardId = (id: string) => `${prefix}card:${id}`;
  const {
    items,
    categories,
    category,
    search,
    sort,
    scope,
    active = true,
  } = props;
  const dimensions = useWindowDimensions();
  const [width, setWidth] = useState(
    dimensions.width - theme.layout.sidebarCompact,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [selection, setSelection] = useState<{
    id: string;
    scope: string;
    origin: string;
  } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selectionOwner = useRef(selection);
  selectionOwner.current = selection;
  const list = useRef<FlatList<readonly T[]>>(null);
  const input = useRef<TextInput>(null);
  const categoryList = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});
  const headerHeight = useRef(0);
  const latest = useRef(props);
  latest.current = props;
  const focus = useEliteV4Focus();
  const preview = useOptionalTVPreviewFocus();
  const layout = v4MoviesLayout(
    width,
    dimensions.height,
    dimensions.fontScale,
    Platform.isTV,
  );
  const rows = useMemo(() => {
    const next: T[][] = [];
    for (let i = 0; i < items.length; i += layout.columns)
      next.push(items.slice(i, i + layout.columns));
    return next;
  }, [items, layout.columns]);
  const first = items[0] ? cardId(items[0].id) : `${prefix}status`;
  const currentInfo =
    selection?.scope === scope
      ? items.find((item) => item.id === selection.id)
      : null;
  const backBlocked = !active || !!currentInfo;
  const blocked = backBlocked || !!props.busy;
  const valid = (movie: T) =>
    latest.current.active !== false && latest.current.scope === scope
      ? latest.current.items.find((item) => item.id === movie.id)
      : undefined;
  const play = (movie: T, origin: string) => {
    const current = valid(movie);
    if (current && !latest.current.busy && (!series || mounted.current))
      props.onPlay(current, origin);
  };
  const info = (movie: T, origin: string) => {
    if (!latest.current.busy && valid(movie) && (!series || mounted.current)) {
      const next = { id: movie.id, scope, origin };
      selectionOwner.current = next;
      setSelection(next);
    }
  };
  const closeInfo = () => {
    if (
      series &&
      (selectionOwner.current !== selection || latest.current.scope !== scope)
    )
      return;
    selectionOwner.current = null;
    setSelection(null);
    if (
      selection &&
      latest.current.scope === selection.scope &&
      latest.current.active !== false
    )
      requestAnimationFrame(() => {
        if (
          !series ||
          (mounted.current &&
            latest.current.scope === selection.scope &&
            latest.current.active !== false &&
            !selectionOwner.current)
        )
          focus.focus(selection.origin);
      });
  };
  const back = () => {
    if (searchOpen) {
      input.current?.blur();
      setSearchOpen(false);
      focus.focus(`${prefix}search`);
    } else props.onBack();
  };
  useEffect(() => {
    if (!active) {
      input.current?.blur();
      setSearchOpen(false);
    }
  }, [active]);
  useEffect(() => {
    if (searchOpen) input.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    setSelection(null);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [scope]);
  useEffect(() => {
    if (backBlocked || !preview?.enabled) return;
    return preview.registerBackAction(back);
  }, [
    backBlocked,
    preview?.enabled,
    preview?.registerBackAction,
    searchOpen,
    props.onBack,
  ]);
  useEffect(() => {
    if (backBlocked || !Platform.isTV) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (hasPlayerBackOwner()) return false;
      back();
      return true;
    });
    return () => sub.remove();
  }, [backBlocked, searchOpen, props.onBack]);
  useEffect(() => {
    if (!active || !focus.focusedId?.startsWith(`${prefix}card:`)) return;
    const id = focus.focusedId;
    requestAnimationFrame(() => focus.focus(id));
  }, [layout.columns]);
  const action = (
    id: string,
    label: string,
    callback: () => void,
    left: string,
    right?: string,
  ) => (
    <EliteV4FocusButton
      focusId={id}
      region="content"
      disabled={blocked}
      accessibilityLabel={label}
      onPress={callback}
      onFocused={() =>
        list.current?.scrollToOffset({ offset: 0, animated: true })
      }
      neighbors={{ left, right, down: `${prefix}hero` }}
      style={actionStyle}
    >
      <Text style={{ color: theme.color.foreground, fontSize: 13 }}>
        {label}
      </Text>
    </EliteV4FocusButton>
  );
  const availableSorts = props.supportsAdded
    ? [...sorts, { id: "added" as const, name: "Son eklenen" }]
    : sorts;
  const header = (
    <View
      onLayout={(event) => {
        headerHeight.current = event.nativeEvent.layout.height;
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 14,
        }}
      >
        <Text
          style={{
            flex: 1,
            minWidth: 100,
            color: theme.color.foreground,
            fontSize: 23,
            fontWeight: "600",
          }}
        >
          {series ? "Diziler" : "Filmler"}
          {props.count !== null ? ` · ${props.count}` : ""}
        </Text>
        {action(
          `${prefix}search`,
          searchOpen ? "Aramayı kapat" : series ? "Dizi ara" : "Film ara",
          () => setSearchOpen((value) => !value),
          sidebar,
          `${prefix}sort`,
        )}
        {action(
          `${prefix}sort`,
          availableSorts.find((item) => item.id === sort)?.name ||
            "Sağlayıcı sırası",
          () =>
            props.onSort(
              availableSorts[
                (availableSorts.findIndex((item) => item.id === sort) + 1) %
                  availableSorts.length
              ].id,
            ),
          `${prefix}search`,
          `${prefix}back`,
        )}
        {action(`${prefix}back`, "Ana Sayfa", back, `${prefix}sort`)}
      </View>
      {searchOpen ? (
        <TextInput
          ref={input}
          accessibilityLabel={series ? "V4 dizi arama" : "V4 film arama"}
          placeholder={series ? "Dizi adı…" : "Film adı…"}
          placeholderTextColor={theme.color.quiet}
          value={search}
          onChangeText={props.onSearch}
          returnKeyType="search"
          onSubmitEditing={() => {
            input.current?.blur();
            setSearchOpen(false);
            focus.focus(`${prefix}search`);
          }}
          style={{
            minHeight: 44,
            paddingHorizontal: 12,
            marginBottom: 12,
            color: theme.color.foreground,
            borderRadius: theme.radius.small,
            borderWidth: 1,
            borderColor: theme.color.accent,
            backgroundColor: theme.color.surface,
          }}
        />
      ) : null}
      <EliteV4MoviesHero
        series={series}
        movie={items[0] ?? null}
        height={layout.heroHeight}
        nextFocusId={
          categories[0] ? `${prefix}category:${categories[0].id}` : first
        }
        onInfo={() => {
          if (items[0]) info(items[0], `${prefix}hero`);
        }}
        onPlay={() => {
          if (items[0]) {
            if (series) info(items[0], `${prefix}play`);
            else play(items[0], `${prefix}play`);
          }
        }}
        onFocused={() =>
          list.current?.scrollToOffset({ offset: 0, animated: true })
        }
        disabled={blocked || !!props.busy}
      />
      <ScrollView
        horizontal
        ref={categoryList}
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, marginBottom: 12 }}
        contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
      >
        {categories.map((item, index) => (
          <EliteV4FocusButton
            key={item.id}
            focusId={`${prefix}category:${item.id}`}
            region="content"
            disabled={blocked}
            selected={item.id === category}
            accessibilityLabel={item.name}
            onLayout={(event) => {
              offsets.current[item.id] = event.nativeEvent.layout.x;
            }}
            onFocused={() =>
              categoryList.current?.scrollTo({
                x: Math.max(0, (offsets.current[item.id] ?? 0) - 6),
                animated: true,
              })
            }
            onPress={() => props.onCategory(item.id)}
            neighbors={{
              left: index
                ? `${prefix}category:${categories[index - 1].id}`
                : sidebar,
              right: categories[index + 1]
                ? `${prefix}category:${categories[index + 1].id}`
                : undefined,
              up: `${prefix}hero`,
              down: first,
            }}
            style={{
              ...actionStyle,
              maxWidth: 240,
              backgroundColor:
                item.id === category
                  ? theme.color.accentSoft
                  : theme.color.surface,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                color:
                  item.id === category ? theme.color.accent : theme.color.muted,
                fontSize: 13,
              }}
            >
              {item.name}
            </Text>
          </EliteV4FocusButton>
        ))}
      </ScrollView>
      {props.partialSort && sort !== "default" ? (
        <Text
          style={{ color: theme.color.muted, fontSize: 12, marginBottom: 10 }}
        >
          Sıralama yalnız yüklenmiş Stalker kayıtları üzerinde uygulanır.
        </Text>
      ) : null}
      {props.error ? (
        <Text
          accessibilityRole="alert"
          style={{ color: theme.color.danger, marginBottom: 10 }}
        >
          {series
            ? "Dizi kataloğu güncellenemedi. Yeniden deneyebilirsiniz."
            : "Film kataloğu güncellenemedi. Yeniden deneyebilirsiniz."}
        </Text>
      ) : null}
    </View>
  );
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        backgroundColor: theme.color.background,
      }}
    >
      <FlatList
        ref={list}
        key={`movies-${layout.columns}`}
        data={rows}
        keyExtractor={(row) => row[0].id}
        extraData={{ blocked, scope }}
        ListHeaderComponent={header}
        contentContainerStyle={{ padding: layout.padding, gap: layout.gap }}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={false}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={7}
        onEndReached={() => {
          if (
            active &&
            !currentInfo &&
            !props.busy &&
            props.hasMore &&
            !props.loading &&
            !props.loadingMore &&
            !props.error
          )
            props.onMore();
        }}
        onEndReachedThreshold={0.5}
        renderItem={({ item: row, index: rowIndex }) => (
          <View style={{ flexDirection: "row", gap: layout.gap }}>
            {row.map((movie, column) => {
              const index = rowIndex * layout.columns + column;
              const up = items[index - layout.columns];
              const down =
                items[index + layout.columns] ??
                (rowIndex < rows.length - 1 ? items[items.length - 1] : null);
              const image = normalizeImageUrl(movie.poster);
              return (
                <EliteV4FocusButton
                  key={movie.id}
                  focusId={cardId(movie.id)}
                  region="content"
                  disabled={blocked}
                  accessibilityLabel={`${movie.title}, ${series ? "dizi" : "film"} bilgileri`}
                  onFocused={() =>
                    list.current?.scrollToOffset({
                      offset:
                        headerHeight.current +
                        rowIndex *
                          (layout.posterHeight +
                            layout.captionHeight +
                            layout.gap),
                      animated: true,
                    })
                  }
                  onPress={() => info(movie, cardId(movie.id))}
                  neighbors={{
                    left: column ? cardId(row[column - 1].id) : sidebar,
                    right: row[column + 1]
                      ? cardId(row[column + 1].id)
                      : undefined,
                    up: up ? cardId(up.id) : `${prefix}hero`,
                    down: down ? cardId(down.id) : `${prefix}status`,
                  }}
                  style={{
                    width: layout.cardWidth,
                    borderRadius: theme.radius.medium,
                    borderWidth: 1,
                    borderColor: theme.color.border,
                    backgroundColor: theme.color.surface,
                    overflow: "hidden",
                  }}
                >
                  {image ? (
                    <Image
                      source={{ uri: image }}
                      resizeMode="cover"
                      style={{ width: "100%", height: layout.posterHeight }}
                    />
                  ) : (
                    <View
                      style={{
                        height: layout.posterHeight,
                        justifyContent: "center",
                        alignItems: "center",
                        backgroundColor: theme.color.surfaceRaised,
                      }}
                    >
                      <Feather
                        name="film"
                        size={32}
                        color={theme.color.quiet}
                      />
                    </View>
                  )}
                  <View style={{ height: layout.captionHeight, padding: 10 }}>
                    <Text
                      numberOfLines={2}
                      style={{
                        color: theme.color.foreground,
                        fontSize: Platform.isTV ? 18 : 15,
                        lineHeight: Platform.isTV ? 24 : 20,
                        fontWeight: "500",
                      }}
                    >
                      {movie.title}
                    </Text>
                  </View>
                </EliteV4FocusButton>
              );
            })}
          </View>
        )}
        ListEmptyComponent={
          <View style={{ paddingVertical: 20 }}>
            {props.loading ? (
              <ActivityIndicator color={theme.color.accent} />
            ) : (
              <Text style={{ color: theme.color.muted }}>
                {props.error
                  ? series
                    ? "Diziler yüklenemedi."
                    : "Filmler yüklenemedi."
                  : search.trim()
                    ? series
                      ? "Aramanıza uygun dizi bulunamadı."
                      : "Aramanıza uygun film bulunamadı."
                    : series
                      ? "Bu kategoride dizi bulunmuyor."
                      : "Bu kategoride film bulunmuyor."}
              </Text>
            )}
          </View>
        }
        ListFooterComponent={
          <View>
            {props.loadingMore ? (
              <ActivityIndicator color={theme.color.accent} />
            ) : null}
            <EliteV4FocusButton
              focusId={`${prefix}status`}
              region="content"
              disabled={blocked || props.loading || props.loadingMore}
              accessibilityLabel={
                props.error
                  ? "Yeniden dene"
                  : props.hasMore
                    ? series
                      ? "Daha fazla dizi"
                      : "Daha fazla film"
                    : "Listenin başına dön"
              }
              neighbors={{
                left: sidebar,
                up: items.length
                  ? cardId(items[items.length - 1].id)
                  : `${prefix}hero`,
                down: `${prefix}hero`,
              }}
              onPress={() => {
                if (props.error) props.onReload();
                else if (props.hasMore) props.onMore();
                else {
                  list.current?.scrollToOffset({ offset: 0, animated: true });
                  focus.focus(`${prefix}hero`);
                }
              }}
              style={actionStyle}
            >
              <Text style={{ color: theme.color.foreground, fontSize: 13 }}>
                {props.error
                  ? "Yeniden dene"
                  : props.hasMore
                    ? series
                      ? "Daha fazla dizi"
                      : "Daha fazla film"
                    : "Listenin başına dön"}
              </Text>
            </EliteV4FocusButton>
          </View>
        }
      />
      {currentInfo && selection ? (
        props.renderInfo ? (
          props.renderInfo(currentInfo, selection.origin, closeInfo)
        ) : (
          <MovieInfoModal
            key={`${scope}:${currentInfo.id}`}
            input={currentInfo.input}
            local={currentInfo.local}
            focusVisualStyle={movieFocusStyle}
            onClose={closeInfo}
            closeOnPlay={false}
            onPlay={() => {
              if (
                latest.current.scope !== selection.scope ||
                latest.current.active === false
              )
                return;
              const current = latest.current.items.find(
                (item) => item.id === selection.id,
              );
              if (current) {
                setSelection(null);
                play(current, selection.origin);
              }
            }}
          />
        )
      ) : null}
    </View>
  );
}

type CatalogProps = {
  onPlay: (movie: V4Movie, origin: string) => void;
  onBack: () => void;
  active?: boolean;
};
function PagedMovies({
  provider,
  ...props
}: CatalogProps & {
  provider: NonNullable<ReturnType<typeof usePlayer>["provider"]>;
}) {
  const { snapshot, lastSuccessfulAt } = useCatalogSync();
  const [category, setCategory] = useState("__all__");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CatalogPageSort>("default");
  const [categories, setCategories] = useState<Category[]>([]);
  const revision = lastSuccessfulAt ?? 0;
  const scope = JSON.stringify([
    provider.id,
    provider.type,
    revision,
    category,
    search,
    sort,
  ]);
  const page = useCatalogPage({
    provider,
    providerType: provider.type as "xtream" | "m3u",
    kind: "vod",
    categoryId: category,
    search,
    sort,
    enabled: true,
    catalogRevision: revision,
    snapshotCount:
      snapshot.providerId === provider.id &&
      category === "__all__" &&
      !search.trim()
        ? { totalCount: snapshot.counts.vod, countKnown: snapshot.ready }
        : undefined,
  });
  useEffect(() => {
    let alive = true;
    void getCachedCatalogCategories(provider.id, "vod", provider.type === "m3u")
      .then((items) => {
        if (alive)
          setCategories(
            items.map((item) => ({
              id: String(item.category_id),
              name: item.category_name,
            })),
          );
      })
      .catch(() => {
        if (alive) setCategories([]);
      });
    return () => {
      alive = false;
    };
  }, [provider.id, revision]);
  return (
    <EliteV4MoviesView
      {...props}
      scope={scope}
      items={v4PagedMovies(
        provider.id,
        provider.type as "xtream" | "m3u",
        String(revision),
        page.items,
      )}
      categories={[
        { id: "__all__", name: "Tümü" },
        ...categories.filter((item) => item.id !== "__all__"),
      ]}
      category={category}
      onCategory={setCategory}
      search={search}
      onSearch={setSearch}
      sort={sort}
      onSort={setSort}
      supportsAdded={provider.type === "xtream"}
      loading={page.loadingInitial}
      loadingMore={page.loadingMore}
      hasMore={page.hasMore}
      error={!!page.error}
      count={page.countKnown ? page.totalCount : null}
      onMore={page.loadMore}
      onReload={page.reload}
    />
  );
}
function StalkerMovies({
  provider,
  onPlayable,
  ...props
}: Omit<CatalogProps, "onPlay"> & {
  provider: StalkerProductProviderIdentity;
  onPlayable: (movie: StalkerMoviePlayable, origin: string) => void;
}) {
  const [sort, setSort] = useState<CatalogPageSort>("default");
  const intent = useRef<{ scope: string; origin: string } | null>(null);
  const latest = useRef({ scope: "", active: props.active });
  const catalog = useStalkerMoviesCatalog({
    provider,
    moviesLabel: "Filmler",
    onPlayable: (movie) => {
      if (
        intent.current?.scope === latest.current.scope &&
        latest.current.active !== false
      )
        onPlayable(movie, intent.current.origin);
    },
  });
  const sessionScope = useMemo(
    () => readCurrentStalkerProductSession(provider).providerScopeId,
    [provider.id, provider.url, provider.playlistUrl, provider.mac],
  );
  const scope = JSON.stringify([
    provider.id,
    sessionScope,
    catalog.selectedCategoryId,
    catalog.search,
    sort,
  ]);
  latest.current = { scope, active: props.active };
  return (
    <EliteV4MoviesView
      {...props}
      scope={scope}
      items={v4StalkerMovies(provider.id, scope, catalog.visibleItems, sort)}
      categories={catalog.categories.map((item) => ({
        id: item.id,
        name: item.title,
      }))}
      category={catalog.selectedCategoryId}
      onCategory={catalog.selectCategory}
      search={catalog.search}
      onSearch={catalog.setSearch}
      sort={sort}
      onSort={setSort}
      partialSort
      loading={catalog.loadingInitial || catalog.searching}
      loadingMore={catalog.loadingMore}
      hasMore={
        !catalog.search.trim() &&
        catalog.visibleItems.length > 0 &&
        (catalog.totalItems === null ||
          catalog.visibleItems.length < catalog.totalItems)
      }
      error={!!catalog.error}
      count={catalog.totalItems}
      onMore={catalog.loadMore}
      onReload={() => void catalog.refresh()}
      busy={!!catalog.resolvingItemId}
      onPlay={(movie, origin) => {
        if (movie.source.kind !== "stalker") return;
        intent.current = { scope, origin };
        void catalog.openMovie(movie.source.item);
      }}
    />
  );
}
export function EliteV4MoviesUnavailable({
  onBack,
  active = true,
  series = false,
  message = "Bu sağlayıcı için film kataloğu kullanılamıyor. Stalker için portal adresi ve MAC bilgisi gerekir.",
}: {
  onBack: () => void;
  active?: boolean;
  series?: boolean;
  message?: string;
}) {
  const preview = useOptionalTVPreviewFocus();
  useEffect(() => {
    if (!active || !preview?.enabled) return;
    return preview.registerBackAction(onBack);
  }, [active, preview?.enabled, preview?.registerBackAction, onBack]);
  useEffect(() => {
    if (!active || !Platform.isTV) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (hasPlayerBackOwner()) return false;
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [active, onBack]);
  return (
    <View
      style={{
        flex: 1,
        padding: 24,
        justifyContent: "center",
        backgroundColor: theme.color.background,
      }}
    >
      <Text
        accessibilityRole="alert"
        style={{ color: theme.color.muted, marginBottom: 16 }}
      >
        {message}
      </Text>
      <EliteV4FocusButton
        focusId={series ? "v4-series-hero" : "v4-movies-hero"}
        region="content"
        disabled={!active}
        onPress={onBack}
        neighbors={{ left: series ? "sidebar-series" : "sidebar-movies" }}
        style={actionStyle}
        accessibilityLabel="Ana Sayfa"
      >
        <Text style={{ color: theme.color.foreground }}>Ana Sayfa</Text>
      </EliteV4FocusButton>
    </View>
  );
}

export class EliteV4MovieBoundary extends React.Component<
  React.PropsWithChildren<{ onBack: () => void }>,
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <EliteV4MoviesUnavailable
        onBack={this.props.onBack}
        message="Film sağlayıcısı oturumu kullanılamıyor. Hesap bilgilerinizi kontrol edin."
      />
    );
  }
}

export function EliteV4MoviesCatalog({
  onPlay,
  onStalkerPlayable,
  onBack,
  active = true,
}: CatalogProps & {
  onStalkerPlayable: (movie: StalkerMoviePlayable, origin: string) => void;
}) {
  const { provider } = usePlayer();
  if (provider?.type === "xtream" || provider?.type === "m3u")
    return (
      <PagedMovies
        key={provider.id}
        provider={provider}
        onPlay={onPlay}
        onBack={onBack}
        active={active}
      />
    );
  if (
    provider?.type === "stalker" &&
    (provider.url || provider.playlistUrl)?.trim() &&
    provider.mac?.trim()
  )
    return (
      <EliteV4MovieBoundary key={provider.id} onBack={onBack}>
        <StalkerMovies
          key={provider.id}
          provider={{
            ...provider,
            type: "stalker",
            url: provider.url || provider.playlistUrl || "",
          }}
          onPlayable={onStalkerPlayable}
          onBack={onBack}
          active={active}
        />
      </EliteV4MovieBoundary>
    );
  return <EliteV4MoviesUnavailable onBack={onBack} active={active} />;
}
