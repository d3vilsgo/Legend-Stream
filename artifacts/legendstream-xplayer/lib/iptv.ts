import { mapInBatches, tokenizeM3ULinesCooperatively, yieldToUi, yieldXtreamXmltvEventLoop } from "./cooperative";
import {
  createM3UShapeDiagnosticsObserver,
  type M3UShapeDiagnostics,
} from "./m3uShapeDiagnostics";
import { createStalkerPortalSession } from "./stalkerPortal";
import {
  recordM3UBackgroundJsSlice,
  recordM3UCatalogBuildEnd,
  recordM3UEpgBodyBegin,
  recordM3UEpgBodyEnd,
  recordM3UEpgDecodeBegin,
  recordM3UEpgDecodeEnd,
  recordM3UEpgFetchBegin,
  recordM3UEpgFetchResponse,
  recordM3UEpgParseBegin,
  recordM3UEpgParseEnd,
  recordM3UEpgStringAssemblyBegin,
  recordM3UEpgStringAssemblyEnd,
  recordM3UFetchBegin,
  recordM3UFetchResponse,
  recordM3UParseLinesEnd,
  recordM3UResponseTextEnd,
  recordM3USplitBegin,
  recordM3USplitEnd,
} from "./m3uInAppDiagnostics";
import {
  loadXtreamLiveCatalogFromPreparedRun,
  type XtreamCredentials,
} from "./xtreamCatalog";
import { normalizeXtreamBaseUrl as normalizeCanonicalXtreamBaseUrl } from "./xtream/client";
import {
  beginXtreamEpgPhase,
  endXtreamEpgPhase,
  getXtreamEpgDiagnosticSnapshot,
  recordXtreamEpgCpuStage,
  recordXtreamEpgHeadersReceived,
  recordXtreamEpgParseYield,
  recordXtreamEpgFailure,
  setXtreamEpgSourceKind,
  type XtreamEpgCpuStage,
} from "./xtreamEpgDiagnostics";

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
  playbackStreamId?: string;
  playbackContainerExtension?: string | null;
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
    const sliceStartedAt = globalThis.performance?.now?.() ?? Date.now();
    const end = Math.min(start + batchSize, input.length);
    for (let index = start; index < end; index += 1) visitor(input[index], index);
    recordM3UBackgroundJsSlice((globalThis.performance?.now?.() ?? Date.now()) - sliceStartedAt);
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
  recordM3USplitBegin();
  const lines = await tokenizeM3ULinesCooperatively(
    content,
    500,
    yieldToUi,
    recordM3UBackgroundJsSlice,
  );
  recordM3USplitEnd();
  const entries: Channel[] = [];
  const state: M3UParseState = { pending: null };
  const diagnostics = createM3UShapeDiagnosticsObserver(providerSource);
  const batchSize = 500;

  for (let start = 0; start < lines.length; start += batchSize) {
    const sliceStartedAt = globalThis.performance?.now?.() ?? Date.now();
    const end = Math.min(start + batchSize, lines.length);
    for (let index = start; index < end; index += 1) {
      const line = lines[index].trim();
      if (line) parseM3ULine(line, providerId, entries, state, diagnostics);
    }
    recordM3UBackgroundJsSlice((globalThis.performance?.now?.() ?? Date.now()) - sliceStartedAt);
    if (end < lines.length) await yieldToUi();
  }

  recordM3UParseLinesEnd();
  if (!entries.length) {
    throw new Error("No playable channels were found in this M3U playlist.");
  }
  await yieldToUi();
  const catalog = await buildM3UCatalogCooperatively(entries, providerId, {
    batchSize: 200,
    yieldFn: yieldToUi,
  });
  recordM3UCatalogBuildEnd();
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
  try {
    return normalizeCanonicalXtreamBaseUrl(value);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Enter a valid Xtream server URL.";
    throw new ProviderLoadError(message, "INVALID_URL");
  }
};

const cleanBaseUrl = (value: string) => normalizeXtreamBaseUrl(value);

async function fetchProviderText(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    recordM3UFetchBegin();
    response = await fetch(url, {
      ...init,
      signal: init?.signal ?? controller.signal,
    });
    recordM3UFetchResponse();
    if (!response.ok) {
      throw new ProviderLoadError(
        `The provider returned HTTP ${response.status}.`,
        "PROVIDER_HTTP_ERROR",
      );
    }
    const text = await response.text();
    recordM3UResponseTextEnd();
    return text;
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
  const credentials: XtreamCredentials = {
    baseUrl,
    username: provider.username,
    password: provider.password,
  };
  let payload: Awaited<ReturnType<typeof loadXtreamLiveCatalogFromPreparedRun>>;
  try {
    payload = await loadXtreamLiveCatalogFromPreparedRun(credentials);
  } catch (caught) {
    const code = (caught as any)?.code;
    if (code === "AUTHENTICATION") {
      throw new ProviderLoadError(
        "Xtream rejected these credentials. Check the username and password.",
        "INVALID_CREDENTIALS",
      );
    }
    if (code === "TIMEOUT") {
      throw new ProviderLoadError("The Xtream server request timed out.", "PROVIDER_TIMEOUT");
    }
    if (code === "UNREACHABLE") {
      throw new ProviderLoadError(
        "The Xtream server could not be reached. Check the URL, port, HTTPS certificate, and network.",
        "PROVIDER_UNREACHABLE",
      );
    }
    if (code === "INVALID_RESPONSE" || code === "UNSUPPORTED_RESPONSE") {
      throw new ProviderLoadError("The Xtream provider returned an invalid response.", "INVALID_PROVIDER_RESPONSE");
    }
    throw caught;
  }

  const streams = payload.streams;
  if (!Array.isArray(streams)) {
    throw new ProviderLoadError(
      "Xtream authentication succeeded, but no live stream list was returned.",
      "NO_LIVE_STREAMS",
    );
  }
  const categoryMap = new Map<string, string>(
    payload.categories.map((row) => [
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
        streamUrl: stream.direct_source || `${baseUrl}/live/${encodeURIComponent(provider.username!)}/${encodeURIComponent(provider.password!)}/${encodeURIComponent(streamId)}.${extension}`,
        logoUrl: stream.stream_icon || undefined,
        category: categoryMap.get(String(stream.category_id)) || "Live TV",
        tvgId: stream.epg_channel_id || undefined,
        streamType: "xtream",
        contentType: "live",
        playbackStreamId: streamId,
        playbackContainerExtension: extension,
      };
    },
    250,
  );
  return { channels, liveChannels: channels, epgUrl: provider.epgUrl };
}

async function loadStalker(provider: Provider): Promise<ProviderLoadResult> {
  const mac = provider.mac?.trim() || "";
  const session = createStalkerPortalSession({
    portalUrl: provider.url,
    mac,
    afterResponse: yieldToUi,
  });
  await session.handshake();
  const result = await session.request({
    type: "itv",
    action: "get_ordered_list",
    p: 1,
  });
  const rows = Array.isArray((result as any)?.data)
    ? (result as any).data
    : Array.isArray(result)
      ? result
      : [];
  const baseUrl = session.baseUrl;
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

const EPG_DECODE_CHUNK_BYTES = 256 * 1024;

const decodeBytesCooperatively = async (
  bytes: Uint8Array,
  encoding: string,
  signal?: AbortSignal,
  diagnosticM3U = false,
  isCurrentEpg?: () => boolean,
) => {
  const Decoder = (globalThis as any).TextDecoder;
  if (typeof Decoder !== "function") return null;

  const reportM3U = () => diagnosticM3U && (isCurrentEpg?.() ?? true);
  if (reportM3U()) recordM3UEpgDecodeBegin();
  const decoder = new Decoder(encoding);
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += EPG_DECODE_CHUNK_BYTES) {
    if (signal?.aborted) throw new Error("EPG background attempt aborted.");
    const end = Math.min(bytes.length, offset + EPG_DECODE_CHUNK_BYTES);
    parts.push(decoder.decode(bytes.subarray(offset, end), { stream: end < bytes.length }));
    if (end < bytes.length) await yieldToUi();
  }
  parts.push(decoder.decode());
  if (reportM3U()) recordM3UEpgDecodeEnd();
  if (signal?.aborted) throw new Error("EPG background attempt aborted.");
  if (reportM3U()) recordM3UEpgStringAssemblyBegin();
  const text = parts.join("");
  if (reportM3U()) recordM3UEpgStringAssemblyEnd();
  return text;
};

const decodeResponseText = async (
  response: Response,
  signal?: AbortSignal,
  diagnosticM3U = false,
  readBody: <T>(operation: () => Promise<T>) => Promise<T> = (operation) => operation(),
  isCurrentEpg?: () => boolean,
) => {
  const reportM3U = () => diagnosticM3U && (isCurrentEpg?.() ?? true);
  try {
    if (reportM3U()) recordM3UEpgBodyBegin();
    const bytes = new Uint8Array(await readBody(() => response.arrayBuffer()));
    if (reportM3U()) recordM3UEpgBodyEnd();
    if (signal?.aborted) throw new Error("EPG background attempt aborted.");
    await yieldToUi();
    const head = Array.from(bytes.slice(0, 256), (byte) => String.fromCharCode(byte)).join("");
    const declared = head.match(/<\?xml[^>]*encoding=["']\s*([^"']+)\s*["']/i)?.[1]?.toLowerCase();
    const encoding = declared || "utf-8";
    const Decoder = (globalThis as any).TextDecoder;
    if (typeof Decoder === "function") {
      try {
        const decoded = await decodeBytesCooperatively(bytes, encoding, signal, diagnosticM3U, isCurrentEpg);
        if (decoded !== null) return decoded;
      } catch {
        if (signal?.aborted) throw new Error("EPG background attempt aborted.");
        const decoded = await decodeBytesCooperatively(bytes, "utf-8", signal, diagnosticM3U, isCurrentEpg);
        if (decoded !== null) return decoded;
      }
    }
    if (signal?.aborted) throw new Error("EPG background attempt aborted.");
    if (reportM3U()) recordM3UEpgStringAssemblyBegin();
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    if (reportM3U()) recordM3UEpgStringAssemblyEnd();
    if (/^(?:utf-?8)$/i.test(encoding)) return binaryStringToUtf8(binary);
    return binary;
  } catch (error) {
    if (error instanceof EpgPhaseFailure) throw error;
    if (signal?.aborted) throw new Error("EPG background attempt aborted.");
    if (reportM3U()) recordM3UEpgBodyBegin();
    const text = await readBody(() => response.text());
    if (reportM3U()) recordM3UEpgBodyEnd();
    return text;
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

// The existing maximum of 120 programmes remains an upper bound. The Xtream
// diagnostic path also yields after a bounded amount of synchronous JS work.
export const XTREAM_XMLTV_SYNC_BUDGET_MS = 48;

export async function parseXmltvAsync(
  content: string,
  channels: Channel[],
  nowMs = Date.now(),
  signal?: AbortSignal,
  diagnosticXtream = false,
  diagnosticAttemptId?: number,
): Promise<EpgProgram[]> {
  const clock = () => globalThis.performance?.now?.() ?? Date.now();
  const pending = new Map<XtreamEpgCpuStage, { total: number; max: number; units: number }>();
  const measure = (stage: XtreamEpgCpuStage, start: number) => {
    if (!diagnosticXtream) return;
    const duration = Math.max(0, clock() - start);
    const metric = pending.get(stage) ?? { total: 0, max: 0, units: 0 };
    metric.total += duration;
    metric.max = Math.max(metric.max, duration);
    metric.units += 1;
    pending.set(stage, metric);
  };
  const flush = () => {
    for (const [stage, metric] of pending) {
      recordXtreamEpgCpuStage(stage, metric.total, metric.max, metric.units, diagnosticAttemptId);
    }
    pending.clear();
  };
  const mapStart = diagnosticXtream ? clock() : 0;
  const channelIds = channelIdMap(channels);
  measure("CHANNEL_MATCH", mapStart);
  const programs: EpgProgram[] = [];
  const perChannel = new Map<string, number>();
  const programmePattern = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
  const windowStart = nowMs - 2 * 60 * 60 * 1000;
  const windowEnd = nowMs + 18 * 60 * 60 * 1000;
  let match: RegExpExecArray | null;
  let scanned = 0;
  let chunkStart = diagnosticXtream ? clock() : 0;
  let chunkHasWork = false;

  while (true) {
    const scanStart = diagnosticXtream ? clock() : 0;
    match = programmePattern.exec(content);
    measure("XML_SCAN", scanStart);
    if (!match) break;
    chunkHasWork = true;
    const extractStart = diagnosticXtream ? clock() : 0;
    const attributes = parseAttributes(match[1]);
    measure("PROGRAMME_EXTRACT", extractStart);
    const matchStart = diagnosticXtream ? clock() : 0;
    const channelId = channelIds.get(decodeEpgText(attributes.channel || ""));
    measure("CHANNEL_MATCH", matchStart);
    const programmeStart = diagnosticXtream ? clock() : 0;
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
    measure("PROGRAMME_EXTRACT", programmeStart);

    scanned += 1;
    if (scanned % 120 === 0 || (diagnosticXtream && clock() - chunkStart >= XTREAM_XMLTV_SYNC_BUDGET_MS)) {
      measure("PARSE_CHUNK", chunkStart);
      // Publish aggregate diagnostics at the existing 120-record cadence,
      // even when the CPU budget causes additional scheduler turns.
      if (scanned % 120 === 0) flush();
      if (signal?.aborted) throw new Error("EPG background attempt aborted.");
      if (diagnosticXtream) recordXtreamEpgParseYield(diagnosticAttemptId);
      if (diagnosticXtream) await yieldXtreamXmltvEventLoop();
      else await yieldToUi();
      if (signal?.aborted) throw new Error("EPG background attempt aborted.");
      if (diagnosticXtream) {
        chunkStart = clock();
        chunkHasWork = false;
      }
    }
  }

  if (diagnosticXtream ? chunkHasWork : scanned % 120 !== 0) measure("PARSE_CHUNK", chunkStart);
  flush();
  if (signal?.aborted) throw new Error("EPG background attempt aborted.");
  if (diagnosticXtream) await yieldXtreamXmltvEventLoop();
  else await yieldToUi();
  if (signal?.aborted) throw new Error("EPG background attempt aborted.");
  const sortStart = diagnosticXtream ? clock() : 0;
  const sorted = programs.sort((a, b) => a.start - b.start);
  if (diagnosticXtream) {
    const sortMs = clock() - sortStart;
    recordXtreamEpgCpuStage("SORT_OR_GROUP", sortMs, sortMs, programs.length, diagnosticAttemptId);
  }
  return sorted;
}

type EpgLoadOptions = {
  signal?: AbortSignal;
  diagnosticAttemptId?: number;
  isCurrentEpg?: () => boolean;
};

export const XMLTV_EPG_NETWORK_TIMEOUT_MS = 30_000;
export const SHORT_EPG_NETWORK_TIMEOUT_MS = 12_000;
export const XMLTV_EPG_BODY_TIMEOUT_MS = 30_000;
export const SHORT_EPG_BODY_TIMEOUT_MS = 12_000;

export class EpgPhaseFailure extends Error {
  constructor(
    readonly stage: "request" | "response" | "body" | "decode" | "parse" | "abort",
    readonly failureClass: "network" | "timeout" | "abort" | "http" | "invalid_response" | "parse" | "unknown",
    readonly httpStatusClass = "unknown",
  ) { super(`EPG ${stage} ${failureClass}`); }
}

// The same controller owns fetch and response consumption. Each stage has its own
// deadline, and cancelling the parent invalidates both stages immediately.
function epgRequestDeadline(parent?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) abort();
  parent?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    async run<T>(stage: "request" | "body", durationMs: number, task: () => Promise<T>): Promise<T> {
      if (controller.signal.aborted) throw new EpgPhaseFailure("abort", "abort");
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      try {
        return await Promise.race([
          Promise.resolve().then(task),
          new Promise<T>((_, reject) => {
            onAbort = () => reject(new EpgPhaseFailure("abort", "abort"));
            controller.signal.addEventListener("abort", onAbort!, { once: true });
            timer = setTimeout(() => {
              reject(new EpgPhaseFailure(stage, "timeout"));
              controller.abort();
            }, durationMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        if (onAbort) controller.signal.removeEventListener("abort", onAbort);
      }
    },
    close() { parent?.removeEventListener("abort", abort); },
  };
}

function httpEpgFailure(status: number) {
  const statusClass = status >= 200 && status < 600
    ? `${Math.floor(status / 100)}xx` : "unknown";
  return new EpgPhaseFailure("response", "http", statusClass);
}

export async function loadEpg(
  provider: Provider,
  channels: Channel[],
  options: EpgLoadOptions = {},
): Promise<EpgProgram[]> {
  const diagnosticXtream = provider.type === "xtream";
  const mode = diagnosticXtream ? getXtreamEpgDiagnosticSnapshot().mode : "FULL_PIPELINE";
  const diagnosticAttemptId = options.diagnosticAttemptId;
  let currentStage: EpgPhaseFailure["stage"] = "request";
  try {

  if (provider.epgUrl) {
    const diagnosticM3U = provider.type === "m3u";
    if (diagnosticXtream) {
      setXtreamEpgSourceKind("xmltv", diagnosticAttemptId);
      beginXtreamEpgPhase("FETCH", diagnosticAttemptId);
    }
    if (diagnosticM3U && (options.isCurrentEpg?.() ?? true)) recordM3UEpgFetchBegin();
    const deadline = epgRequestDeadline(options.signal);
    try {
    const response = await deadline.run("request", XMLTV_EPG_NETWORK_TIMEOUT_MS,
      () => fetch(provider.epgUrl!, {
        headers: { Accept: "application/xml,text/xml,*/*" }, signal: deadline.signal,
      }));
    if (diagnosticXtream) {
      recordXtreamEpgHeadersReceived(diagnosticAttemptId);
      endXtreamEpgPhase("FETCH", {}, diagnosticAttemptId);
    }
    if (diagnosticM3U && (options.isCurrentEpg?.() ?? true)) recordM3UEpgFetchResponse();
    if (!response.ok) throw diagnosticXtream
      ? httpEpgFailure(response.status)
      : new Error(`EPG request failed with ${response.status}.`);
    if (diagnosticXtream && mode === "FETCH_ONLY") return [];
    currentStage = "body";
    if (diagnosticXtream) {
      beginXtreamEpgPhase("BODY", diagnosticAttemptId);
      beginXtreamEpgPhase("DECODE", diagnosticAttemptId);
    }
    const text = await decodeResponseText(response, deadline.signal, diagnosticM3U,
      (operation) => deadline.run("body", XMLTV_EPG_BODY_TIMEOUT_MS, operation), options.isCurrentEpg);
    if (diagnosticXtream) {
      endXtreamEpgPhase("DECODE", { bodyChars: text.length }, diagnosticAttemptId);
      endXtreamEpgPhase("BODY", { bodyChars: text.length }, diagnosticAttemptId);
      if (mode === "FETCH_BODY_ONLY") return [];
    }
    if (options.signal?.aborted) throw new EpgPhaseFailure("abort", "abort");
    currentStage = "parse";
    if (diagnosticXtream) beginXtreamEpgPhase("PARSE", diagnosticAttemptId);
    if (diagnosticM3U && (options.isCurrentEpg?.() ?? true)) recordM3UEpgParseBegin();
    const programs = await parseXmltvAsync(text, channels, Date.now(), options.signal, diagnosticXtream, diagnosticAttemptId);
    if (diagnosticM3U && (options.isCurrentEpg?.() ?? true)) recordM3UEpgParseEnd();
    if (diagnosticXtream) endXtreamEpgPhase("PARSE", { programmeCount: programs.length }, diagnosticAttemptId);
    return programs;
    } finally { deadline?.close(); }
  }

  if (provider.type === "xtream" && provider.username && provider.password) {
    setXtreamEpgSourceKind("short_epg", diagnosticAttemptId);
    const baseUrl = cleanBaseUrl(provider.url);
    const query = `username=${encodeURIComponent(provider.username)}&password=${encodeURIComponent(provider.password)}`;
    const targetChannels = channels.filter((channel) => channel.streamType === "xtream").slice(0, 60);
    beginXtreamEpgPhase("FETCH", diagnosticAttemptId);
    let headersSeen = false;
    let validResponses = 0;
    let firstFailure: EpgPhaseFailure | null = null;
    const results = await Promise.all(
      targetChannels.map(async (channel) => {
        const streamId = channel.id.split(":").pop();
        if (!streamId) return [] as EpgProgram[];
        const deadline = epgRequestDeadline(options.signal);
        let channelStage: EpgPhaseFailure["stage"] = "request";
        try {
          const response = await deadline.run("request", SHORT_EPG_NETWORK_TIMEOUT_MS,
            () => fetch(`${baseUrl}/player_api.php?${query}&action=get_short_epg&stream_id=${encodeURIComponent(streamId)}&limit=8`, {
              signal: deadline.signal,
            }));
          if (!headersSeen) { headersSeen = true; recordXtreamEpgHeadersReceived(diagnosticAttemptId); }
          if (!response.ok) throw httpEpgFailure(response.status);
          validResponses += 1;
          if (mode === "FETCH_ONLY") return [] as EpgProgram[];
          channelStage = "body";
          beginXtreamEpgPhase("BODY", diagnosticAttemptId);
          const text = await deadline.run("body", SHORT_EPG_BODY_TIMEOUT_MS, () => response.text());
          endXtreamEpgPhase("BODY", { bodyChars: text.length }, diagnosticAttemptId);
          if (mode === "FETCH_BODY_ONLY") return [] as EpgProgram[];
          channelStage = "decode";
          beginXtreamEpgPhase("DECODE", diagnosticAttemptId);
          const data = JSON.parse(text) as any;
          endXtreamEpgPhase("DECODE", {}, diagnosticAttemptId);
          const rows = Array.isArray(data?.epg_listings) ? data.epg_listings : [];
          channelStage = "parse";
          beginXtreamEpgPhase("PARSE", diagnosticAttemptId);
          const parsed = rows
            .map((row: any, index: number) => ({
              id: `${channel.id}:${row.id ?? index}`,
              channelId: channel.id,
              title: row.title ? decodeEpgText(atobUtf8Safe(row.title)) : "Program",
              description: row.description ? decodeEpgText(atobUtf8Safe(row.description)) : undefined,
              start: Number(row.start_timestamp) * 1000,
              end: Number(row.stop_timestamp) * 1000,
            }))
            .filter((row: EpgProgram) => Number.isFinite(row.start) && Number.isFinite(row.end));
          endXtreamEpgPhase("PARSE", { programmeCount: parsed.length }, diagnosticAttemptId);
          return parsed;
        } catch (error) {
          if (options.signal?.aborted) throw new EpgPhaseFailure("abort", "abort");
          firstFailure ??= error instanceof EpgPhaseFailure ? error :
            new EpgPhaseFailure(channelStage, channelStage === "request" ? "network" : "parse");
          return [] as EpgProgram[];
        } finally {
          deadline.close();
        }
      }),
    );
    endXtreamEpgPhase("FETCH", {}, diagnosticAttemptId);
    if (!validResponses && firstFailure) throw firstFailure;
    return results.flat().sort((a, b) => a.start - b.start);
  }
  if (diagnosticXtream) setXtreamEpgSourceKind("unknown", diagnosticAttemptId);
  return [];
  } catch (error) {
    if (diagnosticXtream) {
      const failure = error instanceof EpgPhaseFailure ? error :
        options.signal?.aborted ? new EpgPhaseFailure("abort", "abort") :
        new EpgPhaseFailure(currentStage, currentStage === "request" ? "network" : "parse");
      recordXtreamEpgFailure(failure.stage, failure.failureClass, failure.httpStatusClass,
        failure.failureClass === "timeout" ? failure.stage : "none",
        failure.failureClass === "timeout" || failure.failureClass === "abort", diagnosticAttemptId);
    }
    throw error;
  }
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
