import { Feather } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
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

type Props = React.ComponentProps<typeof PlayerChromeV2> & {
  resolution?: string;
};

/**
 * Presentation wrapper for the new chrome.
 *
 * Each player instance starts in the proven ORIG display mode by advancing the
 * existing FIT -> FULL -> ORIG cycle once. The callback identity is stable for
 * the lifetime of CompatibilityVideoPlayer, so PiP unmount/remount does not
 * reset a user's later display-mode choice.
 */
export function PlayerChrome(props: Props) {
  const { resolution, ...chromeProps } = props;

  useEffect(() => {
    const cycle = props.onCycleFit as unknown as Function;
    if (initializedPlayers.has(cycle)) return;
    initializedPlayers.add(cycle);
    if (props.fitMode === "fit") {
      props.onCycleFit();
      props.onCycleFit();
    }
  }, [props.fitMode, props.onCycleFit]);

  return (
    <>
      <PlayerChromeV2 {...chromeProps} />
      {resolution && chromeProps.infoVisible ? (
        <View style={styles.resolutionBadge} pointerEvents="none">
          <Feather name="monitor" size={12} color="#67e8f9" />
          <Text style={styles.resolutionText}>{resolution}</Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  resolutionBadge: {
    position: "absolute",
    zIndex: 40,
    top: 78,
    right: 20,
    minHeight: 26,
    paddingHorizontal: 9,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(4,8,14,.82)",
    borderWidth: 1,
    borderColor: "rgba(103,232,249,.32)",
  },
  resolutionText: {
    color: "#dff8ff",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
});
