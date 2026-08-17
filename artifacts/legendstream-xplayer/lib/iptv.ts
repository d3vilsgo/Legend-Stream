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
  let pending: { attributes: Record<string, string>; name: string } | null =
    null;
  let epgUrl: string | undefined;

  for (const line of lines) {
    if (line.startsWith("#EXTM3U")) {
      const attributes = parseAttributes(line);
      epgUrl = attributes["url-tvg"] ?? attributes["x-tvg-url"];
      continue;
    }
    if (line.startsWith("#EXTINF")) {
      const comma = line.indexOf(",");
      const label =
        comma >= 0 ? line.slice(comma + 1).trim() : "Untitled channel";
      pending = {
        attributes: parseAttributes(line),
        name: decodeEntities(label) || "Untitled channel",
      };
      continue;
    }
    if (line.startsWith("#") || !pending) continue;

    const category = pending.attributes["group-title"] || "Uncategorized";
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

const asJson = async (response: Response) => {
  const text = await response.text();
  if (!response.ok) throw new Error(`Provider returned ${response.status}.`);
  try {
    return JSON.parse(text) as any;
  } catch {
    throw new Error("The provider response was not valid JSON.");
  }
};

const cleanBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

async function loadM3U(provider: Provider): Promise<ProviderLoadResult> {
  const response = await fetch(provider.url, {
    headers: { Accept: "application/vnd.apple.mpegurl,text/plain,*/*" },
  });
  if (!response.ok)
    throw new Error(`Playlist request failed with ${response.status}.`);
  const result = parseM3U(await response.text(), provider.id);
  return { ...result, epgUrl: provider.epgUrl || result.epgUrl };
}

async function loadXtream(provider: Provider): Promise<ProviderLoadResult> {
  if (!provider.username || !provider.password) {
    throw new Error("Xtream Codes requires a username and password.");
  }
  const baseUrl = cleanBaseUrl(provider.url);
  const query = `username=${encodeURIComponent(
    provider.username,
  )}&password=${encodeURIComponent(provider.password)}`;
  const authResponse = await fetch(`${baseUrl}/player_api.php?${query}`);
  const auth = await asJson(authResponse);
  if (auth?.user_info?.auth === 0) {
    throw new Error("Xtream Codes rejected these credentials.");
  }

  const streamsResponse = await fetch(
    `${baseUrl}/player_api.php?${query}&action=get_live_streams`,
  );
  const streams = await asJson(streamsResponse);
  if (!Array.isArray(streams))
    throw new Error("Xtream Codes returned no live streams.");

  const categoriesResponse = await fetch(
    `${baseUrl}/player_api.php?${query}&action=get_live_categories`,
  );
  const categoryRows = categoriesResponse.ok
    ? await asJson(categoriesResponse)
    : [];
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
      streamUrl: `${baseUrl}/live/${encodeURIComponent(
        provider.username!,
      )}/${encodeURIComponent(provider.password!)}/${streamId}.${extension}`,
      logoUrl: stream.stream_icon || undefined,
      category:
        categoryMap.get(String(stream.category_id)) || "Live TV",
      tvgId: stream.epg_channel_id || undefined,
      streamType: "xtream",
    };
  });
  return { channels, epgUrl: provider.epgUrl };
}

const stalkerJson = async (response: Response) => {
  const text = await response.text();
  if (!response.ok)
    throw new Error(`Stalker Portal returned ${response.status}.`);
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
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 12; SmartTV) AppleWebKit/537.36",
    "X-User-Agent": "Model: MAG250; Link: WiFi",
    Cookie: `mac=${mac}; stb_lang=en; timezone=Europe%2FIstanbul`,
  };
  const handshake = await stalkerJson(
    await fetch(
      `${baseUrl}/portal.php?type=stb&action=handshake&token=&JsHttpRequest=1-xml`,
      { headers },
    ),
  );
  const token = handshake?.token || handshake?.js?.token;
  if (!token) {
    throw new Error(
      "Stalker Portal handshake failed. Check the portal URL and MAC address.",
    );
  }

  const authenticatedHeaders = {
    ...headers,
    Authorization: `Bearer ${token}`,
  };
  const result = await stalkerJson(
    await fetch(
      `${baseUrl}/portal.php?type=itv&action=get_ordered_list&p=1&JsHttpRequest=1-xml`,
      { headers: authenticatedHeaders },
    ),
  );
  const rows = Array.isArray(result?.data)
    ? result.data
    : Array.isArray(result)
      ? result
      : [];
  const channels = rows.map((row: any, index: number): Channel => {
    const rawCommand = String(row.cmd ?? row.url ?? "")
      .replace(/^ffmpeg\s+/i, "")
      .trim();
    const streamUrl =
      rawCommand ||
      `${baseUrl}/play/live.php?mac=${encodeURIComponent(
        mac,
      )}&stream=${encodeURIComponent(String(row.id ?? index))}&extension=ts`;
    return {
      id: makeId(
        provider.id,
        index,
        String(row.id ?? row.name ?? index),
      ),
      providerId: provider.id,
      name: row.name || `Channel ${index + 1}`,
      streamUrl,
      logoUrl: row.logo || undefined,
      category: row.tv_genre_name || row.category_name || "Live TV",
      tvgId: row.xmltv_id || undefined,
      streamType: "stalker",
    };
  });
  if (!channels.length)
    throw new Error("The Stalker Portal returned no live channels.");
  return { channels, epgUrl: provider.epgUrl };
}

export async function loadProvider(
  provider: Provider,
): Promise<ProviderLoadResult> {
  if (provider.type === "m3u") return loadM3U(provider);
  if (provider.type === "xtream") return loadXtream(provider);
  return loadStalker(provider);
}

const parseXmlDate = (value: string) => {
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/,
  );
  if (!match) return NaN;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
};

const stripTags = (value: string) =>
  decodeEntities(value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());

export function parseXmltv(
  content: string,
  channels: Channel[],
): EpgProgram[] {
  const channelIds = new Map(
    channels.map((channel) => [channel.tvgId || channel.name, channel.id]),
  );
  const programs: EpgProgram[] = [];
  const programmePattern =
    /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
  let match: RegExpExecArray | null;
  while ((match = programmePattern.exec(content))) {
    const attributes = parseAttributes(match[1]);
    const body = match[2];
    const channelId = channelIds.get(attributes.channel || "");
    const start = parseXmlDate(attributes.start || "");
    const end = parseXmlDate(attributes.stop || "");
    if (!channelId || !Number.isFinite(start) || !Number.isFinite(end))
      continue;

    const title = stripTags(
      body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
        "Untitled program",
    );
    const description = stripTags(
      body.match(/<desc[^>]*>([\s\S]*?)<\/desc>/i)?.[1] || "",
    );
    programs.push({
      id: `${channelId}:${start}:${title}`,
      channelId,
      title,
      description: description || undefined,
      start,
      end,
    });
  }
  return programs.sort((a, b) => a.start - b.start);
}

export async function loadEpg(
  provider: Provider,
  channels: Channel[],
): Promise<EpgProgram[]> {
  if (provider.epgUrl) {
    const response = await fetch(provider.epgUrl, {
      headers: { Accept: "application/xml,text/xml,*/*" },
    });
    if (!response.ok) throw new Error(`EPG request failed with ${response.status}.`);
    return parseXmltv(await response.text(), channels);
  }

  if (provider.type === "xtream" && provider.username && provider.password) {
    const baseUrl = cleanBaseUrl(provider.url);
    const query = `username=${encodeURIComponent(
      provider.username,
    )}&password=${encodeURIComponent(provider.password)}`;
    const targetChannels = channels
      .filter((channel) => channel.streamType === "xtream")
      .slice(0, 60);
    const results = await Promise.all(
      targetChannels.map(async (channel) => {
        const streamId = channel.id.split(":").pop();
        if (!streamId) return [] as EpgProgram[];
        try {
          const response = await fetch(
            `${baseUrl}/player_api.php?${query}&action=get_short_epg&stream_id=${encodeURIComponent(
              streamId,
            )}&limit=8`,
          );
          if (!response.ok) return [] as EpgProgram[];
          const data = await asJson(response);
          const rows = Array.isArray(data?.epg_listings)
            ? data.epg_listings
            : [];
          return rows
            .map((row: any, index: number) => ({
              id: `${channel.id}:${row.id ?? index}`,
              channelId: channel.id,
              title: row.title
                ? decodeEntities(atobSafe(row.title))
                : "Program",
              description: row.description
                ? decodeEntities(atobSafe(row.description))
                : undefined,
              start: Number(row.start_timestamp) * 1000,
              end: Number(row.stop_timestamp) * 1000,
            }))
            .filter(
              (row: EpgProgram) =>
                Number.isFinite(row.start) && Number.isFinite(row.end),
            );
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