from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(rel: str, old: str, new: str) -> None:
    path = ROOT / rel
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{rel}: expected exactly one match, found {count}: {old[:100]!r}")
    path.write_text(text.replace(old, new, 1))


def replace_all(rel: str, old: str, new: str, expected: int) -> None:
    path = ROOT / rel
    text = path.read_text()
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"{rel}: expected {expected} matches, found {count}: {old[:100]!r}")
    path.write_text(text.replace(old, new))


# 1) Provider input parser: keep get.php support and add /playlist/{user}/{pass}/m3u.
replace_once(
    "artifacts/legendstream-xplayer/lib/m3uCatalogRefs.ts",
    '''export function parseM3UProviderSource(value: string): M3UProviderSource | null {
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/i.test(url.protocol) || !/\\/get\\.php$/i.test(url.pathname)) return null;
    const username = url.searchParams.get("username")?.trim();
    const password = url.searchParams.get("password") ?? "";
    const type = url.searchParams.get("type")?.toLowerCase();
    if (!username || !password || (type && type !== "m3u_plus")) return null;
    const basePath = trimmedBasePath(url.pathname);
    return {
      baseUrl: `${url.origin}${basePath}`.replace(/\\/+$/, ""),
      username,
      password,
    };
  } catch {
    return null;
  }
}
''',
    '''export function parseM3UProviderSource(value: string): M3UProviderSource | null {
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/i.test(url.protocol)) return null;

    if (/\\/get\\.php$/i.test(url.pathname)) {
      const username = url.searchParams.get("username")?.trim();
      const password = url.searchParams.get("password") ?? "";
      const type = url.searchParams.get("type")?.toLowerCase();
      if (!username || !password || (type && type !== "m3u_plus")) return null;
      const basePath = trimmedBasePath(url.pathname);
      return {
        baseUrl: `${url.origin}${basePath}`.replace(/\\/+$/, ""),
        username,
        password,
      };
    }

    const pathMatch = url.pathname.match(/^(.*)\\/playlist\\/([^/]+)\\/([^/]+)\\/m3u\\/?$/i);
    if (!pathMatch) return null;
    const username = decodeURIComponent(pathMatch[2]).trim();
    const password = decodeURIComponent(pathMatch[3]);
    if (!username || !password) return null;
    const basePath = pathMatch[1].replace(/\\/+$/, "");
    return {
      baseUrl: `${url.origin}${basePath}`.replace(/\\/+$/, ""),
      username,
      password,
    };
  } catch {
    return null;
  }
}
''',
)

# 2) Dedicated resolver/probe. It never logs or persists credential-bearing values.
routing_path = ROOT / "artifacts/legendstream-xplayer/lib/m3uTransportRouting.ts"
if routing_path.exists():
    raise RuntimeError("m3uTransportRouting.ts already exists")
routing_path.write_text('''import { parseM3UProviderSource, type M3UProviderSource } from "./m3uCatalogRefs";

export type ProviderTransport = "xtream" | "m3u";

type TransportProvider = {
  type?: string | null;
  transport?: ProviderTransport | null;
};

type TransportFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type M3UTransportResolution = {
  declaredType: "m3u";
  transport: ProviderTransport;
  credentials: M3UProviderSource | null;
};

export function resolvedProviderTransport(provider: TransportProvider | null | undefined) {
  return provider?.transport ?? provider?.type;
}

export async function probeM3UXtreamTransport(
  credentials: M3UProviderSource,
  fetchImpl: TransportFetch = fetch,
) {
  try {
    const apiUrl = new URL("player_api.php", `${credentials.baseUrl}/`);
    apiUrl.searchParams.set("username", credentials.username);
    apiUrl.searchParams.set("password", credentials.password);
    const response = await fetchImpl(apiUrl, {
      headers: { Accept: "application/json,*/*" },
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) return false;
    const payload = JSON.parse(await response.text()) as {
      user_info?: { auth?: number | string; status?: string };
    };
    const userInfo = payload?.user_info;
    if (!userInfo || typeof userInfo !== "object") return false;
    const auth = userInfo.auth;
    if (auth === 0 || auth === "0") return false;
    const status = String(userInfo.status ?? "").toLowerCase();
    if (["disabled", "banned", "expired"].includes(status)) return false;
    return auth === 1 || auth === "1" || status === "active";
  } catch {
    return false;
  }
}

export async function resolveM3UTransport(
  source: string,
  fetchImpl: TransportFetch = fetch,
): Promise<M3UTransportResolution> {
  const credentials = parseM3UProviderSource(source);
  if (!credentials) {
    return { declaredType: "m3u", transport: "m3u", credentials: null };
  }
  const xtreamAvailable = await probeM3UXtreamTransport(credentials, fetchImpl);
  return {
    declaredType: "m3u",
    transport: xtreamAvailable ? "xtream" : "m3u",
    credentials,
  };
}
''')

# 3) Player model + connect routing. `type` remains a backwards-compatible runtime alias;
# declaredType is user-facing, transport is the explicit data engine.
player = "artifacts/legendstream-xplayer/context/PlayerContext.tsx"
replace_once(
    player,
    '''import { persistM3ULoadInBackground } from "@/lib/m3uCacheWriteRunner";
import {
  chooseProviderSwitchPath,''',
    '''import { persistM3ULoadInBackground } from "@/lib/m3uCacheWriteRunner";
import {
  resolveM3UTransport,
  resolvedProviderTransport,
  type ProviderTransport,
} from "@/lib/m3uTransportRouting";
import { safeLog } from "@/lib/safeLog";
import {
  chooseProviderSwitchPath,''',
)
replace_once(
    player,
    '''  type: ProviderType;
  playlistUrl: string;''',
    '''  type: ProviderType;
  declaredType?: ProviderType;
  transport?: ProviderTransport;
  playlistUrl: string;''',
)
replace_once(
    player,
    '''const PlayerContext = createContext<PlayerContextValue | null>(null);

const toProvider = (provider: Provider): ProviderConfig => ({
  ...provider,
  playlistUrl: provider.url,
  connectedAt: new Date(provider.createdAt).toISOString(),
  needsCredentials: false,
});

const fromProvider = (provider: ProviderConfig): Provider => ({
  id: provider.id,
  name: provider.name,
  type: provider.type,
  url: provider.url || provider.playlistUrl,
  username: provider.username,
  password: provider.password,
  mac: provider.mac,
  epgUrl: provider.epgUrl,
  createdAt: provider.createdAt,
  lastLoadedAt: provider.lastLoadedAt,
  channelCount: provider.channelCount,
  loadError: provider.loadError,
});
''',
    '''const PlayerContext = createContext<PlayerContextValue | null>(null);

type RoutedProvider = Provider & {
  declaredType?: ProviderType;
  transport?: ProviderTransport;
  playlistUrl?: string;
};

const toProvider = (provider: RoutedProvider): ProviderConfig => ({
  ...provider,
  declaredType: provider.declaredType ?? provider.type,
  transport: provider.transport ?? (
    provider.type === "xtream" || provider.type === "m3u" ? provider.type : undefined
  ),
  playlistUrl: provider.playlistUrl || provider.url,
  connectedAt: new Date(provider.createdAt).toISOString(),
  needsCredentials: false,
});

const fromProvider = (provider: ProviderConfig): RoutedProvider => ({
  id: provider.id,
  name: provider.name,
  type: provider.type,
  declaredType: provider.declaredType ?? provider.type,
  transport: provider.transport ?? (
    provider.type === "xtream" || provider.type === "m3u" ? provider.type : undefined
  ),
  url: provider.url || provider.playlistUrl,
  playlistUrl: provider.playlistUrl || provider.url,
  username: provider.username,
  password: provider.password,
  mac: provider.mac,
  epgUrl: provider.epgUrl,
  createdAt: provider.createdAt,
  lastLoadedAt: provider.lastLoadedAt,
  channelCount: provider.channelCount,
  loadError: provider.loadError,
});
''',
)
replace_once(
    player,
    '''const normalizeUrl = (value: string) =>
  value.trim().replace(/\\/+$/, "").toLowerCase();

function parseXtreamGetPhp(value: string) {''',
    '''const normalizeUrl = (value: string) =>
  value.trim().replace(/\\/+$/, "").toLowerCase();

function logProviderTransport(providerType: ProviderType, resolvedTransport: string | undefined) {
  safeLog.info("LS_PROVIDER_TRANSPORT", {
    providerType,
    resolvedTransport: resolvedTransport ?? "unknown",
  });
}

// Transport diagnostics above are deliberately identity-free and credential-free.
// Keep source locations, account fields, and endpoint details outside that event payload.

function parseXtreamGetPhp(value: string) {''',
)
replace_once(
    player,
    '''async function resolveProviderOnConnect(provider: Provider): Promise<Provider> {
  if (provider.type !== "xtream") return provider;
  const parsed = parseXtreamGetPhp(provider.url);
  if (!parsed) return provider;
  if (await probeXtreamApi(parsed)) {
    return {
      ...provider,
      type: "xtream",
      username: parsed.username,
      password: parsed.password,
    };
  }
  return {
    ...provider,
    type: "m3u",
    username: undefined,
    password: undefined,
  };
}

function toXtreamLoadProvider(provider: Provider): Provider {''',
    '''async function resolveProviderOnConnect(provider: RoutedProvider): Promise<RoutedProvider> {
  const declaredType = provider.declaredType ?? provider.type;
  if (declaredType === "m3u") {
    const source = provider.playlistUrl || provider.url;
    const resolution = await resolveM3UTransport(source);
    logProviderTransport(resolution.declaredType, resolution.transport);
    if (resolution.transport === "xtream" && resolution.credentials) {
      return {
        ...provider,
        type: "xtream",
        declaredType: "m3u",
        transport: "xtream",
        url: resolution.credentials.baseUrl,
        playlistUrl: source,
        username: resolution.credentials.username,
        password: resolution.credentials.password,
      };
    }
    return {
      ...provider,
      type: "m3u",
      declaredType: "m3u",
      transport: "m3u",
      url: source,
      playlistUrl: source,
      username: undefined,
      password: undefined,
    };
  }

  if (declaredType !== "xtream") return { ...provider, declaredType };
  const parsed = parseXtreamGetPhp(provider.url);
  if (!parsed) {
    return { ...provider, type: "xtream", declaredType: "xtream", transport: "xtream" };
  }
  if (await probeXtreamApi(parsed)) {
    return {
      ...provider,
      type: "xtream",
      declaredType: "xtream",
      transport: "xtream",
      username: parsed.username,
      password: parsed.password,
    };
  }
  return {
    ...provider,
    type: "m3u",
    declaredType: "xtream",
    transport: "m3u",
    username: undefined,
    password: undefined,
  };
}

function toXtreamLoadProvider(provider: RoutedProvider): Provider {''',
)
replace_once(
    player,
    '''async function loadProviderSmart(provider: Provider) {
  if (provider.type !== "xtream") {''',
    '''async function loadProviderSmart(provider: RoutedProvider) {
  if (resolvedProviderTransport(provider) !== "xtream") {''',
)
replace_once(
    player,
    '''  const savedXtream: Provider = {
    ...provider,
    type: "xtream",
    username: parsed.username,
    password: parsed.password,
  };''',
    '''  const savedXtream: RoutedProvider = {
    ...provider,
    type: "xtream",
    transport: "xtream",
    username: parsed.username,
    password: parsed.password,
  };''',
)
replace_once(
    player,
    '''    const fallback: Provider = {
      ...provider,
      type: "m3u",
      username: undefined,
      password: undefined,
    };''',
    '''    const fallback: RoutedProvider = {
      ...provider,
      type: "m3u",
      transport: "m3u",
      url: provider.playlistUrl || provider.url,
      username: undefined,
      password: undefined,
    };''',
)
replace_once(
    player,
    '''  const provider = {
    ...stored,
    url,
    playlistUrl: secrets.playlistUrl || secrets.url || "",
    epgUrl: secrets.epgUrl,
    username: secrets.username,
    password: secrets.password,
    mac: secrets.mac,
    needsCredentials,
  } as ProviderConfig;''',
    '''  const provider = {
    ...stored,
    declaredType: stored.declaredType ?? stored.type,
    transport: stored.transport ?? (
      stored.type === "xtream" || stored.type === "m3u" ? stored.type : undefined
    ),
    url,
    playlistUrl: secrets.playlistUrl || secrets.url || "",
    epgUrl: secrets.epgUrl,
    username: secrets.username,
    password: secrets.password,
    mac: secrets.mac,
    needsCredentials,
  } as ProviderConfig;''',
)
replace_once(
    player,
    '''      const rawCandidate: Provider = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: config.name.trim() || "My provider",
        type: config.type,
        url: (config.url || config.playlistUrl).trim(),''',
    '''      const sourceUrl = (config.url || config.playlistUrl).trim();
      const rawCandidate: RoutedProvider = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: config.name.trim() || "My provider",
        type: config.type,
        declaredType: config.type,
        url: sourceUrl,
        playlistUrl: sourceUrl,''',
)

# 4) Explicitly key the catalog sync entry points off transport. Existing Xtream internals stay untouched.
catalog = "artifacts/legendstream-xplayer/context/CatalogSyncContext.tsx"
replace_once(
    catalog,
    '''import type { Channel } from "@/lib/iptv";
''',
    '''import type { Channel } from "@/lib/iptv";
import { resolvedProviderTransport } from "@/lib/m3uTransportRouting";
''',
)
replace_once(
    catalog,
    '''  if (!provider || provider.type !== "xtream" || !provider.username || !provider.password) return null;''',
    '''  if (!provider || resolvedProviderTransport(provider) !== "xtream" || !provider.username || !provider.password) return null;''',
)
replace_once(
    catalog,
    '''    type: provider.type,
    url: provider.url || provider.playlistUrl,''',
    '''    type: resolvedProviderTransport(provider) === "xtream" ? "xtream" : provider.type,
    url: provider.url || provider.playlistUrl,''',
)
replace_once(
    catalog,
    '''    if (!provider || provider.type !== "xtream") return;''',
    '''    if (!provider || resolvedProviderTransport(provider) !== "xtream") return;''',
)
replace_once(
    catalog,
    '''        if (disposed || active.type !== "xtream") return;''',
    '''        if (disposed || resolvedProviderTransport(active) !== "xtream") return;''',
)
replace_once(
    catalog,
    '''    provider?.type === "xtream" &&
    shouldBlockInitialCatalogSync''',
    '''    resolvedProviderTransport(provider) === "xtream" &&
    shouldBlockInitialCatalogSync''',
)

# 5) UI keeps declared type visible, while the legacy `type` field can remain the runtime alias.
screen = "artifacts/legendstream-xplayer/components/OptimizedHomeScreenV6.tsx"
replace_once(
    screen,
    '''import { getM3UCatalog } from "@/lib/iptv";
''',
    '''import { getM3UCatalog } from "@/lib/iptv";
import { parseM3UProviderSource } from "@/lib/m3uCatalogRefs";
''',
)
replace_once(
    screen,
    '''const visibleErrorText = (value?: string | null) =>
  value ? redactSensitiveText(value) : null;

const flattenCatalogCache''',
    '''const visibleErrorText = (value?: string | null) =>
  value ? redactSensitiveText(value) : null;

const providerPresentation = (provider: ProviderConfig) =>
  providerListPresentation({
    ...provider,
    type: provider.declaredType ?? provider.type,
  });

const flattenCatalogCache''',
)
replace_once(
    screen,
    '''const isGetPhpM3UPlusProvider = (provider: ProviderConfig) => {
  try {
    const source = new URL(provider.url || provider.playlistUrl);
    if (!/\\/get\\.php$/i.test(source.pathname)) return false;
    const type = source.searchParams.get("type")?.toLowerCase();
    return !type || type === "m3u_plus";
  } catch {
    return false;
  }
};''',
    '''const isGetPhpM3UPlusProvider = (provider: ProviderConfig) =>
  Boolean(parseM3UProviderSource(provider.playlistUrl || provider.url));''',
)
replace_once(
    screen,
    '''            ...item,
            type: "m3u",
            loadError: undefined,''',
    '''            ...item,
            type: "m3u",
            declaredType: "m3u",
            transport: "m3u",
            loadError: undefined,''',
)
replace_all(screen, "providerListPresentation(item)", "providerPresentation(item)", 6)
replace_once(
    screen,
    '''  const [type, setType] = useState<ProviderType>(existing?.type ?? "xtream");''',
    '''  const [type, setType] = useState<ProviderType>(existing?.declaredType ?? existing?.type ?? "xtream");''',
)
replace_once(
    screen,
    '''{provider.type.toUpperCase()} · {provider.channelCount ?? 0}''',
    '''{(provider.declaredType ?? provider.type).toUpperCase()} · {provider.channelCount ?? 0}''',
)

print("M3U transport routing patch applied")
