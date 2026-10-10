export type PlayerOrientationSnapshot = "portrait" | "landscape" | "unknown";
export type PlayerOrientationRestoreTarget = "portrait" | "landscape" | "unlock";

export function orientationSnapshotFromDimensions(
  width: number,
  height: number,
): PlayerOrientationSnapshot {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "unknown";
  }
  return width >= height ? "landscape" : "portrait";
}

export function resolvePlayerOrientationRestoreTarget({
  launchLayout,
  initialOrientation,
}: {
  launchLayout: PlayerOrientationSnapshot;
  initialOrientation: PlayerOrientationSnapshot;
}): PlayerOrientationRestoreTarget {
  if (launchLayout === "portrait" || launchLayout === "landscape") {
    return launchLayout;
  }
  if (initialOrientation === "portrait" || initialOrientation === "landscape") {
    return initialOrientation;
  }
  return "unlock";
}
