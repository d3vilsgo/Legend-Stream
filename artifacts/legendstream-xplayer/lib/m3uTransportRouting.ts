import { parseM3UProviderSource, type M3UProviderSource } from "./m3uCatalogRefs";

export type ProviderTransport = "xtream" | "m3u";
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
