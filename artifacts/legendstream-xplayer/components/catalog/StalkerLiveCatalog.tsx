import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StalkerCategoryPager } from "@/components/stalker/StalkerCategoryPager";
import type { EpgProgram } from "@/context/PlayerContext";
import { selectProgramsAt, usePlayer } from "@/context/PlayerContext";
import { useCatalogPage } from "@/hooks/useCatalogPage";
import { useColors } from "@/hooks/useColors";
import { useStalkerLiveCatalogSync } from "@/hooks/useStalkerLiveCatalogSync";
import {
  readCatalogCategorySelection,
  rememberCatalogCategorySelection,
  validateCatalogCategorySelection,
} from "@/lib/catalogCategoryMemory";
import { getCachedCatalogCategories } from "@/lib/catalogPageRepository";
import { EPG_PAGED_SEED_LIMIT, registerEpgChannels } from "@/lib/epgRuntime";
import type { Channel } from "@/lib/iptv";
import type { StalkerCategoryPagerItem } from "@/lib/stalkerCategoryPager";

export function StalkerLiveCatalog({
  providerId,
  channels: _channels,
  epgByChannel,
  favorites,
  epgLoading,
  refreshing,
  onRefresh: _onRefresh,
  onOpen,
  onFavorite,
}: {
  providerId: string;
  channels: Channel[];
  epgByChannel: ReadonlyMap<string, readonly EpgProgram[]>;
  favorites: string[];
  epgLoading: boolean;
  refreshing: boolean;
  onRefresh: () => Promise<void> | void;
  onOpen: (channel: Channel) => void;
  onFavorite: (id: string) => void;
}) {
  const colors = useColors();
  const { provider, refreshEpg } = usePlayer();
  const sync = useStalkerLiveCatalogSync(
    provider?.id === providerId && provider.type === "stalker" ? provider : null,
  );
  const [search, setSearch] = useState("");
  const [category, setCategoryState] = useState(() => readCatalogCategorySelection(providerId, "live"));
  const [categories, setCategories] = useState<StalkerCategoryPagerItem[]>([
    { id: "__all__", title: "Tümü" },
  ]);
  const [epgClock, setEpgClock] = useState(() => Date.now());
  const categoryGeneration = useRef(0);

  const loadCategories = useCallback(() => {
    const generation = ++categoryGeneration.current;
    void getCachedCatalogCategories(providerId, "live")
      .then((next) => {
        if (categoryGeneration.current !== generation) return;
        const options: StalkerCategoryPagerItem[] = [
          { id: "__all__", title: "Tümü" },
          ...next.map((item) => ({
            id: String(item.category_id),
            title: item.category_name || String(item.category_id),
          })),
        ];
        const valid = validateCatalogCategorySelection(
          providerId,
          "live",
          next.map((item) => String(item.category_id)),
        );
        setCategories(options);
        setCategoryState(valid);
      })
      .catch(() => {
        if (categoryGeneration.current !== generation) return;
        setCategories([{ id: "__all__", title: "Tümü" }]);
        setCategoryState("__all__");
      });
  }, [providerId]);

  useEffect(() => {
    setCategoryState(readCatalogCategorySelection(providerId, "live"));
  }, [providerId]);

  useEffect(() => {
    if (sync.categoriesReady) loadCategories();
    return () => {
      categoryGeneration.current += 1;
    };
  }, [loadCategories, sync.categoriesReady]);

  const setCategory = useCallback((id: string) => {
    setCategoryState(rememberCatalogCategorySelection(providerId, "live", id));
  }, [providerId]);

  const page = useCatalogPage({
    provider: provider?.id === providerId && provider.type === "stalker" ? provider : null,
    providerType: null,
    kind: "live",
    categoryId: category,
    search,
    sort: "default",
    enabled: true,
    snapshotCount: category === "__all__" && search.trim() === ""
      ? { totalCount: sync.totalCount, countKnown: sync.countKnown }
      : undefined,
  });

  const epgSeedKey = useMemo(
    () => page.items.slice(0, EPG_PAGED_SEED_LIMIT).map((channel) => channel.id).join("|"),
    [page.items],
  );

  useEffect(() => {
    const timer = setInterval(() => setEpgClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => setEpgClock(Date.now()), [category, search]);

  useEffect(() => {
    if (!epgSeedKey || !provider) return;
    const seed = page.items.slice(0, EPG_PAGED_SEED_LIMIT);
    registerEpgChannels(provider.id, seed);
    const timer = setTimeout(() => {
      void refreshEpg(provider.id);
    }, 250);
    return () => clearTimeout(timer);
  }, [epgSeedKey, page.items, provider, refreshEpg]);

  if (!provider || provider.id !== providerId || provider.type !== "stalker") return null;
  if (!sync.categoriesReady) {
    return <View style={styles.center}>
      <ActivityIndicator size="small" color={colors.primary} />
    </View>;
  }

  const selectedCategory = categories.find((item) => item.id === category) ?? categories[0] ?? null;
  const countLabel = page.countKnown && page.totalCount !== null ? page.totalCount.toLocaleString() : "—";

  return <StalkerCategoryPager
    categories={categories}
    activeId={category}
    disabled={search.trim().length > 0}
    onSelect={setCategory}
  >
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={page.items}
      keyExtractor={(channel) => channel.id}
      ListHeaderComponent={<View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>Canlı TV</Text>
            <Text style={{ color: colors.mutedForeground }}>
              {selectedCategory?.title || "Tümü"} · {countLabel} kanal{epgLoading ? " · EPG…" : ""}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yenile"
            disabled={refreshing || sync.syncing || page.loadingInitial}
            onPress={() => {
              void Promise.resolve(sync.refresh()).finally(() => {
                loadCategories();
                page.reload();
              });
            }}
            style={[styles.refreshButton, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <Text style={{ color: colors.foreground, fontWeight: "800" }}>
              {refreshing || sync.syncing ? "Yükleniyor" : "Yenile"}
            </Text>
          </Pressable>
        </View>
        <View style={[styles.search, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={{ color: colors.mutedForeground }}>⌕</Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Kanal ara..."
            placeholderTextColor={colors.mutedForeground}
            autoCorrect={false}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {search ? <Pressable accessibilityRole="button" accessibilityLabel="Aramayı temizle" onPress={() => setSearch("")}>
            <Text style={{ color: colors.mutedForeground, fontSize: 18 }}>×</Text>
          </Pressable> : null}
        </View>
        {search.trim() ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Arama sırasında kategori kaydırma devre dışı.</Text> : null}
        {page.loadingInitial && page.items.length === 0 ? <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={{ color: colors.mutedForeground }}>Kanallar yükleniyor</Text>
        </View> : null}
      </View>}
      ListEmptyComponent={!page.loadingInitial ? <Text style={{ color: colors.mutedForeground, textAlign: "center", paddingVertical: 30 }}>—</Text> : null}
      ListFooterComponent={page.loadingMore ? <View style={styles.loadingRow}><ActivityIndicator size="small" color={colors.primary} /></View> : null}
      onEndReached={page.loadMore}
      onEndReachedThreshold={0.45}
      renderItem={({ item: channel }) => {
        const current = selectProgramsAt(epgByChannel.get(channel.id), epgClock).now;
        const endLabel = current
          ? new Date(current.end).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
          : undefined;
        return <View style={[styles.channelRow, { borderColor: colors.border, backgroundColor: colors.card }]}> 
          <Pressable style={styles.channelMain} onPress={() => onOpen(channel)}>
            {channel.logoUrl
              ? <Image source={{ uri: channel.logoUrl }} style={styles.logo} />
              : <View style={[styles.logo, styles.logoFallback, { backgroundColor: colors.secondary }]}>
                  <Text style={{ color: colors.primary, fontWeight: "900" }}>{channel.name.slice(0, 2).toUpperCase()}</Text>
                </View>}
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "800" }}>{channel.name}</Text>
              <Text numberOfLines={1} style={{ color: current ? colors.foreground : colors.mutedForeground, fontSize: 12 }}>
                {current ? `Şu an: ${current.title}${endLabel ? ` · ${endLabel}` : ""}` : "—"}
              </Text>
            </View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Favori" onPress={() => onFavorite(channel.id)} style={styles.favoriteButton}>
            <Text style={{ color: favorites.includes(channel.id) ? colors.primary : colors.mutedForeground, fontSize: 22 }}>☆</Text>
          </Pressable>
        </View>;
      }}
      extraData={{ favorites, epgByChannel, epgClock }}
      initialNumToRender={16}
      maxToRenderPerBatch={12}
      windowSize={9}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    />
  </StalkerCategoryPager>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 18, paddingBottom: 40, maxWidth: 1500, width: "100%", alignSelf: "center", gap: 8 },
  header: { gap: 12, marginBottom: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 28, fontWeight: "900" },
  refreshButton: { minHeight: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  search: { borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  searchInput: { flex: 1, minHeight: 44, fontSize: 16 },
  loadingRow: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  channelRow: { borderWidth: 1, borderRadius: 14, flexDirection: "row", alignItems: "center", minHeight: 68 },
  channelMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, padding: 10 },
  logo: { width: 48, height: 48, borderRadius: 10 },
  logoFallback: { alignItems: "center", justifyContent: "center" },
  favoriteButton: { width: 52, minHeight: 58, alignItems: "center", justifyContent: "center" },
});
