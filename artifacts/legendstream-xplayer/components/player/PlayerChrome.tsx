import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  LayoutChangeEvent,
  Pressable,
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

type FeatherName = React.ComponentProps<typeof Feather>["name"];
type Props = React.ComponentProps<typeof PlayerChromeV2> & {
  resolution?: string;
  fps?: number;
};
type Action = {
  key: string;
  label: string;
  icon?: FeatherName;
  glyph?: string;
  badge?: string;
  active?: boolean;
  accent?: boolean;
  onPress: () => void;
};

const initializedPlayers = new WeakSet<Function>();
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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
 * LegendStream responsive player chrome.
 *
 * The visible toolbar is always one row. Button dimensions are calculated from
 * the actual window width so portrait and landscape use the same controls
 * without horizontal scrolling, overflow or a secondary "more" drawer.
 * PlayerChromeV2 stays underneath for gestures, panels and error/download UI.
 */
export function PlayerChrome(props: Props) {
  const { width, height } = useWindowDimensions();
  const portrait = height > width;
  const [seekWidth, setSeekWidth] = useState(1);
  const runtime = useSyncExternalStore(
    subscribePlayerRuntimeInfo,
    getPlayerRuntimeInfoSnapshot,
    getPlayerRuntimeInfoSnapshot,
  );

  const {
    resolution: resolutionOverride,
    fps: fpsOverride,
    ...chrome
  } = props;

  // Keep the long-standing default of opening on ORIG without touching the VLC
  // bootstrap path. Two cycle calls move FIT -> FULL -> ORIG in one state turn.
  useEffect(() => {
    const cycle = props.onCycleFit as unknown as Function;
    if (initializedPlayers.has(cycle)) return;
    initializedPlayers.add(cycle);
    if (props.fitMode === "fit") {
      props.onCycleFit();
      props.onCycleFit();
    }
  }, [props.fitMode, props.onCycleFit]);

  const resolution = resolutionOverride ?? runtime.resolution;
  const fps = fpsOverride ?? runtime.fps;
  const tech = resolution
    ? `${resolution}${fps ? ` · ${formatFps(fps)} FPS` : ""}`
    : fps
      ? `${formatFps(fps)} FPS`
      : undefined;

  const progress = chrome.duration > 0
    ? clamp(chrome.position / chrome.duration, 0, 1)
    : 0;
  const showCenter = chrome.controlsVisible && !chrome.panel;

  const actions = useMemo<Action[]>(() => {
    const result: Action[] = [];
    if (chrome.selectableItems.length) {
      result.push({
        key: "list",
        label: chrome.mediaKind === "live" ? "Kanal listesi" : "İçerik listesi",
        icon: "list",
        active: chrome.panel === "content",
        onPress: () => chrome.onTogglePanel("content"),
      });
    }
    result.push(
      {
        key: "fit",
        label: `Görüntü modu ${fitLabel(chrome.fitMode)}`,
        icon: "maximize-2",
        badge: fitLabel(chrome.fitMode),
        accent: true,
        onPress: chrome.onCycleFit,
      },
      {
        key: "rotate",
        label: "Ekranı döndür",
        icon: "rotate-cw",
        onPress: chrome.onRotate,
      },
    );
    if (chrome.pipSupported) {
      result.push({
        key: "pip",
        label: "Picture in Picture",
        glyph: "PiP",
        onPress: chrome.onEnterPip,
      });
    }
    result.push(
      {
        key: "cc",
        label: "Altyazı",
        glyph: "CC",
        active: chrome.panel === "subtitles",
        onPress: () => chrome.onTogglePanel("subtitles"),
      },
      {
        key: "audio",
        label: "Ses parçası",
        icon: "volume-2",
        active: chrome.panel === "audio",
        onPress: () => chrome.onTogglePanel("audio"),
      },
      {
        key: "codec",
        label: `Codec ${playerCodecLabel(chrome.codecMode)}`,
        icon: "cpu",
        badge: playerCodecLabel(chrome.codecMode),
        accent: true,
        active: chrome.panel === "codec",
        onPress: () => chrome.onTogglePanel("codec"),
      },
    );
    if (chrome.allowDownload) {
      result.push({
        key: "download",
        label: chrome.downloadState === "done" ? "İndirildi" : "İndir",
        icon: chrome.downloadState === "done"
          ? "check-circle"
          : chrome.downloadState === "error"
            ? "alert-circle"
            : "download",
        active: chrome.downloadState === "done",
        onPress: chrome.onDownload,
      });
    }
    return result;
  }, [
    chrome.allowDownload,
    chrome.codecMode,
    chrome.downloadState,
    chrome.fitMode,
    chrome.mediaKind,
    chrome.onCycleFit,
    chrome.onDownload,
    chrome.onEnterPip,
    chrome.onRotate,
    chrome.onTogglePanel,
    chrome.panel,
    chrome.pipSupported,
    chrome.selectableItems.length,
  ]);

  const dockLayout = useMemo(() => {
    const count = Math.max(1, actions.length);
    const outerMargin = portrait ? 10 : 24;
    const innerPadding = portrait ? 7 : 12;
    const gap = portrait ? 2 : 5;
    const maxButton = portrait ? 47 : 54;
    const minButton = portrait ? 32 : 40;
    const maxDockWidth = Math.max(220, width - outerMargin * 2);
    const usable = maxDockWidth - innerPadding * 2 - gap * (count - 1);
    const button = clamp(Math.floor(usable / count), minButton, maxButton);
    const dockWidth = Math.min(
      maxDockWidth,
      button * count + gap * (count - 1) + innerPadding * 2,
    );
    return {
      outerMargin,
      innerPadding,
      gap,
      button,
      icon: clamp(Math.round(button * 0.46), 16, 24),
      badgeFont: clamp(Math.round(button * 0.16), 7, 9),
      dockWidth,
      dockHeight: clamp(button + (portrait ? 12 : 14), 50, 70),
    };
  }, [actions.length, portrait, width]);

  const infoLeft = portrait ? 70 : 92;
  const infoRight = portrait ? 12 : 20;

  const onSeekLayout = (event: LayoutChangeEvent) => {
    setSeekWidth(Math.max(1, event.nativeEvent.layout.width));
  };

  return (
    <>
      <PlayerChromeV2
        {...chrome}
        controlsVisible={false}
        infoVisible={false}
      />

      {chrome.infoVisible ? (
        <View
          pointerEvents="none"
          style={[
            styles.info,
            portrait ? styles.infoPortrait : styles.infoLandscape,
            { left: infoLeft, right: infoRight },
          ]}
        >
          <LinearGradient
            colors={["rgba(5,14,23,.96)", "rgba(4,10,18,.88)"]}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={styles.infoRail} />
          <View style={styles.infoMain}>
            <View style={styles.titleRow}>
              {chrome.mediaKind === "live" ? (
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>CANLI</Text>
                </View>
              ) : null}
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[styles.title, portrait && styles.titlePortrait]}
              >
                {chrome.title}
              </Text>
            </View>
            <View style={styles.metaRow}>
              {chrome.meta ? (
                <Text numberOfLines={1} style={styles.meta}>{chrome.meta}</Text>
              ) : null}
              <View style={[styles.tech, !tech && styles.techWaiting]}>
                <Feather name="monitor" size={11} color={tech ? "#67e8f9" : "#64748b"} />
                <Text
                  numberOfLines={1}
                  style={tech ? styles.techText : styles.techWaitingText}
                >
                  {tech ?? "Akış bilgisi bekleniyor"}
                </Text>
              </View>
            </View>
          </View>
          {!portrait ? (
            <View style={styles.modeCluster}>
              <ModeChip icon="maximize-2" text={fitLabel(chrome.fitMode)} />
              <ModeChip icon="cpu" text={playerCodecLabel(chrome.codecMode)} accent />
            </View>
          ) : null}
        </View>
      ) : null}

      {chrome.controlsVisible && chrome.canExit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Oynatıcıdan çık"
          onPress={chrome.onExit}
          hitSlop={10}
          style={({ pressed }) => [
            styles.back,
            portrait ? styles.backPortrait : styles.backLandscape,
            pressed && styles.pressed,
          ]}
        >
          <Feather name="arrow-left" size={portrait ? 24 : 27} color="#f8fafc" />
        </Pressable>
      ) : null}

      {showCenter ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.center,
            portrait ? styles.centerPortrait : styles.centerLandscape,
          ]}
        >
          {chrome.mediaKind !== "live" ? (
            <RoundAction
              compact={portrait}
              icon="rotate-ccw"
              badge="10"
              label="10 saniye geri"
              onPress={() => chrome.onSeekBy(-10)}
            />
          ) : chrome.canNavigate ? (
            <RoundAction
              compact={portrait}
              icon="skip-back"
              label="Önceki kanal"
              onPress={() => chrome.onMoveRelative(-1)}
            />
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={chrome.paused ? "Oynat" : "Duraklat"}
            onPress={chrome.onTogglePause}
            hitSlop={10}
            style={({ pressed }) => [
              styles.playOuter,
              portrait && styles.playOuterPortrait,
              pressed && styles.pressed,
            ]}
          >
            <LinearGradient
              colors={["#c7fbff", "#2dd4ee", "#0ea5e9"]}
              style={styles.playInner}
            >
              <Feather
                name={chrome.paused ? "play" : "pause"}
                size={portrait ? 30 : 36}
                color="#03131a"
              />
            </LinearGradient>
          </Pressable>

          {chrome.mediaKind !== "live" ? (
            <RoundAction
              compact={portrait}
              icon="rotate-cw"
              badge="15"
              label="15 saniye ileri"
              onPress={() => chrome.onSeekBy(15)}
            />
          ) : chrome.canNavigate ? (
            <RoundAction
              compact={portrait}
              icon="skip-forward"
              label="Sonraki kanal"
              onPress={() => chrome.onMoveRelative(1)}
            />
          ) : null}
        </View>
      ) : null}

      {chrome.controlsVisible ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.bottom,
            portrait ? styles.bottomPortrait : styles.bottomLandscape,
            { paddingHorizontal: dockLayout.outerMargin },
          ]}
        >
          {chrome.mediaKind !== "live" && !chrome.panel ? (
            <View style={styles.seekRow}>
              <Text style={styles.time}>{formatTime(chrome.position)}</Text>
              <Pressable
                onLayout={onSeekLayout}
                onPress={(event) => chrome.onSeekRatio(
                  clamp(event.nativeEvent.locationX / seekWidth, 0, 1),
                )}
                style={styles.seekTouch}
                hitSlop={{ top: 12, bottom: 12, left: 0, right: 0 }}
              >
                <View style={styles.seekTrack}>
                  <View style={[styles.seekFill, { width: `${progress * 100}%` }]} />
                  <View style={[styles.seekThumb, { left: `${progress * 100}%` }]} />
                </View>
              </Pressable>
              <Text style={[styles.time, styles.timeRight]}>{formatTime(chrome.duration)}</Text>
            </View>
          ) : null}

          <View
            style={[
              styles.dock,
              {
                width: dockLayout.dockWidth,
                minHeight: dockLayout.dockHeight,
                paddingHorizontal: dockLayout.innerPadding,
              },
            ]}
          >
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(13,23,34,.97)", "rgba(4,9,15,.97)"]}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={styles.dockGlow} pointerEvents="none" />
            <View style={[styles.dockRow, { gap: dockLayout.gap }]}>
              {actions.map((action) => (
                <DockAction
                  key={action.key}
                  action={action}
                  size={dockLayout.button}
                  iconSize={dockLayout.icon}
                  badgeFont={dockLayout.badgeFont}
                />
              ))}
            </View>
          </View>
        </View>
      ) : null}
    </>
  );
}

function ModeChip({ icon, text, accent }: { icon: FeatherName; text: string; accent?: boolean }) {
  return (
    <View style={[styles.modeChip, accent && styles.modeChipAccent]}>
      <Feather name={icon} size={11} color={accent ? "#67e8f9" : "#cbd5e1"} />
      <Text style={[styles.modeChipText, accent && styles.modeChipTextAccent]}>{text}</Text>
    </View>
  );
}

function RoundAction({
  compact,
  icon,
  badge,
  label,
  onPress,
}: {
  compact?: boolean;
  icon: FeatherName;
  badge?: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.roundAction,
        compact && styles.roundActionPortrait,
        pressed && styles.pressed,
      ]}
    >
      <Feather name={icon} size={compact ? 24 : 29} color="#f8fafc" />
      {badge ? <Text style={styles.roundBadge}>{badge}</Text> : null}
    </Pressable>
  );
}

function DockAction({
  action,
  size,
  iconSize,
  badgeFont,
}: {
  action: Action;
  size: number;
  iconSize: number;
  badgeFont: number;
}) {
  const highlighted = Boolean(action.active || action.accent);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={action.onPress}
      hitSlop={3}
      style={({ pressed }) => [
        styles.dockAction,
        { width: size, height: size, borderRadius: Math.round(size * 0.31) },
        highlighted && styles.dockActionHighlighted,
        action.active && styles.dockActionActive,
        pressed && styles.pressed,
      ]}
    >
      {action.icon ? (
        <Feather
          name={action.icon}
          size={iconSize}
          color={highlighted ? "#8beeff" : "#f8fafc"}
        />
      ) : (
        <Text
          style={[
            styles.glyph,
            { fontSize: clamp(Math.round(size * 0.32), 11, 16) },
            highlighted && styles.glyphAccent,
          ]}
        >
          {action.glyph}
        </Text>
      )}
      {action.badge ? (
        <View style={styles.badge} pointerEvents="none">
          <Text
            numberOfLines={1}
            style={[styles.badgeText, { fontSize: badgeFont }]}
          >
            {action.badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  info: {
    position: "absolute",
    zIndex: 52,
    top: 16,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(71,101,124,.42)",
    backgroundColor: "rgba(5,12,20,.92)",
    elevation: 9,
  },
  infoLandscape: {
    minHeight: 62,
    borderRadius: 18,
    paddingLeft: 18,
    paddingRight: 13,
  },
  infoPortrait: {
    minHeight: 66,
    borderRadius: 17,
    paddingLeft: 14,
    paddingRight: 10,
  },
  infoRail: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: "#22d3ee",
  },
  infoMain: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 8,
  },
  titleRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  titlePortrait: {
    fontSize: 15,
  },
  livePill: {
    height: 23,
    paddingHorizontal: 8,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "rgba(34,211,238,.38)",
    backgroundColor: "rgba(8,145,178,.16)",
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#22d3ee",
  },
  liveText: {
    color: "#8beeff",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.45,
  },
  metaRow: {
    minWidth: 0,
    marginTop: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  meta: {
    flexShrink: 1,
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700",
  },
  tech: {
    flexShrink: 0,
    minHeight: 22,
    maxWidth: "64%",
    paddingHorizontal: 7,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "rgba(103,232,249,.28)",
    backgroundColor: "rgba(8,145,178,.11)",
  },
  techWaiting: {
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  techText: {
    color: "#dffaff",
    fontSize: 10,
    fontWeight: "900",
  },
  techWaitingText: {
    color: "#64748b",
    fontSize: 9,
    fontWeight: "700",
  },
  modeCluster: {
    marginLeft: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  modeChip: {
    height: 29,
    minWidth: 62,
    paddingHorizontal: 9,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,.22)",
    backgroundColor: "rgba(15,23,42,.66)",
  },
  modeChipAccent: {
    borderColor: "rgba(34,211,238,.38)",
    backgroundColor: "rgba(8,145,178,.12)",
  },
  modeChipText: {
    color: "#e2e8f0",
    fontSize: 10,
    fontWeight: "900",
  },
  modeChipTextAccent: {
    color: "#8beeff",
  },
  back: {
    position: "absolute",
    zIndex: 65,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(5,12,20,.88)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,.28)",
    elevation: 12,
  },
  backLandscape: {
    left: 20,
    top: 18,
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  backPortrait: {
    left: 14,
    top: 18,
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  center: {
    position: "absolute",
    zIndex: 60,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  centerLandscape: {
    top: "50%",
    transform: [{ translateY: -44 }],
    gap: 52,
  },
  centerPortrait: {
    top: "49%",
    transform: [{ translateY: -37 }],
    gap: 26,
  },
  roundAction: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(5,12,20,.70)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,.32)",
    elevation: 7,
  },
  roundActionPortrait: {
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  roundBadge: {
    position: "absolute",
    color: "#f8fafc",
    fontSize: 9,
    fontWeight: "900",
  },
  playOuter: {
    width: 86,
    height: 86,
    borderRadius: 43,
    padding: 5,
    backgroundColor: "rgba(34,211,238,.18)",
    borderWidth: 1,
    borderColor: "rgba(103,232,249,.58)",
    elevation: 14,
  },
  playOuterPortrait: {
    width: 74,
    height: 74,
    borderRadius: 37,
  },
  playInner: {
    flex: 1,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  bottom: {
    position: "absolute",
    zIndex: 62,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  bottomLandscape: {
    bottom: 16,
  },
  bottomPortrait: {
    bottom: 12,
  },
  seekRow: {
    width: "100%",
    height: 32,
    marginBottom: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  time: {
    width: 54,
    color: "#f8fafc",
    fontSize: 11,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  timeRight: {
    textAlign: "right",
  },
  seekTouch: {
    flex: 1,
    height: 28,
    justifyContent: "center",
  },
  seekTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(226,232,240,.3)",
    overflow: "visible",
  },
  seekFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 2,
    backgroundColor: "#22d3ee",
  },
  seekThumb: {
    position: "absolute",
    top: -4,
    marginLeft: -6,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#67e8f9",
    borderWidth: 2,
    borderColor: "#e6fcff",
  },
  dock: {
    overflow: "hidden",
    alignSelf: "center",
    justifyContent: "center",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(71,101,124,.46)",
    backgroundColor: "rgba(4,9,15,.96)",
    elevation: 12,
  },
  dockGlow: {
    position: "absolute",
    left: 14,
    right: 14,
    top: 0,
    height: 1,
    backgroundColor: "rgba(103,232,249,.52)",
  },
  dockRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  dockAction: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "rgba(15,23,42,.30)",
  },
  dockActionHighlighted: {
    borderColor: "rgba(34,211,238,.28)",
    backgroundColor: "rgba(8,145,178,.10)",
  },
  dockActionActive: {
    borderColor: "rgba(103,232,249,.72)",
    backgroundColor: "rgba(8,145,178,.18)",
  },
  glyph: {
    color: "#f8fafc",
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  glyphAccent: {
    color: "#8beeff",
  },
  badge: {
    position: "absolute",
    right: 1,
    bottom: 1,
    minWidth: 22,
    maxWidth: 43,
    height: 15,
    paddingHorizontal: 3,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8,47,73,.96)",
    borderWidth: 1,
    borderColor: "rgba(103,232,249,.58)",
  },
  badgeText: {
    color: "#a5f3fc",
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.96 }],
  },
});
