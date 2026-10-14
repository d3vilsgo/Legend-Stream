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
  goldenSeriesBackTarget,
  initialGoldenSeriesSeasonId,
  orderGoldenSeriesSeasons,
  selectedGoldenSeriesSeason,
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
    void getCachedCatalogCategories(providerId, kind, diagnosticM3U)
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
  }, [providerId, kind, diagnosticM3U]);
  const ready = result.providerId === providerId;
  return {
    categories: ready ? result.categories : [],
    ready,
    reload,
  };
}

f