import { Feather, MaterialIcons } from "@expo/vector-icons";
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
type MaterialName = React.ComponentProps<typeof MaterialIcons>["name"];
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
  materialIcon?: MaterialName;
  subLabel?: string;
  active?: boolean;
  accent?: boolean;
  onPress: () => void;
};

const TEXT_SHADOW = {
  textShadowColor: "rgba(0,0,0,.96)",
  textShadowOffset: { width: 0, height: 2 },
  textShadowRadius: 5,
} as const;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

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

export function PlayerChrome(props: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const portrait = height > width;
  const shortEdge = Math.max(1, Math.min(width, height));
  const uiScale = portrait
    ? clamp(shortEdge / 390, 0.86, 1)
    : clamp(shortEdge / 430, 0.86, 1.02);
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
  const hasBlockingStatus = typeof chrome.errorText === "string" && chrome.errorText.trim().length > 0;
  const showCenter = chrome.controlsVisible && !chrome.panel && !hasBlockingStatus;

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
      icon: "maximize-2" as FeatherName,
      accent: chrome.fitMode === "fit",
      onPress: chrome.onCycleFit,
    },
    {
      key: "rotate",
      label: "Döndür",
      icon: "rotate-cw" as FeatherName,
      onPress: chrome.onRotate,
    },
    ...(chrome.pipSupported ? [{
      key: "pip",
      label: "Picture in Picture",
      materialIcon: "picture-in-picture" as MaterialName,
      subLabel: "PiP",
      onPress: chrome.onEnterPip,
    }] : []),
    {
      key: "cc",
      label: "Altyazı",
      materialIcon: "closed-caption" as MaterialName,
      subLabel: "CC",
      active: chrome.panel === "subtitles",
      onPress: () => chrome.onTogglePanel("subtitles"),
    },
    {
      key: "audio",
      label: "Ses parçası",
      icon: "volume-2" as FeatherName,
      active: chrome.panel === "audio",
      onPress: () => chrome.onTogglePanel("audio"),
    },
    {
      key: "codec",
      label: `Codec ${playerCodecLabel(chrome.codecMode)}`,
      icon: "cpu" as FeatherName,
      accent: chrome.codecMode === "auto",
      active: chrome.panel === "codec",
      onPress: () => chrome.onTogglePanel("codec"),
    },
    ...(chrome.allowDownload ? [{
      key: "download",
      label: chrome.downloadState === "done" ? "İndirildi" : "İndir",
      icon: (chrome.downloadState === "done" ? "check-circle" : chrome.downloadState === "error" ? "alert-circle" : "download") as FeatherName,
      active: chrome.downloadState === "done",
      onPress: chrome.onDownload,
    }] : []),
  ];

  const gap = Math.round((portrait ? 4 : 9) * uiScale);
  const outerPadding = Math.round((portrait ? 8 : 22) * uiScale);
  const availableWidth = Math.max(1, width - insets.left - insets.right - outerPadding * 2);
  const buttonSize = clamp(
    Math.floor((availableWidth - gap * Math.max(0, actions.length - 1)) / Math.max(1, actions.length)),
    Math.round(38 * uiScale),
    Math.round((portrait ? 44 : 48) * uiScale),
  );
  const dockIconSize = clamp(Math.round((portrait ? 20 : 22) * uiScale), 17, 23);
  const progressScale = clamp(width / (portrait ? 390 : 840), 0.82, 1.12);
  const timeWidth = clamp(Math.round(50 * progressScale), 42, 58);
  const timeFontSize = clamp(Math.round(10 * progressScale), 9, 12);

  const topY = Math.max(insets.top + Math.round((portrait ? 5 : 4) * uiScale), portrait ? 8 : 6);
  const infoLeft = Math.max(insets.left + Math.round((portrait ? 62 : 82) * uiScale), portrait ? 68 : 86);
  const infoRight = portrait
    ? Math.max(insets.right + 12, 12)
    : Math.max(insets.right + Math.round(164 * uiScale), 158);
  const modeRight = Math.max(insets.right + Math.round(14 * uiScale), 14);

  return (
    <>
      <PlayerChromeV2 {...chrome} controlsVisible={false} infoVisible={false} />

      {chrome.infoVisible ? (
        <InfoCard
          opacity={infoOpacity}
          portrait={portrait}
          scale={uiScale}
          top={topY}
          left={infoLeft}
          right={infoRight}
          title={chrome.title}
          meta={chrome.meta}
          live={chrome.mediaKind === "live"}
          tech={technicalLabel}
          epgNow={epgNow}
          epgNext={epgNext}
          epgLoading={epgLoading}
        />
      ) : null}

      {chrome.infoVisible && !portrait ? (
        <TopModeCluster
          opacity={infoOpacity}
          top={topY + 1}
          right={modeRight}
          scale={uiScale}
          fit={chrome.fitMode}
          codec={chrome.codecMode}
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
            {
              left: Math.max(insets.left + 10, Math.round((portrait ? 14 : 18) * uiScale)),
              top: topY,
              width: Math.round((portrait ? 48 : 54) * uiScale),
              height: Math.round((portrait ? 48 : 54) * uiScale),
            },
            pressed && styles.pressed,
          ]}
        >
          <EmbossedIcon
            name="arrow-left"
            size={Math.round((portrait ? 26 : 29) * uiScale)}
          />
        </Pressable>
      ) : null}

      {showCenter ? (
        <Animated.View
          style={[
            styles.center,
            portrait ? styles.centerPortrait : styles.centerLandscape,
            { opacity: controlsOpacity },
          ]}
          pointerEvents="box-none"
        >
          {chrome.mediaKind !== "live" ? (
            <RoundButton
              icon="rotate-ccw"
              badge="10"
              label="10 saniye geri"
              onPress={() => chrome.onSeekBy(-10)}
              size={Math.round((portrait ? 54 : 58) * uiScale)}
              iconSize={Math.round((portrait ? 27 : 30) * uiScale)}
            />
          ) : chrome.canNavigate ? (
            <RoundButton
              icon="skip-back"
              label="Önceki kanal"
              onPress={() => chrome.onMoveRelative(-1)}
              size={Math.round((portrait ? 54 : 58) * uiScale)}
              iconSize={Math.round((portrait ? 27 : 30) * uiScale)}
            />
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={chrome.paused ? "Oynat" : "Duraklat"}
            onPress={chrome.onTogglePause}
            hitSlop={14}
            style={({ pressed }) => [
              styles.playShell,
              {
                width: Math.round((portrait ? 72 : 80) * uiScale),
                height: Math.round((portrait ? 72 : 80) * uiScale),
                borderRadius: Math.round((portrait ? 36 : 40) * uiScale),
              },
              pressed && styles.pressed,
            ]}
          >
            <EmbossedIcon
              name={chrome.paused ? "play" : "pause"}
              size={Math.round((portrait ? 32 : 36) * uiScale)}
              accent
            />
          </Pressable>

          {chrome.mediaKind !== "live" ? (
            <RoundButton
              icon="rotate-cw"
              badge="15"
              label="15 saniye ileri"
              onPress={() => chrome.onSeekBy(15)}
              size={Math.round((portrait ? 54 : 58) * uiScale)}
              iconSize={Math.round((portrait ? 27 : 30) * uiScale)}
            />
          ) : chrome.canNavigate ? (
            <RoundButton
              icon="skip-forward"
              label="Sonraki kanal"
              onPress={() => chrome.onMoveRelative(1)}
              size={Math.round((portrait ? 54 : 58) * uiScale)}
              iconSize={Math.round((portrait ? 27 : 30) * uiScale)}
            />
          ) : null}
        </Animated.View>
      ) : null}

      {chrome.controlsVisible && !chrome.panel ? (
        <Animated.View
          style={[
            styles.bottom,
            {
              opacity: controlsOpacity,
              bottom: Math.max(insets.bottom + 2, Math.round((portrait ? 8 : 10) * uiScale)),
              paddingLeft: Math.max(outerPadding, insets.left + 8),
              paddingRight: Math.max(outerPadding, insets.right + 8),
            },
          ]}
          pointerEvents="box-none"
        >
          {chrome.mediaKind !== "live" ? (
            <View style={[styles.seekRow, { height: Math.round(28 * progressScale), gap: Math.max(5, Math.round(7 * progressScale)) }]}>
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
              <AdaptiveDockButton
                key={action.key}
                action={action}
                size={buttonSize}
                iconSize={dockIconSize}
              />
            ))}
          </View>
        </Animated.View>
      ) : null}
    </>
  );
}

function InfoCard({ opacity, portrait, scale, top, left, right, title, meta, live, tech, epgNow, epgNext, epgLoading }: {
  opacity: Animated.Value;
  portrait: boolean;
  scale: number;
  top: number;
  left: number;
  right: number;
  title: string;
  meta?: string;
  live: boolean;
  tech?: string;
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
      style={[styles.info, { opacity, top, left, right }]}
    >
      <View style={styles.infoMain}>
        <View style={[styles.titleRow, { gap: Math.round(7 * scale) }]}>
          {live ? (
            <View style={[styles.liveInline, { gap: Math.round(4 * scale) }]}>
              <Feather name="circle" size={Math.max(7, Math.round(8 * scale))} color="#22d3ee" style={styles.cyanTextShadow} />
              <Text style={[styles.liveText, { fontSize: Math.round((portrait ? 10 : 10.5) * scale) }]}>CANLI</Text>
            </View>
          ) : null}
          <Text
            numberOfLines={1}
            style={[styles.title, { fontSize: Math.round((portrait ? 15 : 17) * scale) }]}
          >
            {safeTitle}
          </Text>
        </View>

        {live && hasEpg ? (
          <View style={[styles.epgBlock, { marginTop: Math.round(2 * scale) }]}>
            {epgLoading && !epgNow ? (
              <Text numberOfLines={1} style={[styles.epgMuted, { fontSize: Math.round(9.5 * scale) }]}>Program bilgisi yükleniyor…</Text>
            ) : epgNow ? (
              <>
                <Text numberOfLines={1} style={[styles.epgNow, { fontSize: Math.round((portrait ? 10.5 : 11) * scale) }]}>Şimdi: {nowTitle} · {formatClock(nowEnd)}{remaining ? ` · ${remaining}` : ""}</Text>
                {epgNext ? <Text numberOfLines={1} style={[styles.epgNext, { fontSize: Math.round((portrait ? 9.5 : 10) * scale) }]}>Sıradaki: {nextTitle} · {formatClock(nextStart)}</Text> : null}
              </>
            ) : null}
          </View>
        ) : null}

        {(safeMeta || tech) ? (
          <View style={[styles.metaRow, { marginTop: Math.round(3 * scale), gap: Math.round(8 * scale) }]}>
            {safeMeta ? <Text numberOfLines={1} style={[styles.meta, { fontSize: Math.round(9.5 * scale) }]}>{safeMeta}</Text> : null}
            {tech ? (
              <View style={[styles.techInline, { gap: Math.round(4 * scale) }]}>
                <EmbossedIcon name="monitor" size={Math.round(11 * scale)} accent compact />
                <Text numberOfLines={1} style={[styles.techText, { fontSize: Math.round(9 * scale) }]}>{tech}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

function TopModeCluster({ opacity, top, right, scale, fit, codec }: {
  opacity: Animated.Value;
  top: number;
  right: number;
  scale: number;
  fit: PlayerFitMode;
  codec: Props["codecMode"];
}) {
  return (
    <Animated.View pointerEvents="none" style={[styles.topModes, { opacity, top, right, gap: Math.round(12 * scale) }]}>
      <ModeChip icon="maximize-2" text={fitLabel(fit)} scale={scale} />
      <ModeChip icon="cpu" text={playerCodecLabel(codec)} scale={scale} accent={codec === "auto"} />
    </Animated.View>
  );
}

function ModeChip({ icon, text, scale, accent }: { icon: FeatherName; text: string; scale: number; accent?: boolean }) {
  return (
    <View style={[styles.modeChip, { gap: Math.round(4 * scale) }]}>
      <EmbossedIcon name={icon} size={Math.round(12 * scale)} accent={accent} compact />
      <Text style={[styles.modeText, accent && styles.modeTextAccent, { fontSize: Math.round(10 * scale) }]}>{text}</Text>
    </View>
  );
}

function RoundButton({ icon, badge, label, onPress, size, iconSize }: {
  icon: FeatherName;
  badge?: string;
  label: string;
  onPress: () => void;
  size: number;
  iconSize: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={14}
      style={({ pressed }) => [styles.roundButton, { width: size, height: size }, pressed && styles.pressed]}
    >
      <EmbossedIcon name={icon} size={iconSize} />
      {badge ? <Text style={styles.roundBadge}>{badge}</Text> : null}
    </Pressable>
  );
}

function AdaptiveDockButton({ action, size, iconSize }: { action: Action; size: number; iconSize: number }) {
  const highlighted = Boolean(action.active || action.accent);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={action.onPress}
      hitSlop={Math.max(10, Math.ceil((50 - size) / 2))}
      style={({ pressed }) => [styles.dockButton, { width: size, height: size }, pressed && styles.pressed]}
    >
      {action.materialIcon ? (
        <EmbossedMaterialIcon name={action.materialIcon} size={iconSize + 1} accent={highlighted} />
      ) : action.icon ? (
        <EmbossedIcon name={action.icon} size={iconSize} accent={highlighted} />
      ) : null}
      {action.subLabel ? (
        <Text numberOfLines={1} style={[styles.actionSubLabel, highlighted && styles.actionSubLabelAccent]}>{action.subLabel}</Text>
      ) : null}
    </Pressable>
  );
}

function EmbossedIcon({ name, size, accent = false, compact = false }: {
  name: FeatherName;
  size: number;
  accent?: boolean;
  compact?: boolean;
}) {
  const main = accent ? "#22d3ee" : "#e2e8f0";
  const highlight = accent ? "#e6fdff" : "#ffffff";
  const lowlight = accent ? "#036f8b" : "#475569";
  const box = compact ? size + 4 : size + 10;
  return (
    <View pointerEvents="none" style={{ width: box, height: box, alignItems: "center", justifyContent: "center" }}>
      <Feather
        name={name}
        size={size}
        color="rgba(0,0,0,.92)"
        style={[styles.embossLayer, styles.depthDrop, { transform: [{ translateX: 1.4 }, { translateY: 2.4 }, { scale: 1.03 }] }]}
      />
      <Feather
        name={name}
        size={size}
        color={lowlight}
        style={[styles.embossLayer, { opacity: 0.96, transform: [{ translateX: 0.7 }, { translateY: 1.15 }, { scale: 1.025 }] }]}
      />
      <Feather
        name={name}
        size={size}
        color={highlight}
        style={[styles.embossLayer, { opacity: 0.94, transform: [{ translateX: -0.95 }, { translateY: -1.05 }, { scale: 1.025 }] }]}
      />
      <Feather
        name={name}
        size={size}
        color={accent ? "rgba(190,250,255,.78)" : "rgba(255,255,255,.72)"}
        style={[styles.embossLayer, { opacity: 0.58, transform: [{ translateX: -0.35 }, { translateY: -0.45 }] }]}
      />
      <Feather name={name} size={size} color={main} style={accent ? styles.cyanTextShadow : styles.iconTextShadow} />
    </View>
  );
}

function EmbossedMaterialIcon({ name, size, accent = false }: {
  name: MaterialName;
  size: number;
  accent?: boolean;
}) {
  const main = accent ? "#22d3ee" : "#e2e8f0";
  const highlight = accent ? "#e6fdff" : "#ffffff";
  const lowlight = accent ? "#036f8b" : "#475569";
  return (
    <View pointerEvents="none" style={{ width: size + 10, height: size + 10, alignItems: "center", justifyContent: "center" }}>
      <MaterialIcons
        name={name}
        size={size}
        color="rgba(0,0,0,.92)"
        style={[styles.embossLayer, styles.depthDrop, { transform: [{ translateX: 1.4 }, { translateY: 2.4 }, { scale: 1.03 }] }]}
      />
      <MaterialIcons
        name={name}
        size={size}
        color={lowlight}
        style={[styles.embossLayer, { opacity: 0.96, transform: [{ translateX: 0.7 }, { translateY: 1.15 }, { scale: 1.025 }] }]}
      />
      <MaterialIcons
        name={name}
        size={size}
        color={highlight}
        style={[styles.embossLayer, { opacity: 0.94, transform: [{ translateX: -0.95 }, { translateY: -1.05 }, { scale: 1.025 }] }]}
      />
      <MaterialIcons
        name={name}
        size={size}
        color={accent ? "rgba(190,250,255,.78)" : "rgba(255,255,255,.72)"}
        style={[styles.embossLayer, { opacity: 0.58, transform: [{ translateX: -0.35 }, { translateY: -0.45 }] }]}
      />
      <MaterialIcons name={name} size={size} color={main} style={accent ? styles.cyanTextShadow : styles.iconTextShadow} />
    </View>
  );
}

const styles = StyleSheet.create({
  info: {
    position: "absolute",
    zIndex: 52,
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "transparent",
  },
  infoMain: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", minWidth: 0 },
  title: { flex: 1, color: "#fff", fontWeight: "900", ...TEXT_SHADOW },
  liveInline: { flexDirection: "row", alignItems: "center" },
  liveText: { color: "#c8fbff", fontWeight: "900", ...TEXT_SHADOW },
  epgBlock: { minWidth: 0 },
  epgNow: { color: "#fff", fontWeight: "800", ...TEXT_SHADOW },
  epgNext: { marginTop: 1, color: "#f1f5f9", fontWeight: "700", ...TEXT_SHADOW },
  epgMuted: { color: "#e2e8f0", fontWeight: "700", ...TEXT_SHADOW },
  metaRow: { flexDirection: "row", alignItems: "center", minWidth: 0 },
  meta: { flexShrink: 1, color: "#fff", fontWeight: "800", ...TEXT_SHADOW },
  techInline: { flexShrink: 0, maxWidth: "56%", flexDirection: "row", alignItems: "center" },
  techText: { color: "#dffcff", fontWeight: "900", ...TEXT_SHADOW },

  topModes: {
    position: "absolute",
    zIndex: 54,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
  },
  modeChip: { flexDirection: "row", alignItems: "center", backgroundColor: "transparent" },
  modeText: { color: "#fff", fontWeight: "900", ...TEXT_SHADOW },
  modeTextAccent: { color: "#9af4ff" },

  back: {
    position: "absolute",
    zIndex: 65,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
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
  centerLandscape: { top: "50%", transform: [{ translateY: -40 }], gap: 54 },
  centerPortrait: { top: "48%", transform: [{ translateY: -34 }], gap: 28 },
  roundButton: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  roundBadge: { position: "absolute", color: "#fff", fontSize: 8, fontWeight: "900", ...TEXT_SHADOW },
  playShell: {
    borderWidth: 1.25,
    borderColor: "rgba(103,232,249,.72)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    shadowColor: "#22d3ee",
    shadowOpacity: 0.42,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },

  bottom: { position: "absolute", zIndex: 62, left: 0, right: 0, backgroundColor: "transparent" },
  seekRow: { width: "100%", marginBottom: 6, flexDirection: "row", alignItems: "center" },
  time: { color: "#fff", fontWeight: "800", fontVariant: ["tabular-nums"], ...TEXT_SHADOW },
  timeRight: { textAlign: "right" },
  seekTouch: { flex: 1, height: 26, justifyContent: "center" },
  seekTrack: { height: 8, justifyContent: "center", backgroundColor: "transparent" },
  seekFill: { position: "absolute", left: 0, top: 3, height: 2, borderTopWidth: 2, borderColor: "#22d3ee", backgroundColor: "transparent" },
  seekThumb: { position: "absolute", top: 0, marginLeft: -5, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: "#bff8ff", backgroundColor: "transparent" },
  dockRow: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  dockButton: { alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  actionSubLabel: {
    position: "absolute",
    bottom: -1,
    color: "rgba(255,255,255,.72)",
    fontSize: 8,
    fontWeight: "600",
    ...TEXT_SHADOW,
  },
  actionSubLabelAccent: { color: "#9af4ff" },

  embossLayer: { position: "absolute" },
  depthDrop: {
    textShadowColor: "rgba(0,0,0,.82)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  iconTextShadow: {
    textShadowColor: "rgba(0,0,0,.96)",
    textShadowOffset: { width: 0, height: 1.4 },
    textShadowRadius: 4.5,
  },
  cyanTextShadow: {
    textShadowColor: "rgba(34,211,238,.98)",
    textShadowOffset: { width: 0, height: 0.8 },
    textShadowRadius: 8,
  },
  pressed: { opacity: 0.62, transform: [{ scale: 0.94 }] },
});
