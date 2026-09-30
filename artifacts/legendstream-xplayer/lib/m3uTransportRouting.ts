import { parseM3UProviderSource, type M3UProviderSource } from "./m3uCatalogRefs";
import type { Provider, ProviderType } from "./iptv";
import { safeLog } from "./safeLog";

export type ProviderTransport = "xtream" | "m3u";
export type RoutedProvider = Provider & {
  declaredType?: ProviderType;
  transport?: ProviderTransport;
  playlistUrl?: string;
};
export type M3UTransportResolutionReason =
  | "url-not-credentialed"
  | "probe-succeeded"
  | "probe-failed"
  | "probe-timeout";

type TransportProvider = {
  type?: string | null;
  transport?: ProviderTransport | null;
};

type TransportFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type M3UProbeResult = {
  available: boolean;
  reason: Exclude<M3UTransportResolutionReason, "url-not-credentialed">;
};

export type M3UTransportResolution = {
  declaredType: "m3u";
  transport: ProviderTransport;
  reason: M3UTransportResolutionReason;
  credentials: M3UProviderSource | null;
};

export function resolvedProviderTransport(provider: TransportProvider | null | undefined) {
  return provider?.transport ?? provider?.type;
}

function isTimeoutFailure(caught: unknown) {
  if (!caught || typeof caught !== "object" || !("name" in caught)) return false;
  const name = String((caught as { name?: unknown }).name ?? "");
  return name === "TimeoutError" || name === "AbortError";
}

async function probeM3UXtreamTransportResult(
  credentials: M3UProviderSource,
  fetchImpl: TransportFetch = fetch,
): Promise<M3UProbeResult> {
  try {
    const apiUrl = new URL("player_api.php", `${credentials.baseUrl}/`);
    apiUrl.searchParams.set("username", credentials.username);
    apiUrl.searchParams.set("password", credentials.password);
    const response = await fetchImpl(apiUrl, {
      headers: { Accept: "application/json,*/*" },
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) return { available: false, reason: "probe-failed" };
    const payload = JSON.parse(await response.text()) as {
      user_info?: { auth?: number | string; status?: string };
    };
    const userInfo = payload?.user_info;
    if (!userInfo || typeof userInfo !== "object") {
      return { available: false, reason: "probe-failed" };
    }
    const auth = userInfo.auth;
    if (auth === 0 || auth === "0") {
      return { available: false, reason: "probe-failed" };
    }
    const status = String(userInfo.status ?? "").toLowerCase();
    if (["disabled", "banned", "expired"].includes(status)) {
      return { available: false, reason: "probe-failed" };
    }
    const available = auth === 1 || auth === "1" || status === "active";
    return {
      available,
      reason: available ? "probe-succeeded" : "probe-failed",
    };
  } catch (caught) {
    return {
      available: false,
      reason: isTimeoutFailure(caught) ? "probe-timeout" : "probe-failed",
    };
  }
}

export async function probeM3UXtreamTransport(
  credentials: M3UProviderSource,
  fetchImpl: TransportFetch = fetch,
) {
  return (await probeM3UXtreamTransportResult(credentials, fetchImpl)).available;
}

export async function resolveM3UTransport(
  source: string,
  fetchImpl: TransportFetch = fetch,
): Promise<M3UTransportResolution> {
  const credentials = parseM3UProviderSource(source);
  if (!credentials) {
    return {
      declaredType: "m3u",
      transport: "m3u",
      reason: "url-not-credentialed",
      credentials: null,
    };
  }
  const probe = await probeM3UXtreamTransportResult(credentials, fetchImpl);
  return {
    declaredType: "m3u",
    transport: probe.available ? "xtream" : "m3u",
    reason: probe.reason,
    credentials,
  };
}

const XTREAM_PROBE_TIMEOUT_MS = 7_000;

function logProviderTransport(
  providerType: ProviderType,
  resolvedTransport: string | undefined,
  resolutionReason: M3UTransportResolutionReason,
) {
  safeLog.info("LS_PROVIDER_TRANSPORT", {
    providerType,
    resolvedTransport: resolvedTransport ?? "unknown",
    resolutionReason,
  });
}

// Transport diagnostics above are deliberately identity-free and credential-free.
// Keep source locations, account fields, and endpoint details outside that event payload.

export function parseXtreamGetPhp(value: string) {
  try {
    const url = new URL(value.trim());
    if (!/\/get\.php$/i.test(url.pathname)) return null;
    const username = url.searchParams.get("username")?.trim();
    const password = url.searchParams.get("password") ?? "";
    const type = url.searchParams.get("type")?.toLowerCase();
    if (!username || !password || (type && type !== "m3u_plus")) return null;
    const path = url.pathname.replace(/\/get\.php$/i, "").replace(/\/+$/, "");
    return {
      baseUrl: `${url.origin}${path}`,
      username,
      password,
    };
  } catch {
    return null;
  }
}

type ParsedGetPhp = NonNullable<ReturnType<typeof parseXtreamGetPhp>>;

async function probeXtreamApi(parsed: ParsedGetPhp) {
  try {
    const apiUrl = new URL("player_api.php", `${parsed.baseUrl}/`);
    apiUrl.searchParams.set("username", parsed.username);
    apiUrl.searchParams.set("password", parsed.password);
    const response = await fetch(apiUrl.toString(), {
      headers: { Accept: "application/json,*/*" },
      signal: AbortSignal.timeout(XTREAM_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const text = await response.text();
    const payload = JSON.parse(text) as {
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

export async function resolveProviderTransport(provider: RoutedProvider): Promise<RoutedProvider> {
  const declaredType = provider.declaredType ?? provider.type;
  if (declaredType === "m3u") {
    const source = provider.playlistUrl || provider.url;
    const resolution = await resolveM3UTransport(source);
    logProviderTransport(resolution.declaredType, resolution.transport, resolution.reason);
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
