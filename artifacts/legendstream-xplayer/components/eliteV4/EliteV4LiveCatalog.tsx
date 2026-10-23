import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Image,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  usePlayer,
  selectProgramsAt,
  type Channel,
  type EpgProgram,
} from "@/context/PlayerContext";
import { useCatalogSync } from "@/context/CatalogSyncContext";
import { useCatalogPage, type CatalogPageState } from "@/hooks/useCatalogPage";
import { getCachedCatalogCategories } from "@/lib/catalogPageRepository";
import { registerEpgChannels, EPG_PAGED_SEED_LIMIT } from "@/lib/epgRuntime";
import { hasPlayerBackOwner } from "@/lib/playerRemoteOwnership";
import { normalizeImageUrl } from "@/lib/imageUrl";
import { useOptionalTVPreviewFocus } from "@/components/tvPreview/TVPreviewFocus";
import { EliteV4FocusButton, useEliteV4Focus } from "./EliteV4FocusSurface";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";

type Category = { id: string; name: string };
type LivePage = CatalogPageState<Channel> & {
  loadMore: () => void;
  reload: () => void;
};
const channelFocusId = (id: string) => `v4-live-channel:${id}`;
const actionStyle = {
  minHeight: 44,
  paddingHorizontal: 12,
  borderRadius: theme.radius.small,
  borderWidth: 1,
  borderColor: theme.color.border,
  justifyContent: "center" as const,
  backgroundColor: theme.color.surface,
};

/** V4 presentation over the existing paged catalog. Focus selects; OK opens. */
export function EliteV4LiveView({
  page,
  categories,
  category,
  onCategory,
  search,
  onSearch,
  epgByChannel,
  favorites,
  onFavorite,
  onOpen,
  onBack,
  active = true,
}: {
  page: LivePage;
  categories: readonly Category[];
  category: string;
  onCategory: (id: string) => void;
  search: string;
  onSearch: (value: string) => void;
  epgByChannel: ReadonlyMap<string, readonly EpgProgram[]>;
  favorites: readonly string[];
  onFavorite: (id: string) => void;
  onOpen: (channel: Channel) => void;
  onBack: () => void;
  active?: boolean;
}) {
  const dimensions = useWindowDimensions();
  const [width, setWidth] = useState(
    dimensions.width - theme.layout.sidebarCompact,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const list = useRef<FlatList<Channel>>(null);
  const input = useRef<TextInput>(null);
  const focus = useEliteV4Focus();
  const preview = useOptionalTVPreviewFocus();
  const selected = page.items.find((item) => item.id === selectedId) ?? null;
  const rowHeight = Math.max(
    72,
    Math.ceil(44 * (dimensions.fontScale || 1) + 24),
  );
  const firstChannel = page.items[0]
    ? channelFocusId(page.items[0].id)
    : "v4-live-status";
  const categoriesWithAll = [
    { id: "__all__", name: "Tümü" },
    ...categories.filter((item) => item.id !== "__all__"),
  ];
  const firstCategory = `v4-live-category:${categoriesWithAll[0].id}`;
  const current = selected
    ? selectProgramsAt(epgByChannel.get(selected.id), clock).now
    : undefined;
  const back = () => {
    if (searchOpen) {
      setSearchOpen(false);
      input.current?.blur();
      focus.focus("v4-live-search");
    } else onBack();
  };
  useEffect(() => {
    if (!active) {
      input.current?.blur();
      setSearchOpen(false);
    }
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (!active || !preview?.enabled) return;
    return preview.registerBackAction(back);
  }, [
    active,
    preview?.enabled,
    preview?.registerBackAction,
    searchOpen,
    onBack,
  ]);
  useEffect(() => {
    if (!active || !Platform.isTV) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (hasPlayerBackOwner()) return false;
        back();
        return true;
      },
    );
    return () => subscription.remove();
  }, [active, searchOpen, onBack]);
  useEffect(() => {
    if (searchOpen) input.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    setSelectedId(null);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [category, search]);
  const button = (
    id: string,
    label: string,
    action: () => void,
    neighbors: { left?: string; right?: string; up?: string; down?: string },
    disabled = false,
  ) => (
    <EliteV4FocusButton
      focusId={id}
      region="content"
      onPress={action}
      neighbors={neighbors}
      disabled={disabled || !active}
      accessibilityLabel={label}
      style={actionStyle}
    >
      <Text
        style={{
          color: disabled ? theme.color.quiet : theme.color.foreground,
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </EliteV4FocusButton>
  );
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        padding: width < 600 ? 14 : 24,
        backgroundColor: theme.color.background,
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
        <View style={{ flex: 1, minWidth: 120 }}>
          <Text
            style={{
              color: theme.color.foreground,
              fontSize: 24,
              fontWeight: "600",
            }}
          >
            Canlı TV
          </Text>
          <Text style={{ color: theme.color.muted, fontSize: 12 }}>
            {page.countKnown && page.totalCount !== null
              ? `${page.totalCount} kanal`
              : "Kanal kataloğu"}
          </Text>
        </View>
        {button(
          "v4-live-search",
          searchOpen ? "Aramayı kapat" : "Kanal ara",
          () => setSearchOpen((value) => !value),
          {
            left: "sidebar-live",
            right: "v4-live-refresh",
            down: firstCategory,
          },
        )}
        {button(
          "v4-live-refresh",
          "Yenile",
          page.reload,
          {
            left: "v4-live-search",
            right: "v4-live-back",
            down: firstCategory,
          },
          page.loadingInitial || page.loadingMore,
        )}
        {button("v4-live-back", "Ana Sayfa", back, {
          left: "v4-live-refresh",
          down: firstCategory,
        })}
      </View>
      {searchOpen ? (
        <TextInput
          ref={input}
          value={search}
          onChangeText={onSearch}
          accessibilityLabel="V4 kanal arama"
          placeholder="Kanal adı…"
          placeholderTextColor={theme.color.quiet}
          returnKeyType="search"
          onSubmitEditing={() => {
            input.current?.blur();
            setSearchOpen(false);
            focus.focus("v4-live-search");
          }}
          style={{
            color: theme.color.foreground,
            backgroundColor: theme.color.surface,
            borderWidth: 1,
            borderColor: theme.color.accent,
            borderRadius: theme.radius.small,
            minHeight: 44,
            paddingHorizontal: 12,
            marginBottom: 10,
          }}
        />
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, maxHeight: 64, marginBottom: 12 }}
        contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
      >
        {categoriesWithAll.map((item, index) => (
          <EliteV4FocusButton
            key={item.id}
            focusId={`v4-live-category:${item.id}`}
            region="content"
            selected={category === item.id}
            disabled={!active}
            neighbors={{
              left: index
                ? `v4-live-category:${categoriesWithAll[index - 1].id}`
                : "sidebar-live",
              right: categoriesWithAll[index + 1]
                ? `v4-live-category:${categoriesWithAll[index + 1].id}`
                : undefined,
              up: "v4-live-search",
              down: firstChannel,
            }}
            onPress={() => onCategory(item.id)}
            accessibilityLabel={item.name}
            style={{
              ...actionStyle,
              maxWidth: 220,
              backgroundColor:
                category === item.id
                  ? theme.color.accentSoft
                  : theme.color.surface,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                color:
                  category === item.id ? theme.color.accent : theme.color.muted,
                fontSize: 13,
              }}
            >
              {item.name}
            </Text>
          </EliteV4FocusButton>
        ))}
      </ScrollView>
      <View style={{ flex: 1, minHeight: 0, flexDirection: "row", gap: 20 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <FlatList
            ref={list}
            data={page.items}
            keyExtractor={(item) => item.id}
            extraData={{ selectedId, clock, favorites, active, epgByChannel }}
            getItemLayout={(_, index) => ({
              index,
              length: rowHeight + 8,
              offset: index * (rowHeight + 8),
            })}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            contentContainerStyle={{
              paddingVertical: 4,
              paddingHorizontal: 2,
              paddingBottom: 12,
            }}
            onEndReached={() => {
              if (
                active &&
                page.hasMore &&
                !page.loadingInitial &&
                !page.loadingMore &&
                !page.error
              )
                page.loadMore();
            }}
            onEndReachedThreshold={0.5}
            renderItem={({ item, index }) => {
              const now = selectProgramsAt(
                epgByChannel.get(item.id),
                clock,
              ).now;
              const image = normalizeImageUrl(item.logoUrl);
              return (
                <EliteV4FocusButton
                  focusId={channelFocusId(item.id)}
                  region="content"
                  disabled={!active}
                  selected={selectedId === item.id}
                  neighbors={{
                    left: "sidebar-live",
                    right: width >= 760 ? "v4-live-watch" : undefined,
                    up: index
                      ? channelFocusId(page.items[index - 1].id)
                      : firstCategory,
                    down: page.items[index + 1]
                      ? channelFocusId(page.items[index + 1].id)
                      : "v4-live-status",
                  }}
                  onFocused={() => {
                    setSelectedId(item.id);
                    list.current?.scrollToOffset({
                      offset: index * (rowHeight + 8),
                      animated: true,
                    });
                  }}
                  onPress={() => onOpen(item)}
                  accessibilityLabel={`${item.name}, ${now?.title || "Canlı yayın"}`}
                  style={{
                    height: rowHeight,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingHorizontal: 12,
                    borderWidth: 1,
                    borderColor: theme.color.border,
                    borderRadius: theme.radius.medium,
                    backgroundColor:
                      selectedId === item.id
                        ? theme.color.accentSoft
                        : theme.color.surface,
                  }}
                >
                  {image ? (
                    <Image
                      source={{ uri: image }}
                      resizeMode="contain"
                      style={{ width: 42, height: 42 }}
                    />
                  ) : (
                    <Feather name="radio" size={24} color={theme.color.quiet} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: theme.color.foreground,
                        fontSize: 15,
                        fontWeight: "500",
                      }}
                    >
                      {item.name}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: theme.color.muted,
                        fontSize: 12,
                        marginTop: 5,
                      }}
                    >
                      {now?.title || "Program bilgisi bulunmuyor"}
                    </Text>
                  </View>
                  <Feather
                    name={favorites.includes(item.id) ? "star" : "play"}
                    size={16}
                    color={theme.color.accent}
                  />
                </EliteV4FocusButton>
              );
            }}
            ListEmptyComponent={
              <View style={{ paddingVertical: 20 }}>
                {page.loadingInitial ? (
                  <ActivityIndicator color={theme.color.accent} />
                ) : (
                  <Text style={{ color: theme.color.muted, fontSize: 14 }}>
                    {page.error
                      ? "Kanal listesi yüklenemedi."
                      : search.trim()
                        ? "Aramanıza uygun kanal bulunamadı."
                        : "Bu kategoride kanal bulunmuyor."}
                  </Text>
                )}
              </View>
            }
            ListFooterComponent={
              <View style={{ paddingTop: 10 }}>
                {page.loadingMore ? (
                  <ActivityIndicator color={theme.color.accent} />
                ) : null}
                {page.error ? (
                  <Text
                    accessibilityRole="alert"
                    style={{ color: theme.color.danger, marginBottom: 8 }}
                  >
                    Kanal listesi güncellenemedi. Yeniden deneyebilirsiniz.
                  </Text>
                ) : null}
                {button(
                  "v4-live-status",
                  page.error
                    ? "Yeniden dene"
                    : page.hasMore
                      ? "Daha fazla kanal"
                      : "Listenin başına dön",
                  () => {
                    if (page.error) page.reload();
                    else if (page.hasMore) page.loadMore();
                    else {
                      list.current?.scrollToOffset({
                        offset: 0,
                        animated: true,
                      });
                      focus.focus(
                        firstChannel === "v4-live-status"
                          ? "v4-live-search"
                          : firstChannel,
                      );
                    }
                  },
                  {
                    left: "sidebar-live",
                    down:
                      width < 760 && selected
                        ? "v4-live-favorite"
                        : "v4-live-search",
                  },
                  page.loadingInitial || page.loadingMore,
                )}
              </View>
            }
          />
          {width < 760 && selected
            ? button(
                "v4-live-favorite",
                favorites.includes(selected.id)
                  ? "Favoriden çıkar"
                  : "Favoriye ekle",
                () => onFavorite(selected.id),
                {
                  left: "sidebar-live",
                  up: "v4-live-status",
                  down: firstChannel,
                },
              )
            : null}
        </View>
        {width >= 760 ? (
          <View
            style={{
              width: Math.min(320, width * 0.32),
              padding: 20,
              borderWidth: 1,
              borderColor: theme.color.border,
              borderRadius: theme.radius.large,
              backgroundColor: theme.color.surface,
            }}
          >
            <Text
              style={{
                color: theme.color.accent,
                fontSize: 11,
                letterSpacing: 1.5,
                marginBottom: 16,
              }}
            >
              ŞİMDİ YAYINDA
            </Text>
            <Text
              numberOfLines={2}
              style={{
                color: theme.color.foreground,
                fontSize: 23,
                fontWeight: "600",
              }}
            >
              {selected?.name || "Bir kanal seçin"}
            </Text>
            <Text
              numberOfLines={3}
              style={{
                color: theme.color.muted,
                fontSize: 14,
                marginVertical: 14,
              }}
            >
              {current?.title ||
                (selected
                  ? "Program bilgisi bulunmuyor"
                  : "Kumandayla kanallar arasında gezinin.")}
            </Text>
            {button(
              "v4-live-watch",
              "Canlı yayını izle",
              () => {
                if (selected) onOpen(selected);
              },
              {
                left: selected ? channelFocusId(selected.id) : firstChannel,
                down: "v4-live-favorite",
              },
              !selected,
            )}
            <View style={{ height: 10 }} />
            {button(
              "v4-live-favorite",
              selected && favorites.includes(selected.id)
                ? "Favoriden çıkar"
                : "Favoriye ekle",
              () => {
                if (selected) onFavorite(selected.id);
              },
              {
                left: selected ? channelFocusId(selected.id) : firstChannel,
                down: "v4-live-watch",
              },
              !selected,
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function EliteV4LiveCatalog({
  onOpen,
  onBack,
  active = true,
}: {
  onOpen: (channel: Channel) => void;
  onBack: () => void;
  active?: boolean;
}) {
  const { provider, epgByChannel, favorites, toggleFavorite } = usePlayer();
  const { snapshot, lastSuccessfulAt } = useCatalogSync();
  const [category, setCategory] = useState("__all__");
  const [search, setSearch] = useState("");
  const [categoryResult, setCategoryResult] = useState<{
    owner: string;
    items: Category[];
  } | null>(null);
  const supported = provider?.type === "xtream" || provider?.type === "m3u";
  const page = useCatalogPage({
    provider,
    providerType: supported ? (provider.type as "xtream" | "m3u") : null,
    kind: "live",
    categoryId: category,
    search,
    sort: "default",
    enabled: supported,
    catalogRevision: lastSuccessfulAt ?? 0,
    snapshotCount:
      provider &&
      snapshot.providerId === provider.id &&
      category === "__all__" &&
      !search.trim()
        ? { totalCount: snapshot.counts.live, countKnown: snapshot.ready }
        : undefined,
  });
  useEffect(() => {
    let cancelled = false;
    if (!provider || !supported) return;
    const owner = provider.id;
    void getCachedCatalogCategories(owner, "live", provider.type === "m3u")
      .then((items) => {
        if (!cancelled)
          setCategoryResult({
            owner,
            items: items.map((item) => ({
              id: String(item.category_id),
              name: item.category_name,
            })),
          });
      })
      .catch(() => {
        if (!cancelled) setCategoryResult({ owner, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [provider?.id, supported, lastSuccessfulAt]);
  const epgSeedKey = page.items
    .slice(0, EPG_PAGED_SEED_LIMIT)
    .map((item) => item.id)
    .join("|");
  useEffect(() => {
    if (provider && supported && epgSeedKey)
      registerEpgChannels(
        provider.id,
        page.items.slice(0, EPG_PAGED_SEED_LIMIT),
      );
  }, [provider?.id, supported, epgSeedKey]);
  if (!provider || !supported) return null;
  return (
    <EliteV4LiveView
      page={page}
      categories={
        categoryResult?.owner === provider.id ? categoryResult.items : []
      }
      category={category}
      onCategory={setCategory}
      search={search}
      onSearch={setSearch}
      epgByChannel={epgByChannel}
      favorites={favorites}
      onFavorite={(id) => {
        void toggleFavorite(id);
      }}
      onOpen={onOpen}
      onBack={onBack}
      active={active}
    />
  );
}
