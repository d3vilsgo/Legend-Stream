import { Platform } from "react-native";
import { normalizeXtreamBaseUrl } from "./iptv";

export type XtreamCategory = {
  category_id: string | number;
  category_name: string;
  parent_id?: number;
};

export type XtreamVodItem = {
  stream_id: number | string;
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
};

export type XtreamSeriesItem = {
  series_id: number | string;
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

export type XtreamEpisode = {
  id: string | number;
  episode_num?: number;
  title?: string;
  container_extension?: string;
  info?: {
    movie_image?: string;
    plot?: string;
    duration?: string;
    rating?: string | number;
    releaseDate?: string;
  };
};

export type XtreamSeason = {
  season_number: number;
  name?: string;
  cover?: string;
  cover_big?: string;
  episode_count?: number;
  overview?: string;
};

export type XtreamSeriesInfo = {
  info?: XtreamSeriesItem & Record<string, unknown>;
  seasons?: XtreamSeason[];
  episodes?: Record<string, XtreamEpisode[]>;
};

type XtreamCredentials = {
  baseUrl: string;
  username: string;
  password: string;
};

const encodeCredentials = (credentials: XtreamCredentials) => ({
  baseUrl: normalizeXtreamBaseUrl(credentials.baseUrl),
  username: credentials.username.trim(),
  password: credentials.password,
});

async function parseResponse(response: Response) {
  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Xtream server returned an invalid JSON response.");
  }
  if (!response.ok) {
    const message = (data as any)?.error?.message;
    throw new Error(message || `Xtream request failed with HTTP ${response.status}.`);
  }
  return data as any;
}

async function requestNative(
  credentials: XtreamCredentials,
  action: string,
  params: Record<string, string | number | undefined> = {},
) {
  const normalized = encodeCredentials(credentials);
  const url = new URL("player_api.php", `${normalized.baseUrl}/`);
  url.searchParams.set("username", normalized.username);
  url.searchParams.set("password", normalized.password);
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "LegendStream-XPlayer/1.0 Android",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Xtream server could not be reached.");
  }
  return parseResponse(response);
}

async function requestWeb(
  credentials: XtreamCredentials,
  action: string,
  params: Record<string, string | number | undefined> = {},
) {
  let response: Response;
  try {
    response = await fetch("/api/iptv/xtream/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...encodeCredentials(credentials), action, params }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new Error("Xtream web proxy could not be reached.");
  }
  return parseResponse(response);
}

async function requestXtream(
  credentials: XtreamCredentials,
  action: string,
  params: Record<string, string | number | undefined> = {},
) {
  return Platform.OS === "web"
    ? requestWeb(credentials, action, params)
    : requestNative(credentials, action, params);
}

export async function getVodCategories(credentials: XtreamCredentials) {
  const data = await requestXtream(credentials, "get_vod_categories");
  return Array.isArray(data) ? (data as XtreamCategory[]) : [];
}

export async function getVodStreams(
  credentials: XtreamCredentials,
  categoryId?: string | number,
) {
  const data = await requestXtream(credentials, "get_vod_streams", {
    category_id: categoryId,
  });
  return Array.isArray(data) ? (data as XtreamVodItem[]) : [];
}

export async function getSeriesCategories(credentials: XtreamCredentials) {
  const data = await requestXtream(credentials, "get_series_categories");
  return Array.isArray(data) ? (data as XtreamCategory[]) : [];
}

export async function getSeries(
  credentials: XtreamCredentials,
  categoryId?: string | number,
) {
  const data = await requestXtream(credentials, "get_series", {
    category_id: categoryId,
  });
  return Array.isArray(data) ? (data as XtreamSeriesItem[]) : [];
}

export async function getSeriesInfo(
  credentials: XtreamCredentials,
  seriesId: string | number,
) {
  const data = await requestXtream(credentials, "get_series_info", {
    series_id: seriesId,
  });
  return (data ?? {}) as XtreamSeriesInfo;
}

export function buildVodStreamUrl(
  credentials: XtreamCredentials,
  item: XtreamVodItem,
) {
  const baseUrl = normalizeXtreamBaseUrl(credentials.baseUrl);
  const extension = item.container_extension || "mp4";
  return `${baseUrl}/movie/${encodeURIComponent(credentials.username)}/${encodeURIComponent(
    credentials.password,
  )}/${encodeURIComponent(String(item.stream_id))}.${extension}`;
}

export function buildEpisodeStreamUrl(
  credentials: XtreamCredentials,
  episode: XtreamEpisode,
) {
  const baseUrl = normalizeXtreamBaseUrl(credentials.baseUrl);
  const extension = episode.container_extension || "mp4";
  return `${baseUrl}/series/${encodeURIComponent(credentials.username)}/${encodeURIComponent(
    credentials.password,
  )}/${encodeURIComponent(String(episode.id))}.${extension}`;
}
