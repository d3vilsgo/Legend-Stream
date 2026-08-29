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
  try {
    const base = new URL(`${provider.baseUrl}/`);
    const stream = new URL(streamSource);
    if (!/^https?:$/i.test(stream.protocol) || stream.origin !== base.origin) return null;
    if (stream.search || stream.hash) return null;

    const baseSegments = base.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const segments = stream.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (segments.length !== baseSegments.length + 4) return null;
    for (let index = 0; index < baseSegments.length; index += 1) {
      if (segments[index] !== baseSegments[index]) return null;
    }

    const kind = segments[baseSegments.length] as M3UStreamKind;
    if (kind !== "live" && kind !== "movie" && kind !== "series") return null;
    if (expectedKind && kind !== expectedKind) return null;
    if (
      segments[baseSegments.length + 1] !== provider.username ||
      segments[baseSegments.length + 2] !== provider.password
    ) {
      return null;
    }

    const file = segments[baseSegments.length + 3];
    const dot = file.lastIndexOf(".");
    if (dot <= 0 || dot === file.length - 1) return null;
    const streamId = file.slice(0, dot);
    const containerExtension = file.slice(dot + 1);
    if (!streamId || !/^[a-zA-Z0-9]{1,10}$/.test(containerExtension)) return null;
    return { type: "m3u-path", kind, streamId, containerExtension };
  } catch {
    return null;
  }
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
