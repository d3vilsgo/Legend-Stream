import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState, useSyncExternalStore } from "react";
import {
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  PlayerChrome as PlayerChromeV2,
  playerCodecLabel,
} from "./PlayerChromeV2";
import {
  getPlayerRuntimeInfoSnapshot,
  subscribePlayerRuntimeInfo,
} from "@/lib/playerRuntimeInfo";
import type { PlayerFitMode } from "./VlcPlaybackSurface";

export type {
  PlayerPanel,
  PlayerSelectableItem,
  PlayerMediaKind,
  PlayerDownloadState,
} from "./PlayerChromeV2";
export { playerCodecLabel };

const initializedPlayers = new WeakSet<Function>();
type FeatherName = React.ComponentProps<typeof Feather>["name"];

type Props = React.ComponentProps<typeof PlayerChromeV2> & {
  resolution?: string;
  fps?: number;
};

const fitLabel = (mode: PlayerFitMode) => {
  if (mode === "full") return "FULL";
  if (mode === "original") return "ORIG";
  if (mode === "16:9") return "16:9";
  if (mode === "4:3") return "4:3";
  return "FIT";
};

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const value = Math.floor(seconds);
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};

const formatFps = (fps: number) => {
  const rounded = Math.round(fps);
  if (Math.abs(fps - rounded) < 0.015) return String(rounded);
  return fps.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

/**
 * Presentation wrapper around PlayerChromeV2.
 *
 * V2 keeps its proven media-info, gesture and option-panel implementations.
 * Its old word-heavy bottom toolbar is suppressed here and replaced by a
 * compact icon dock. This keeps interaction logic stable while modernising the
 * visible player controls.
 */
export function PlayerChrome(props: Props) {
  const { width, height } = useWindowDimensions();
  const [seekWidth, setSeekWidth] = useState(1);
  const runtimeInfo = useSyncExternalStore(
    subscribePlayerRuntimeInfo,
    getPlayerRuntimeInfoSnapshot,
    getPlayerRuntimeInfoSnapshot,
  );
  const {
    resolution: resolutionOverride,
    fps: fpsOverride,
    ...chromeProps
  } = props;

  useEffect(() => {
    const cycle = props.onCycleFit as unknown as Function;
    if (initializedPlayers.has(cycle)) return;
    initializedPlayers.add(cycle);
    if (props.fitMode === "fit") {
      props.onCycleFit();
      props.onCycleFit();
    }
  }, [props.fitMode, props.onCycleFit]);

  const resolution = resolutionOverride ?? runtimeInfo.resolution;
  const fps = fpsOverride ?? runtimeInfo.fps;
  const technicalLabel = resolution
    ? `${resolution}${fps ? ` · ${formatFps(fps)} FPS` : ""}`
    : fps
      ? `${formatFps(fps)} FPS`
      : undefined;

  const progress = chromeProps.duration > 0
    ? Math.max(0, Math.min(1, chromeProps.position / chromeProps.duration))
    : 0;
  const landscape = width >= height;
  const controlsVisible = chromeProps.controlsVisible;
  const showCenter = controlsVisible && !chromeProps.panel;

  const onSeekLayout = (event: LayoutChangeEvent) => {
    setSeekWidth(Math.max(1, event.nativeEvent.layout.width));
  };

  return (
    <>
      <PlayerChromeV2 {...chromeProps} controlsVisible={false} />

      {technicalLabel && chromeProps.infoVisible ? (
        <View style={styles.technicalBadge} pointerEvents="none">
          <Feather name="monitor" size={13} color="#67e8f9" />
          <Text style={styles.technicalText}>{technicalLabel}</Text>
        </View>
      ) : null}

      {controlsVisible && chromeProps.canExit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Oynatıcıdan çık"
          onPress={chromeProps.onExit}
          style={({ pressed }) => [
            styles.backButton,
            landscape ? styles.backLandscape : styles.backPortrait,
            pressed && styles.pressed,
          ]}
          hitSlop={10}
        >
          <Feather name="arrow-left" size={27} color="#f8fafc" />
        </Pressable>
      ) : null}

      {showCenter ? (
        <View style={styles.centerControls} pointerEvents="box-none">
          {chromeProps.mediaKind !== "live" ? (
            <RoundButton
              accessibilityLabel="10 saniye geri"
              icon="rotate-ccw"
              badge="10"
              onPress={() => chromeProps.onSeekBy(-10)}
            />
          ) : chromeProps.canNavigate ? (
            <RoundButton
              accessibilityLabel="Önceki kanal"
              icon="skip-back"
              disabled={chromeProps.currentIndex <= 0}
              onPress={() => chromeProps.onMoveRelative(-1)}
            />
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={chromeProps.paused ? "Oynat" : "Duraklat"}
            onPress={chromeProps.onTogglePause}
            style={({ pressed }) => [styles.playOuter, pressed && styles.playPressed]}
            hitSlop={10}
          >
            <LinearGradient
              colors={["#b8f7ff", "#22d3ee", "#0ea5e9"]}
              start={{ x: 0.15, y: 0 }}
              end={{ x: 0.85, y: 1 }}
              style={styles.playInner}
            >
              <Feather
                name={chromeProps.paused ? "play" : "pause"}
                size={36}
                color="#03131a"
              />
            </LinearGradient>
          </Pressable>

          {chromeProps.mediaKind !== "live" ? (
            <RoundButton
              accessibilityLabel="15 saniye ileri"
              icon="rotate-cw"
              badge="15"
              onPress={() => chromeProps.onSeekBy(15)}
            />
          ) : chromeProps.canNavigate ? (
            <RoundButton
              accessibilityLabel="Sonraki kanal"
              icon="skip-forward"
              disabled={chromeProps.currentIndex >= chromeProps.selectableItems.length - 1}
              onPress={() => chromeProps.onMoveRelative(1)}
            />
          ) : null}
        </View>
      ) : null}

      {controlsVisible ? (
        <View
          style={[
            styles.bottomArea,
            landscape ? styles.bottomLandscape : styles.bottomPortrait,
          ]}
          pointerEvents="box-none"
        >
          {chromeProps.mediaKind !== "live" && !chromeProps.panel ? (
            <View style={styles.seekRow}>
              <Text style={styles.timeText}>{formatTime(chromeProps.position)}</Text>
              <Pressable
                onLayout={onSeekLayout}
                onPress={(event) => chromeProps.onSeekRatio(
                  Math.max(0, Math.min(1, event.nativeEvent.locationX / seekWidth)),
                )}
                style={styles.seekTouch}
                hitSlop={{ top: 12, bottom: 12, left: 0, right: 0 }}
              >
                <View style={styles.seekTrack}>
                  <LinearGradient
                    colors={["#67e8f9", "#22d3ee", "#0284c7"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.seekFill, { width: `${progress * 100}%` }]}
                  />
                  <View style={[styles.seekThumb, { left: `${progress * 100}%` }]} />
                </View>
              </Pressable>
              <Text style={[styles.timeText, styles.timeRight]}>{formatTime(chromeProps.duration)}</Text>
            </View>
          ) : null}

          <View style={styles.dockShell}>
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(13,23,34,.96)", "rgba(4,9,15,.96)"]}
              style={StyleSheet.absoluteFillObject}
            />
            <View pointerEvents="none" style={styles.dockTopGlow} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dockContent}
            >
              {chromeProps.canNavigate ? (
                <DockButton
                  accessibilityLabel={chromeProps.mediaKind === "live" ? "Önceki kanal" : "Önceki içerik"}
                  icon="skip-back"
                  disabled={chromeProps.currentIndex <= 0}
                  onPress={() => chromeProps.onMoveRelative(-1)}
                />
              ) : null}

              {chromeProps.selectableItems.length ? (
                <DockButton
                  accessibilityLabel={chromeProps.mediaKind === "live" ? "Kanal listesi" : "İçerik listesi"}
                  icon="list"
                  active={chromeProps.panel === "content"}
                  onPress={() => chromeProps.onTogglePanel("content")}
                />
              ) : null}

              {chromeProps.canNavigate ? (
                <DockButton
                  accessibilityLabel={chromeProps.mediaKind === "live" ? "Sonraki kanal" : "Sonraki içerik"}
                  icon="skip-forward"
                  disabled={chromeProps.currentIndex >= chromeProps.selectableItems.length - 1}
                  onPress={() => chromeProps.onMoveRelative(1)}
                />
              ) : null}

              {(chromeProps.canNavigate || chromeProps.selectableItems.length) ? <DockDivider /> : null}

              <DockButton
                accessibilityLabel={`Görüntü modu ${fitLabel(chromeProps.fitMode)}`}
                icon="maximize-2"
                badge={fitLabel(chromeProps.fitMode)}
                accent
                onPress={chromeProps.onCycleFit}
              />

              <DockButton
                accessibilityLabel="Ekranı döndür"
                icon="rotate-cw"
                onPress={chromeProps.onRotate}
              />

              {chromeProps.pipSupported ? (
                <DockButton
                  accessibilityLabel="Picture in Picture"
                  glyph="PiP"
                  onPress={chromeProps.onEnterPip}
                />
              ) : null}

              <DockDivider />

              <DockButton
                accessibilityLabel="Altyazı"
                glyph="CC"
                active={chromeProps.panel === "subtitles"}
                onPress={() => chromeProps.onTogglePanel("subtitles")}
              />

              <DockButton
                accessibilityLabel="Ses parçası"
                icon="volume-2"
                active={chromeProps.panel === "audio"}
                onPress={() => chromeProps.onTogglePanel("audio")}
              />

              <DockButton
                accessibilityLabel={`Codec ${playerCodecLabel(chromeProps.codecMode)}`}
                icon="cpu"
                badge={playerCodecLabel(chromeProps.codecMode)}
                accent
                active={chromeProps.panel === "codec"}
                onPress={() => chromeProps.onTogglePanel("codec")}
              />

              {chromeProps.allowDownload ? (
                <DockButton
                  accessibilityLabel={chromeProps.downloadState === "done" ? "İndirildi" : "İndir"}
                  icon={chromeProps.downloadState === "done"
                    ? "check-circle"
                    : chromeProps.downloadState === "error"
                      ? "alert-circle"
                      : "download"}
                  active={chromeProps.downloadState === "done"}
                  onPress={chromeProps.onDownload}
                />
              ) : null}
            </ScrollView>
          </View>
        </View>
      ) : null}
    </>
  );
}

function RoundButton({
  accessibilityLabel,
  icon,
  badge,
  disabled,
  onPress,
}: {
  accessibilityLabel: string;
  icon: FeatherName;
  badge?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.roundButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Feather name={icon} size={29} color="#f8fafc" />
      {badge ? <Text style={styles.roundBadge}>{badge}</Text> : null}
    </Pressable>
  );
}

function DockButton({
  accessibilityLabel,
  icon,
  glyph,
  badge,
  active,
  accent,
  disabled,
  onPress,
}: {
  accessibilityLabel: string;
  icon?: FeatherName;
  glyph?: string;
  badge?: string;
  active?: boolean;
  accent?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const highlighted = active || accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.dockButton,
        highlighted && styles.dockButtonHighlighted,
        active && styles.dockButtonActive,
        disabled && styles.disabled,
        pressed && !disabled && styles.dockButtonPressed,
      ]}
    >
      {icon ? (
        <Feather
          name={icon}
          size={22}
          color={highlighted ? "#8beeff" : "#f8fafc"}
        />
      ) : (
        <Text style={[styles.glyphText, highlighted && styles.glyphTextAccent]}>{glyph}</Text>
      )}
      {badge ? (
        <View style={styles.microBadge} pointerEvents="none">
          <Text style={styles.microBadgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function DockDivider() {
  return <View style={styles.dockDivider} pointerEvents="none" />;
}

const styles = StyleSheet.create({
  technicalBadge: {
    position: "absolute",
    zIndex: 52,
    top: 78,
    right: 20,
    minHeight: 29,
    paddingHorizontal: 11,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "rgba(3,10,17,.9)",
    borderWidth: 1,
    borderColor: "rgba(103,232,249,.48)",
    elevation: 8,
  },
  technicalText: {
    color: "#e7fbff",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  backButton: {
    position: "absolute",
    zIndex: 65,
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(5,12,20,.86)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,.28)",
    elevation: 12,
  },
  backLandscape: {
    left: 24,
    top: 18,
  },
  backPortrait: {
    left: 18,
    top: 18,
  },
  centerControls: {
    position: "absolute",
    zIndex: 60,
    left: 0,
    right: 0,
    top: "50%",
    marginTop: -39,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 44,
  },
  roundButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(3,9,16,.74)",
    borderWidth: 1,
    borderColor: "rgba(203,213,225,.28)",
    elevation: 10,
  },
  roundBadge: {
    position: "absolute",
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
  },
  playOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    padding: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(103,232,249,.12)",
    borderWidth: 1,
    borderColor: "rgba(103,232,249,.72)",
    elevation: 18,
  },
  playInner: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
  },
  playPressed: {
    transform: [{ scale: 0.96 }],
    opacity: 0.9,
  },
  bottomArea: {
    position: "absolute",
    zIndex: 58,
  },
  bottomLandscape: {
    left: 26,
    right: 26,
    bottom: 18,
  },
  bottomPortrait: {
    left: 18,
    right: 18,
    bottom: 18,
  },
  seekRow: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 10,
    marginBottom: 10,
    gap: 12,
  },
  timeText: {
    minWidth: 50,
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  timeRight: {
    textAlign: "right",
  },
  seekTouch: {
    flex: 1,
    height: 22,
    justifyContent: "center",
  },
  seekTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(226,232,240,.34)",
  },
  seekFill: {
    height: 5,
    borderRadius: 3,
  },
  seekThumb: {
    position: "absolute",
    top: -3,
    marginLeft: -5,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: "#8beeff",
    borderWidth: 2,
    borderColor: "#062331",
  },
  dockShell: {
    minHeight: 68,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(100,116,139,.34)",
    elevation: 18,
  },
  dockTopGlow: {
    position: "absolute",
    left: 28,
    right: 28,
    top: 0,
    height: 1,
    backgroundColor: "rgba(103,232,249,.62)",
  },
  dockContent: {
    minWidth: "100%",
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  dockButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,23,42,.52)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,.16)",
  },
  dockButtonHighlighted: {
    backgroundColor: "rgba(8,145,178,.13)",
    borderColor: "rgba(103,232,249,.34)",
  },
  dockButtonActive: {
    backgroundColor: "rgba(14,165,233,.2)",
    borderColor: "rgba(103,232,249,.72)",
  },
  dockButtonPressed: {
    transform: [{ scale: 0.94 }],
    backgroundColor: "rgba(30,41,59,.92)",
  },
  glyphText: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  glyphTextAccent: {
    color: "#8beeff",
  },
  microBadge: {
    position: "absolute",
    right: 2,
    bottom: 2,
    minWidth: 21,
    height: 14,
    paddingHorizontal: 3,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#062b39",
    borderWidth: 1,
    borderColor: "rgba(103,232,249,.45)",
  },
  microBadgeText: {
    color: "#a5f3fc",
    fontSize: 7,
    lineHeight: 9,
    fontWeight: "900",
  },
  dockDivider: {
    width: 1,
    height: 30,
    marginHorizontal: 2,
    backgroundColor: "rgba(148,163,184,.22)",
  },
  disabled: {
    opacity: 0.28,
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
});
