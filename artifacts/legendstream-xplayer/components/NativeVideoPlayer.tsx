import React from "react";
import { CompatibilityVideoPlayer } from "@/components/CompatibilityVideoPlayerV2";
import { getEpisodePlaybackQueue, getVodPlaybackQueue } from "@/lib/xtreamCatalog";

type Props = React.ComponentProps<typeof CompatibilityVideoPlayer>;

export function NativeVideoPlayer(props: Props) {
  const registeredKind = getEpisodePlaybackQueue(props.source)
    ? "episode"
    : getVodPlaybackQueue(props.source)
      ? "movie"
      : undefined;

  return (
    <CompatibilityVideoPlayer
      {...props}
      mediaKind={props.mediaKind ?? registeredKind}
    />
  );
}
