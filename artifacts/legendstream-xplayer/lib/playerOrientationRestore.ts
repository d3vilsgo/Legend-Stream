export type PlayerOrientationSnapshot = "portrait" | "landscape" | "unknown";
export type PlayerOrientationRestoreTarget = "portrait" | "landscape" | "unlock";
export type PlayerOrientationLockPolicy = "free" | "portrait" | "landscape" | "unknown";
export type PlayerOrientationRestoreStep =
  | { type: "lock"; target: "portrait" | "landscape" }
  | { type: "unlock" };

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

export function resolvePlayerOrientationRestorePlan({
  launchLayout,
  initialOrientation,
  initialLock,
}: {
  launchLayout: PlayerOrientationSnapshot;
  initialOrientation: PlayerOrientationSnapshot;
  initialLock: PlayerOrientationLockPolicy;
}): PlayerOrientationRestoreStep[] {
  const visualTarget = resolvePlayerOrientationRestoreTarget({ launchLayout, initialOrientation });
  const steps: PlayerOrientationRestoreStep[] = [];

  if (visualTarget === "portrait" || visualTarget === "landscape") {
    steps.push({ type: "lock", target: visualTarget });
  } else {
    steps.push({ type: "unlock" });
  }

  if (initialLock === "free" || initialLock === "unknown") {
    if (visualTarget !== "unlock") steps.push({ type: "unlock" });
    return steps;
  }

  if (visualTarget !== initialLock) {
    steps.push({ type: "lock", target: initialLock });
  }
  return steps;
}
