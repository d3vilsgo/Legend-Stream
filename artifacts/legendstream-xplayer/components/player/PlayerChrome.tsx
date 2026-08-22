import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState, useSyncExternalStore } from "react";
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

const initializedPlayers = new WeakSet<Function>();
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

const fitLabel = (mode: PlayerFitMode) =>
  mode === "full"
    ? "FULL"
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

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function PlayerChrome(props: Props) {
  const { width, height } = useWindowDimensions();
  const portrait = height > width;
  const [seekWidth, setSeekWidth] = useState(1);
  const runtime = useSyncExternalStore(
    subscribePlayerRuntimeInfo,
    getPlayerRuntimeInfoSnapshot,
    getPlayerRuntimeInfoSnapshot,
  );
  const { resolution: resolutionOverride, fps: fpsOverride, ...chrome } = props;

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
  const technicalLabel = resolution
    ? `${resolution}${fps ? ` · ${formatFps(fps)} FPS` : ""}`
    : fps
      ? `${formatFps(fps)} FPS`
      : undefined;

  const progress = chrome.duration > 0
    ? Math.max(0, Math.min(1, chrome.position / chrome.duration))
    : 0;

  const actions: Action[] = [
    ...(chrome.selectableItems.length ? [{
      key: "list",
      label: chrome.mediaKind === "live" ? "Kanal listesi" : "İçerik listesi",
      icon: "list" as FeatherName,
      active: chrome.panel === "content",
      onPress: () => chrome.onTogglePanel("content"),
    }] : []),
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
    ...(chrome.pipSupported ? [{
      key: "pip",
      label: "Picture in Picture",
      glyph: "PiP",
      onPress: chrome.onEnterPip,
    }] : []),
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
    ...(chrome.allowDownload ? [{
      key: "download",
      label: chrome.downloadState === "done" ? "İndirildi" : "İndir",
      icon: (chrome.downloadState === "done"
        ? "check-circle"
        : chrome.downloadState === "error"
          ? "alert-circle"
          : "download") as FeatherName,
      active: chrome.downloadState === "done",
      onPress: chrome.onDownload,
    }] : []),
  ];

  // Every action stays visible. The controls scale down/up with the current
  // viewport instead of scrolling, paging or opening a secondary toolbar.
  const dockHorizontalInset = portrait ? 18 : 54;
  const gap = portrait ? 3 : 6;
  const availableWidth = Math.max(250, width - dockHorizontalInset);
  const buttonSize = clamp(
    Math.floor(
      (availableWidth - gap * Math.max(0, actions.length - 1) - 12) /
      Math.max(1, actions.length),
    ),
    32,
    portrait ? 46 : 52,
  );
  const iconSize = clamp(Math.round(buttonSize * 0.46), 17, 23);
  const dockHeight = buttonSize + 14;

  return (
    <>
      <PlayerChromeV2 {...chrome} controlsVisible={false} infoVisible={false} />

      {(chrome.controlsVisible || chrome.infoVisible) ? (
        <>
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(0,0,0,.64)", "rgba(0,0,0,.16)", "rgba(0,0,0,0)"]}
            style={styles.topShade}
          />
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(0,0,0,0)", "rgba(0,0,0,.14)", "rgba(0,0,0,.7)"]}
            style={styles.bottomShade}
          />
        </>
      ) : null}

      {chrome.infoVisible ? (
        <InfoCard
          portrait={portrait}
          title={chrome.title}
          meta={chrome.meta}
          live={chrome.mediaKind === "live"}
          technicalLabel={technicalLabel}
          fit={chrome.fitMode}
          codec={chrome.codecMode}
        />
      ) : null}

      {chrome.controlsVisible && chrome.canExit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Oynatıcıdan çık"
          onPress={chrome.onExit}
          style={({ pressed }) => [
            styles.backButton,
            portrait ? styles.backPortrait : styles.backLandscape,
            pressed && styles.pressed,
          ]}
          hitSlop={10}
        >
          <Feather name="arrow-left" size={portrait ? 24 : 27} color="#fff" />
        </Pressable>
      ) : null}

      {chrome.controlsVisible && !chrome.panel ? (
        <View
          style={[styles.centerControls, portrait ? styles.centerPortrait : styles.centerLandscape]}
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
              portrait && styles.playPortrait,
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

      {chrome.controlsVisible && !chrome.panel ? (
        <View
          style={[styles.bottomArea, portrait ? styles.bottomPortrait : styles.bottomLandscape]}
          pointerEvents="box-none"
        >
          {chrome.mediaKind !== "live" ? (
            <View style={styles.seekRow}>
              <Text style={styles.timeText}>{formatTime(chrome.position)}</Text>
              <Pressable
                onLayout={(event: LayoutChangeEvent) =>
                  setSeekWidth(Math.max(1, event.nativeEvent.layout.width))}
                onPress={(event) => chrome.onSeekRatio(
                  Math.max(0, Math.min(1, event.nativeEvent.locationX / seekWidth)),
                )}
                style={styles.seekTouch}
                hitSlop={{ top: 12, bottom: 12, left: 0, right: 0 }}
              >
                <View style={styles.seekTrack}>
                  <View style={[styles.seekFill, { width: `${progress * 100}%` }]} />
                  <View style={[styles.seekThumb, { left: `${progress * 100}%` }]} />
                </View>
              </Pressable>
              <Text style={[styles.timeText, styles.timeRight]}>{formatTime(chrome.duration)}</Text>
            </View>
          ) : null}

          <View style={[styles.dockShell, { minHeight: dockHeight }]}> 
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(12,22,33,.97)", "rgba(4,9,15,.98)"]}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={styles.dockGlow} pointerEvents="none" />
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
        </View>
      ) : null}
    </>
  );
}

function InfoCard({
  portrait,
  title,
  meta,
  live,
  technicalLabel,
  fit,
  codec,
}: {
  portrait: boolean;
  title: string;
  meta?: string;
  live: boolean;
  technicalLabel?: string;
  fit: PlayerFitMode;
  codec: Props["codecMode"];
}) {
  return (
    <View
      pointerEvents="none"
      style={[styles.infoCard, portrait ? styles.infoPortrait : styles.infoLandscape]}
    >
      <LinearGradient
        colors={["rgba(5,14,23,.97)", "rgba(5,12,20,.88)"]}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.infoRail} />
      <View style={styles.infoMain}>
        <View style={styles.titleRow}>
          {live ? (
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>CANLI</Text>
            </View>
          ) : null}
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.infoTitle, portrait && styles.infoTitlePortrait]}
          >
            {title}
          </Text>
        </View>
        <View style={styles.metaRow}>
          {meta ? <Text numberOfLines={1} style={styles.metaText}>{meta}</Text> : null}
          <View style={[styles.techPill, !technicalLabel && styles.techPillMuted]}>
            <Feather
              name="monitor"
              size={11}
              color={technicalLabel ? "#67e8f9" : "#64748b"}
            />
            <Text
              numberOfLines={1}
              style={technicalLabel ? styles.techText : styles.techMutedText}
            >
              {technicalLabel ?? "Akış bilgisi bekleniyor"}
            </Text>
          </View>
        </View>
      </View>
      {!portrait ? (
        <View style={styles.modeCluster}>
          <ModeChip icon="maximize-2" text={fitLabel(fit)} />
          <ModeChip icon="cpu" text={playerCodecLabel(codec)} accent />
        </View>
      ) : null}
    </View>
  );
}

function ModeChip({ icon, text, accent }: { icon: FeatherName; text: string; accent?: boolean }) {
  return (
    <View style={[styles.modeChip, accent && styles.modeChipAccent]}>
      <Feather name={icon} size={11} color={accent ? "#67e8f9" : "#cbd5e1"} />
      <Text style={[styles.modeText, accent && styles.modeTextAccent]}>{text}</Text>
    </View>
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
      hitSlop={2}
      style={({ pressed }) => [
        styles.dockButton,
        {
          width: size,
          height: size,
          borderRadius: Math.max(10, Math.round(size * 0.3)),
        },
        highlighted && styles.dockHighlighted,
        action.active && styles.dockActive,
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
        <Text style={[styles.glyphText, highlighted && styles.glyphAccent]}>{action.glyph}</Text>
      )}
      {action.badge ? (
        <View style={styles.microBadge} pointerEvents="none">
          <Text numberOfLines={1} style={styles.microBadgeText}>{action.badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topShade: { position: "absolute", zIndex: 40, top: 0, left: 0, right: 0, height: 126 },
  bottomShade: { position: "absolute", zIndex: 40, bottom: 0, left: 0, right: 0, height: 150 },
  infoCard: {
    position: "absolute",
    zIndex: 52,
    top: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(71,101,124,.44)",
    backgroundColor: "rgba(5,12,20,.9)",
    elevation: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  infoLandscape: { left: 92, right: 18, minHeight: 58, borderRadius: 18, paddingLeft: 17, paddingRight: 13 },
  infoPortrait: { left: 70, right: 12, minHeight: 64, borderRadius: 17, paddingLeft: 13, paddingRight: 10 },
  infoRail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: "#22d3ee" },
  infoMain: { flex: 1, minWidth: 0, paddingVertical: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  livePill: { height: 22, paddingHorizontal: 8, borderRadius: 11, flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: "rgba(34,211,238,.38)", backgroundColor: "rgba(8,145,178,.16)" },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22d3ee" },
  liveText: { color: "#8beeff", fontSize: 10, fontWeight: "900" },
  infoTitle: { flex: 1, minWidth: 0, color: "#f8fafc", fontSize: 18, fontWeight: "900" },
  infoTitlePortrait: { fontSize: 15 },
  metaRow: { marginTop: 5, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  metaText: { flexShrink: 1, color: "#94a3b8", fontSize: 11, fontWeight: "700" },
  techPill: { flexShrink: 0, minHeight: 22, maxWidth: "68%", paddingHorizontal: 7, borderRadius: 11, flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: "rgba(103,232,249,.3)", backgroundColor: "rgba(8,145,178,.12)" },
  techPillMuted: { borderColor: "transparent", backgroundColor: "transparent" },
  techText: { color: "#dffaff", fontSize: 10, fontWeight: "900" },
  techMutedText: { color: "#64748b", fontSize: 9, fontWeight: "700" },
  modeCluster: { marginLeft: 10, flexDirection: "row", gap: 6 },
  modeChip: { height: 29, minWidth: 62, paddingHorizontal: 9, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderWidth: 1, borderColor: "rgba(148,163,184,.22)", backgroundColor: "rgba(15,23,42,.66)" },
  modeChipAccent: { borderColor: "rgba(34,211,238,.38)", backgroundColor: "rgba(8,145,178,.12)" },
  modeText: { color: "#e2e8f0", fontSize: 10, fontWeight: "900" },
  modeTextAccent: { color: "#8beeff" },
  backButton: { position: "absolute", zIndex: 65, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5,12,20,.88)", borderWidth: 1, borderColor: "rgba(148,163,184,.28)", elevation: 12 },
  backLandscape: { left: 20, top: 16, width: 54, height: 54, borderRadius: 27 },
  backPortrait: { left: 14, top: 16, width: 46, height: 46, borderRadius: 23 },
  centerControls: { position: "absolute", zIndex: 60, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  centerLandscape: { top: "50%", transform: [{ translateY: -43 }], gap: 50 },
  centerPortrait: { top: "48%", transform: [{ translateY: -37 }], gap: 26 },
  roundButton: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5,12,20,.72)", borderWidth: 1, borderColor: "rgba(148,163,184,.32)", elevation: 7 },
  roundButtonPortrait: { width: 52, height: 52, borderRadius: 26 },
  roundBadge: { position: "absolute", color: "#fff", fontSize: 9, fontWeight: "900" },
  playShell: { width: 84, height: 84, borderRadius: 42, padding: 5, backgroundColor: "rgba(34,211,238,.18)", borderWidth: 1, borderColor: "rgba(103,232,249,.58)", elevation: 14 },
  playPortrait: { width: 72, height: 72, borderRadius: 36 },
  playInner: { flex: 1, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  bottomArea: { position: "absolute", zIndex: 62, left: 0, right: 0 },
  bottomLandscape: { bottom: 14, paddingHorizontal: 26 },
  bottomPortrait: { bottom: 12, paddingHorizontal: 8 },
  seekRow: { width: "100%", height: 31, marginBottom: 6, flexDirection: "row", alignItems: "center", gap: 8 },
  timeText: { width: 54, color: "#fff", fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  timeRight: { textAlign: "right" },
  seekTouch: { flex: 1, height: 28, justifyContent: "center" },
  seekTrack: { height: 4, borderRadius: 2, backgroundColor: "rgba(226,232,240,.3)", overflow: "visible" },
  seekFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: "#22d3ee" },
  seekThumb: { position: "absolute", top: -4, marginLeft: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: "#67e8f9", borderWidth: 2, borderColor: "#e6fcff" },
  dockShell: { width: "100%", overflow: "hidden", borderRadius: 20, borderWidth: 1, borderColor: "rgba(71,101,124,.46)", backgroundColor: "#050b12", elevation: 12, justifyContent: "center" },
  dockGlow: { position: "absolute", left: 18, right: 18, top: 0, height: 1, backgroundColor: "rgba(103,232,249,.54)" },
  dockRow: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "space-evenly", paddingHorizontal: 6, paddingVertical: 6 },
  dockButton: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent", backgroundColor: "rgba(15,23,42,.48)" },
  dockHighlighted: { borderColor: "rgba(34,211,238,.3)", backgroundColor: "rgba(8,145,178,.12)" },
  dockActive: { borderColor: "rgba(103,232,249,.72)", backgroundColor: "rgba(8,145,178,.2)" },
  glyphText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  glyphAccent: { color: "#8beeff" },
  microBadge: { position: "absolute", right: 1, bottom: 1, minWidth: 22, maxWidth: 40, height: 14, paddingHorizontal: 3, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(8,47,73,.96)", borderWidth: 1, borderColor: "rgba(103,232,249,.58)" },
  microBadgeText: { color: "#a5f3fc", fontSize: 7, fontWeight: "900" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.96 }] },
});
