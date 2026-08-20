import { Platform } from "react-native";

export type ProviderType = "m3u" | "xtream" | "stalker";

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
  nowPlaying?: string;
  nextPlaying?: string;
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
  epgUrl?: string;
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

const decodeEntities = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const parseAttributes = (line: string) => {
  const attributes: Record<string, string> = {};
  const attributePattern = /([\w-]+)=(?:"([^"]*)"|'([^']*)'|([^\s]*))/g;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(line))) {
    attributes[match[1].toLowerCase()] = decodeEntities(
      match[2] ?? match[3] ?? match[4] ?? "",
    );
  }
  return attributes;
};

const makeId = (providerId: string, index: number, value: string) =>
  `${providerId}:${index}:${value}`.replace(/[^a-zA-Z0-9:_-]/g, "-");

export function parseM3U(
  content: string,
  providerId: string,
): ProviderLoadResult {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const channels: Channel[] = [];
  let pending: { attributes: Record<string, string>; name: string; group?: string } | null = null;
  let nextGroup: string | undefined;
  let epgUrl: string | undefined;

  for (const line of lines) {
    if (line.startsWith("#EXTM3U")) {
      const attributes = parseAttributes(line);
      epgUrl = attributes["url-tvg"] ?? attributes["x-tvg-url"];
      continue;
    }
    if (line.startsWith("#EXTINF")) {
      const comma = line.indexOf(",");
      const label = comma >= 0 ? line.slice(comma + 1).trim() : "Untitled channel";
      pending = {
        attributes: parseAttributes(line),
        name: decodeEntities(label) || "Untitled channel",
        group: nextGroup,
      };
      nextGroup = undefined;
      continue;
    }
    if (/^#EXTGRP:/i.test(line)) {
      const group = decodeEntities(line.slice(line.indexOf(":") + 1).trim());
      if (pending) pending.group = group || pending.group;
      else nextGroup = group || nextGroup;
      continue;
    }
    if (line.startsWith("#") || !pending) continue;

    const category =
      pending.attributes["group-title"] ||
      pending.attributes["group"] ||
      pending.attributes["category"] ||
      pending.attributes["tvg-group"] ||
      pending.group ||
      "Uncategorized";
    const streamId = pending.attributes["tvg-id"] || pending.name;
    channels.push({
      id: makeId(providerId, channels.length, streamId),
      providerId,
      name: pending.attributes["tvg-name"] || pending.name,
      streamUrl: line,
      logoUrl: pending.attributes["tvg-logo"] || undefined,
      category,
      tvgId: pending.attributes["tvg-id"] || undefined,
      streamType: pending.attributes["type"] || undefined,
    });
    pending = null;
  }

  if (!channels.length) {
    throw new Error("No playable channels were found in this M3U playlist.");
  }
  return { channels, epgUrl };
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
      signal: init?.signal ?? AbortSignal.timeout(15_000),
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
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ProviderLoadError(
      "The provider could not be reached. Check the URL, port, and network.",
      "PROVIDER_UNREACHABLE",
    );
  }
  if (!response.ok) {
    throw new ProviderLoadError(
      `The provider returned HTTP ${response.status}.`,
      "PROVIDER_HTTP_ERROR",
    );
  }
  return response.text();
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
      signal: AbortSignal.timeout(20_000),
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
  const result = parseM3U(content, provider.id);
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
  if (!Array.isArray(streams))
    throw new ProviderLoadError(
      "Xtream authentication succeeded, but no live stream list was returned.",
      "NO_LIVE_STREAMS",
    );
  const categoryRows = payload.categories;
  const categoryMap = new Map<string, string>(
    (Array.isArray(categoryRows) ? categoryRows : []).map((row: any) => [
      String(row.category_id),
      row.category_name,
    ]),
  );

  const channels = streams.map((stream: any, index: number): Channel => {
    const streamId = String(stream.stream_id ?? index);
    const extension = stream.container_extension || "m3u8";
    return {
      id: makeId(provider.id, index, streamId),
      providerId: provider.id,
      name: stream.name || `Channel ${index + 1}`,
      streamUrl: `${baseUrl}/live/${encodeURIComponent(provider.username!)}/${encodeURIComponent(provider.password!)}/${streamId}.${extension}`,
      logoUrl: stream.stream_icon || undefined,
      category: categoryMap.get(String(stream.category_id)) || "Live TV",
      tvgId: stream.epg_channel_id || undefined,
      streamType: "xtream",
    };
  });
  return { channels, epgUrl: provider.epgUrl };
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

  const streamsUrl = new URL(apiUrl);
  streamsUrl.searchParams.set("action", "get_live_streams");
  const streams = await fetchProviderJson(streamsUrl.toString());

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
  const channels = rows.map((row: any, index: number): Channel => {
    const rawCommand = String(row.cmd ?? row.url ?? "").replace(/^ffmpeg\s+/i, "").trim();
    const streamUrl = rawCommand || `${baseUrl}/play/live.php?mac=${encodeURIComponent(mac)}&stream=${encodeURIComponent(String(row.id ?? index))}&extension=ts`;
    return {
      id: makeId(provider.id, index, String(row.id ?? row.name ?? index)),
      providerId: provider.id,
      name: row.name || `Channel ${index + 1}`,
      streamUrl,
      logoUrl: row.logo || undefined,
      category: row.tv_genre_name || row.category_name || "Live TV",
      tvgId: row.xmltv_id || undefined,
      streamType: "stalker",
    };
  });
  if (!channels.length) throw new Error("The Stalker Portal returned no live channels.");
  return { channels, epgUrl: provider.epgUrl };
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

const stripTags = (value: string) => decodeEntities(value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());

export function parseXmltv(content: string, channels: Channel[]): EpgProgram[] {
  const channelIds = new Map(channels.map((channel) => [channel.tvgId || channel.name, channel.id]));
  const programs: EpgProgram[] = [];
  const programmePattern = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
  let match: RegExpExecArray | null;
  while ((match = programmePattern.exec(content))) {
    const attributes = parseAttributes(match[1]);
    const body = match[2];
    const channelId = channelIds.get(attributes.channel || "");
    const start = parseXmlDate(attributes.start || "");
    const end = parseXmlDate(attributes.stop || "");
    if (!channelId || !Number.isFinite(start) || !Number.isFinite(end)) continue;

    const title = stripTags(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "Untitled program");
    const description = stripTags(body.match(/<desc[^>]*>([\s\S]*?)<\/desc>/i)?.[1] || "");
    programs.push({ id: `${channelId}:${start}:${title}`, channelId, title, description: description || undefined, start, end });
  }
  return programs.sort((a, b) => a.start - b.start);
}

export async function loadEpg(provider: Provider, channels: Channel[]): Promise<EpgProgram[]> {
  if (provider.epgUrl) {
    const response = await fetch(provider.epgUrl, { headers: { Accept: "application/xml,text/xml,*/*" } });
    if (!response.ok) throw new Error(`EPG request failed with ${response.status}.`);
    return parseXmltv(await response.text(), channels);
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
          const response = await fetch(`${baseUrl}/player_api.php?${query}&action=get_short_epg&stream_id=${encodeURIComponent(streamId)}&limit=8`);
          if (!response.ok) return [] as EpgProgram[];
          const data = await asJson(response);
          const rows = Array.isArray(data?.epg_listings) ? data.epg_listings : [];
          return rows
            .map((row: any, index: number) => ({
              id: `${channel.id}:${row.id ?? index}`,
              channelId: channel.id,
              title: row.title ? decodeEntities(atobSafe(row.title)) : "Program",
              description: row.description ? decodeEntities(atobSafe(row.description)) : undefined,
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

function atobSafe(value: string) {
  try {
    if (typeof globalThis.atob === "function") return globalThis.atob(value);
    return value;
  } catch {
    return value;
  }
}
