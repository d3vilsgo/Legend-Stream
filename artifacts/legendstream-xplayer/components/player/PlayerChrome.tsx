import { Feather } from "@expo/vector-icons";
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

const TEXT_SHADOW = {
  textShadowColor: "rgba(0,0,0,.95)",
  textShadowOffset: { width: 0, height: 2 },
  textShadowRadius: 6,
} as const;

const ICON_SHADOW = {
  textShadowColor: "rgba(0,0,0,.95)",
  textShadowOffset: { width: 0, height: 2 },
  textShadowRadius: 7,
} as const;

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
      duration: chrome.controlsVisible ? 150 : 210,
      useNativeDriver: true,
    }).start();
  }, [chrome.controlsVisible, controlsOpacity]);

  useEffect(() => {
    Animated.timing(infoOpacity, {
      toValue: chrome.infoVisible ? 1 : 0,
      duration: chrome.infoVisible ? 160 : 220,
      useNativeDriver: true,
    }).start();
  }, [chrome.infoVisible, infoOpacity]);

  const resolution = resolutionOverride ?? runtime.resolution;
  const fps = fpsOverride ?? runtime.fps;
  const streamCodec = codecOverride ?? runtime.codec;
  const technicalParts = [resolution, streamCodec, fps ? `${formatFps(fps)} FPS` : undefined].filter(Boolean);
  const technicalLabel = technicalParts.length ? technicalParts.join(" · ") : undefined;
  const progress = chrome.duration > 0 ? clamp(chrome.position / chrome.duration, 0, 1) : 0;
  const showCenter = chrome.controlsVisible && !chrome.panel;

  const actions: Action[] = [
    ...(chrome.selectableItems.length ? [{
      key: "list",
      label: chrome.mediaKind === "live" ? "Kanallar" : "Liste",
      icon: "list" as FeatherName,
      active: chrome.panel === "content",
      onPress: () => chrome.onTogglePanel("content"),
    }] : []),
    { key: "fit", label: `Görüntü ${fitLabel(chrome.fitMode)}`, icon: "maximize-2", badge: fitLabel(chrome.fitMode), accent: true, onPress: chrome.onCycleFit },
    { key: "rotate", label: "Döndür", icon: "rotate-cw", onPress: chrome.onRotate },
    ...(chrome.pipSupported ? [{ key: "pip", label: "Picture in Picture", glyph: "PiP", onPress: chrome.onEnterPip }] : []),
    { key: "cc", label: "Altyazı", glyph: "CC", active: chrome.panel === "subtitles", onPress: () => chrome.onTogglePanel("subtitles") },
    { key: "audio", label: "Ses parçası", icon: "volume-2", active: chrome.panel === "audio", onPress: () => chrome.onTogglePanel("audio") },
    { key: "codec", label: `Codec ${playerCodecLabel(chrome.codecMode)}`, icon: "cpu", badge: playerCodecLabel(chrome.codecMode), accent: true, active: chrome.panel === "codec", onPress: () => chrome.onTogglePanel("codec") },
    ...(chrome.allowDownload ? [{
      key: "download",
      label: chrome.downloadState === "done" ? "İndirildi" : "İndir",
      icon: (chrome.downloadState === "done" ? "check-circle" : chrome.downloadState === "error" ? "alert-circle" : "download") as FeatherName,
      active: chrome.downloadState === "done",
      onPress: chrome.onDownload,
    }] : []),
  ];

  const gap = portrait ? 5 : 12;
  const outerPadding = portrait ? 10 : 24;
  const availableWidth = Math.max(1, width - insets.left - insets.right - outerPadding * 2);
  const buttonSize = clamp(
    Math.floor((availableWidth - gap * Math.max(0, actions.length - 1)) / Math.max(1, actions.length)),
    34,
    portrait ? 48 : 58,
  );
  const iconSize = clamp(Math.round(buttonSize * 0.5), 17, 27);
  const progressScale = clamp(width / (portrait ? 390 : 840), 0.82, 1.2);
  const timeWidth = clamp(Math.round(54 * progressScale), 44, 64);
  const timeFontSize = clamp(Math.round(11 * progressScale), 9, 13);

  return (
    <>
      <PlayerChromeV2 {...chrome} controlsVisible={false} infoVisible={false} />

      {chrome.infoVisible ? (
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
      ) : null}

      {chrome.controlsVisible && chrome.canExit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Oynatıcıdan çık"
          onPress={chrome.onExit}
          hitSlop={14}
          style={({ pressed }) => [
            styles.back,
            portrait ? styles.backPortrait : styles.backLandscape,
            pressed && styles.pressed,
          ]}
        >
          <Feather
            name="arrow-left"
            size={portrait ? 30 : 34}
            color="#fff"
            style={styles.iconShadow}
          />
        </Pressable>
      ) : null}

      {!chrome.panel ? (
        <Animated.View
          style={[styles.center, portrait ? styles.centerPortrait : styles.centerLandscape, { opacity: controlsOpacity }]}
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
            hitSlop={12}
            style={({ pressed }) => [styles.playShell, portrait && styles.playShellPortrait, pressed && styles.pressed]}
          >
            <Feather
              name={chrome.paused ? "play" : "pause"}
              size={portrait ? 39 : 46}
              color="#67e8f9"
              style={styles.playIcon}
            />
          </Pressable>

          {chrome.mediaKind !== "live" ? (
            <RoundButton compact={portrait} icon="rotate-cw" badge="15" label="15 saniye ileri" onPress={() => chrome.onSeekBy(15)} />
          ) : chrome.canNavigate ? (
            <RoundButton compact={portrait} icon="skip-forward" label="Sonraki kanal" onPress={() => chrome.onMoveRelative(1)} />
          ) : null}
        </Animated.View>
      ) : null}

      {chrome.controlsVisible && !chrome.panel ? (
        <Animated.View
          style={[
            styles.bottom,
            {
              opacity: controlsOpacity,
              bottom: Math.max(insets.bottom, portrait ? 10 : 14),
              paddingLeft: Math.max(outerPadding, insets.left + 10),
              paddingRight: Math.max(outerPadding, insets.right + 10),
            },
          ]}
          pointerEvents="box-none"
        >
          {chrome.mediaKind !== "live" ? (
            <View style={[styles.seekRow, { height: Math.round(32 * progressScale), gap: Math.max(5, Math.round(8 * progressScale)) }]}>
              <Text style={[styles.time, { width: timeWidth, fontSize: timeFontSize }]}>{formatTime(chrome.position)}</Text>
              <Pressable
                onLayout={(event: LayoutChangeEvent) => setSeekWidth(Math.max(1, event.nativeEvent.layout.width))}
                onPress={(event) => chrome.onSeekRatio(clamp(event.nativeEvent.locationX / seekWidth, 0, 1))}
                style={styles.seekTouch}
                hitSlop={{ top: 14, bottom: 14, left: 0, right: 0 }}
              >
                <View style={styles.seekTrack}>
                  <View style={[styles.seekFill, { width: `${progress * 100}%` }]} />
                  <View style={[styles.seekThumb, { left: `${progress * 100}%` }]} />
                </View>
              </Pressable>
              <Text style={[styles.time, styles.timeRight, { width: timeWidth, fontSize: timeFontSize }]}>{formatTime(chrome.duration)}</Text>
            </View>
          ) : null}

          <View style={[styles.dockRow, { gap }]}>
            {actions.map((action) => (
              <AdaptiveDockButton key={action.key} action={action} size={buttonSize} iconSize={iconSize} />
            ))}
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
  const safeTitle = typeof title === "string" && title.trim() ? title.trim() : "Canlı yayın";
  const safeMeta = typeof meta === "string" && meta.trim() ? meta.trim() : undefined;
  const nowTitle = safeProgramTitle(epgNow?.title);
  const nowEnd = safeTimestamp(epgNow?.end);
  const nextTitle = safeProgramTitle(epgNext?.title);
  const nextStart = safeTimestamp(epgNext?.start);
  const remaining = formatRemaining(nowEnd);
  const hasEpg = Boolean(epgNow || epgNext || epgLoading);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.info, portrait ? styles.infoPortrait : styles.infoLandscape, { opacity }]}
    >
      <View style={styles.infoMain}>
        <View style={styles.titleRow}>
          {live ? (
            <View style={styles.liveInline}>
              <Feather name="circle" size={9} color="#22d3ee" style={styles.cyanIconShadow} />
              <Text style={styles.liveText}>CANLI</Text>
            </View>
          ) : null}
          <Text numberOfLines={1} style={[styles.title, portrait && styles.titlePortrait]}>{safeTitle}</Text>
        </View>

        {live && hasEpg ? (
          <View style={styles.epgBlock}>
            {epgLoading && !epgNow ? (
              <Text numberOfLines={1} style={styles.epgMuted}>Program bilgisi yükleniyor…</Text>
            ) : epgNow ? (
              <>
                <Text numberOfLines={1} style={styles.epgNow}>Şimdi: {nowTitle} · {formatClock(nowEnd)}{remaining ? ` · ${remaining}` : ""}</Text>
                {epgNext ? <Text numberOfLines={1} style={styles.epgNext}>Sıradaki: {nextTitle} · {formatClock(nextStart)}</Text> : null}
              </>
            ) : null}
          </View>
        ) : null}

        {(safeMeta || tech) ? (
          <View style={styles.metaRow}>
            {safeMeta ? <Text numberOfLines={1} style={styles.meta}>{safeMeta}</Text> : null}
            {tech ? (
              <View style={styles.techInline}>
                <Feather name="monitor" size={12} color="#67e8f9" style={styles.cyanIconShadow} />
                <Text numberOfLines={1} style={styles.techText}>{tech}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
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
  return (
    <View style={styles.modeChip}>
      <Feather
        name={icon}
        size={13}
        color={accent ? "#67e8f9" : "#fff"}
        style={accent ? styles.cyanIconShadow : styles.iconShadow}
      />
      <Text style={[styles.modeText, accent && styles.modeTextAccent]}>{text}</Text>
    </View>
  );
}

function RoundButton({ icon, badge, compact, label, onPress }: {
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
      hitSlop={14}
      style={({ pressed }) => [styles.roundButton, compact && styles.roundButtonPortrait, pressed && styles.pressed]}
    >
      <Feather
        name={icon}
        size={compact ? 31 : 37}
        color="#fff"
        style={styles.iconShadow}
      />
      {badge ? <Text style={styles.roundBadge}>{badge}</Text> : null}
    </Pressable>
  );
}

function AdaptiveDockButton({ action, size, iconSize }: { action: Action; size: number; iconSize: number }) {
  const highlighted = Boolean(action.active || action.accent);
  const iconColor = highlighted ? "#67e8f9" : "#fff";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={action.onPress}
      hitSlop={Math.max(7, Math.ceil((48 - size) / 2))}
      style={({ pressed }) => [
        styles.dockButton,
        { width: size, height: size },
        pressed && styles.pressed,
      ]}
    >
      {action.icon ? (
        <Feather
          name={action.icon}
          size={highlighted ? iconSize + 1 : iconSize}
          color={iconColor}
          style={highlighted ? styles.cyanIconShadow : styles.iconShadow}
        />
      ) : (
        <Text style={[styles.glyph, highlighted && styles.glyphAccent]}>{action.glyph}</Text>
      )}
      {action.badge ? <Text numberOfLines={1} style={styles.microBadgeText}>{action.badge}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  info: {
    position: "absolute",
    zIndex: 52,
    top: 20,
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "transparent",
  },
  infoLandscape: { left: 104, right: 28, paddingTop: 4 },
  infoPortrait: { left: 76, right: 16, paddingTop: 2 },
  infoMain: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 9, minWidth: 0 },
  title: { flex: 1, color: "#fff", fontSize: 20, fontWeight: "900", ...TEXT_SHADOW },
  titlePortrait: { fontSize: 16 },
  liveInline: { flexDirection: "row", alignItems: "center", gap: 5 },
  liveText: { color: "#bff8ff", fontSize: 11, fontWeight: "900", ...TEXT_SHADOW },
  epgBlock: { marginTop: 4, minWidth: 0 },
  epgNow: { color: "#fff", fontSize: 12, fontWeight: "800", ...TEXT_SHADOW },
  epgNext: { marginTop: 1, color: "#f1f5f9", fontSize: 11, fontWeight: "700", ...TEXT_SHADOW },
  epgMuted: { color: "#e2e8f0", fontSize: 11, fontWeight: "700", ...TEXT_SHADOW },
  metaRow: { marginTop: 5, flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },
  meta: { flexShrink: 1, color: "#fff", fontSize: 11, fontWeight: "800", ...TEXT_SHADOW },
  techInline: { flexShrink: 0, maxWidth: "62%", flexDirection: "row", alignItems: "center", gap: 5 },
  techText: { color: "#dffcff", fontSize: 10, fontWeight: "900", ...TEXT_SHADOW },
  modeCluster: { marginLeft: 14, flexDirection: "row", alignItems: "center", gap: 14, paddingTop: 2 },
  modeChip: { flexDirection: "row", alignItems: "center", gap: 5 },
  modeText: { color: "#fff", fontSize: 11, fontWeight: "900", ...TEXT_SHADOW },
  modeTextAccent: { color: "#9af4ff" },

  back: {
    position: "absolute",
    zIndex: 65,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  backLandscape: { left: 24, top: 22, width: 62, height: 62 },
  backPortrait: { left: 14, top: 18, width: 54, height: 54 },

  center: {
    position: "absolute",
    zIndex: 60,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  centerLandscape: { top: "50%", transform: [{ translateY: -46 }], gap: 64 },
  centerPortrait: { top: "48%", transform: [{ translateY: -40 }], gap: 34 },
  roundButton: {
    width: 70,
    height: 70,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  roundButtonPortrait: { width: 58, height: 58 },
  roundBadge: { position: "absolute", color: "#fff", fontSize: 9, fontWeight: "900", ...TEXT_SHADOW },
  playShell: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 1.5,
    borderColor: "rgba(103,232,249,.78)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    shadowColor: "#22d3ee",
    shadowOpacity: 0.5,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 0 },
  },
  playShellPortrait: { width: 80, height: 80, borderRadius: 40 },
  playIcon: {
    textShadowColor: "rgba(34,211,238,.9)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },

  bottom: { position: "absolute", zIndex: 62, left: 0, right: 0, backgroundColor: "transparent" },
  seekRow: { width: "100%", marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  time: { width: 54, color: "#fff", fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"], ...TEXT_SHADOW },
  timeRight: { textAlign: "right" },
  seekTouch: { flex: 1, height: 28, justifyContent: "center" },
  seekTrack: { height: 8, justifyContent: "center", backgroundColor: "transparent" },
  seekFill: { position: "absolute", left: 0, top: 3, height: 2, borderTopWidth: 2, borderColor: "#22d3ee", backgroundColor: "transparent" },
  seekThumb: { position: "absolute", top: 0, marginLeft: -5, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: "#bff8ff", backgroundColor: "transparent" },
  dockRow: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  dockButton: { alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  glyph: { color: "#fff", fontSize: 18, fontWeight: "900", ...TEXT_SHADOW },
  glyphAccent: { color: "#67e8f9", textShadowColor: "rgba(34,211,238,.85)", textShadowRadius: 8 },
  microBadgeText: { position: "absolute", bottom: -1, color: "#9af4ff", fontSize: 8, fontWeight: "900", ...TEXT_SHADOW },
  iconShadow: ICON_SHADOW,
  cyanIconShadow: {
    textShadowColor: "rgba(34,211,238,.95)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  pressed: { opacity: 0.62, transform: [{ scale: 0.94 }] },
});
