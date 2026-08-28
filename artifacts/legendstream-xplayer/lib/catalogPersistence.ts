import type { Channel } from "./iptv";
import { normalizeImageUrl } from "./imageUrl";
import type { XtreamSeriesItem, XtreamVodItem } from "./xtreamCatalog";

export type CatalogKind = "live" | "vod" | "series";
export type CatalogSourceMode = "canonical" | "direct";

export type PersistedLivePlaybackRef =
  | {
      type: "xtream-live";
      streamId: string;
      containerExtension: string;
    }
  | { type: "unresolved" };

export type PersistedVodPlaybackRef = {
  type: "xtream-vod";
  streamId: string;
  containerExtension: string;
  sourceMode: CatalogSourceMode;
};

export type PersistedLiveCatalogItem = {
  schemaVersion: 1;
  catalogKind: "live";
  providerId: string;
  id: string;
  name: string;
  logoUrl?: string;
  category: string;
  tvgId?: string;
  streamType?: string;
  contentType: "live";
  nowPlaying?: string;
  nextPlaying?: string;
  playbackRef: PersistedLivePlaybackRef;
};

export type PersistedVodCatalogItem = {
  schemaVersion: 1;
  catalogKind: "vod";
  providerId: string;
  stream_id: string | number;
  name: string;
  stream_icon?: string;
  rating?: string | number;
  rating_5based?: number;
  added?: string;
  category_id?: string | number;
  container_extension?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  releaseDate?: string;
  release_date?: string;
  youtube_trailer?: string;
  playbackRef: PersistedVodPlaybackRef;
};

export type PersistedSeriesCatalogItem = {
  schemaVersion: 1;
  catalogKind: "series";
  providerId: string;
  series_id: string | number;
  name: string;
  cover?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  releaseDate?: string;
  release_date?: string;
  rating?: string | number;
  category_id?: string | number;
  backdrop_path?: string[];
};

export type PersistedCatalogItem =
  | PersistedLiveCatalogItem
  | PersistedVodCatalogItem
  | PersistedSeriesCatalogItem;

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const stringValue = (value: unknown) => typeof value === "string" ? value : undefined;
const nonBlankString = (value: unknown) => {
  const text = stringValue(value)?.trim();
  return text ? text : undefined;
};
const numberValue = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const stringOrNumber = (value: unknown) =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value))
    ? value
    : undefined;
const stringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;

function parseXtreamLivePlaybackRef(source: unknown): PersistedLivePlaybackRef {
  if (typeof source !== "string" || !source) return { type: "unresolved" };
  try {
    const url = new URL(source);
    const match = url.pathname.match(/\/live\/[^/]+\/[^/]+\/([^/]+)$/i);
    if (!match) return { type: "unresolved" };
    const file = decodeURIComponent(match[1]);
    const dot = file.lastIndexOf(".");
    if (dot <= 0 || dot === file.length - 1) return { type: "unresolved" };
    const streamId = file.slice(0, dot);
    const containerExtension = file.slice(dot + 1);
    if (!streamId || !/^[a-zA-Z0-9]{1,10}$/.test(containerExtension)) {
      return { type: "unresolved" };
    }
    return { type: "xtream-live", streamId, containerExtension };
  } catch {
    return { type: "unresolved" };
  }
}

function normalizeLivePlaybackRef(value: unknown): PersistedLivePlaybackRef {
  const raw = asObject(value);
  if (!raw) return { type: "unresolved" };
  if (raw.type === "xtream-live") {
    const streamId = stringValue(raw.streamId);
    const containerExtension = stringValue(raw.containerExtension);
    if (streamId && containerExtension && /^[a-zA-Z0-9]{1,10}$/.test(containerExtension)) {
      return { type: "xtream-live", streamId, containerExtension };
    }
  }
  return { type: "unresolved" };
}

function normalizeVodPlaybackRef(value: unknown, fallback: Record<string, unknown>): PersistedVodPlaybackRef | null {
  const raw = asObject(value);
  const streamId = stringValue(raw?.streamId) ?? String(stringOrNumber(fallback.stream_id) ?? "");
  if (!streamId) return null;
  const rawExtension = stringValue(raw?.containerExtension) ?? stringValue(fallback.container_extension) ?? "mp4";
  const containerExtension = /^[a-zA-Z0-9]{1,10}$/.test(rawExtension) ? rawExtension : "mp4";
  const sourceMode: CatalogSourceMode = raw?.sourceMode === "direct" || Boolean(stringValue(fallback.direct_source))
    ? "direct"
    : "canonical";
  return { type: "xtream-vod", streamId, containerExtension, sourceMode };
}

function projectLive(providerId: string, value: unknown): PersistedLiveCatalogItem | null {
  const raw = asObject(value);
  if (!raw) return null;
  const id = stringValue(raw.id);
  const name = nonBlankString(raw.name);
  if (!id || !name) return null;
  const playbackRef = raw.schemaVersion === 1 && raw.catalogKind === "live"
    ? normalizeLivePlaybackRef(raw.playbackRef)
    : parseXtreamLivePlaybackRef(raw.streamUrl);
  return {
    schemaVersion: 1,
    catalogKind: "live",
    providerId,
    id,
    name,
    logoUrl: normalizeImageUrl(raw.logoUrl) ?? undefined,
    category: stringValue(raw.category) ?? "Live TV",
    tvgId: stringValue(raw.tvgId),
    streamType: stringValue(raw.streamType),
    contentType: "live",
    nowPlaying: stringValue(raw.nowPlaying),
    nextPlaying: stringValue(raw.nextPlaying),
    playbackRef,
  };
}

function projectVod(providerId: string, value: unknown): PersistedVodCatalogItem | null {
  const raw = asObject(value);
  if (!raw) return null;
  const streamId = stringOrNumber(raw.stream_id);
  const name = nonBlankString(raw.name);
  const playbackRef = normalizeVodPlaybackRef(raw.playbackRef, raw);
  if (streamId === undefined || !name || !playbackRef) return null;
  return {
    schemaVersion: 1,
    catalogKind: "vod",
    providerId,
    stream_id: streamId,
    name,
    stream_icon: normalizeImageUrl(raw.stream_icon) ?? undefined,
    rating: stringOrNumber(raw.rating),
    rating_5based: numberValue(raw.rating_5based),
    added: stringValue(raw.added),
    category_id: stringOrNumber(raw.category_id),
    container_extension: stringValue(raw.container_extension),
    plot: stringValue(raw.plot),
    cast: stringValue(raw.cast),
    director: stringValue(raw.director),
    genre: stringValue(raw.genre),
    releaseDate: stringValue(raw.releaseDate),
    release_date: stringValue(raw.release_date),
    youtube_trailer: stringValue(raw.youtube_trailer),
    playbackRef,
  };
}

function projectSeries(providerId: string, value: unknown): PersistedSeriesCatalogItem | null {
  const raw = asObject(value);
  if (!raw) return null;
  const seriesId = stringOrNumber(raw.series_id);
  const name = nonBlankString(raw.name);
  if (seriesId === undefined || !name) return null;
  return {
    schemaVersion: 1,
    catalogKind: "series",
    providerId,
    series_id: seriesId,
    name,
    cover: normalizeImageUrl(raw.cover) ?? undefined,
    plot: stringValue(raw.plot),
    cast: stringValue(raw.cast),
    director: stringValue(raw.director),
    genre: stringValue(raw.genre),
    releaseDate: stringValue(raw.releaseDate),
    release_date: stringValue(raw.release_date),
    rating: stringOrNumber(raw.rating),
    category_id: stringOrNumber(raw.category_id),
    backdrop_path: stringArray(raw.backdrop_path),
  };
}

export function projectCatalogItem(
  providerId: string,
  kind: CatalogKind,
  value: Channel | XtreamVodItem | XtreamSeriesItem | unknown,
): PersistedCatalogItem | null {
  if (kind === "live") return projectLive(providerId, value);
  if (kind === "vod") return projectVod(providerId, value);
  return projectSeries(providerId, value);
}

export function projectCatalogItems(
  providerId: string,
  kind: CatalogKind,
  values: Array<Channel | XtreamVodItem | XtreamSeriesItem>,
): PersistedCatalogItem[] {
  return values
    .map((value) => projectCatalogItem(providerId, kind, value))
    .filter((value): value is PersistedCatalogItem => value !== null);
}

export function normalizePersistedCatalogPayload(
  providerId: string,
  kind: CatalogKind,
  raw: unknown,
): PersistedCatalogItem | null {
  // Re-project both v1 runtime payloads and v1-safe DTO payloads through the
  // explicit whitelist. Unknown provider fields can never escape this boundary.
  return projectCatalogItem(providerId, kind, raw);
}

const RUNTIME_SCHEME = "legendstream-catalog:";

export function makeDirectVodRuntimeSource(ref: PersistedVodCatalogItem): string {
  return `legendstream-catalog://xtream/movie/${encodeURIComponent(ref.providerId)}/${encodeURIComponent(ref.playbackRef.streamId)}?ext=${encodeURIComponent(ref.playbackRef.containerExtension)}`;
}

export type CatalogRuntimeSourceRef = {
  kind: "vod-direct";
  providerId: string;
  streamId: string;
  containerExtension: string;
};

export function parseCatalogRuntimeSource(source: string): CatalogRuntimeSourceRef | null {
  if (!source.startsWith(RUNTIME_SCHEME)) return null;
  try {
    const url = new URL(source);
    if (url.protocol !== RUNTIME_SCHEME || url.hostname !== "xtream") return null;
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts.length !== 3 || parts[0] !== "movie") return null;
    const containerExtension = url.searchParams.get("ext") || "mp4";
    if (!parts[1] || !parts[2] || !/^[a-zA-Z0-9]{1,10}$/.test(containerExtension)) return null;
    return {
      kind: "vod-direct",
      providerId: parts[1],
      streamId: parts[2],
      containerExtension,
    };
  } catch {
    return null;
  }
}

export function isCatalogRuntimeSource(source: string): boolean {
  return parseCatalogRuntimeSource(source) !== null;
}
