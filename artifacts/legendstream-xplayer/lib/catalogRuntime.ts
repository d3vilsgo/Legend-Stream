import type { Channel } from "./iptv";
import { normalizeXtreamBaseUrl } from "./iptv";
import { buildM3UStreamUrl } from "./m3uCatalogRefs";
import {
  buildEpisodeStreamUrl,
  buildVodStreamUrl,
  getVodInfo,
  type XtreamEpisode,
  type XtreamSeriesItem,
  type XtreamVodItem,
} from "./xtreamCatalog";
import {
  getCachedPersistedItems,
  getNewCachedPersistedItems,
} from "./catalogCache";
import {
  makeDirectVodRuntimeSource,
  makeStalkerLiveRuntimeSource,
  parseCatalogRuntimeSource,
  type PersistedLiveCatalogItem,
  type PersistedSeriesCatalogItem,
  type PersistedVodCatalogItem,
} from "./catalogPersistence";
import { resolveStalkerLiveCreateLink } from "./stalkerLiveCatalog";
import { getPersistedStalkerLivePlaybackRef } from "./stalkerLiveCache";
import { getOrCreateStalkerPortalSession } from "./stalkerPortalRuntime";
import type { StalkerPortalSession } from "./stalkerPortal";
import { safeLog } from "./safeLog";

export type CatalogRuntimeProvider = {
  id: string;
  type: string;
  url?: string;
  playlistUrl?: string;
  username?: string;
  password?: string;
  mac?: string;
};

export type CatalogPageRuntimeItem = Channel | XtreamVodItem | XtreamSeriesItem;

type CatalogRuntimeDependencies = {
  getStalkerPlaybackRef?: typeof getPersistedStalkerLivePlaybackRef;
  acquireStalkerSession?: (
    identity: Parameters<typeof getOrCreateStalkerPortalSession>[0],
  ) => Pick<StalkerPortalSession, "request">;
  resolveStalkerLink?: (
    session: Pick<StalkerPortalSession, "request">,
    cmd: string,
    signal?: AbortSignal,
  ) => Promise<string>;
};

function normalizeCatalogRuntimeBaseUrl(value: string) {
  const normalized = normalizeXtreamBaseUrl(value);
  try {
    const url = new URL(normalized);
    const path = url.pathname.replace(/\/+$/, "");
    if (/\/get\.php$/i.test(path)) {
      url.pathname = path.slice(0, path.lastIndexOf("/")) || "/";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/+$/, "");
    }
  } catch {
    // normalizeXtreamBaseUrl already validates the value.
  }
  return normalized;
}

function requireXtreamCredentials(provider: CatalogRuntimeProvider) {
  if (provider.type !== "xtream" || !provider.username || !provider.password) {
    throw new Error("Cached playback credentials are unavailable.");
  }
  const source = provider.url || provider.playlistUrl || "";
  return {
    baseUrl: normalizeCatalogRuntimeBaseUrl(source),
    username: provider.username,
    password: provider.password,
  };
}

function requireStalkerCredentials(provider: CatalogRuntimeProvider) {
  const portalUrl = provider.url || provider.playlistUrl || "";
  const mac = provider.mac?.trim() || "";
  if (provider.type !== "stalker" || !portalUrl || !mac) {
    throw new Error("Cached Stalker playback credentials are unavailable.");
  }
  return { portalUrl, mac };
}

function providerSource(provider: CatalogRuntimeProvider) {
  return provider.url || provider.playlistUrl || "";
}

export function liveRuntimeItem(
  persisted: PersistedLiveCatalogItem,
  provider: CatalogRuntimeProvider,
): Channel {
  let streamUrl = "";
  if (persisted.playbackRef.type === "xtream-live") {
    try {
      const credentials = requireXtreamCredentials(provider);
      if (provider.id === persisted.providerId) {
        streamUrl = `${credentials.baseUrl}/live/${encodeURIComponent(credentials.username)}/${encodeURIComponent(credentials.password)}/${encodeURIComponent(persisted.playbackRef.streamId)}.${persisted.playbackRef.containerExtension}`;
      }
    } catch {
      streamUrl = "";
    }
  } else if (persisted.playbackRef.type === "m3u-path" && provider.type === "m3u") {
    streamUrl = buildM3UStreamUrl(providerSource(provider), persisted.playbackRef) ?? "";
  } else if (
    persisted.playbackRef.type === "stalker-live" &&
    provider.type === "stalker" &&
    provider.id === persisted.providerId
  ) {
    streamUrl = makeStalkerLiveRuntimeSource(persisted);
  }
  return {
    id: persisted.id,
    providerId: persisted.providerId,
    name: persisted.name,
    streamUrl,
    logoUrl: persisted.logoUrl,
    category: persisted.categoryName ?? persisted.category,
    tvgId: persisted.tvgId,
    streamType: persisted.streamType,
    contentType: "live",
    playbackStreamId:
      persisted.playbackRef.type === "xtream-live" || persisted.playbackRef.type === "m3u-path"
        ? persisted.playbackRef.streamId
        : undefined,
    playbackContainerExtension:
      persisted.playbackRef.type === "xtream-live" || persisted.playbackRef.type === "m3u-path"
        ? persisted.playbackRef.containerExtension
        : undefined,
    nowPlaying: persisted.nowPlaying,
    nextPlaying: persisted.nextPlaying,
  };
}

export function vodRuntimeItem(
  persisted: PersistedVodCatalogItem,
  provider: CatalogRuntimeProvider,
): XtreamVodItem {
  let directSource: string | undefined;
  if (persisted.playbackRef.type === "m3u-path" && provider.type === "m3u") {
    directSource = buildM3UStreamUrl(providerSource(provider), persisted.playbackRef) ?? undefined;
  } else if (
    persisted.playbackRef.type === "xtream-vod" &&
    persisted.playbackRef.sourceMode === "direct"
  ) {
    directSource = makeDirectVodRuntimeSource(persisted);
  }
  return {
    stream_id: persisted.stream_id,
    name: persisted.name,
    stream_icon: persisted.stream_icon,
    rating: persisted.rating,
    rating_5based: persisted.rating_5based,
    added: persisted.added,
    category_id: persisted.category_id,
    container_extension: persisted.container_extension,
    direct_source: directSource,
    plot: persisted.plot,
    cast: persisted.cast,
    director: persisted.director,
    genre: persisted.genre,
    releaseDate: persisted.releaseDate,
    release_date: persisted.release_date,
    youtube_trailer: persisted.youtube_trailer,
  };
}

export function seriesRuntimeItem(persisted: PersistedSeriesCatalogItem): XtreamSeriesItem {
  return {
    series_id: persisted.series_id,
    name: persisted.name,
    cover: persisted.cover,
    plot: persisted.plot,
    cast: persisted.cast,
    director: persisted.director,
    genre: persisted.genre,
    releaseDate: persisted.releaseDate,
    release_date: persisted.release_date,
    rating: persisted.rating,
    category_id: persisted.category_id,
    backdrop_path: persisted.backdrop_path,
  };
}

export async function getCachedLiveItems(
  provider: CatalogRuntimeProvider,
  categoryId?: string,
  limit?: number,
): Promise<Channel[]> {
  const rows = await getCachedPersistedItems(provider.id, "live", categoryId, limit, provider);
  return rows
    .filter((row): row is PersistedLiveCatalogItem => row.catalogKind === "live")
    .map((row) => liveRuntimeItem(row, provider));
}

export async function getCachedVodItems(
  provider: CatalogRuntimeProvider,
  categoryId?: string,
  limit?: number,
): Promise<XtreamVodItem[]> {
  const rows = await getCachedPersistedItems(provider.id, "vod", categoryId, limit, provider);
  return rows
    .filter((row): row is PersistedVodCatalogItem => row.catalogKind === "vod")
    .map((row) => vodRuntimeItem(row, provider));
}

export async function getCachedSeriesItems(
  provider: CatalogRuntimeProvider,
  categoryId?: string,
  limit?: number,
): Promise<XtreamSeriesItem[]> {
  const rows = await getCachedPersistedItems(provider.id, "series", categoryId, limit, provider);
  return rows
    .filter((row): row is PersistedSeriesCatalogItem => row.catalogKind === "series")
    .map(seriesRuntimeItem);
}

export async function getNewCachedLiveItems(provider: CatalogRuntimeProvider, limit = 24) {
  const rows = await getNewCachedPersistedItems(provider.id, "live", limit, provider);
  return rows
    .filter((row): row is PersistedLiveCatalogItem => row.catalogKind === "live")
    .map((row) => liveRuntimeItem(row, provider));
}

export async function getNewCachedVodItems(provider: CatalogRuntimeProvider, limit = 24) {
  const rows = await getNewCachedPersistedItems(provider.id, "vod", limit, provider);
  return rows
    .filter((row): row is PersistedVodCatalogItem => row.catalogKind === "vod")
    .map((row) => vodRuntimeItem(row, provider));
}

export async function getNewCachedSeriesItems(provider: CatalogRuntimeProvider, limit = 24) {
  const rows = await getNewCachedPersistedItems(provider.id, "series", limit, provider);
  return rows
    .filter((row): row is PersistedSeriesCatalogItem => row.catalogKind === "series")
    .map(seriesRuntimeItem);
}

async function resolveXtreamVodRuntimeRef(
  ref: Extract<NonNullable<ReturnType<typeof parseCatalogRuntimeSource>>, { kind: "vod-direct" }>,
  provider: CatalogRuntimeProvider,
  signal?: AbortSignal,
): Promise<{ url: string; strategy: "xtream-vod-direct" | "xtream-vod-canonical-fallback" }> {
  const credentials = requireXtreamCredentials(provider);
  const info = await getVodInfo(credentials, ref.streamId, signal);
  const directSource = info.movie_data?.direct_source?.trim();
  if (directSource && !parseCatalogRuntimeSource(directSource)) {
    return { url: directSource, strategy: "xtream-vod-direct" };
  }
  return {
    url: buildVodStreamUrl(credentials, {
      stream_id: ref.streamId,
      name: "Cached movie",
      container_extension: ref.containerExtension,
    }),
    strategy: "xtream-vod-canonical-fallback",
  };
}

export async function resolveCatalogRuntimeSource(
  source: string,
  provider: CatalogRuntimeProvider | null | undefined,
  signal?: AbortSignal,
  dependencies: CatalogRuntimeDependencies = {},
): Promise<string> {
  const ref = parseCatalogRuntimeSource(source);
  if (!ref) return source;
  if (!provider || provider.id !== ref.providerId) {
    throw new Error("Cached playback provider is unavailable.");
  }
  if (ref.kind === "stalker-live") {
    const credentials = requireStalkerCredentials(provider);
    const playbackRef = await (dependencies.getStalkerPlaybackRef ?? getPersistedStalkerLivePlaybackRef)(ref.providerId, ref.itemId);
    if (!playbackRef) throw new Error("Cached Stalker playback reference is unavailable.");
    const session = (dependencies.acquireStalkerSession ?? getOrCreateStalkerPortalSession)({
      providerId: ref.providerId,
      portalUrl: credentials.portalUrl,
      mac: credentials.mac,
    });
    return (dependencies.resolveStalkerLink ?? resolveStalkerLiveCreateLink)(session, playbackRef.cmd, signal);
  }
  if (ref.kind === "vod-direct") {
    return (await resolveXtreamVodRuntimeRef(ref, provider, signal)).url;
  }
  return source;
}


export type CatalogPlaybackRequest =
  | { kind: "live"; item: Channel }
  | { kind: "movie"; item: XtreamVodItem }
  | { kind: "episode"; item: XtreamEpisode };

export type CatalogPlaybackResolution = {
  url: string;
  strategy:
    | "m3u-path"
    | "xtream-live"
    | "xtream-vod-direct"
    | "xtream-vod-canonical"
    | "xtream-vod-canonical-fallback"
    | "xtream-episode-direct"
    | "xtream-episode-canonical";
};

function playbackSourceMetadata(source: string) {
  try {
    const url = new URL(source);
    const filename = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const dot = filename.lastIndexOf(".");
    return {
      scheme: url.protocol.replace(/:$/, "").toLowerCase() || "other",
      extension: dot > 0 && dot < filename.length - 1 ? filename.slice(dot + 1).toLowerCase() : "",
      sourceLength: source.length,
    };
  } catch {
    return { scheme: "other", extension: "", sourceLength: source.length };
  }
}

function requireHttpPlaybackSource(source: string) {
  const trimmed = source.trim();
  if (!trimmed) throw new Error("Playback source could not be resolved.");
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Playback source could not be resolved.");
    }
  } catch {
    throw new Error("Playback source could not be resolved.");
  }
  return trimmed;
}

export async function resolveCatalogPlaybackSource(
  request: CatalogPlaybackRequest,
  provider: CatalogRuntimeProvider,
  signal?: AbortSignal,
): Promise<CatalogPlaybackResolution> {
  const startedAt = Date.now();
  const providerType = provider.type;
  const contentKind = request.kind;
  let source = "";
  let strategy: CatalogPlaybackResolution["strategy"];
  let hasDurableRef = false;

  try {
    if (request.kind === "live") {
      if (
        request.item.providerId !== provider.id ||
        (providerType !== "m3u" && providerType !== "xtream")
      ) {
        throw new Error("Playback source could not be resolved.");
      }
      hasDurableRef = Boolean(request.item.playbackStreamId);
      source = request.item.streamUrl?.trim() ?? "";
      strategy = providerType === "m3u" ? "m3u-path" : "xtream-live";
      if (!source && request.item.playbackStreamId) {
        if (providerType === "m3u") {
          source = buildM3UStreamUrl(provider.url || provider.playlistUrl || "", {
            type: "m3u-path",
            kind: "live",
            streamId: request.item.playbackStreamId,
            containerExtension: request.item.playbackContainerExtension ?? null,
          }) ?? "";
        } else {
          const credentials = requireXtreamCredentials(provider);
          const extension = request.item.playbackContainerExtension || "m3u8";
          source = `${credentials.baseUrl}/live/${encodeURIComponent(credentials.username)}/${encodeURIComponent(credentials.password)}/${encodeURIComponent(request.item.playbackStreamId)}.${extension}`;
        }
      }
    } else if (request.kind === "movie") {
      hasDurableRef = Boolean(String(request.item.stream_id ?? ""));
      if (providerType === "m3u") {
        source = request.item.direct_source?.trim() ?? "";
        strategy = "m3u-path";
      } else {
        const credentials = requireXtreamCredentials(provider);
        source = buildVodStreamUrl(credentials, request.item);
        strategy = isCatalogRuntimeSource(source) ? "xtream-vod-direct" : "xtream-vod-canonical";
      }
    } else {
      hasDurableRef = Boolean(String(request.item.id ?? ""));
      if (providerType === "m3u") {
        source = request.item.direct_source?.trim() ?? "";
        strategy = "m3u-path";
      } else {
        const credentials = requireXtreamCredentials(provider);
        source = buildEpisodeStreamUrl(credentials, request.item);
        strategy = request.item.direct_source ? "xtream-episode-direct" : "xtream-episode-canonical";
      }
    }

    safeLog.info("PLAYBACK_RESOLVE_BEGIN", {
      providerType,
      contentKind,
      identityKind: strategy,
      hasDurableRef,
      hasDirectSource: Boolean(source && !isCatalogRuntimeSource(source)),
    });

    if (!source) throw new Error("Playback source could not be resolved.");

    let resolved: string;
    if (strategy === "xtream-vod-direct") {
      const ref = parseCatalogRuntimeSource(source);
      if (!ref || ref.kind !== "vod-direct") throw new Error("Playback source could not be resolved.");
      const outcome = await resolveXtreamVodRuntimeRef(ref, provider, signal);
      resolved = requireHttpPlaybackSource(outcome.url);
      strategy = outcome.strategy;
    } else {
      resolved = requireHttpPlaybackSource(
        await resolveCatalogRuntimeSource(source, provider, signal),
      );
    }

    safeLog.info("PLAYBACK_RESOLVE_END", {
      providerType,
      contentKind,
      success: true,
      strategy,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      ...playbackSourceMetadata(resolved),
    });
    return { url: resolved, strategy };
  } catch (caught) {
    safeLog.warn("PLAYBACK_RESOLVE_FAIL", {
      providerType,
      contentKind,
      reason: signal?.aborted
        ? "RESOLUTION_FAILED"
        : hasDurableRef
          ? "INVALID_RESULT"
          : "MISSING_RUNTIME_REFERENCE",
    });
    throw caught;
  }
}
