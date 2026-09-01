import { parseM3UProviderSource, type M3UProviderSource } from "./m3uCatalogRefs";

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
