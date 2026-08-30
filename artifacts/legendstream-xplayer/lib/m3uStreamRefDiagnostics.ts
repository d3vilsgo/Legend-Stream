import type {
  M3UPathPlaybackRef,
  M3UProviderSource,
  M3UStreamKind,
} from "./m3uCatalogRefs";
import type { M3URefRejectionReason } from "./m3uCacheWriteMeasurement";

export type M3UStreamRefInspection =
  | { ref: M3UPathPlaybackRef; reason: null }
  | { ref: null; reason: M3URefRejectionReason };

function matchesBasePath(baseSegments: string[], segments: string[]) {
  for (let index = 0; index < baseSegments.length; index += 1) {
    if (segments[index] !== baseSegments[index]) return false;
  }
  return true;
}

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
    if (segments.length < baseSegments.length || !matchesBasePath(baseSegments, segments)) {
      return { ref: null, reason: "path-shape" };
    }

    const relative = segments.slice(baseSegments.length);

    // Some Xtream-compatible M3U panels expose live streams as
    // /{username}/{password}/{streamId}: no /live/ segment and no extension.
    // This shape is accepted only as live and still requires exact credentials.
    if (relative.length === 3) {
      if (expectedKind !== undefined && expectedKind !== "live") {
        return { ref: null, reason: "kind-mismatch" };
      }
      if (relative[0] !== provider.username || relative[1] !== provider.password) {
        return { ref: null, reason: "credential-path-mismatch" };
      }
      const streamId = relative[2];
      if (!streamId) return { ref: null, reason: "path-shape" };
      return {
        ref: {
          type: "m3u-path",
          kind: "live",
          streamId,
          containerExtension: null,
        },
        reason: null,
      };
    }

    if (relative.length !== 4) {
      return { ref: null, reason: "path-shape" };
    }

    const kind = relative[0] as M3UStreamKind;
    if (
      (kind !== "live" && kind !== "movie" && kind !== "series") ||
      (expectedKind !== undefined && kind !== expectedKind)
    ) {
      return { ref: null, reason: "kind-mismatch" };
    }
    if (relative[1] !== provider.username || relative[2] !== provider.password) {
      return { ref: null, reason: "credential-path-mismatch" };
    }

    const file = relative[3];
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
