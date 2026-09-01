import { Platform } from "react-native";
import { mapInBatches, yieldToUi } from "./cooperative";
import {
  createM3UShapeDiagnosticsObserver,
  type M3UShapeDiagnostics,
} from "./m3uShapeDiagnostics";

export type ProviderType = "m3u" | "xtream" | "stalker";
export type ChannelContentType = "live" | "movie" | "series";

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  url: string;
  username?: string;
  password?: string;
  mac?: string;
  epgUrl?: string;
  createdAt: number;
  lastLoadedAt?: number;
  channelCount?: number;
  isLoading?: boolean;
  loadError?: string;
}

export interface Channel {
  id: string;
  providerId: string;
  name: string;
  streamUrl: string;
  logoUrl?: string;
  category: string;
  tvgId?: string;
  streamType?: string;
  contentType?: ChannelContentType;
  nowPlaying?: string;
  nextPlaying?: string;
}

export interface M3UMovieItem {
  id: string;
  providerId: string;
  name: string;
  streamUrl: string;
  logoUrl?: string;
  category: string;
  contentType: "movie";
}

export interface M3USeriesEpisode {
  id: string;
  providerId: string;
  title: string;
  streamUrl: string;
  category: string;
  season: number;
  episode: number;
  logoUrl?: string;
}

export interface M3USeriesGroup {
  id: string;
  providerId: string;
  name: string;
  category: string;
  coverUrl?: string;
  contentType: "series";
  seasons: Record<string, M3USeriesEpisode[]>;
}

export interface M3UCatalog {
  movieItems: M3UMovieItem[];
  seriesGroups: M3USeriesGroup[];
}

export interface EpgProgram {
  id: string;
  channelId: string;
  title: string;
  description?: string;
  start: number;
  end: number;
}

export interface ProviderLoadResult {
  channels: Channel[];
  liveChannels?: Channel[];
  movieItems?: M3UMovieItem[];
  seriesGroups?: M3USeriesGroup[];
  epgUrl?: string;
  m3uDiagnostics?: M3UShapeDiagnostics;
}

export interface ProviderForm {
  name: string;
  type: ProviderType;
  url: string;
  username?: string;
  password?: string;
  mac?: string;
  epgUrl?: string;
}

const m3uCatalogByProvider = new Map<string, M3UCatalog>();

export function getM3UCatalog(providerId?: string): M3UCatalog {
  if (!providerId) return { movieItems: [], seriesGroups: [] };
  return m3uCatalogByProvider.get(providerId) ?? { movieItems: [], seriesGroups: [] };
}

export function installM3UCatalog(providerId: string, catalog: M3UCatalog) {
  m3uCatalogByProvider.set(providerId, catalog);
}

const decodeEntities = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const MOJIBAKE_MARKERS = /[ÃÄÅÂ]/;

const binaryStringToUtf8 = (binary: string) => {
  try {
    const encoded = Array.from(binary, (char) =>
      `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
    ).join("");
    return decodeURIComponent(encoded);
  } catch {
    return binary;
  }
};

export function repairUtf8Mojibake(value: string) {
  if (!value || !MOJIBAKE_MARKERS.test(value)) return value;
  const chars = Array.from(value);
  if (chars.some((char) => char.charCodeAt(0) > 0xff)) return value;

  const repaired = binaryStringToUtf8(value);
  if (!repaired || repaired === value) return value;
  const before = (value.match(/[ÃÄÅÂ]/g) || []).length;
  const after = (repaired.match(/[ÃÄÅÂ]/g) || []).length;
  return after < before ? repaired : value;
}

const decodeEpgText = (value: string) =>
  repairUtf8Mojibake(decodeEntities(value));

const parseAttributes = (line: string) => {
  const attributes: Record<string, string> = {};
  const attributePattern = /([\w-]+)=(?:"([^"]*)"|'([^']*)'|([^\s]*))/g;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(line))) {
    attributes[match[1].toLowerCase()] = decodeEpgText(
      match[2] ?? match[3] ?? match[4] ?? "",
    );
  }
  return attributes;
};

const makeId = (providerId: string, index: number, value: string) =>
  `${providerId}:${index}:${value}`.replace(/[^a-zA-Z0-9:_-]/g, "-");

const normalizeHint = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

function parseSeriesIdentity(name: string) {
  const patterns = [
    /\bS(?:EASON)?\s*(\d{1,2})\s*E(?:P(?:ISODE)?)?\s*(\d{1,3})\b/i,
    /\b(\d{1,2})\s*[xX]\s*(\d{1,3})\b/i,
    /\b(?:SEZON|SEASON)\s*(\d{1,2})\s*(?:B[ÖO]L[ÜU]M|EPISODE|EP)\s*(\d{1,3})\b/i,
  ];
  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (!match) continue;
    const season = Number(match[1]);
    const episode = Number(match[2]);
    if (!Number.isFinite(season) || !Number.isFinite(episode)) continue;
    const seriesName = name
      .replace(match[0], " ")
      .replace(/[._-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return {
      seriesName: seriesName || name.trim(),
      season: Math.max(1, season),
      episode: Math.max(1, episode),
    };
  }
  return { seriesName: name.trim(), season: 1, episode: 1 };
}

function buildM3UCatalog(entries: Channel[], providerId: string): ProviderLoadResult {
  const liveChannels = entries.filter((entry) => entry.contentType === "live");
  const movieEntries = entries.filter((entry) => entry.contentType === "movie");
  const seriesEntries = entries.filter((entry) => entry.contentType === "series");

  const movieItems: M3UMovieItem[] = movieEntries.map((entry) => ({
    id: entry.id,
    providerId,
    name: entry.name,
    streamUrl: entry.streamUrl,
    logoUrl: entry.logoUrl,
    category: entry.category,
    contentType: "movie",
  }));

  const grouped = new Map<string, M3USeriesGroup>();
  for (const entry of seriesEntries) {
    const identity = parseSeriesIdentity(entry.name);
    const key = `${normalizeHint(identity.seriesName)}::${normalizeHint(entry.category)}`;
    let group = grouped.get(key);
    if (!group) {
      group = {
        id: makeId(providerId, grouped.size, identity.seriesName),
        providerId,
        name: identity.seriesName,
        category: entry.category,
        coverUrl: entry.logoUrl,
        contentType: "series",
        seasons: {},
      };
      grouped.set(key, group);
    }
    const seasonKey = String(identity.season);
    const episodes = group.seasons[seasonKey] ?? (group.seasons[seasonKey] = []);
    episodes.push({
      id: entry.id,
      providerId,
      title: entry.name,
      streamUrl: entry.streamUrl,
      category: entry.category,
      season: identity.season,
      episode: identity.episode,
      logoUrl: entry.logoUrl,
    });
  }
  const seriesGroups = Array.from(grouped.values()).map((group) => ({
    ...group,
    seasons: Object.fromEntries(
      Object.entries(group.seasons).map(([season, episodes]) => [
        season,
        episodes.sort((a, b) => a.episode - b.episode),
      ]),
    ),
  }));

  m3uCatalogByProvider.set(providerId, { movieItems, seriesGroups });
  return { channels: liveChannels, liveChannels, movieItems, seriesGroups };
}

type M3UCatalogCooperativeOptions = {
  batchSize?: number;
  yieldFn?: () => Promise<void>;
};

async function forEachM3UCatalogBatch<T>(
  input: readonly T[],
  batchSize: number,
  yieldFn: () => Promise<void>,
  visitor: (value: T, index: number) => void,
) {
  for (let start = 0; start < input.length; start += batchSize) {
    const end = Math.min(start + batchSize, input.length);
    for (let index = start; index < end; index += 1) visitor(input[index], index);
    if (end < input.length) await yieldFn();
  }
}

async function buildM3UCatalogCooperatively(
  entries: Channel[],
  providerId: string,
  options: M3UCatalogCooperativeOptions = {},
): Promise<ProviderLoadResult> {
  const batchSize = Math.max(1, options.batchSize ?? 200);
  const yieldFn = options.yieldFn ?? yieldToUi;
  const liveChannels: Channel[] = [];
  const movieEntries: Channel[] = [];
  const seriesEntries: Channel[] = [];

  await forEachM3UCatalogBatch(entries, batchSize, yieldFn, (entry) => {
    if (entry.contentType === "live") liveChannels.push(entry);
    else if (entry.contentType === "movie") movieEntries.push(entry);
    else if (entry.contentType === "series") seriesEntries.push(entry);
  });

  const movieItems: M3UMovieItem[] = new Array(movieEntries.length);
  await forEachM3UCatalogBatch(movieEntries, batchSize, yieldFn, (entry, index) => {
    movieItems[index] = {
      id: entry.id,
      providerId,
      name: entry.name,
      streamUrl: entry.streamUrl,
      logoUrl: entry.logoUrl,
      category: entry.category,
      contentType: "movie",
    };
  });

  const grouped = new Map<string, M3USeriesGroup>();
  await forEachM3UCatalogBatch(seriesEntries, batchSize, yieldFn, (entry) => {
    const identity = parseSeriesIdentity(entry.name);
    const key = `${normalizeHint(identity.seriesName)}::${normalizeHint(entry.category)}`;
    let group = grouped.get(key);
    if (!group) {
      group = {
        id: makeId(providerId, grouped.size, identity.seriesName),
        providerId,
        name: identity.seriesName,
        category: entry.category,
        coverUrl: entry.logoUrl,
        contentType: "series",
        seasons: {},
      };
      grouped.set(key, group);
    }
    const seasonKey = String(identity.season);
    const episodes = group.seasons[seasonKey] ?? (group.seasons[seasonKey] = []);
    episodes.push({
      id: entry.id,
      providerId,
      title: entry.name,
      streamUrl: entry.streamUrl,
      category: entry.category,
      season: identity.season,
      episode: identity.episode,
      logoUrl: entry.logoUrl,
    });
  });

  const groupValues = Array.from(grouped.values());
  const seriesGroups: M3USeriesGroup[] = new Array(groupValues.length);
  await forEachM3UCatalogBatch(groupValues, batchSize, yieldFn, (group, index) => {
    seriesGroups[index] = {
      ...group,
      seasons: Object.fromEntries(
        Object.entries(group.seasons).map(([season, episodes]) => [
          season,
          episodes.sort((a, b) => a.episode - b.episode),
        ]),
      ),
    };
  });

  m3uCatalogByProvider.set(providerId, { movieItems, seriesGroups });
  return { channels: liveChannels, liveChannels, movieItems, seriesGroups };
}

type M3UParseState = {
  pending: {
    attributes: Record<string, string>;
    name: string;
    group?: string;
    extinfDuration?: string;
  } | null;
  nextGroup?: string;
  epgUrl?: string;
};

function parseM3ULine(
  line: string,
  providerId: string,
  entries: Channel[],
  state: M3UParseState,
  diagnostics: ReturnType<typeof createM3UShapeDiagnosticsObserver>,
) {
  if (line.startsWith("#EXTM3U")) {
    const attributes = parseAttributes(line);
    state.epgUrl = attributes["url-tvg"] ?? attributes["x-tvg-url"];
    return;
  }
  if (line.startsWith("#EXTINF")) {
    const comma = line.indexOf(",");
    const label = comma >= 0 ? line.slice(comma + 1).trim() : "Untitled channel";
    const extinfDuration = line.match(/^#EXTINF:([^,\s]+)/i)?.[1];
    state.pending = {
      attributes: parseAttributes(line),
      name: decodeEpgText(label) || "Untitled channel",
      group: state.nextGroup,
      extinfDuration,
    };
    state.nextGroup = undefined;
    return;
  }
  if (/^#EXTGRP:/i.test(line)) {
    const group = decodeEpgText(line.slice(line.indexOf(":") + 1).trim());
    if (state.pending) state.pending.group = group || state.pending.group;
    else state.nextGroup = group || state.nextGroup;
    return;
  }
  if (line.startsWith("#") || !state.pending) return;

  const category =
    state.pending.attributes["group-title"] ||
    state.pending.attributes["group"] ||
    state.pending.attributes["category"] ||
    state.pending.attributes["tvg-group"] ||
    state.pending.group ||
    "Uncategorized";
  const streamId = state.pending.attributes["tvg-id"] || state.pending.name;
  const name = state.pending.attributes["tvg-name"] || state.pending.name;
  const tvgId = state.pending.attributes["tvg-id"] || undefined;
  const decision = diagnostics.observe({
    streamUrl: line,
    category,
    extinfDuration: state.pending.extinfDuration,
    tvgId,
  });
  entries.push({
    id: makeId(providerId, entries.length, streamId),
    providerId,
    name,
    streamUrl: line,
    logoUrl: state.pending.attributes["tvg-logo"] || undefined,
    category,
    tvgId,
    streamType: state.pending.attributes["type"] || undefined,
    contentType: decision.contentType,
  });
  state.pending = null;
}

export function parseM3U(
  content: string,
  providerId: string,
  providerSource?: string,
): ProviderLoadResult {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const entries: Channel[] = [];
  const state: M3UParseState = { pending: null };
  const diagnostics = createM3UShapeDiagnosticsObserver(providerSource);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line) parseM3ULine(line, providerId, entries, state, diagnostics);
  }

  if (!entries.length) {
    throw new Error("No playable channels were found in this M3U playlist.");
  }
  return {
    ...buildM3UCatalog(entries, providerId),
    epgUrl: state.epgUrl,
    m3uDiagnostics: diagnostics.snapshot(),
  };
}

async function parseM3UCooperatively(
  content: string,
  providerId: string,
  providerSource?: string,
): Promise<ProviderLoadResult> {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const entries: Channel[] = [];
  const state: M3UParseState = { pending: null };
  const diagnostics = createM3UShapeDiagnosticsObserver(providerSource);
  const batchSize = 500;

  for (let start = 0; start < lines.length; start += batchSize) {
    const end = Math.min(start + batchSize, lines.length);
    for (let index = start; index < end; index += 1) {
      const line = lines[index].trim();
      if (line) parseM3ULine(line, providerId, entries, state, diagnostics);
    }
    if (end < lines.length) await yieldToUi();
  }

  if (!entries.length) {
    throw new Error("No playable channels were found in this M3U playlist.");
  }
  await yieldToUi();
  const catalog = await buildM3UCatalogCooperatively(entries, providerId, {
    batchSize: 200,
    yieldFn: yieldToUi,
  });
  return {
    ...catalog,
    epgUrl: state.epgUrl,
    m3uDiagnostics: diagnostics.snapshot(),
  };
}

export class ProviderLoadError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_URL"
      | "MISSING_CREDENTIALS"
      | "INVALID_CREDENTIALS"
      | "PROVIDER_UNREACHABLE"
      | "PROVIDER_TIMEOUT"
      | "PROVIDER_HTTP_ERROR"
      | "INVALID_PROVIDER_RESPONSE"
      | "PROXY_UNAVAILABLE"
      | "NO_LIVE_STREAMS"
      | "UNKNOWN",
  ) {
    super(message);
    this.name = "ProviderLoadError";
  }
}

const asJson = async (response: Response) => {
  const text = await response.text();
  await yieldToUi();
  try {
    const parsed = JSON.parse(text) as any;
    if (!response.ok) {
      throw new ProviderLoadError(
        parsed?.error?.message || `The provider returned HTTP ${response.status}.`,
        parsed?.error?.code || "PROVIDER_HTTP_ERROR",
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof ProviderLoadError) throw error;
    if (!response.ok) {
      throw new ProviderLoadError(
        `The provider returned HTTP ${response.status}.`,
        "PROVIDER_HTTP_ERROR",
      );
    }
    throw new Error("The provider response was not valid JSON.");
  }
};

export const normalizeXtreamBaseUrl = (value: string) => {
  const trimmed = value.trim();
  const candidate = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ProviderLoadError("Enter a valid Xtream server URL.", "INVALID_URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new ProviderLoadError(
      "Xtream server URLs must use HTTP or HTTPS.",
      "INVALID_URL",
    );
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  if (/\/(player_api|panel_api|server\/load)\.php$/i.test(path)) {
    parsed.pathname = path.slice(0, path.lastIndexOf("/")) || "/";
  } else {
    parsed.pathname = path;
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
};

const cleanBaseUrl = (value: string) => normalizeXtreamBaseUrl(value);

async function fetchProviderJson(url: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ProviderLoadError(
      "The Xtream server could not be reached. Check the URL, port, HTTPS certificate, and network.",
      "PROVIDER_UNREACHABLE",
    );
  }
  return asJson(response);
}

async function fetchProviderText(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: init?.signal ?? controller.signal,
    });
    if (!response.ok) {
      throw new ProviderLoadError(
        `The provider returned HTTP ${response.status}.`,
        "PROVIDER_HTTP_ERROR",
      );
    }
    return await response.text();
  } catch (caught) {
    if (caught instanceof ProviderLoadError) throw caught;
    const name = caught instanceof Error ? caught.name : "";
    if (name === "AbortError" || name === "TimeoutError" || controller.signal.aborted) {
      throw new ProviderLoadError(
        "The provider request timed out. The playlist may be too large or the server is responding too slowly.",
        "PROVIDER_TIMEOUT",
      );
    }
    throw new ProviderLoadError(
      "The provider could not be reached. Check the URL, port, and network.",
      "PROVIDER_UNREACHABLE",
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function loadXtreamInBrowser(
  baseUrl: string,
  username: string,
  password: string,
) {
  let response: Response;
  try {
    response = await fetch("/api/iptv/xtream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ baseUrl, username, password }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new ProviderLoadError(
      "The web proxy could not be reached. Restart the API service and try again.",
      "PROXY_UNAVAILABLE",
    );
  }
  return asJson(response);
}

async function loadM3U(provider: Provider): Promise<ProviderLoadResult> {
  const content = await fetchProviderText(provider.url, {
    headers: { Accept: "application/vnd.apple.mpegurl,text/plain,*/*" },
  });
  const result = await parseM3UCooperatively(content, provider.id, provider.url);
  return { ...result, epgUrl: provider.epgUrl || result.epgUrl };
}

async function loadXtream(provider: Provider): Promise<ProviderLoadResult> {
  if (!provider.username || !provider.password) {
    throw new ProviderLoadError(
      "Xtream Codes requires a username and password.",
      "MISSING_CREDENTIALS",
    );
  }
  const baseUrl = cleanBaseUrl(provider.url);
  const payload =
    Platform.OS === "web"
      ? await loadXtreamInBrowser(baseUrl, provider.username, provider.password)
      : await loadXtreamDirect(baseUrl, provider.username, provider.password);
  const auth = payload.auth;
  if (
    auth?.user_info?.auth === 0 ||
    auth?.user_info?.auth === "0" ||
    auth?.user_info?.status?.toLowerCase?.() === "disabled"
  ) {
    throw new ProviderLoadError(
      "Xtream rejected these credentials. Check the username and password.",
      "INVALID_CREDENTIALS",
    );
  }

  const streams = payload.streams;
  if (!Array.isArray(streams)) {
    throw new ProviderLoadError(
      "Xtream authentication succeeded, but no live stream list was returned.",
      "NO_LIVE_STREAMS",
    );
  }
  const categoryRows = payload.categories;
  const categoryMap = new Map<string, string>(
    (Array.isArray(categoryRows) ? categoryRows : []).map((row: any) => [
      String(row.category_id),
      decodeEpgText(String(row.category_name ?? "")),
    ]),
  );

  const channels = await mapInBatches(
    streams,
    (stream: any, index: number): Channel => {
      const streamId = String(stream.stream_id ?? index);
      const extension = stream.container_extension || "m3u8";
      return {
        id: makeId(provider.id, index, streamId),
        providerId: provider.id,
        name: decodeEpgText(String(stream.name || `Channel ${index + 1}`)),
        streamUrl: `${baseUrl}/live/${encodeURIComponent(provider.username!)}/${encodeURIComponent(provider.password!)}/${streamId}.${extension}`,
        logoUrl: stream.stream_icon || undefined,
        category: categoryMap.get(String(stream.category_id)) || "Live TV",
        tvgId: stream.epg_channel_id || undefined,
        streamType: "xtream",
        contentType: "live",
      };
    },
    250,
  );
  return { channels, liveChannels: channels, epgUrl: provider.epgUrl };
}

async function loadXtreamDirect(
  baseUrl: string,
  username: string,
  password: string,
) {
  const apiUrl = new URL("player_api.php", `${baseUrl}/`);
  apiUrl.searchParams.set("username", username);
  apiUrl.searchParams.set("password", password);
  const auth = await fetchProviderJson(apiUrl.toString());
  await yieldToUi();

  const streamsUrl = new URL(apiUrl);
  streamsUrl.searchParams.set("action", "get_live_streams");
  const streams = await fetchProviderJson(streamsUrl.toString());
  await yieldToUi();

  let categories: unknown[] = [];
  try {
    const categoriesUrl = new URL(apiUrl);
    categoriesUrl.searchParams.set("action", "get_live_categories");
    const result = await fetchProviderJson(categoriesUrl.toString());
    categories = Array.isArray(result) ? result : [];
  } catch {
    // Some providers omit live categories while returning playable streams.
  }
  return { auth, streams, categories };
}

const stalkerJson = async (response: Response) => {
  const text = await response.text();
  await yieldToUi();
  if (!response.ok) throw new Error(`Stalker Portal returned ${response.status}.`);
  try {
    const parsed = JSON.parse(text);
    return parsed?.js ?? parsed;
  } catch {
    throw new Error("The Stalker Portal response was not valid JSON.");
  }
};

async function loadStalker(provider: Provider): Promise<ProviderLoadResult> {
  const baseUrl = cleanBaseUrl(provider.url);
  const mac = provider.mac?.trim() || "00:1A:79:00:00:01";
  const headers = {
    Accept: "*/*",
    "User-Agent": "Mozilla/5.0 (Linux; Android 12; SmartTV) AppleWebKit/537.36",
    "X-User-Agent": "Model: MAG250; Link: WiFi",
    Cookie: `mac=${mac}; stb_lang=en; timezone=Europe%2FIstanbul`,
  };
  const handshake = await stalkerJson(
    await fetch(`${baseUrl}/portal.php?type=stb&action=handshake&token=&JsHttpRequest=1-xml`, { headers }),
  );
  const token = handshake?.token || handshake?.js?.token;
  if (!token) {
    throw new Error("Stalker Portal handshake failed. Check the portal URL and MAC address.");
  }

  const authenticatedHeaders = { ...headers, Authorization: `Bearer ${token}` };
  const result = await stalkerJson(
    await fetch(`${baseUrl}/portal.php?type=itv&action=get_ordered_list&p=1&JsHttpRequest=1-xml`, { headers: authenticatedHeaders }),
  );
  const rows = Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : [];
  const channels = await mapInBatches(
    rows,
    (row: any, index: number): Channel => {
      const rawCommand = String(row.cmd ?? row.url ?? "").replace(/^ffmpeg\s+/i, "").trim();
      const streamUrl = rawCommand || `${baseUrl}/play/live.php?mac=${encodeURIComponent(mac)}&stream=${encodeURIComponent(String(row.id ?? index))}&extension=ts`;
      return {
        id: makeId(provider.id, index, String(row.id ?? row.name ?? index)),
        providerId: provider.id,
        name: decodeEpgText(String(row.name || `Channel ${index + 1}`)),
        streamUrl,
        logoUrl: row.logo || undefined,
        category: decodeEpgText(String(row.tv_genre_name || row.category_name || "Live TV")),
        tvgId: row.xmltv_id || undefined,
        streamType: "stalker",
        contentType: "live",
      };
    },
    250,
  );
  if (!channels.length) throw new Error("The Stalker Portal returned no live channels.");
  return { channels, liveChannels: channels, epgUrl: provider.epgUrl };
}

export async function loadProvider(provider: Provider): Promise<ProviderLoadResult> {
  if (provider.type === "m3u") return loadM3U(provider);
  if (provider.type === "xtream") return loadXtream(provider);
  return loadStalker(provider);
}

const parseXmlDate = (value: string) => {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
};

const stripTags = (value: string) =>
  decodeEpgText(value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());

const decodeResponseText = async (response: Response) => {
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const head = Array.from(bytes.slice(0, 256), (byte) => String.fromCharCode(byte)).join("");
    const declared = head.match(/<\?xml[^>]*encoding=["']\s*([^"']+)\s*["']/i)?.[1]?.toLowerCase();
    const encoding = declared || "utf-8";
    const Decoder = (globalThis as any).TextDecoder;
    if (typeof Decoder === "function") {
      try {
        return new Decoder(encoding).decode(bytes);
      } catch {
        return new Decoder("utf-8").decode(bytes);
      }
    }
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    if (/^(?:utf-?8)$/i.test(encoding)) return binaryStringToUtf8(binary);
    return binary;
  } catch {
    return response.text();
  }
};

function channelIdMap(channels: Channel[]) {
  return new Map(
    channels.map((channel) => [decodeEpgText(channel.tvgId || channel.name), channel.id]),
  );
}

function parseProgramme(
  attributesText: string,
  body: string,
  channelIds: Map<string, string>,
): EpgProgram | null {
  const attributes = parseAttributes(attributesText);
  const channelId = channelIds.get(decodeEpgText(attributes.channel || ""));
  const start = parseXmlDate(attributes.start || "");
  const end = parseXmlDate(attributes.stop || "");
  if (!channelId || !Number.isFinite(start) || !Number.isFinite(end)) return null;

  const title = stripTags(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "Untitled program");
  const description = stripTags(body.match(/<desc[^>]*>([\s\S]*?)<\/desc>/i)?.[1] || "");
  return {
    id: `${channelId}:${start}:${title}`,
    channelId,
    title,
    description: description || undefined,
    start,
    end,
  };
}

export function parseXmltv(content: string, channels: Channel[]): EpgProgram[] {
  const channelIds = channelIdMap(channels);
  const programs: EpgProgram[] = [];
  const programmePattern = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
  let match: RegExpExecArray | null;
  while ((match = programmePattern.exec(content))) {
    const program = parseProgramme(match[1], match[2], channelIds);
    if (program) programs.push(program);
  }
  return programs.sort((a, b) => a.start - b.start);
}

export async function parseXmltvAsync(
  content: string,
  channels: Channel[],
  nowMs = Date.now(),
): Promise<EpgProgram[]> {
  const channelIds = channelIdMap(channels);
  const programs: EpgProgram[] = [];
  const perChannel = new Map<string, number>();
  const programmePattern = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
  const windowStart = nowMs - 2 * 60 * 60 * 1000;
  const windowEnd = nowMs + 18 * 60 * 60 * 1000;
  let match: RegExpExecArray | null;
  let scanned = 0;

  while ((match = programmePattern.exec(content))) {
    const attributes = parseAttributes(match[1]);
    const channelId = channelIds.get(decodeEpgText(attributes.channel || ""));
    if (channelId) {
      const start = parseXmlDate(attributes.start || "");
      const end = parseXmlDate(attributes.stop || "");
      const count = perChannel.get(channelId) ?? 0;
      if (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end >= windowStart &&
        start <= windowEnd &&
        count < 6
      ) {
        const title = stripTags(match[2].match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "Untitled program");
        const description = stripTags(match[2].match(/<desc[^>]*>([\s\S]*?)<\/desc>/i)?.[1] || "");
        programs.push({
          id: `${channelId}:${start}:${title}`,
          channelId,
          title,
          description: description || undefined,
          start,
          end,
        });
        perChannel.set(channelId, count + 1);
      }
    }

    scanned += 1;
    if (scanned % 120 === 0) await yieldToUi();
  }

  await yieldToUi();
  return programs.sort((a, b) => a.start - b.start);
}

export async function loadEpg(provider: Provider, channels: Channel[]): Promise<EpgProgram[]> {
  if (provider.epgUrl) {
    const response = await fetch(provider.epgUrl, {
      headers: { Accept: "application/xml,text/xml,*/*" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`EPG request failed with ${response.status}.`);
    return parseXmltvAsync(await decodeResponseText(response), channels);
  }

  if (provider.type === "xtream" && provider.username && provider.password) {
    const baseUrl = cleanBaseUrl(provider.url);
    const query = `username=${encodeURIComponent(provider.username)}&password=${encodeURIComponent(provider.password)}`;
    const targetChannels = channels.filter((channel) => channel.streamType === "xtream").slice(0, 60);
    const results = await Promise.all(
      targetChannels.map(async (channel) => {
        const streamId = channel.id.split(":").pop();
        if (!streamId) return [] as EpgProgram[];
        try {
          const response = await fetch(`${baseUrl}/player_api.php?${query}&action=get_short_epg&stream_id=${encodeURIComponent(streamId)}&limit=8`, {
            signal: AbortSignal.timeout(12_000),
          });
          if (!response.ok) return [] as EpgProgram[];
          const data = await asJson(response);
          const rows = Array.isArray(data?.epg_listings) ? data.epg_listings : [];
          return rows
            .map((row: any, index: number) => ({
              id: `${channel.id}:${row.id ?? index}`,
              channelId: channel.id,
              title: row.title ? decodeEpgText(atobUtf8Safe(row.title)) : "Program",
              description: row.description ? decodeEpgText(atobUtf8Safe(row.description)) : undefined,
              start: Number(row.start_timestamp) * 1000,
              end: Number(row.stop_timestamp) * 1000,
            }))
            .filter((row: EpgProgram) => Number.isFinite(row.start) && Number.isFinite(row.end));
        } catch {
          return [] as EpgProgram[];
        }
      }),
    );
    return results.flat().sort((a, b) => a.start - b.start);
  }
  return [];
}

function atobUtf8Safe(value: string) {
  try {
    if (typeof globalThis.atob !== "function") return repairUtf8Mojibake(value);
    const binary = globalThis.atob(value);
    return repairUtf8Mojibake(binaryStringToUtf8(binary));
  } catch {
    return repairUtf8Mojibake(value);
  }
}
