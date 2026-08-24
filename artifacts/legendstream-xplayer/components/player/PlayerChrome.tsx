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
  title?: string;
  start?: number;
  end?: number;
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

const safeTimestamp = (value?: number) =>
  Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : undefined;

const safeProgramTitle = (value?: string) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text || "Program bilgisi";
};

const formatClock = (timestamp?: number) => {
  const safe = safeTimestamp(timestamp);
  if (!safe) return "--:--";
  try {
    return new Date(safe).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "--:--";
  }
};

const formatRemaining = (end?: number) => {
  const safe = safeTimestamp(end);
  if (!safe) return "";
  const minutes = Math.max(0, Math.ceil((safe - Date.now()) / 60_000));
  return minutes > 0 ? `${minutes} dk kaldı` : `bitiş ${formatClock(safe)}`;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

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
    epgLoading,
    ...chrome
  } = props;
  const controlsOpacity = useRef(new Animated.Value(chrome.controlsVisible ? 1 : 0)).current;
  const infoOpacity = useRef(new Animated.Value(chrome.infoVisible ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(controlsOpacity, {
      toValue: chrome.controlsVisible ? 1 : 0,
      duration: chrome.controlsVisible ? 170 : 240,
      useNativeDriver: true,
    }).start();
  }, [chrome.controlsVisible, controlsOpacity]);

  useEffect(() => {
    Animated.timing(infoOpacity, {
      toValue: chrome.infoVisible ? 1 : 0,
      duration: chrome.infoVisible ? 190 : 260,
      useNativeDriver: true,
    }).start();
  }, [chrome.infoVisible, infoOpacity]);

  const resolution = resolutionOverride ?? runtime.resolution;
  const fps = fpsOverride ?? runtime.fps;
  const streamCodec = codecOverride ?? runtime.codec;
  const technicalParts = [
    resolution,
    streamCodec,
    fps ? `${formatFps(fps)} FPS` : undefined,
  ].filter(Boolean);
  const technicalLabel = technicalParts.length ? technicalParts.join(" · ") : undefined;

  const progress = chrome.duration > 0
    ? Math.max(0, Math.min(1, chrome.position / chrome.duration))
    : 0;
  const showCenter = chrome.controlsVisible && !chrome.panel;

  const actions: Action[] = [
    ...(chrome.selectableItems.length ? [{
      key: "list",
      label: chrome.mediaKind === "live" ? "Kanallar" : "Liste",
      icon: "list" as FeatherName,
      active: chrome.panel === "content",
      onPress: () => chrome.onTogglePanel("content"),
    }] : []),
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

  const gap = portrait ? 2 : 5;
  const outerPadding = portrait ? 8 : 20;
  const safeHorizontal = insets.left + insets.right;
  const dockInnerPadding = 12;
  const availableWidth = Math.max(1, width - safeHorizontal - outerPadding * 2 - dockInnerPadding);
  const buttonSize = clamp(
    Math.floor((availableWidth - gap * Math.max(0, actions.length - 1)) / Math.max(1, actions.length)),
    30,
    portrait ? 46 : 54,
  );
  const iconSize = clamp(Math.round(buttonSize * 0.46), 15, 24);
  const dockHeight = buttonSize + (portrait ? 12 : 16);
  const progressScale = clamp(width / (portrait ? 390 : 840), 0.82, 1.2);
  const timeWidth = clamp(Math.round(54 * progressScale), 44, 64);
  const timeFontSize = clamp(Math.round(11 * progressScale), 9, 13);

  return (
    <>
      <PlayerChromeV2 {...chrome} controlsVisible={false} infoVisible={false} />

      <InfoCard
        opacity={infoOpacity}
        portrait={portrait}
        title={chrome.title}
        meta={chrome.meta}
        live={chrome.mediaKind === "live"}
        tech={technicalLabel}
        fit={chrome.fitMode}
        codec={chrome.codecMode}
        epgNow={epgNow}
        epgNext={epgNext}
        epgLoading={epgLoading}
      />

      {chrome.controlsVisible && chrome.canExit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Oynatıcıdan çık"
          onPress={chrome.onExit}
          style={({ pressed }) => [
            styles.back,
            portrait ? styles.backPortrait : styles.backLandscape,
            pressed && styles.pressed,
          ]}
          hitSlop={10}
        >
          <LinearGradient pointerEvents="none" colors={["rgba(255,255,255,.12)", "rgba(7,18,29,.26)"]} style={StyleSheet.absoluteFillObject} />
          <Feather name="arrow-left" size={portrait ? 24 : 27} color="#fff" />
        </Pressable>
      ) : null}

      {!chrome.panel ? (
        <Animated.View
          style={[
            styles.center,
            portrait ? styles.centerPortrait : styles.centerLandscape,
            { opacity: controlsOpacity },
          ]}
          pointerEvents={showCenter ? "box-none" : "none"}
        >
          {chrome.mediaKind !== "live" ? (
            <RoundButton compact={portrait} icon="rotate-ccw" badge="10" label="10 saniye geri" onPress={() => chrome.onSeekBy(-10)} />
          ) : chrome.canNavigate ? (
            <RoundButton compact={portrait} icon="skip-back" label="Önceki kanal" onPress={() => chrome.onMoveRelative(-1)} />
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={chrome.paused ? "Oynat" : "Duraklat"}
            onPress={chrome.onTogglePause}
            style={({ pressed }) => [styles.playShell, portrait && styles.playShellPortrait, pressed && styles.pressed]}
          >
            <LinearGradient pointerEvents="none" colors={["rgba(199,251,255,.96)", "rgba(34,211,238,.9)", "rgba(14,165,233,.92)"]} style={styles.playInner}>
              <Feather name={chrome.paused ? "play" : "pause"} size={portrait ? 31 : 36} color="#02131b" />
            </LinearGradient>
          </Pressable>

          {chrome.mediaKind !== "live" ? (
            <RoundButton compact={portrait} icon="rotate-cw" badge="15" label="15 saniye ileri" onPress={() => chrome.onSeekBy(15)} />
          ) : chrome.canNavigate ? (
            <RoundButton compact={portrait} icon="skip-forward" label="Sonraki kanal" onPress={() => chrome.onMoveRelative(1)} />
          ) : null}
        </Animated.View>
      ) : null}

      {!chrome.panel ? (
        <Animated.View
          style={[
            styles.bottom,
            portrait ? styles.bottomPortrait : styles.bottomLandscape,
            {
              opacity: controlsOpacity,
              bottom: Math.max(insets.bottom, portrait ? 8 : 12),
              paddingLeft: Math.max(outerPadding, insets.left + 8),
              paddingRight: Math.max(outerPadding, insets.right + 8),
            },
          ]}
          pointerEvents={chrome.controlsVisible ? "box-none" : "none"}
        >
          {chrome.mediaKind !== "live" ? (
            <View style={[styles.seekRow, { height: Math.round(32 * progressScale), gap: Math.max(5, Math.round(8 * progressScale)) }]}>
              <Text style={[styles.time, { width: timeWidth, fontSize: timeFontSize }]}>{formatTime(chrome.position)}</Text>
              <Pressable
                onLayout={(event: LayoutChangeEvent) => setSeekWidth(Math.max(1, event.nativeEvent.layout.width))}
                onPress={(event) => chrome.onSeekRatio(Math.max(0, Math.min(1, event.nativeEvent.locationX / seekWidth)))}
                style={styles.seekTouch}
                hitSlop={{ top: 12, bottom: 12, left: 0, right: 0 }}
              >
                <View style={styles.seekTrack}>
                  <View style={[styles.seekFill, { width: `${progress * 100}%` }]} />
                  <View style={[styles.seekThumb, { left: `${progress * 100}%` }]} />
                </View>
              </Pressable>
              <Text style={[styles.time, styles.timeRight, { width: timeWidth, fontSize: timeFontSize }]}>{formatTime(chrome.duration)}</Text>
            </View>
          ) : null}

          <View style={[styles.dockShell, { minHeight: dockHeight }]}>
            <LinearGradient pointerEvents="none" colors={["rgba(34,211,238,.12)", "rgba(8,18,30,.52)", "rgba(2,8,16,.42)"]} style={StyleSheet.absoluteFillObject} />
            <View pointerEvents="none" style={styles.dockGlow} />
            <View style={[styles.dockRow, { gap }]}>
              {actions.map((action) => (
                <AdaptiveDockButton key={action.key} action={action} size={buttonSize} iconSize={iconSize} />
              ))}
            </View>
          </View>
        </Animated.View>
      ) : null}
    </>
  );
}

function InfoCard({ opacity, portrait, title, meta, live, tech, fit, codec, epgNow, epgNext, epgLoading }: {
  opacity: Animated.Value;
  portrait: boolean;
  title: string;
  meta?: string;
  live: boolean;
  tech?: string;
  fit: PlayerFitMode;
  codec: Props["codecMode"];
  epgNow?: PlayerProgramInfo;
  epgNext?: PlayerProgramInfo;
  epgLoading?: boolean;
}) {
  const nowTitle = safeProgramTitle(epgNow?.title);
  const nowEnd = safeTimestamp(epgNow?.end);
  const nextTitle = safeProgramTitle(epgNext?.title);
  const nextStart = safeTimestamp(epgNext?.start);
  const remaining = formatRemaining(nowEnd);

  return (
    <Animated.View pointerEvents="none" style={[styles.info, portrait ? styles.infoPortrait : styles.infoLandscape, { opacity }]}>
      <LinearGradient pointerEvents="none" colors={["rgba(34,211,238,.1)", "rgba(7,17,28,.48)", "rgba(3,10,18,.38)"]} style={StyleSheet.absoluteFillObject} />
      <View pointerEvents="none" style={styles.infoHighlight} />
      <View pointerEvents="none" style={styles.infoRail} />
      <View style={styles.infoMain}>
        <View style={styles.titleRow}>
          {live ? <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>CANLI</Text></View> : null}
          <Text numberOfLines={1} style={[styles.title, portrait && styles.titlePortrait]}>{title || "Canlı yayın"}</Text>
        </View>
        {live ? (
          <View style={styles.epgBlock}>
            {epgLoading && !epgNow ? (
              <Text numberOfLines={1} style={styles.epgMuted}>Program bilgisi yükleniyor…</Text>
            ) : epgNow ? (
              <>
                <Text numberOfLines={1} style={styles.epgNow}>Şimdi: {nowTitle} · {formatClock(nowEnd)}{remaining ? ` · ${remaining}` : ""}</Text>
                {epgNext ? <Text numberOfLines={1} style={styles.epgNext}>Sıradaki: {nextTitle} · {formatClock(nextStart)}</Text> : null}
              </>
            ) : (
              <Text numberOfLines={1} style={styles.epgMuted}>Program bilgisi yok</Text>
            )}
          </View>
        ) : null}
        <View style={styles.metaRow}>
          {meta ? <Text numberOfLines={1} style={styles.meta}>{meta}</Text> : null}
          <View style={[styles.techPill, !tech && styles.techPillMuted]}>
            <Feather name="monitor" size={11} color={tech ? "#67e8f9" : "#94a3b8"} />
            <Text numberOfLines={1} style={tech ? styles.techText : styles.techMutedText}>{tech ?? "Akış bilgisi bekleniyor"}</Text>
          </View>
        </View>
      </View>
      {!portrait ? (
        <View style={styles.modeCluster}>
          <ModeChip icon="maximize-2" text={fitLabel(fit)} />
          <ModeChip icon="cpu" text={playerCodecLabel(codec)} accent />
        </View>
      ) : null}
    </Animated.View>
  );
}

function ModeChip({ icon, text, accent }: { icon: FeatherName; text: string; accent?: boolean }) {
  return <View style={[styles.modeChip, accent && styles.modeChipAccent]}><Feather name={icon} size={11} color={accent ? "#67e8f9" : "#e2e8f0"} /><Text style={[styles.modeText, accent && styles.modeTextAccent]}>{text}</Text></View>;
}

function RoundButton({ icon, badge, compact, label, onPress }: { icon: FeatherName; badge?: string; compact?: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.roundButton, compact && styles.roundButtonPortrait, pressed && styles.pressed]}><LinearGradient pointerEvents="none" colors={["rgba(255,255,255,.15)", "rgba(7,20,33,.28)"]} style={StyleSheet.absoluteFillObject} /><Feather name={icon} size={compact ? 24 : 29} color="#fff" />{badge ? <Text style={styles.roundBadge}>{badge}</Text> : null}</Pressable>;
}

function AdaptiveDockButton({ action, size, iconSize }: { action: Action; size: number; iconSize: number }) {
  const highlighted = Boolean(action.active || action.accent);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={action.onPress}
      hitSlop={Math.max(3, Math.ceil((44 - size) / 2))}
      style={({ pressed }) => [
        styles.dockButton,
        { width: size, height: size, borderRadius: Math.max(11, Math.round(size * 0.3)) },
        highlighted && styles.dockButtonHighlighted,
        action.active && styles.dockButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <LinearGradient pointerEvents="none" colors={highlighted ? ["rgba(103,232,249,.18)", "rgba(8,145,178,.08)"] : ["rgba(255,255,255,.09)", "rgba(15,23,42,.16)"]} style={StyleSheet.absoluteFillObject} />
      {action.icon ? <Feather name={action.icon} size={iconSize} color={highlighted ? "#8beeff" : "#f8fafc"} /> : <Text style={[styles.glyph, highlighted && styles.glyphAccent]}>{action.glyph}</Text>}
      {action.badge ? <View style={styles.microBadge} pointerEvents="none"><Text numberOfLines={1} style={styles.microBadgeText}>{action.badge}</Text></View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  info: { position: "absolute", zIndex: 52, top: 18, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,.2)", backgroundColor: "rgba(4,12,21,.34)", elevation: 5, shadowColor: "#000", shadowOpacity: 0.24, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, flexDirection: "row", alignItems: "center" },
  infoLandscape: { left: 94, right: 24, minHeight: 78, borderRadius: 20, paddingLeft: 18, paddingRight: 14 },
  infoPortrait: { left: 72, right: 14, minHeight: 88, borderRadius: 20, paddingLeft: 14, paddingRight: 10 },
  infoHighlight: { position: "absolute", left: 14, right: 14, top: 0, height: 1, backgroundColor: "rgba(255,255,255,.34)" },
  infoRail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: "rgba(34,211,238,.88)" },
  infoMain: { flex: 1, minWidth: 0, paddingVertical: 9 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  title: { flex: 1, color: "#f8fafc", fontSize: 18, fontWeight: "900" },
  titlePortrait: { fontSize: 15 },
  livePill: { height: 23, paddingHorizontal: 8, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: "rgba(103,232,249,.42)", backgroundColor: "rgba(8,145,178,.18)" },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22d3ee" },
  liveText: { color: "#b8f7ff", fontSize: 10, fontWeight: "900" },
  epgBlock: { marginTop: 4, minWidth: 0 },
  epgNow: { color: "#f1f5f9", fontSize: 11, fontWeight: "800" },
  epgNext: { marginTop: 1, color: "#cbd5e1", fontSize: 10, fontWeight: "700" },
  epgMuted: { color: "#94a3b8", fontSize: 10, fontWeight: "700" },
  metaRow: { marginTop: 5, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  meta: { flexShrink: 1, color: "#cbd5e1", fontSize: 11, fontWeight: "700" },
  techPill: { flexShrink: 0, minHeight: 22, maxWidth: "62%", paddingHorizontal: 7, borderRadius: 11, flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: "rgba(103,232,249,.3)", backgroundColor: "rgba(8,145,178,.1)" },
  techPillMuted: { borderColor: "rgba(255,255,255,.1)", backgroundColor: "rgba(255,255,255,.04)" },
  techText: { color: "#dffaff", fontSize: 10, fontWeight: "900" },
  techMutedText: { color: "#94a3b8", fontSize: 9, fontWeight: "700" },
  modeCluster: { marginLeft: 10, flexDirection: "row", gap: 6 },
  modeChip: { height: 29, minWidth: 62, paddingHorizontal: 9, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderWidth: 1, borderColor: "rgba(255,255,255,.16)", backgroundColor: "rgba(255,255,255,.06)" },
  modeChipAccent: { borderColor: "rgba(103,232,249,.4)", backgroundColor: "rgba(8,145,178,.12)" },
  modeText: { color: "#f1f5f9", fontSize: 10, fontWeight: "900" },
  modeTextAccent: { color: "#a5f3fc" },
  back: { position: "absolute", zIndex: 65, alignItems: "center", justifyContent: "center", overflow: "hidden", backgroundColor: "rgba(5,12,20,.28)", borderWidth: 1, borderColor: "rgba(255,255,255,.22)", elevation: 7, shadowColor: "#000", shadowOpacity: 0.24, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  backLandscape: { left: 22, top: 20, width: 56, height: 56, borderRadius: 28 },
  backPortrait: { left: 16, top: 20, width: 48, height: 48, borderRadius: 24 },
  center: { position: "absolute", zIndex: 60, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  centerLandscape: { top: "50%", transform: [{ translateY: -44 }], gap: 54 },
  centerPortrait: { top: "48%", transform: [{ translateY: -38 }], gap: 28 },
  roundButton: { width: 66, height: 66, borderRadius: 33, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5,12,20,.2)", borderWidth: 1, borderColor: "rgba(255,255,255,.24)", elevation: 5, shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  roundButtonPortrait: { width: 54, height: 54, borderRadius: 27 },
  roundBadge: { position: "absolute", color: "#fff", fontSize: 9, fontWeight: "900" },
  playShell: { width: 86, height: 86, borderRadius: 43, padding: 5, backgroundColor: "rgba(34,211,238,.12)", borderWidth: 1, borderColor: "rgba(207,250,254,.62)", elevation: 10, shadowColor: "#22d3ee", shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 7 } },
  playShellPortrait: { width: 74, height: 74, borderRadius: 37 },
  playInner: { flex: 1, borderRadius: 999, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  bottom: { position: "absolute", zIndex: 62, left: 0, right: 0 },
  bottomLandscape: {},
  bottomPortrait: {},
  seekRow: { width: "100%", height: 32, marginBottom: 7, flexDirection: "row", alignItems: "center", gap: 8 },
  time: { width: 54, color: "#fff", fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  timeRight: { textAlign: "right" },
  seekTouch: { flex: 1, height: 28, justifyContent: "center" },
  seekTrack: { height: 4, borderRadius: 2, backgroundColor: "rgba(226,232,240,.28)", overflow: "visible" },
  seekFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: "#22d3ee" },
  seekThumb: { position: "absolute", top: -4, marginLeft: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: "#67e8f9", borderWidth: 2, borderColor: "#e6fcff" },
  dockShell: { width: "100%", alignSelf: "center", overflow: "hidden", borderRadius: 24, borderWidth: 1, borderColor: "rgba(255,255,255,.2)", backgroundColor: "rgba(3,10,18,.28)", elevation: 7, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, justifyContent: "center" },
  dockGlow: { position: "absolute", left: 18, right: 18, top: 0, height: 1, backgroundColor: "rgba(207,250,254,.5)" },
  dockRow: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 6, paddingVertical: 6 },
  dockButton: { alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,.12)", backgroundColor: "rgba(255,255,255,.045)" },
  dockButtonHighlighted: { borderColor: "rgba(103,232,249,.34)", backgroundColor: "rgba(8,145,178,.08)" },
  dockButtonActive: { borderColor: "rgba(165,243,252,.72)", backgroundColor: "rgba(8,145,178,.18)" },
  glyph: { color: "#fff", fontSize: 15, fontWeight: "900" },
  glyphAccent: { color: "#8beeff" },
  microBadge: { position: "absolute", right: 2, bottom: 2, minWidth: 23, maxWidth: 42, height: 15, paddingHorizontal: 3, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(8,47,73,.72)", borderWidth: 1, borderColor: "rgba(103,232,249,.54)" },
  microBadgeText: { color: "#a5f3fc", fontSize: 7, fontWeight: "900" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.96 }] },
});