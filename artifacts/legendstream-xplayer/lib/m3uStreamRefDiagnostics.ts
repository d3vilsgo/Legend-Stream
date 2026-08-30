import type {
  M3UPathPlaybackRef,
  M3UProviderSource,
  M3UStreamKind,
} from "./m3uCatalogRefs";
import type { M3URefRejectionReason } from "./m3uCacheWriteMeasurement";

export type M3UStreamRefInspection =
  | { ref: M3UPathPlaybackRef; reason: null }
  | { ref: null; reason: M3URefRejectionReason };

export function inspectM3UStreamRef(
  provider: M3UProviderSource,
  streamSource: string,
  expectedKind?: M3UStreamKind,
): M3UStreamRefInspection {
  try {
    const base = new URL(`${provider.baseUrl}/`);
    const stream = new URL(streamSource);
    if (!/^https?:$/i.test(stream.protocol)) {
      return { ref: null, reason: "path-shape" };
    }
    if (stream.origin !== base.origin) {
      return { ref: null, reason: "origin-mismatch" };
    }
    if (stream.search || stream.hash) {
      return { ref: null, reason: "query-present" };
    }

    const baseSegments = base.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const segments = stream.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (segments.length !== baseSegments.length + 4) {
      return { ref: null, reason: "path-shape" };
    }
    for (let index = 0; index < baseSegments.length; index += 1) {
      if (segments[index] !== baseSegments[index]) {
        return { ref: null, reason: "path-shape" };
      }
    }

    const kind = segments[baseSegments.length] as M3UStreamKind;
    if (
      (kind !== "live" && kind !== "movie" && kind !== "series") ||
      (expectedKind !== undefined && kind !== expectedKind)
    ) {
      return { ref: null, reason: "kind-mismatch" };
    }
    if (
      segments[baseSegments.length + 1] !== provider.username ||
      segments[baseSegments.length + 2] !== provider.password
    ) {
      return { ref: null, reason: "credential-path-mismatch" };
    }

    const file = segments[baseSegments.length + 3];
    const dot = file.lastIndexOf(".");
    if (dot <= 0 || dot === file.length - 1) {
      return { ref: null, reason: "missing-extension" };
    }
    const streamId = file.slice(0, dot);
    const containerExtension = file.slice(dot + 1);
    if (!streamId || !/^[a-zA-Z0-9]{1,10}$/.test(containerExtension)) {
      return { ref: null, reason: "missing-extension" };
    }
    return {
      ref: { type: "m3u-path", kind, streamId, containerExtension },
      reason: null,
    };
  } catch {
    return { ref: null, reason: "path-shape" };
  }
}
