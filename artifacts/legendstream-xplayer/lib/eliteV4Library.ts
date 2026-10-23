import type { ProviderConfig } from "@/context/PlayerContext";
import type { MediaProgress } from "@/context/MediaLibraryContext";
import {
  getCachedLibraryItem,
  getCachedM3UEpisodeParent,
  loadM3USeriesInfoFromCache,
} from "./catalogPageRepository";
import { resolveCatalogPlaybackSource } from "./catalogRuntime";
import {
  getSeriesInfo,
  type XtreamSeriesItem,
  type XtreamVodItem,
} from "./xtreamCatalog";
import { v4PagedMovies, v4StalkerMovies, type V4Movie } from "./eliteV4Movies";
import { v4PagedSeries, v4StalkerSeries, type V4Series } from "./eliteV4Series";
import { readCurrentStalkerProductSession } from "./stalkerProductSession";
import {
  findStalkerVodItemByIdentity,
  resolveStalkerVodHistoryLink,
  resolveStalkerVodLink,
} from "./stalkerVod";
import { resolveStalkerSeriesHistoryEpisode } from "./stalkerSeriesProduct";
import type { ContentFavorite } from "./contentFavorites";
import { resumableProgress } from "./progressMutations";
export type LibraryTarget = {
  providerId: string;
  kind: "movie" | "series";
  catalogId: string;
  title: string;
  categoryId?: string;
};
export function favoriteForProgress(item: MediaProgress): LibraryTarget | null {
  if (!item.providerId) return null;
  const r = item.playbackRef;
  if (r.type === "xtream-vod")
    return {
      providerId: item.providerId,
      kind: "movie",
      catalogId: r.streamId,
      title: item.title,
    };
  if (r.type === "m3u-vod" || r.type === "stalker-vod")
    return {
      providerId: item.providerId,
      kind: "movie",
      catalogId: r.itemId,
      title: item.title,
      ...(r.type === "stalker-vod" ? { categoryId: r.categoryId } : {}),
    };
  const seriesId =
    item.episodeContext?.seriesId ||
    (r.type === "xtream-episode" || r.type === "stalker-episode"
      ? r.seriesId
      : undefined);
  return seriesId
    ? {
        providerId: item.providerId,
        kind: "series",
        catalogId: seriesId,
        title: item.subtitle || item.title,
      }
    : null;
}
export function canResumeLibraryProgress(entry: MediaProgress) {
  return (
    resumableProgress(entry) &&
    (entry.kind !== "episode" || !!favoriteForProgress(entry))
  );
}
export function continueWatching(
  entries: readonly MediaProgress[],
  providerId: string,
) {
  const seen = new Set<string>();
  return entries
    .filter((e) => e.providerId === providerId && canResumeLibraryProgress(e))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((e) => {
      const target = favoriteForProgress(e),
        key =
          e.kind === "episode" && target
            ? JSON.stringify([target.providerId, target.catalogId])
            : e.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
export const progressCaption = (entry: MediaProgress) => {
  const context = entry.episodeContext;
  if (context)
    return `Dizi · S${context.seasonId}${context.episodeNumber !== undefined ? ` · B${context.episodeNumber}` : ""} · ${entry.title}`;
  const r = entry.playbackRef;
  return r.type === "stalker-episode"
    ? `Dizi · S${r.seasonId} · ${entry.title}`
    : entry.kind === "episode"
      ? `Dizi · ${entry.subtitle || entry.title}`
      : "Film";
};
export async function loadLibraryDetail(
  provider: ProviderConfig,
  target: LibraryTarget,
  signal: AbortSignal,
): Promise<V4Movie | V4Series> {
  if (target.providerId !== provider.id)
    throw new Error("LIBRARY_PROVIDER_CHANGED");
  if (provider.type === "stalker") {
    const session = readCurrentStalkerProductSession({
      ...provider,
      type: "stalker",
    });
    if (target.kind === "series")
      return v4StalkerSeries(provider.id, session.providerScopeId, [
        { id: target.catalogId, title: target.title },
      ])[0];
    if (!target.categoryId) throw new Error("LIBRARY_ITEM_UNAVAILABLE");
    const item = await findStalkerVodItemByIdentity(
      session.session,
      { itemId: target.catalogId, categoryId: target.categoryId },
      { signal },
    );
    return v4StalkerMovies(
      provider.id,
      session.providerScopeId,
      [item],
      "default",
    )[0];
  }
  const item = await getCachedLibraryItem(
    provider,
    target.kind,
    target.catalogId,
  );
  if (!item || signal.aborted) throw new Error("LIBRARY_ITEM_UNAVAILABLE");
  return target.kind === "series"
    ? v4PagedSeries(provider.id, provider.type, "library", [
        item as XtreamSeriesItem,
      ])[0]
    : v4PagedMovies(provider.id, provider.type, "library", [
        item as XtreamVodItem,
      ])[0];
}
export async function resolveLibraryMovie(
  provider: ProviderConfig,
  movie: V4Movie,
  signal: AbortSignal,
) {
  if (movie.input.identity.providerId !== provider.id)
    throw new Error("LIBRARY_PROVIDER_CHANGED");
  return movie.source.kind === "stalker"
    ? resolveStalkerVodLink(
        readCurrentStalkerProductSession({ ...provider, type: "stalker" })
          .session,
        movie.source.item,
        { signal },
      )
    : (
        await resolveCatalogPlaybackSource(
          { kind: "movie", item: movie.source.item },
          provider,
          signal,
        )
      ).url;
}
export async function resolveLibraryProgress(
  provider: ProviderConfig,
  item: MediaProgress,
  signal: AbortSignal,
) {
  if (item.providerId !== provider.id || !resumableProgress(item))
    throw new Error("LIBRARY_RESUME_UNAVAILABLE");
  const r = item.playbackRef;
  if (r.type === "stalker-episode")
    return (
      await resolveStalkerSeriesHistoryEpisode(
        readCurrentStalkerProductSession({ ...provider, type: "stalker" })
          .session,
        provider.id,
        r,
        item.subtitle || item.title,
        signal,
      )
    ).url;
  if (r.type === "stalker-vod")
    return (
      await resolveStalkerVodHistoryLink(
        readCurrentStalkerProductSession({ ...provider, type: "stalker" })
          .session,
        r,
        { signal },
      )
    ).url;
  if (item.kind === "movie") {
    const target = favoriteForProgress(item);
    if (!target) throw new Error("LIBRARY_RESUME_UNAVAILABLE");
    return resolveLibraryMovie(
      provider,
      (await loadLibraryDetail(provider, target, signal)) as V4Movie,
      signal,
    );
  }
  let seriesId =
    item.episodeContext?.seriesId ||
    (r.type === "xtream-episode" ? r.seriesId : undefined);
  if (r.type === "m3u-episode" && !seriesId)
    seriesId = String(
      (await getCachedM3UEpisodeParent(provider, r.itemId))?.series_id ?? "",
    );
  if (!seriesId) throw new Error("LIBRARY_EPISODE_PARENT_UNAVAILABLE");
  const info =
    provider.type === "m3u"
      ? await loadM3USeriesInfoFromCache(provider, seriesId)
      : await getSeriesInfo(
          {
            baseUrl: provider.url || provider.playlistUrl,
            username: provider.username || "",
            password: provider.password || "",
          },
          seriesId,
          signal,
        );
  const episodeId =
    r.type === "m3u-episode"
      ? r.itemId
      : r.type === "xtream-episode"
        ? r.episodeId
        : "";
  const episodes = Object.entries(info?.episodes ?? {}).flatMap(
    ([season, episodes]) =>
      episodes.filter(
        (e) =>
          String(e.id) === episodeId &&
          (!item.episodeContext || item.episodeContext.seasonId === season),
      ),
  );
  if (episodes.length !== 1 || signal.aborted)
    throw new Error("LIBRARY_EPISODE_UNAVAILABLE");
  return (
    await resolveCatalogPlaybackSource(
      { kind: "episode", item: episodes[0] },
      provider,
      signal,
    )
  ).url;
}
export const libraryFavoriteTarget = (item: {
  input: {
    identity: {
      providerId: string;
      kind: "movie" | "series";
      catalogId: string;
    };
  };
  title: string;
  categoryId?: string;
}): Omit<ContentFavorite, "addedAt"> => ({
  ...item.input.identity,
  title: item.title,
  categoryId: item.categoryId,
});
