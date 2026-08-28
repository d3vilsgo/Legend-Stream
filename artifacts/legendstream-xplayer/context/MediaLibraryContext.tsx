import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePlayer, type ProviderConfig } from "@/context/PlayerContext";
import { getM3UCatalog } from "@/lib/iptv";
import { parseCatalogRuntimeSource } from "@/lib/catalogPersistence";
import { getEpisodePlaybackQueue, getVodPlaybackQueue } from "@/lib/xtreamCatalog";
import { readCredentials } from "@/lib/secureCredentials";
import {
  MEDIA_PROGRESS_V2_STORAGE_KEY,
  asMediaProgressMigrationError,
  claimProgressForProvider,
  isMediaProgressV2PayloadSafe,
  makeMediaProgressId,
  migrateMediaProgressStorage,
  normalizeXtreamProgressBaseUrl,
  parseCanonicalXtreamProgressSource,
  samePlaybackRef,
  trimMediaProgressByScope,
  type MediaKind,
  type MediaPlaybackRef,
  type MediaProgressCredentialSnapshot,
  type MediaProgressV2,
} from "@/lib/mediaProgress";

export type { MediaKind, MediaPlaybackRef, MediaProgressV2 } from "@/lib/mediaProgress";

/**
 * Runtime/UI projection only. `source` is never part of MediaProgressV2 and is
 * never serialized. It is rebuilt in RAM from the active provider or replaced
 * by a credential-free runtime reference.
 */
export type MediaProgress = MediaProgressV2 & { source: string };

type SaveProgressInput = {
  kind: MediaKind;
  title: string;
  subtitle?: string;
  source: string;
  position: number;
  duration: number;
};

type MediaLibraryValue = {
  entries: MediaProgress[];
  unscopedEntries: MediaProgress[];
  loaded: boolean;
  getProgress: (source: string) => MediaProgress | undefined;
  saveProgress: (entry: SaveProgressInput) => Promise<void>;
  removeProgress: (source: string) => Promise<void>;
  clearProgress: () => Promise<void>;
};

const Context = createContext<MediaLibraryValue | null>(null);
const UNSCOPED_RUNTIME_PREFIX = "legendstream-progress-unscoped:";

const storageAdapter = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
};

const extensionFromSource = (source: string, fallback = "mp4") => {
  try {
    const path = new URL(source).pathname;
    const file = path.split("/").pop() || "";
    const dot = file.lastIndexOf(".");
    const extension = dot > 0 ? file.slice(dot + 1) : "";
    return /^[a-zA-Z0-9]{1,10}$/.test(extension) ? extension : fallback;
  } catch {
    return fallback;
  }
};

async function readCredentialSnapshots(
  providers: readonly ProviderConfig[],
): Promise<MediaProgressCredentialSnapshot[]> {
  const snapshots: MediaProgressCredentialSnapshot[] = [];
  for (const provider of providers) {
    const result = await readCredentials(provider.id);
    if (result.status !== "found") continue;
    snapshots.push({
      providerId: provider.id,
      type: provider.type,
      secrets: result.secrets,
    });
  }
  return snapshots;
}

function xtreamRuntimeSource(
  provider: ProviderConfig,
  ref: Extract<MediaPlaybackRef, { type: "xtream-vod" | "xtream-episode" }>,
): string | null {
  if (provider.type !== "xtream" || !provider.username || !provider.password) return null;
  const baseUrl = normalizeXtreamProgressBaseUrl(provider.url || provider.playlistUrl);
  if (!baseUrl) return null;
  if (ref.type === "xtream-vod" && ref.sourceMode === "direct") {
    return `legendstream-catalog://xtream/movie/${encodeURIComponent(provider.id)}/${encodeURIComponent(ref.streamId)}?ext=${encodeURIComponent(ref.containerExtension)}`;
  }
  const itemId = ref.type === "xtream-vod" ? ref.streamId : ref.episodeId;
  const path = ref.type === "xtream-vod" ? "movie" : "series";
  // A direct episode URL is deliberately not persisted. If no seriesId-backed
  // direct resolver is available, reconstruct the canonical Xtream route in RAM.
  return `${baseUrl}/${path}/${encodeURIComponent(provider.username)}/${encodeURIComponent(provider.password)}/${encodeURIComponent(itemId)}.${ref.containerExtension}`;
}

function m3uRuntimeSource(
  provider: ProviderConfig,
  ref: Extract<MediaPlaybackRef, { type: "m3u-vod" | "m3u-episode" }>,
): string | null {
  if (provider.type !== "m3u") return null;
  const catalog = getM3UCatalog(provider.id);
  if (ref.type === "m3u-vod") {
    return catalog.movieItems.find((item) => item.id === ref.itemId)?.streamUrl ?? null;
  }
  for (const group of catalog.seriesGroups) {
    for (const episodes of Object.values(group.seasons)) {
      const match = episodes.find((episode) => episode.id === ref.itemId);
      if (match) return match.streamUrl;
    }
  }
  return null;
}

function runtimeSourceFor(entry: MediaProgressV2, provider: ProviderConfig | null): string {
  if (!provider || entry.providerId !== provider.id || entry.playbackRef.type === "unresolved") {
    return `${UNSCOPED_RUNTIME_PREFIX}${encodeURIComponent(entry.id)}`;
  }
  if (entry.playbackRef.type === "xtream-vod" || entry.playbackRef.type === "xtream-episode") {
    return xtreamRuntimeSource(provider, entry.playbackRef) ?? `${UNSCOPED_RUNTIME_PREFIX}${encodeURIComponent(entry.id)}`;
  }
  return m3uRuntimeSource(provider, entry.playbackRef) ?? `${UNSCOPED_RUNTIME_PREFIX}${encodeURIComponent(entry.id)}`;
}

function inferProgressKind(source: string, provider: ProviderConfig): MediaKind {
  const runtime = parseCatalogRuntimeSource(source);
  if (runtime?.kind === "vod-direct") return "movie";
  const canonical = parseCanonicalXtreamProgressSource(source);
  if (canonical) return canonical.kind;
  if (getEpisodePlaybackQueue(source)) return "episode";
  if (getVodPlaybackQueue(source)) return "movie";
  if (provider.type === "m3u") {
    const catalog = getM3UCatalog(provider.id);
    if (catalog.movieItems.some((item) => item.streamUrl === source)) return "movie";
    for (const group of catalog.seriesGroups) {
      for (const episodes of Object.values(group.seasons)) {
        if (episodes.some((item) => item.streamUrl === source)) return "episode";
      }
    }
  }
  return /\/series\//i.test(source) ? "episode" : "movie";
}

function playbackRefFromRuntimeSource(
  source: string,
  kind: MediaKind,
  provider: ProviderConfig,
): MediaPlaybackRef | null {
  const runtime = parseCatalogRuntimeSource(source);
  if (runtime?.kind === "vod-direct" && runtime.providerId === provider.id && kind === "movie") {
    return {
      type: "xtream-vod",
      streamId: runtime.streamId,
      containerExtension: runtime.containerExtension,
      sourceMode: "direct",
    };
  }

  const canonical = parseCanonicalXtreamProgressSource(source);
  if (canonical && canonical.kind === kind && provider.type === "xtream") {
    const baseUrl = normalizeXtreamProgressBaseUrl(provider.url || provider.playlistUrl);
    if (
      baseUrl === canonical.baseUrl &&
      (provider.username || "") === canonical.username &&
      (provider.password || "") === canonical.password
    ) {
      return kind === "movie"
        ? {
            type: "xtream-vod",
            streamId: canonical.itemId,
            containerExtension: canonical.containerExtension,
            sourceMode: "canonical",
          }
        : {
            type: "xtream-episode",
            episodeId: canonical.itemId,
            containerExtension: canonical.containerExtension,
            sourceMode: "canonical",
          };
    }
  }

  if (provider.type === "m3u") {
    const catalog = getM3UCatalog(provider.id);
    if (kind === "movie") {
      const movie = catalog.movieItems.find((item) => item.streamUrl === source);
      return movie ? { type: "m3u-vod", itemId: movie.id } : null;
    }
    for (const group of catalog.seriesGroups) {
      for (const episodes of Object.values(group.seasons)) {
        const episode = episodes.find((item) => item.streamUrl === source);
        if (episode) return { type: "m3u-episode", itemId: episode.id };
      }
    }
    return null;
  }

  if (kind === "movie") {
    const queue = getVodPlaybackQueue(source);
    const item = queue?.items[queue.index];
    if (item) {
      return {
        type: "xtream-vod",
        streamId: item.id,
        containerExtension: extensionFromSource(source),
        sourceMode: "direct",
      };
    }
  } else {
    const queue = getEpisodePlaybackQueue(source);
    const item = queue?.items[queue.index];
    if (item) {
      return {
        type: "xtream-episode",
        episodeId: item.id,
        containerExtension: extensionFromSource(source),
        sourceMode: "direct",
      };
    }
  }
  return null;
}

function unresolvedRef(kind: MediaKind, title: string): MediaPlaybackRef {
  let hash = 0;
  const value = `${kind}\u0000${title}`;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return { type: "unresolved", mediaKind: kind, legacyTag: `runtime-${Math.abs(hash).toString(36)}` };
}

export function MediaLibraryProvider({ children }: { children: ReactNode }) {
  const { provider, providers, isHydrating } = usePlayer();
  const [allEntries, setAllEntries] = useState<MediaProgressV2[]>([]);
  const entriesRef = useRef<MediaProgressV2[]>([]);
  const sourceIndexRef = useRef(new Map<string, string>());
  const credentialSnapshotsRef = useRef<MediaProgressCredentialSnapshot[]>([]);
  const migrationStartedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (isHydrating || migrationStartedRef.current) return;
    migrationStartedRef.current = true;
    let cancelled = false;
    void (async () => {
      const snapshots = await readCredentialSnapshots(providers);
      credentialSnapshotsRef.current = snapshots;
      const migrated = trimMediaProgressByScope(
        await migrateMediaProgressStorage(storageAdapter, snapshots),
      );
      if (cancelled) return;
      entriesRef.current = migrated;
      setAllEntries(migrated);
    })()
      .catch(() => {
        // K4: no source/error payload is logged. The migration library exposes
        // only MEDIA_PROGRESS_MIGRATION_FAILED and leaves v1 untouched.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [isHydrating, providers]);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    void readCredentialSnapshots(providers).then((snapshots) => {
      if (!cancelled) credentialSnapshotsRef.current = snapshots;
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [loaded, providers]);

  const persist = useCallback(async (next: MediaProgressV2[]) => {
    const trimmed = trimMediaProgressByScope(next);
    if (!isMediaProgressV2PayloadSafe(trimmed, credentialSnapshotsRef.current)) {
      throw asMediaProgressMigrationError();
    }
    entriesRef.current = trimmed;
    setAllEntries(trimmed);
    try {
      await AsyncStorage.setItem(MEDIA_PROGRESS_V2_STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // Runtime progress persistence remains best effort. Never surface or log
      // transport/storage exception payloads because they may contain sources.
    }
  }, []);

  const toView = useCallback((entry: MediaProgressV2, active: ProviderConfig | null): MediaProgress => {
    const source = runtimeSourceFor(entry, active);
    sourceIndexRef.current.set(source, entry.id);
    return { ...entry, source };
  }, []);

  const entries = useMemo(() => {
    sourceIndexRef.current = new Map();
    if (!provider) return [];
    return allEntries
      .filter((entry) => entry.providerId === provider.id)
      .map((entry) => toView(entry, provider));
  }, [allEntries, provider, toView]);

  const unscopedEntries = useMemo(
    () => allEntries
      .filter((entry) => entry.providerId === null)
      .map((entry) => toView(entry, null)),
    [allEntries, toView],
  );

  const getProgress = useCallback((source: string) => {
    const indexedId = sourceIndexRef.current.get(source);
    if (indexedId) {
      const exact = entriesRef.current.find((entry) => entry.id === indexedId);
      if (exact) return toView(exact, provider);
    }
    if (!provider) return undefined;
    const kind = inferProgressKind(source, provider);
    const ref = playbackRefFromRuntimeSource(source, kind, provider);
    if (!ref) return undefined;
    const claim = claimProgressForProvider(entriesRef.current, provider.id, ref);
    if (!claim.entry) return undefined;
    if (claim.changed) void persist(claim.entries).catch(() => undefined);
    return toView(claim.entry, provider);
  }, [persist, provider, toView]);

  const saveProgress = useCallback(async (entry: SaveProgressInput) => {
    if (!provider || !Number.isFinite(entry.position) || entry.position < 0) return;
    const current = entriesRef.current;
    const indexedId = sourceIndexRef.current.get(entry.source);
    const indexed = indexedId ? current.find((item) => item.id === indexedId) : undefined;
    let ref = indexed?.playbackRef ?? playbackRefFromRuntimeSource(entry.source, entry.kind, provider);
    if (!ref) {
      const previousUnresolved = current.find(
        (item) => item.providerId === provider.id && item.kind === entry.kind &&
          item.title === entry.title && item.playbackRef.type === "unresolved",
      );
      ref = previousUnresolved?.playbackRef ?? unresolvedRef(entry.kind, entry.title);
    }

    const previous = current.find(
      (item) => item.providerId === provider.id &&
        (samePlaybackRef(item.playbackRef, ref) ||
          (item.playbackRef.type === "unresolved" && ref.type === "unresolved" && item.title === entry.title)),
    );
    const now = Date.now();
    if (
      previous &&
      Math.abs(previous.position - entry.position) < 1.5 &&
      Math.abs(previous.duration - entry.duration) < 1.5 &&
      now - previous.updatedAt < 8_000
    ) {
      return;
    }

    const nextEntry: MediaProgressV2 = {
      schemaVersion: 2,
      id: previous?.id ?? makeMediaProgressId(provider.id, entry.kind, ref, entry.title, now),
      providerId: provider.id,
      kind: entry.kind,
      title: entry.title,
      subtitle: entry.subtitle,
      playbackRef: ref,
      position: entry.position,
      duration: entry.duration,
      updatedAt: now,
    };

    const withoutIdentity = current.filter((item) => item.id !== previous?.id);
    const next = [nextEntry, ...withoutIdentity]
      .filter((item) => item.duration <= 0 || item.position < Math.max(0, item.duration - 30));
    await persist(next);
  }, [persist, provider]);

  const removeProgress = useCallback(async (source: string) => {
    const indexedId = sourceIndexRef.current.get(source);
    if (indexedId) {
      await persist(entriesRef.current.filter((item) => item.id !== indexedId));
      return;
    }
    if (!provider) return;
    const kind = inferProgressKind(source, provider);
    const ref = playbackRefFromRuntimeSource(source, kind, provider);
    if (!ref) return;
    await persist(entriesRef.current.filter(
      (item) => !(item.providerId === provider.id && samePlaybackRef(item.playbackRef, ref)),
    ));
  }, [persist, provider]);

  const clearProgress = useCallback(async () => {
    if (!provider) return;
    await persist(entriesRef.current.filter((item) => item.providerId !== provider.id));
  }, [persist, provider]);

  const value = useMemo<MediaLibraryValue>(() => ({
    entries,
    unscopedEntries,
    loaded,
    getProgress,
    saveProgress,
    removeProgress,
    clearProgress,
  }), [clearProgress, entries, getProgress, loaded, removeProgress, saveProgress, unscopedEntries]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useMediaLibrary() {
  const value = useContext(Context);
  if (!value) throw new Error("useMediaLibrary must be used within MediaLibraryProvider");
  return value;
}
