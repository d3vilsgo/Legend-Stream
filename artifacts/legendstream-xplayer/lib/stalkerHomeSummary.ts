import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StalkerSeriesProductItem } from "./stalkerSeriesProduct";
import type { StalkerVodItem } from "./stalkerVod";

export const STALKER_HOME_PREVIEW_LIMIT = 8;

export type StalkerHomeMoviePreview = {
  id: string;
  title: string;
  image?: string;
  category?: string;
  year?: string;
  rating?: string;
};

export type StalkerHomeSeriesPreview = StalkerHomeMoviePreview;

export type StalkerHomeSummary = {
  schemaVersion: 1;
  providerId: string;
  movies: StalkerHomeMoviePreview[];
  series: StalkerHomeSeriesPreview[];
};

type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem">;
type SummaryListener = (summary: StalkerHomeSummary) => void;

const STORAGE_PREFIX = "@legendstream/stalker-home-summary-v1:";
const listeners = new Map<string, Set<SummaryListener>>();
const writeQueues = new Map<string, Promise<void>>();
const SAFE_PREVIEW_KEYS = new Set(["id", "title", "image", "category", "year", "rating"]);

export function emptyStalkerHomeSummary(providerId: string): StalkerHomeSummary {
  return { schemaVersion: 1, providerId, movies: [], series: [] };
}

const safeText = (value: unknown, maxLength: number) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;

function parsePreview(value: unknown): StalkerHomeMoviePreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !SAFE_PREVIEW_KEYS.has(key))) return null;
  const id = safeText(raw.id, 256);
  const title = safeText(raw.title, 256);
  if (!id || !title) return null;
  return {
    id,
    title,
    image: safeText(raw.image, 2_048),
    category: safeText(raw.category, 256),
    year: safeText(raw.year, 32),
    rating: safeText(raw.rating, 32),
  };
}

function parsePreviewList(value: unknown) {
  if (!Array.isArray(value) || value.length > STALKER_HOME_PREVIEW_LIMIT) return null;
  const result: StalkerHomeMoviePreview[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const item = parsePreview(raw);
    if (!item || seen.has(item.id)) return null;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

export function parseStalkerHomeSummary(raw: string | null, providerId: string): StalkerHomeSummary {
  if (!raw) return emptyStalkerHomeSummary(providerId);
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      !value ||
      value.schemaVersion !== 1 ||
      value.providerId !== providerId ||
      Object.keys(value).sort().join("|") !== "movies|providerId|schemaVersion|series"
    ) return emptyStalkerHomeSummary(providerId);
    const movies = parsePreviewList(value.movies);
    const series = parsePreviewList(value.series);
    return movies && series
      ? { schemaVersion: 1, providerId, movies, series }
      : emptyStalkerHomeSummary(providerId);
  } catch {
    return emptyStalkerHomeSummary(providerId);
  }
}

export async function readStalkerHomeSummary(
  providerId: string,
  storage: Storage = AsyncStorage,
) {
  return parseStalkerHomeSummary(
    await storage.getItem(`${STORAGE_PREFIX}${providerId}`),
    providerId,
  );
}

function moviePreview(item: StalkerVodItem): StalkerHomeMoviePreview {
  return {
    id: item.portalId,
    title: item.title,
    image: item.posterUrl,
    category: item.genre,
    year: item.year,
    rating: item.rating,
  };
}

function seriesPreview(item: StalkerSeriesProductItem): StalkerHomeSeriesPreview {
  return {
    id: item.id,
    title: item.title,
    image: item.posterUrl,
    category: item.genre,
    year: item.year,
    rating: item.rating,
  };
}

async function writePreview(
  providerId: string,
  kind: "movies" | "series",
  preview: StalkerHomeMoviePreview[],
  storage: Storage,
) {
  const write = async () => {
    const current = await readStalkerHomeSummary(providerId, storage);
    const next: StalkerHomeSummary = {
      ...current,
      [kind]: preview.slice(0, STALKER_HOME_PREVIEW_LIMIT),
    };
    await storage.setItem(`${STORAGE_PREFIX}${providerId}`, JSON.stringify(next));
    listeners.get(providerId)?.forEach((listener) => listener(next));
    return next;
  };
  const queued = (writeQueues.get(providerId) ?? Promise.resolve()).then(write, write);
  writeQueues.set(providerId, queued.then(() => undefined, () => undefined));
  return queued;
}

export function writeStalkerMovieHomePreview(
  providerId: string,
  items: readonly StalkerVodItem[],
  storage: Storage = AsyncStorage,
) {
  return writePreview(providerId, "movies", items.map(moviePreview), storage);
}

export function writeStalkerSeriesHomePreview(
  providerId: string,
  items: readonly StalkerSeriesProductItem[],
  storage: Storage = AsyncStorage,
) {
  return writePreview(providerId, "series", items.map(seriesPreview), storage);
}

export function subscribeStalkerHomeSummary(providerId: string, listener: SummaryListener) {
  const providerListeners = listeners.get(providerId) ?? new Set<SummaryListener>();
  providerListeners.add(listener);
  listeners.set(providerId, providerListeners);
  return () => {
    providerListeners.delete(listener);
    if (!providerListeners.size) listeners.delete(providerId);
  };
}
