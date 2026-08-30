import type { M3UCacheCounts, M3UCacheSyncPhase } from "./m3uCacheWriteMeasurement";

export function hasUsableM3UCacheSnapshot(
  counts: M3UCacheCounts,
  phase: M3UCacheSyncPhase,
) {
  if (phase === "error") return false;
  return counts.live > 0 || counts.vod > 0 || counts.series > 0;
}
