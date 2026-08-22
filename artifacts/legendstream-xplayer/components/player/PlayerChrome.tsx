import React, { useEffect } from "react";
import {
  PlayerChrome as PlayerChromeV2,
  playerCodecLabel,
} from "./PlayerChromeV2";

export type {
  PlayerPanel,
  PlayerSelectableItem,
  PlayerMediaKind,
  PlayerDownloadState,
} from "./PlayerChromeV2";
export { playerCodecLabel };

const initializedPlayers = new WeakSet<Function>();

/**
 * Presentation wrapper for the new chrome.
 *
 * Each player instance starts in the proven ORIG display mode by advancing the
 * existing FIT -> FULL -> ORIG cycle once. The callback identity is stable for
 * the lifetime of CompatibilityVideoPlayer, so PiP unmount/remount does not
 * reset a user's later display-mode choice.
 */
export function PlayerChrome(
  props: React.ComponentProps<typeof PlayerChromeV2>,
) {
  useEffect(() => {
    const cycle = props.onCycleFit as unknown as Function;
    if (initializedPlayers.has(cycle)) return;
    initializedPlayers.add(cycle);
    if (props.fitMode === "fit") {
      props.onCycleFit();
      props.onCycleFit();
    }
  }, [props.fitMode, props.onCycleFit]);

  return <PlayerChromeV2 {...props} />;
}
