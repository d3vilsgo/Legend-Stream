import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { TVPreviewPressable } from "@/components/tvPreview/TVPreviewFocus";
import { useTVPreviewFocus } from "@/components/tvPreview/TVPreviewFocus";
import { NativeVideoPlayer } from "@/components/NativeVideoPlayer";
import { StalkerCategoryPager } from "@/components/stalker/StalkerCategoryPager";
import { useColors } from "@/hooks/useColors";
import { redactSensitiveText } from "@/lib/safeLog";
import {
  isCurrentStalkerProductSession,
  readCurrentStalkerProductSession,
  type StalkerProductProviderIdentity,
} from "@/lib/stalkerProductSession";
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

export function StalkerVodSurface({ provider, onBack, onPlayerActiveChange }: {
  provider: StalkerProductProviderIdentity;
  onBack: () => void;
  onPlayerActiveChange?: (active: boolean) => void;
}) {
  const colors = useColors();
  const current = useMemo(() => readCurrentStalkerProductSession(provider), [provider.id, provider.url, provider.playlistUrl, provider.mac]);
  const session = current.session;
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
  const { registerBackAction } = useTVPreviewFocus();
  const categoryRequestRef = useRef({ inFlight: false, loaded: false, sequence: 0 });
  const pageRequestRef = useRef<{ key: string | null; sequence: number }>({ key: null, sequence: 0 });
  const activeCategoryRef = useRef<string | null>(null);
  const pageAbortRef = useRef<AbortController | null>(null);
  const playbackRequestRef = useRef<{ key: string | null; seq