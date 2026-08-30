import { inspectM3UStreamRef } from "./m3uStreamRefDiagnostics";

export type M3UStreamKind = "live" | "movie" | "series";

export type M3UPathPlaybackRef = {
  type: "m3u-path";
  kind: M3UStreamKind;
  streamId: string;
  containerExtension: string;
};

export type M3UProviderSource = {
  baseUrl: string;
  username: string;
  password: string;
};

function trimmedBasePath(pathname: string) {
  const withoutGetPhp = pathname.replace(/\/get\.php$/i, "");
  return withoutGetPhp.replace(/\/+$/, "");
}

export function parseM3UProviderSource(value: string): M3UProviderSource | null {
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/i.test(url.protocol) || !/\/get\.php$/i.test(url.pathname)) return null;
    const username = url.searchParams.get("username")?.trim();
    const password = url.searchParams.get("password") ?? "";
    const type = url.searchParams.get("type")?.toLowerCase();
    if (!username || !password || (type && type !== "m3u_plus")) return null;
    const basePath = trimmedBasePath(url.pathname);
    return {
      baseUrl: `${url.origin}${basePath}`.replace(/\/+$/, ""),
      username,
      password,
    };
  } catch {
    return null;
  }
}

export function parseM3UStreamRef(
  providerSource: string,
  streamSource: string,
  expectedKind?: M3UStreamKind,
): M3UPathPlaybackRef | null {
  const provider = parseM3UProviderSource(providerSource);
  if (!provider) return null;
  return inspectM3UStreamRef(provider, streamSource, expectedKind).ref;
}

export function buildM3UStreamUrl(
  providerSource: string,
  ref: M3UPathPlaybackRef,
): string | null {
  const provider = parseM3UProviderSource(providerSource);
  if (!provider) return null;
  return `${provider.baseUrl}/${ref.kind}/${encodeURIComponent(provider.username)}/${encodeURIComponent(provider.password)}/${encodeURIComponent(ref.streamId)}.${ref.containerExtension}`;
}

export function isSafeM3UPlaybackRef(value: unknown): value is M3UPathPlaybackRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as Partial<M3UPathPlaybackRef>;
  return (
    ref.type === "m3u-path" &&
    (ref.kind === "live" || ref.kind === "movie" || ref.kind === "series") &&
    typeof ref.streamId === "string" && ref.streamId.length > 0 &&
    typeof ref.containerExtension === "string" &&
    /^[a-zA-Z0-9]{1,10}$/.test(ref.containerExtension)
  );
}
