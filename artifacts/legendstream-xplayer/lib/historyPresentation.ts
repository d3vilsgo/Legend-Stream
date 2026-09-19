export const MEANINGFUL_PROGRESS_SECONDS = 5;

export function visibleProgressRatio(position: number, duration: number) {
  if (!Number.isFinite(position) || !Number.isFinite(duration)) return null;
  if (position <= MEANINGFUL_PROGRESS_SECONDS || duration <= 0) return null;
  return Math.max(0, Math.min(1, position / duration));
}

export function historySecondaryText(
  kind: "movie" | "episode",
  subtitle: string | undefined,
  movieLabel: string,
  episodeLabel: string,
) {
  const normalized = subtitle?.trim();
  return normalized || (kind === "episode" ? episodeLabel : movieLabel);
}
