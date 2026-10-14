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
import { TVPreviewPressable } from "@/components/tvPreview/TVPreviewFocus";
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
  const [category, setCategoryState] = useState<string | null>(() => readCatalogCategorySelection(providerId, "live", null));
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
          null,
        );
        setCategories(options);
        setCategoryState(valid);
      })
      .catch(() => {
        if (categoryGeneration.current !== generation) return;
        setCategories([{ id: "__all__", title: "Tümü" }]);
        setCategoryState(null);
      });
  }, [providerId]);

  useEffect(() => {
    setCategoryState(readCatalogCategorySelection(providerId, "live", null));
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
    categoryId: category ?? undefined,
    search,
    sort: "default",
    enabled: category !== null && sync.categoriesReady,
    snapshotCount: category === "__all__" && search.trim() === ""
      ? { totalCount: sync.t