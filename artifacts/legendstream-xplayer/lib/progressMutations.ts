import { LibraryMutationQueue } from "./contentFavorites";
import {
  samePlaybackRef,
  type MediaPlaybackRef,
  type MediaProgressV2,
} from "./mediaProgress";
export function validProgress(position: number, duration: number) {
  return (
    Number.isFinite(position) &&
    Number.isFinite(duration) &&
    position > 5 &&
    duration > 0 &&
    position <= duration + 2
  );
}
export function resumableProgress(
  value: Pick<MediaProgressV2, "position" | "duration" | "playbackRef">,
) {
  return (
    validProgress(value.position, value.duration) &&
    value.playbackRef.type !== "unresolved" &&
    value.position < Math.max(0, value.duration - 30) &&
    value.position / value.duration < 0.95
  );
}
export type ProgressSession = {
  providerId: string;
  ref: MediaPlaybackRef;
  epoch: number;
};
/** In-memory ownership around the existing V2 storage, not a second history store. */
export class ProgressMutationOwner {
  readonly queue = new LibraryMutationQueue();
  private epochs = new Map<string, number>();
  private key(providerId: string, ref: MediaPlaybackRef) {
    const identity =
      ref.type === "xtream-vod"
        ? [ref.type, ref.streamId]
        : ref.type === "xtream-episode"
          ? [ref.type, ref.episodeId]
          : ref.type === "m3u-vod" || ref.type === "m3u-episode"
            ? [ref.type, ref.itemId]
            : ref.type === "stalker-vod"
              ? [ref.type, ref.itemId, ref.categoryId]
              : ref.type === "stalker-episode"
                ? [ref.type, ref.seriesId, ref.seasonId, ref.episodeId]
                : [ref.type, ref.legacyTag];
    return JSON.stringify([providerId, identity]);
  }
  begin(providerId: string, ref: MediaPlaybackRef): ProgressSession {
    const key = this.key(providerId, ref),
      epoch = (this.epochs.get(key) ?? 0) + 1;
    this.epochs.set(key, epoch);
    return { providerId, ref, epoch };
  }
  owns(session: ProgressSession) {
    return (
      this.epochs.get(this.key(session.providerId, session.ref)) ===
      session.epoch
    );
  }
  invalidate(providerId: string, ref: MediaPlaybackRef) {
    this.begin(providerId, ref);
  }
  same(session: ProgressSession, providerId: string, ref: MediaPlaybackRef) {
    return (
      session.providerId === providerId &&
      samePlaybackRef(session.ref, ref) &&
      this.owns(session)
    );
  }
}
