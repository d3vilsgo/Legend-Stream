import { Feather } from "@expo/vector-icons";
import React, { memo, useMemo, useState } from "react";
import {
  FlatList,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { PlayerGestureLayer } from "./PlayerGestureLayer";
import type { PlayerCodecMode, PlayerFitMode, PlayerTrack } from "./VlcPlaybackSurface";

export type PlayerPanel = "content" | "subtitles" | "audio" | "codec" | null;
export type PlayerSelectableItem = {
  id: string;
  title: string;
  subtitle?: string;
  source: string;
  isLive?: boolean;
};
export type PlayerMediaKind = "live" | "movie" | "episode" | "download";
export type PlayerDownloadState = "idle" | "downloading" | "done" | "error";

type Props = {
  title: string;
  meta?: string;
  mediaKind: PlayerMediaKind;
  codecMode: PlayerCodecMode;
  fitMode: PlayerFitMode;
  volume: number;
  controlsVisible: boolean;
  infoVisible: boolean;
  panel: PlayerPanel;
  paused: boolean;
  position: number;
  duration: number;
  selectableItems: PlayerSelectableItem[];
  currentIndex: number;
  canNavigate: boolean;
  allowDownload: boolean;
  downloadState: PlayerDownloadState;
  downloadProgress: number;
  audioTracks: PlayerTrack[];
  textTracks: PlayerTrack[];
  errorText?: string | null;
  canExit: boolean;
  pipSupported: boolean;
  onBackgroundPress: () => void;
  onExit: () => void;
  onTogglePause: () => void;
  onSeekBy: (seconds: number) => void;
  onSeekRatio: (ratio: number) => void;
  onMoveRelative: (delta: number) => void;
  onTogglePanel: (panel: Exclude<PlayerPanel, null>) => void;
  onSwitchTo: (item: PlayerSelectableItem) => void;
  onSelectSubtitle: (id: number) => void;
  onSelectAudio: (id: number) => void;
  onChangeCodec: (mode: PlayerCodecMode) => void;
  onDownload: () => void;
  onCycleFit: () => void;
  onRotate: () => void;
  onVolumeChange: (value: number) => void;
  onVolumeCommit?: (value: number) => void;
  onEnterPip: () => void;
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

export const playerCodecLabel = (mode: PlayerCodecMode) =>
  mode === "hardware" ? "HW" : mode === "software" ? "SW" : "AUTO";

const fitLabel = (mode: PlayerFitMode) => {
  if (mode === "full") return "FULL";
  if (mode === "original") return "ORIG";
  if (mode === "16:9") return "16:9";
  if (mode === "4:3") return "4:3";
  return "FIT";
};

export const PlayerChrome = memo(function PlayerChrome(props: Props) {
  const { width, height } = useWindowDimensions();
  const [seekWidth, setSeekWidth] = useState(1);
  const landscape = width >= height;
  const progress = props.duration > 0
    ? Math.max(0, Math.min(1, props.position / props.duration))
    : 0;

  const panelStyle = useMemo(
    () => [styles.panel, landscape ? styles.panelLandscape : styles.panelPortrait],
    [landscape],
  );

  const onSeekLayout = (event: LayoutChangeEvent) => {
    setSeekWidth(Math.max(1, event.nativeEvent.layout.width));
  };

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <PlayerGestureLayer
        enabled={!props.panel}
        volume={props.volume}
        onTap={props.onBackgroundPress}
        onVolumeChange={props.onVolumeChange}
        onVolumeCommit={props.onVolumeCommit}
      />

      {props.errorText ? (
        <View style={styles.error} pointerEvents="none">
          <Text style={styles.errorTitle}>Oynatma başarısız</Text>
          <Text style={styles.errorText}>{props.errorText}</Text>
        </View>
      ) : null}

      {props.infoVisible ? (
        <View style={styles.mediaHud} pointerEvents="none">
          <View style={styles.liveDot} />
          <View style={styles.mediaCopy}>
            <Text numberOfLines={1} style={styles.mediaTitle}>{props.title}</Text>
            {props.meta ? <Text numberOfLines={1} style={styles.mediaMeta}>{props.meta}</Text> : null}
          </View>
          <View style={styles.infoBadges}>
            <View style={styles.fitBadge}><Text style={styles.fitBadgeText}>{fitLabel(props.fitMode)}</Text></View>
            <View style={styles.codecBadge}><Text style={styles.codecBadgeText}>{playerCodecLabel(props.codecMode)}</Text></View>
          </View>
        </View>
      ) : null}

      {props.controlsVisible && props.canExit ? (
        <Pressable onPress={props.onExit} style={styles.back} hitSlop={10}>
          <Feather name="arrow-left" size={28} color="#fff" />
        </Pressable>
      ) : null}

      {props.controlsVisible ? (
        <>
          <View style={styles.center} pointerEvents="box-none">
            {props.mediaKind !== "live" ? (
              <ControlButton onPress={() => props.onSeekBy(-10)} icon="rotate-ccw" size="large" badge="10" />
            ) : null}
            <Pressable onPress={props.onTogglePause} style={styles.play} hitSlop={10}>
              <Feather name={props.paused ? "play" : "pause"} size={32} color="#000" />
            </Pressable>
            {props.mediaKind !== "live" ? (
              <ControlButton onPress={() => props.onSeekBy(15)} icon="rotate-cw" size="large" badge="15" />
            ) : null}
          </View>

          <View style={styles.bottom} pointerEvents="box-none">
            {props.mediaKind !== "live" ? (
              <View style={styles.seekRow}>
                <Text style={styles.time}>{formatTime(props.position)}</Text>
                <Pressable
                  onLayout={onSeekLayout}
                  onPress={(event) => props.onSeekRatio(
                    Math.max(0, Math.min(1, event.nativeEvent.locationX / seekWidth)),
                  )}
                  style={styles.seek}
                  hitSlop={{ top: 12, bottom: 12, left: 0, right: 0 }}
                >
                  <View style={[styles.seekFill, { width: `${progress * 100}%` }]} />
                </Pressable>
                <Text style={styles.time}>{formatTime(props.duration)}</Text>
              </View>
            ) : null}

            <View style={styles.barShell}>
              <View style={styles.bar}>
                {props.canNavigate ? (
                  <ControlButton
                    onPress={() => props.onMoveRelative(-1)}
                    icon="skip-back"
                    disabled={props.currentIndex <= 0}
                  />
                ) : null}
                {props.selectableItems.length ? (
                  <ControlButton onPress={() => props.onTogglePanel("content")} icon="list" />
                ) : null}
                {props.canNavigate ? (
                  <ControlButton
                    onPress={() => props.onMoveRelative(1)}
                    icon="skip-forward"
                    disabled={props.currentIndex >= props.selectableItems.length - 1}
                  />
                ) : null}
                {props.allowDownload ? (
                  <ControlButton
                    onPress={props.onDownload}
                    icon={props.downloadState === "done"
                      ? "check-circle"
                      : props.downloadState === "error"
                        ? "alert-circle"
                        : "download"}
                  />
                ) : null}
                <Pressable onPress={props.onCycleFit} style={styles.fitControl} hitSlop={6}>
                  <Feather name="maximize-2" size={20} color="#fff" />
                  <Text style={styles.fitMini}>{fitLabel(props.fitMode)}</Text>
                </Pressable>
                <ControlButton onPress={props.onRotate} icon="rotate-cw" />
                {props.pipSupported ? (
                  <Pressable onPress={props.onEnterPip} style={styles.pipControl} hitSlop={6}>
                    <Text style={styles.pipText}>PiP</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => props.onTogglePanel("subtitles")} style={styles.icon} hitSlop={6}>
                  <Text style={styles.cc}>CC</Text>
                </Pressable>
                <ControlButton onPress={() => props.onTogglePanel("audio")} icon="volume-2" />
                <Pressable onPress={() => props.onTogglePanel("codec")} style={styles.codecIcon} hitSlop={6}>
                  <Feather name="cpu" size={20} color="#fff" />
                  <Text style={styles.codecMini}>{playerCodecLabel(props.codecMode)}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </>
      ) : null}

      {props.panel ? (
        <View style={panelStyle}>
          <PanelContent {...props} />
        </View>
      ) : null}

      {props.downloadState === "downloading" ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>İndiriliyor… %{Math.round(props.downloadProgress * 100)}</Text>
        </View>
      ) : null}
    </View>
  );
});

function PanelContent(props: Props) {
  if (props.panel === "content") {
    return (
      <FlatList
        data={props.selectableItems}
        keyExtractor={(item, index) => `${item.id}:${index}`}
        initialNumToRender={16}
        maxToRenderPerBatch={16}
        windowSize={5}
        removeClippedSubviews
        renderItem={({ item }) => (
          <Pressable onPress={() => props.onSwitchTo(item)} style={styles.row}>
            <Text numberOfLines={1} style={styles.rowTitle}>{item.title}</Text>
            {item.subtitle ? <Text numberOfLines={1} style={styles.rowSub}>{item.subtitle}</Text> : null}
          </Pressable>
        )}
      />
    );
  }

  if (props.panel === "subtitles") {
    const rows = [{ id: -1, name: "Kapalı" }, ...props.textTracks];
    return (
      <FlatList
        data={rows}
        keyExtractor={(item, index) => `${item.id}:${index}`}
        ListHeaderComponent={<PanelHeader title="Altyazı" hint={props.textTracks.length ? undefined : "Bu içerikte gömülü altyazı bulunamadı."} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => props.onSelectSubtitle(item.id)} style={styles.row}>
            <Text style={styles.rowTitle}>{item.name}</Text>
          </Pressable>
        )}
      />
    );
  }

  if (props.panel === "audio") {
    return (
      <FlatList
        data={props.audioTracks}
        keyExtractor={(item, index) => `${item.id}:${index}`}
        ListHeaderComponent={<PanelHeader title="Ses" hint={props.audioTracks.length ? undefined : "Bu içerikte seçilebilir ek ses parçası bulunamadı."} />}
        ListEmptyComponent={<View />}
        renderItem={({ item }) => (
          <Pressable onPress={() => props.onSelectAudio(item.id)} style={styles.row}>
            <Text style={styles.rowTitle}>{item.name}</Text>
          </Pressable>
        )}
      />
    );
  }

  const modes: Array<{ id: PlayerCodecMode; title: string; subtitle: string; icon: React.ComponentProps<typeof Feather>["name"] }> = [
    { id: "auto", title: "Otomatik", subtitle: "VLC uygun çözümleyiciyi seçer", icon: "shuffle" },
    { id: "hardware", title: "Donanımsal (HW)", subtitle: "Daha düşük CPU kullanımı; cihaz codec desteğine bağlı", icon: "zap" },
    { id: "software", title: "Yazılımsal (SW)", subtitle: "En geniş uyumluluk; daha fazla CPU ve batarya kullanır", icon: "cpu" },
  ];
  return (
    <FlatList
      data={modes}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={<PanelHeader title="Codec çözümleme" hint="AUTO önerilir. Sorunlu veya eski cihazlarda SW deneyin." />}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => props.onChangeCodec(item.id)}
          style={[styles.row, props.codecMode === item.id && styles.rowActive]}
        >
          <View style={styles.rowHeadline}>
            <Feather name={item.icon} size={20} color="#fff" />
            <Text style={styles.rowTitle}>{item.title}</Text>
          </View>
          <Text style={styles.rowSub}>{item.subtitle}</Text>
        </Pressable>
      )}
    />
  );
}

function PanelHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.panelHeader}>
      <Text style={styles.panelHeading}>{title}</Text>
      {hint ? <Text style={styles.panelHint}>{hint}</Text> : null}
    </View>
  );
}

function ControlButton({ onPress, icon, disabled = false, size = "normal", badge }: {
  onPress: () => void;
  icon: React.ComponentProps<typeof Feather>["name"];
  disabled?: boolean;
  size?: "normal" | "large";
  badge?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[size === "large" ? styles.centerBtn : styles.icon, disabled && styles.disabled]}
      hitSlop={6}
    >
      <Feather name={icon} size={size === "large" ? 28 : 22} color="#fff" />
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 20 },
  back: { position: "absolute", zIndex: 6, top: 18, left: 18, width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(4,8,14,.78)", borderWidth: 1, borderColor: "rgba(255,255,255,.12)", alignItems: "center", justifyContent: "center" },
  mediaHud: { position: "absolute", zIndex: 5, top: 18, left: 84, right: 18, minHeight: 56, borderRadius: 17, backgroundColor: "rgba(4,8,14,.76)", borderWidth: 1, borderColor: "rgba(255,255,255,.12)", paddingHorizontal: 14, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10 },
  mediaCopy: { flex: 1, minWidth: 0 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#22d3ee" },
  mediaTitle: { color: "#fff", fontSize: 16, fontWeight: "900" },
  mediaMeta: { color: "#aab4c3", fontSize: 12, marginTop: 2 },
  infoBadges: { flexDirection: "row", alignItems: "center", gap: 6 },
  fitBadge: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 9, backgroundColor: "rgba(255,255,255,.08)", borderWidth: 1, borderColor: "rgba(255,255,255,.15)" },
  fitBadgeText: { color: "#dbeafe", fontSize: 9, fontWeight: "900" },
  codecBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9, backgroundColor: "rgba(34,211,238,.16)", borderWidth: 1, borderColor: "rgba(34,211,238,.35)" },
  codecBadgeText: { color: "#67e8f9", fontSize: 10, fontWeight: "900" },
  center: { position: "absolute", zIndex: 6, left: 0, right: 0, top: "40%", flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 34 },
  centerBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(4,8,14,.55)", alignItems: "center", justifyContent: "center" },
  play: { width: 66, height: 66, borderRadius: 33, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", color: "#fff", fontWeight: "800", fontSize: 10 },
  bottom: { position: "absolute", zIndex: 6, left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingBottom: 12 },
  seekRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 9, paddingHorizontal: 5 },
  time: { color: "#fff", fontWeight: "700", fontSize: 13, minWidth: 42 },
  seek: { flex: 1, height: 5, backgroundColor: "rgba(255,255,255,.30)", borderRadius: 3, overflow: "hidden" },
  seekFill: { height: 5, backgroundColor: "#22d3ee" },
  barShell: { borderRadius: 18, backgroundColor: "rgba(4,8,14,.82)", borderWidth: 1, borderColor: "rgba(255,255,255,.11)", overflow: "hidden" },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingVertical: 7, paddingHorizontal: 5 },
  icon: { minWidth: 40, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  fitControl: { minWidth: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  fitMini: { color: "#cbd5e1", fontSize: 7, fontWeight: "900", marginTop: -1 },
  pipControl: { minWidth: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  pipText: { color: "#fff", fontSize: 11, fontWeight: "900", borderWidth: 1.5, borderColor: "#fff", borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1 },
  codecIcon: { minWidth: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  codecMini: { color: "#67e8f9", fontSize: 8, fontWeight: "900", marginTop: -2 },
  cc: { color: "#fff", fontWeight: "900", fontSize: 15, borderWidth: 2, borderColor: "#fff", borderRadius: 4, paddingHorizontal: 3, lineHeight: 18 },
  disabled: { opacity: 0.35 },
  panel: { position: "absolute", zIndex: 10, right: 16, top: 82, bottom: 92, backgroundColor: "rgba(6,11,20,.98)", borderRadius: 18, borderWidth: 1, borderColor: "rgba(255,255,255,.12)", padding: 8, overflow: "hidden" },
  panelLandscape: { width: "46%", maxWidth: 440 },
  panelPortrait: { left: 16, right: 16, width: undefined },
  panelHeader: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 },
  panelHeading: { color: "#fff", fontSize: 18, fontWeight: "900" },
  panelHint: { color: "#94a3b8", fontSize: 12, paddingTop: 6, lineHeight: 17 },
  row: { paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,.08)", borderRadius: 10 },
  rowActive: { backgroundColor: "rgba(34,211,238,.12)", borderColor: "rgba(34,211,238,.22)" },
  rowHeadline: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowTitle: { color: "#fff", fontWeight: "800" },
  rowSub: { color: "#9ca3af", fontSize: 12, marginTop: 3 },
  toast: { position: "absolute", zIndex: 12, top: 84, right: 18, backgroundColor: "rgba(4,8,14,.84)", borderWidth: 1, borderColor: "rgba(255,255,255,.10)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  toastText: { color: "#fff", fontWeight: "800" },
  error: { ...StyleSheet.absoluteFillObject, zIndex: 15, alignItems: "center", justifyContent: "center", padding: 30, backgroundColor: "#07101f" },
  errorTitle: { color: "#fff", fontSize: 26, fontWeight: "900", marginBottom: 10 },
  errorText: { color: "#9ca3af", textAlign: "center", maxWidth: 560, lineHeight: 21 },
});