import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Animated,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

export type PlayerProgramInfo = {
  title: string;
  start: number;
  end: number;
};

type FeatherName = React.ComponentProps<typeof Feather>["name"];
type Props = React.ComponentProps<typeof PlayerChromeV2> & {
  resolution?: string;
  fps?: number;
  streamCodec?: string;
  epgNow?: PlayerProgramInfo;
  epgNext?: PlayerProgramInfo;
  epgLoading?: boolean;
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

const fitLabel = (mode: PlayerFitMode) =>
  mode === "full"
    ? "FILL"
    : mode === "original"
      ? "ORIG"
      : mode === "16:9"
        ? "16:9"
        : mode === "4:3"
          ? "4:3"
          : "FIT";

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

const formatClock = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });

const formatRemaining = (end: number) => {
  const minutes = Math.max(0, Math.ceil((end - Date.now()) / 60_000));
  return minutes > 0 ? `${minutes} dk kaldı` : `bitiş ${formatClock(end)}`;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function useFade(visible: boolean) {
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: visible ? 170 : 260,
      useNativeDriver: true,
    }).start();
  }, [opacity, visible]);
  return opacity;
}

export function PlayerChrome(props: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
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
    streamCodec: codecOverride,
    epgNow,
    epgNext,
    epgLoading: _epgLoading,
    ...chrome
  } = props;

  const controlsOpacity = useFade(chrome.controlsVisible);
  const infoOpacity = useFade(chrome.infoVisible);
  const shadeOpacity = useFade(chrome.controlsVisible || chrome.infoVisible);

  const resolution = resolutionOverride ?? runtime.resolution;
  const fps = fpsOverride ?? runtime.fps;
  const streamCodec = codecOverride ?? runtime.codec;
  const technicalParts = [
    resolution,
    streamCodec,
    fps ? `${formatFps(fps)} FPS` : undefined,
  ].filter(Boolean);
  const technicalLabel = technicalParts.length
    ? technicalParts.join(" · ")
    : undefined;

  const progress = chrome.duration > 0
    ? Math.max(0, Math.min(1, chrome.position / chrome.duration))
    : 0;
  const showCenter = chrome.controlsVisible && !chrome.panel;

  const actions: Action[] = [
    ...(chrome.selectableItems.length
      ? [{
          key: "list",
          label: chrome.mediaKind === "live" ? "Kanallar" : "Liste",
          icon: "list" as FeatherName,
          active: chrome.panel === "content",
          onPress: () => chrome.onTogglePanel("content"),
        }]
      : []),
    {
      key: "fit",
      label: `Görüntü ${fitLabel(chrome.fitMode)}`,
      icon: "maximize-2",
      badge: fitLabel(chrome.fitMode),
      accent: true,
      onPress: chrome.onCycleFit,
    },
    {
      key: "rotate",
      label: "Döndür",
      icon: "rotate-cw",
      onPress: chrome.onRotate,
    },
    ...(chrome.pipSupported
      ? [{
          key: "pip",
          label: "Picture in Picture",
          glyph: "PiP",
          onPress: chrome.onEnterPip,
        }]
      : []),
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
    ...(chrome.allowDownload
      ? [{
          key: "download",
          label: chrome.downloadState === "done" ? "İndirildi" : "İndir",
          icon: (chrome.downloadState === "done"
            ? "check-circle"
            : chrome.downloadState === "error"
              ? "alert-circle"
              : "download") as FeatherName,
          active: chrome.downloadState === "done",
          onPress: chrome.onDownload,
        }]
      : []),
  ];

  const gap = portrait ? 2 : 5;
  const outerPadding = portrait ? 8 : 20;
  const safeHorizontal = insets.left + insets.right;
  const availableWidth = Math.max(
    1,
    width - safeHorizontal - outerPadding * 2 - 8,
  );
  const buttonSize = clamp(
    Math.floor(
      (availableWidth - gap * Math.max(0, actions.length - 1)) /
        Math.max(1, actions.length),
    ),
    30,
    portrait ? 46 : 54,
  );
  const iconSize = clamp(Math.round(buttonSize * 0.46), 15, 24);
  const progressScale = clamp(width / (portrait ? 390 : 840), 0.82, 1.2);
  const timeWidth = clamp(Math.round(54 * progressScale), 44, 64);
  const timeFontSize = clamp(Math.round(11 * progressScale), 9, 13);
  const topInset = Math.max(insets.top, portrait ? 10 : 12);
  const infoLeft = Math.max(insets.left + (portrait ? 70 : 82), portrait ? 70 : 86);
  const infoMaxWidth = portrait
    ? Math.max(180, width - infoLeft - Math.max(insets.right + 12, 12))
    : Math.min(Math.max(320, width * 0.56), 680);

  return (
    <>
      <PlayerChromeV2 {...chrome} controlsVisible={false} infoVisible={false} />

      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, { opacity: shadeOpacity }]}
      >
        <LinearGradient
          colors={["rgba(0,0,0,.68)", "rgba(0,0,0,.34)", "rgba(0,0,0,0)"]}
          locations={[0, 0.48, 1]}
          style={styles.topGradient}
        />
        <LinearGradient
          colors={["rgba(0,0,0,0)", "rgba(0,0,0,.34)", "rgba(0,0,0,.74)"]}
          locations={[0, 0.48, 1]}
          style={styles.bottomGradient}
        />
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.info,
          portrait ? styles.infoPortrait : styles.infoLandscape,
          {
            top: topInset,
            left: infoLeft,
            maxWidth: infoMaxWidth,
            opacity: infoOpacity,
          },
        ]}
      >
        <InfoCard
          portrait={portrait}
          title={chrome.title}
          meta={chrome.meta}
          live={chrome.mediaKind === "live"}
          tech={technicalLabel}
          epgNow={epgNow}
          epgNext={epgNext}
        />
      </Animated.View>

      <Animated.View
        pointerEvents={chrome.controlsVisible ? "box-none" : "none"}
        style={[StyleSheet.absoluteFillObject, { opacity: controlsOpacity }]}
      >
        {chrome.canExit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Oynatıcıdan çık"
            onPress={chrome.onExit}
            style={({ pressed }) => [
              styles.back,
              {
                left: Math.max(insets.left + 12, 16),
                top: topInset + 1,
              },
              portrait ? styles.backPortrait : styles.backLandscape,
              pressed && styles.pressed,
            ]}
            hitSlop={10}
          >
            <Feather
              name="arrow-left"
              size={portrait ? 23 : 26}
              color="#fff"
            />
          </Pressable>
        ) : null}

        {!portrait ? (
          <View
            style={[
              styles.modeCluster,
              {
                top: topInset + 3,
                right: Math.max(insets.right + 18, 20),
              },
            ]}
          >
            <ModeChip
              icon="maximize-2"
              text={fitLabel(chrome.fitMode)}
              onPress={chrome.onCycleFit}
            />
            <ModeChip
              icon="cpu"
              text={playerCodecLabel(chrome.codecMode)}
              accent
              onPress={() => chrome.onTogglePanel("codec")}
            />
          </View>
        ) : null}

        {showCenter ? (
          <View
            style={[
              styles.center,
              portrait ? styles.centerPortrait : styles.centerLandscape,
            ]}
            pointerEvents="box-none"
          >
            {chrome.mediaKind !== "live" ? (
              <RoundButton
                compact={portrait}
                icon="rotate-ccw"
                badge="10"
                label="10 saniye geri"
                onPress={() => chrome.onSeekBy(-10)}
              />
            ) : chrome.canNavigate ? (
              <RoundButton
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
              style={({ pressed }) => [
                styles.playShell,
                portrait && styles.playShellPortrait,
                pressed && styles.pressed,
              ]}
            >
              <LinearGradient
                colors={["#c7fbff", "#22d3ee", "#0ea5e9"]}
                style={styles.playInner}
              >
                <Feather
                  name={chrome.paused ? "play" : "pause"}
                  size={portrait ? 31 : 36}
                  color="#02131b"
                />
              </LinearGradient>
            </Pressable>

            {chrome.mediaKind !== "live" ? (
              <RoundButton
                compact={portrait}
                icon="rotate-cw"
                badge="15"
                label="15 saniye ileri"
                onPress={() => chrome.onSeekBy(15)}
              />
            ) : chrome.canNavigate ? (
              <RoundButton
                compact={portrait}
                icon="skip-forward"
                label="Sonraki kanal"
                onPress={() => chrome.onMoveRelative(1)}
              />
            ) : null}
          </View>
        ) : null}

        {!chrome.panel ? (
          <View
            style={[
              styles.bottom,
              {
                bottom: Math.max(insets.bottom, portrait ? 8 : 12),
                paddingLeft: Math.max(outerPadding, insets.left + 8),
                paddingRight: Math.max(outerPadding, insets.right + 8),
              },
            ]}
            pointerEvents="box-none"
          >
            {chrome.mediaKind !== "live" ? (
              <View
                style={[
                  styles.seekRow,
                  {
                    height: Math.round(32 * progressScale),
                    gap: Math.max(5, Math.round(8 * progressScale)),
                  },
                ]}
              >
                <Text
                  style={[
                    styles.time,
                    { width: timeWidth, fontSize: timeFontSize },
                  ]}
                >
                  {formatTime(chrome.position)}
                </Text>
                <Pressable
                  onLayout={(event: LayoutChangeEvent) =>
                    setSeekWidth(Math.max(1, event.nativeEvent.layout.width))
                  }
                  onPress={(event) =>
                    chrome.onSeekRatio(
                      Math.max(
                        0,
                        Math.min(1, event.nativeEvent.locationX / seekWidth),
                      ),
                    )
                  }
                  style={styles.seekTouch}
                  hitSlop={{ top: 12, bottom: 12, left: 0, right: 0 }}
                >
                  <View style={styles.seekTrack}>
                    <View
                      style={[styles.seekFill, { width: `${progress * 100}%` }]}
                    />
                    <View
                      style={[styles.seekThumb, { left: `${progress * 100}%` }]}
                    />
                  </View>
                </Pressable>
                <Text
                  style={[
                    styles.time,
                    styles.timeRight,
                    { width: timeWidth, fontSize: timeFontSize },
                  ]}
                >
                  {formatTime(chrome.duration)}
                </Text>
              </View>
            ) : null}

            <View style={[styles.dockRow, { gap }]}> 
              {actions.map((action) => (
                <AdaptiveDockButton
                  key={action.key}
                  action={action}
                  size={buttonSize}
                  iconSize={iconSize}
                />
              ))}
            </View>
          </View>
        ) : null}
      </Animated.View>
    </>
  );
}

function InfoCard({
  portrait,
  title,
  meta,
  live,
  tech,
  epgNow,
  epgNext,
}: {
  portrait: boolean;
  title: string;
  meta?: string;
  live: boolean;
  tech?: string;
  epgNow?: PlayerProgramInfo;
  epgNext?: PlayerProgramInfo;
}) {
  return (
    <View pointerEvents="none" style={styles.infoMain}>
      <View style={styles.titleRow}>
        {live ? (
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>CANLI</Text>
          </View>
        ) : null}
        <Text
          numberOfLines={1}
          style={[styles.title, portrait && styles.titlePortrait]}
        >
          {title}
        </Text>
      </View>

      {live && epgNow ? (
        <View style={styles.epgBlock}>
          <Text numberOfLines={1} style={styles.epgNow}>
            Şimdi: {epgNow.title} · {formatRemaining(epgNow.end)}
          </Text>
          {epgNext ? (
            <Text numberOfLines={1} style={styles.epgNext}>
              Sıradaki: {epgNext.title} · {formatClock(epgNext.start)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {(meta || tech) ? (
        <View style={styles.metaRow}>
          {meta ? (
            <Text numberOfLines={1} style={styles.meta}>
              {meta}
            </Text>
          ) : null}
          {tech ? (
            <View style={styles.techPill}>
              <Feather name="monitor" size={10} color="#a5f3fc" />
              <Text numberOfLines={1} style={styles.techText}>
                {tech}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ModeChip({
  icon,
  text,
  accent,
  onPress,
}: {
  icon: FeatherName;
  text: string;
  accent?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeChip,
        accent && styles.modeChipAccent,
        pressed && styles.pressed,
      ]}
    >
      <Feather
        name={icon}
        size={11}
        color={accent ? "#67e8f9" : "#e2e8f0"}
      />
      <Text style={[styles.modeText, accent && styles.modeTextAccent]}>
        {text}
      </Text>
    </Pressable>
  );
}

function RoundButton({
  icon,
  badge,
  compact,
  label,
  onPress,
}: {
  icon: FeatherName;
  badge?: string;
  compact?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.roundButton,
        compact && styles.roundButtonPortrait,
        pressed && styles.pressed,
      ]}
    >
      <Feather name={icon} size={compact ? 24 : 29} color="#fff" />
      {badge ? <Text style={styles.roundBadge}>{badge}</Text> : null}
    </Pressable>
  );
}

function AdaptiveDockButton({
  action,
  size,
  iconSize,
}: {
  action: Action;
  size: number;
  iconSize: number;
}) {
  const highlighted = Boolean(action.active || action.accent);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={action.onPress}
      hitSlop={Math.max(3, Math.ceil((44 - size) / 2))}
      style={({ pressed }) => [
        styles.dockButton,
        {
          width: size,
          height: size,
          borderRadius: Math.max(11, Math.round(size * 0.3)),
        },
        highlighted && styles.dockButtonHighlighted,
        action.active && styles.dockButtonActive,
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
        <Text style={[styles.glyph, highlighted && styles.glyphAccent]}>
          {action.glyph}
        </Text>
      )}
      {action.badge ? (
        <View style={styles.microBadge} pointerEvents="none">
          <Text numberOfLines={1} style={styles.microBadgeText}>
            {action.badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "33%",
  },
  bottomGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "31%",
  },
  info: {
    position: "absolute",
    zIndex: 52,
  },
  infoLandscape: {
    minHeight: 62,
  },
  infoPortrait: {
    minHeight: 54,
  },
  infoMain: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingVertical: 4,
    paddingRight: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    maxWidth: "100%",
  },
  title: {
    flexShrink: 1,
    color: "#fff",
    fontSize: 19,
    fontWeight: "900",
    textShadowColor: "rgba(0,0,0,.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  titlePortrait: {
    fontSize: 16,
  },
  livePill: {
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "rgba(103,232,249,.42)",
    backgroundColor: "rgba(8,145,178,.18)",
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#22d3ee",
  },
  liveText: {
    color: "#c7fbff",
    fontSize: 9,
    fontWeight: "900",
  },
  epgBlock: {
    marginTop: 3,
    maxWidth: "100%",
  },
  epgNow: {
    color: "#f1f5f9",
    fontSize: 11,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,.88)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  epgNext: {
    marginTop: 1,
    color: "#cbd5e1",
    fontSize: 10,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,.88)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  metaRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    maxWidth: "100%",
  },
  meta: {
    flexShrink: 1,
    color: "#cbd5e1",
    fontSize: 10,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  techPill: {
    flexShrink: 1,
    minHeight: 20,
    maxWidth: "66%",
    paddingHorizontal: 7,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "rgba(103,232,249,.22)",
    backgroundColor: "rgba(3,12,20,.34)",
  },
  techText: {
    color: "#dffaff",
    fontSize: 9,
    fontWeight: "800",
  },
  modeCluster: {
    position: "absolute",
    zIndex: 64,
    flexDirection: "row",
    gap: 6,
  },
  modeChip: {
    height: 30,
    minWidth: 58,
    paddingHorizontal: 9,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "rgba(226,232,240,.24)",
    backgroundColor: "rgba(3,10,18,.42)",
  },
  modeChipAccent: {
    borderColor: "rgba(34,211,238,.34)",
    backgroundColor: "rgba(8,145,178,.13)",
  },
  modeText: {
    color: "#f1f5f9",
    fontSize: 9,
    fontWeight: "900",
  },
  modeTextAccent: {
    color: "#a5f3fc",
  },
  back: {
    position: "absolute",
    zIndex: 65,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(3,10,18,.42)",
    borderWidth: 1,
    borderColor: "rgba(226,232,240,.22)",
    elevation: 6,
  },
  backLandscape: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  backPortrait: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
    gap: 54,
  },
  centerPortrait: {
    top: "48%",
    transform: [{ translateY: -38 }],
    gap: 28,
  },
  roundButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(3,10,18,.48)",
    borderWidth: 1,
    borderColor: "rgba(226,232,240,.22)",
    elevation: 5,
  },
  roundButtonPortrait: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  roundBadge: {
    position: "absolute",
    color: "#fff",
    fontSize: 9,
    fontWeight: "900",
  },
  playShell: {
    width: 82,
    height: 82,
    borderRadius: 41,
    padding: 5,
    backgroundColor: "rgba(34,211,238,.14)",
    borderWidth: 1,
    borderColor: "rgba(103,232,249,.52)",
    elevation: 8,
  },
  playShellPortrait: {
    width: 72,
    height: 72,
    borderRadius: 36,
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
  },
  seekRow: {
    width: "100%",
    marginBottom: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  time: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    textShadowColor: "rgba(0,0,0,.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
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
    backgroundColor: "rgba(226,232,240,.32)",
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
  dockRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  dockButton: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(226,232,240,.08)",
    backgroundColor: "rgba(3,10,18,.36)",
  },
  dockButtonHighlighted: {
    borderColor: "rgba(34,211,238,.28)",
    backgroundColor: "rgba(8,145,178,.11)",
  },
  dockButtonActive: {
    borderColor: "rgba(103,232,249,.66)",
    backgroundColor: "rgba(8,145,178,.18)",
  },
  glyph: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },
  glyphAccent: {
    color: "#8beeff",
  },
  microBadge: {
    position: "absolute",
    right: 2,
    bottom: 2,
    minWidth: 23,
    maxWidth: 42,
    height: 15,
    paddingHorizontal: 3,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8,47,73,.9)",
    borderWidth: 1,
    borderColor: "rgba(103,232,249,.5)",
  },
  microBadgeText: {
    color: "#a5f3fc",
    fontSize: 7,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.96 }],
  },
});