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
  isCatalogRuntimeSource,
  makeDirectVodRuntimeSource,
  makeStalkerLiveRuntimeSource,
  parseCatalogRuntimeSource,
  type PersistedLiveCatalogItem,
  type PersistedSeriesCatalogItem,
  type PersistedVodCatalogItem,
} from "./catalogPersistence";
import { classifyStalkerLiveRuntimeCmd, resolveStalkerLiveRuntimeCmd } from "./stalkerLiveCatalog";
import type { StalkerLiveCategory } from "./stalkerLiveCatalog";
import { getPersistedStalkerLiveCategoryId, getPersistedStalkerLivePlaybackRef } from "./stalkerLiveCache";
import { getOrCreateStalkerPortalSession } from "./stalkerPortalRuntime";
import { reacquireStalkerLiveChannel } from "./stalkerLiveRuntimeLocator";
import type { StalkerPortalSession } from "./stalkerPortal";
import { safeLog } from "./safeLog";
import { classifyPlaybackSource, getActiveStalkerTraceId, shortSafeId, traceStalker } from "./stalkerPlaybackTrace";

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
  getStalkerCategoryHint?: typeof getPersistedStalkerLiveCategoryId;
  acquireStalkerSession?: (
    identity: Parameters<typeof getOrCreateStalkerPortalSession>[0],
  ) => Pick<StalkerPortalSession, "request">;
  resolveStalkerLink?: (
    session: Pick<StalkerPortalSession, "request">,
    cmd: string,
    signal?: AbortSignal,
  ) => Promise<string>;
  getStalkerCategories?: (providerId: string) => Promise<StalkerLiveCategory[]>;
  discoverStalkerLive?: (input: {
    session: Pick<StalkerPortalSession, "request">;
    providerId: string;
    categories: StalkerLiveCategory[];
    signal?: AbortSignal;
  }) => Promise<{
    rows: Array<{ portalId: string; cmd: string }>;
  }>;
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
  const traceId = getActiveStalkerTraceId() ?? undefined;
  let stage = "PARSE_REF";
  if (traceId) traceStalker("CATALOG_RUNTIME_RESOLVE_START", { traceId, sourceKind: classifyPlaybackSource(source), activeProviderPresent: Boolean(provider), providerShortId: shortSafeId(provider?.id) });
  try {
    const ref = parseCatalogRuntimeSource(source);
    if (!ref) { if (traceId) traceStalker("CATALOG_RUNTIME_FAIL", { traceId, stage: "PARSE_REF", errorClass: "UNKNOWN" }); return source; }
    if (traceId) traceStalker("CATALOG_RUNTIME_REF_PARSED", { traceId, refKind: ref.kind, refProviderShortId: shortSafeId(ref.providerId), itemId: "itemId" in ref ? ref.itemId : undefined, providerMatches: Boolean(provider && provider.id === ref.providerId) });
    if (!provider || provider.id !== ref.providerId) { stage = provider ? "PROVIDER_MISMATCH" : "PROVIDER_MISSING"; throw new Error("Cached playback provider is unavailable."); }
    if (ref.kind === "stalker-live") {
      stage = "CREDENTIAL_STATE_INVALID";
      if (traceId) traceStalker("STALKER_CREDENTIAL_STATE", { traceId, hasPortalUrl: Boolean(provider.url || provider.playlistUrl), hasMac: Boolean(provider.mac?.trim()) });
      const credentials = requireStalkerCredentials(provider);
      stage = "PLAYBACK_REF_MISSING";
      if (traceId) traceStalker("STALKER_PLAYBACK_REF_LOOKUP", { traceId });
      const playbackRef = await (dependencies.getStalkerPlaybackRef ?? getPersistedStalkerLivePlaybackRef)(ref.providerId, ref.itemId);
      if (traceId) traceStalker("STALKER_PLAYBACK_REF_RESULT", { traceId, found: Boolean(playbackRef), refType: playbackRef?.type ?? "none", portalIdHash: playbackRef ? shortSafeId(playbackRef.portalId) : "none" });
      if (!playbackRef) throw new Error("Cached Stalker playback reference is unavailable.");
      stage = "SESSION_ACQUIRE";
      if (traceId) traceStalker("STALKER_SESSION_ACQUIRE_START", { traceId });
      const session = (dependencies.acquireStalkerSession ?? getOrCreateStalkerPortalSession)({ providerId: ref.providerId, portalUrl: credentials.portalUrl, mac: credentials.mac });
      if (traceId) traceStalker("STALKER_SESSION_ACQUIRE_RESULT", { traceId, success: true });
      const categories = dependencies.getStalkerCategories ? await dependencies.getStalkerCategories(ref.providerId) : [];
      if (signal?.aborted) throw new Error("Cached Stalker playback resolution was cancelled.");
      stage = "REACQUIRE";
      if (traceId) traceStalker("PLAYBACK_REACQUIRE_START", { traceId });
      const reacquired = await reacquireStalkerLiveChannel(
        { session, providerId: ref.providerId, portalId: playbackRef.portalId, categories, signal, traceId },
        {
          fullDiscover: dependencies.discoverStalkerLive,
          resolveCategoryHint: () =>
            (dependencies.getStalkerCategoryHint ?? getPersistedStalkerLiveCategoryId)(
              ref.providerId,
              ref.itemId,
            ),
        },
      );
      if (signal?.aborted) throw new Error("Cached Stalker playback resolution was cancelled.");
      const currentChannel = reacquired.channel;
      if (traceId) {
        traceStalker("PLAYBACK_REACQUIRE_SOURCE", { traceId, source: reacquired.source });
        traceStalker("PLAYBACK_REACQUIRE_ROWS", { traceId, rowCount: reacquired.rows });
        traceStalker("PLAYBACK_REACQUIRE_DONE", { traceId, success: true });
      }
      stage = "CURRENT_CMD_MISSING";
      if (traceId) traceStalker("STALKER_CURRENT_CMD_RESULT", { traceId, hasCmd: Boolean(currentChannel.cmd?.trim()) });
      if (!currentChannel.cmd?.trim()) throw new Error("Stalker channel has no playback command.");
      const cmdStage = classifyStalkerLiveRuntimeCmd(currentChannel.cmd);
      stage = cmdStage === "CREATE_LINK_REQUIRED" ? "CREATE_LINK" : "CMD_STAGE";
      if (traceId) traceStalker("STALKER_CMD_STAGE", { traceId, stage: cmdStage });
      if (traceId && cmdStage === "CREATE_LINK_REQUIRED") traceStalker("STALKER_CREATE_LINK_START", { traceId, kind: "live" });
      const resolved = await resolveStalkerLiveRuntimeCmd(
        session,
        currentChannel.cmd,
        signal,
        dependencies.resolveStalkerLink,
      );
      if (traceId && cmdStage === "CREATE_LINK_REQUIRED") traceStalker("STALKER_CREATE_LINK_RESULT", { traceId, kind: "live", success: true, hasPlayableUrl: Boolean(resolved) });
      if (traceId) traceStalker("CATALOG_RUNTIME_RESOLVE_SUCCESS", { traceId, resolvedSourceKind: classifyPlaybackSource(resolved) });
      return resolved;
    }
    if (ref.kind === "vod-direct") return (await resolveXtreamVodRuntimeRef(ref, provider, signal)).url;
    return source;
  } catch (caught) {
    if (traceId) {
      const errorClass = signal?.aborted ? "ABORTED" : stage === "PROVIDER_MISMATCH" ? "PROVIDER_MISMATCH" : stage === "PROVIDER_MISSING" ? "PROVIDER_MISSING" : stage === "CREDENTIAL_STATE_INVALID" ? "CREDENTIAL_STATE_INVALID" : stage === "PLAYBACK_REF_MISSING" ? "PLAYBACK_REF_MISSING" : stage === "SESSION_ACQUIRE" ? "SESSION_ERROR" : stage === "REACQUIRE" ? "DISCOVERY_ERROR" : stage === "CURRENT_CMD_MISSING" ? "CURRENT_CMD_MISSING" : stage === "CMD_STAGE" ? "INVALID_RESPONSE" : stage === "CREATE_LINK" ? (/playable.*link/i.test(caught instanceof Error ? caught.message : "") ? "CREATE_LINK_NO_URL" : "CREATE_LINK_ERROR") : "UNKNOWN";
      if (stage === "CREATE_LINK") traceStalker("STALKER_CREATE_LINK_RESULT", { traceId, kind: "live", success: false, hasPlayableUrl: false, errorClass });
      traceStalker("CATALOG_RUNTIME_FAIL", { traceId, stage, errorClass });
    }
    throw caught;
  }
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
