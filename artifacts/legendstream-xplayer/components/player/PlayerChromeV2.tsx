import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { memo, useMemo, useState } from "react";
import {
  FlatList,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
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

      {(props.controlsVisible || props.infoVisible) ? (
        <>
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(0,0,0,.72)", "rgba(0,0,0,.28)", "rgba(0,0,0,0)"]}
            style={styles.topShade}
          />
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(0,0,0,0)", "rgba(0,0,0,.28)", "rgba(0,0,0,.82)"]}
            style={styles.bottomShade}
          />
        </>
      ) : null}

      {props.errorText ? (
        <View style={styles.error} pointerEvents="none">
          <View style={styles.errorIcon}><Feather name="alert-triangle" size={30} color="#67e8f9" /></View>
          <Text style={styles.errorTitle}>Oynatma başarısız</Text>
          <Text style={styles.errorText}>{props.errorText}</Text>
        </View>
      ) : null}

      {props.infoVisible ? (
        <View style={styles.mediaHud} pointerEvents="none">
          <View style={styles.accentRail} />
          <View style={styles.mediaCopy}>
            <View style={styles.titleLine}>
              {props.mediaKind === "live" ? (
                <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>CANLI</Text></View>
              ) : null}
              <Text numberOfLines={1} style={styles.mediaTitle}>{props.title}</Text>
            </View>
            {props.meta ? <Text numberOfLines={1} style={styles.mediaMeta}>{props.meta}</Text> : null}
          </View>
          <View style={styles.infoBadges}>
            <View style={styles.fitBadge}><Feather name="maximize-2" size={11} color="#dbeafe" /><Text style={styles.fitBadgeText}>{fitLabel(props.fitMode)}</Text></View>
            <View style={styles.codecBadge}><Feather name="cpu" size={11} color="#67e8f9" /><Text style={styles.codecBadgeText}>{playerCodecLabel(props.codecMode)}</Text></View>
          </View>
        </View>
      ) : null}

      {props.controlsVisible && props.canExit ? (
        <Pressable onPress={props.onExit} style={({ pressed }) => [styles.back, pressed && styles.pressed]} hitSlop={10}>
          <Feather name="arrow-left" size={25} color="#fff" />
        </Pressable>
      ) : null}

      {props.controlsVisible ? (
        <>
          <View style={styles.center} pointerEvents="box-none">
            {props.mediaKind !== "live" ? (
              <RoundAction onPress={() => props.onSeekBy(-10)} icon="rotate-ccw" badge="10" />
            ) : props.canNavigate ? (
              <RoundAction onPress={() => props.onMoveRelative(-1)} icon="skip-back" disabled={props.currentIndex <= 0} />
            ) : null}

            <Pressable onPress={props.onTogglePause} style={({ pressed }) => [styles.playShell, pressed && styles.playPressed]} hitSlop={10}>
              <LinearGradient colors={["#a5f3fc", "#22d3ee", "#0ea5e9"]} style={styles.playGradient}>
                <Feather name={props.paused ? "play" : "pause"} size={34} color="#02131b" />
              </LinearGradient>
            </Pressable>

            {props.mediaKind !== "live" ? (
              <RoundAction onPress={() => props.onSeekBy(15)} icon="rotate-cw" badge="15" />
            ) : props.canNavigate ? (
              <RoundAction onPress={() => props.onMoveRelative(1)} icon="skip-forward" disabled={props.currentIndex >= props.selectableItems.length - 1} />
            ) : null}
          </View>

          <View style={styles.bottom} pointerEvents="box-none">
            {props.mediaKind !== "live" ? (
              <View style={styles.seekCard}>
                <Text style={styles.time}>{formatTime(props.position)}</Text>
                <Pressable
                  onLayout={onSeekLayout}
                  onPress={(event) => props.onSeekRatio(
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
                  </View>
                </Pressable>
                <Text style={[styles.time, styles.timeRight]}>{formatTime(props.duration)}</Text>
              </View>
            ) : null}

            <View style={styles.dockShell}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.dockContent}
              >
                {props.canNavigate ? (
                  <ToolButton
                    onPress={() => props.onMoveRelative(-1)}
                    icon="skip-back"
                    label="Önceki"
                    disabled={props.currentIndex <= 0}
                  />
                ) : null}
                {props.selectableItems.length ? (
                  <ToolButton
                    onPress={() => props.onTogglePanel("content")}
                    icon="list"
                    label={props.mediaKind === "live" ? "Kanallar" : "Liste"}
                    active={props.panel === "content"}
                  />
                ) : null}
                {props.canNavigate ? (
                  <ToolButton
                    onPress={() => props.onMoveRelative(1)}
                    icon="skip-forward"
                    label="Sonraki"
                    disabled={props.currentIndex >= props.selectableItems.length - 1}
                  />
                ) : null}

                {(props.canNavigate || props.selectableItems.length) ? <DockDivider /> : null}

                <ToolButton
                  onPress={props.onCycleFit}
                  icon="maximize-2"
                  label="Görüntü"
                  meta={fitLabel(props.fitMode)}
                  accent
                />
                <ToolButton onPress={props.onRotate} icon="rotate-cw" label="Döndür" />
                {props.pipSupported ? (
                  <ToolButton onPress={props.onEnterPip} label="PiP" glyph="PiP" />
                ) : null}

                <DockDivider />

                <ToolButton
                  onPress={() => props.onTogglePanel("subtitles")}
                  label="Altyazı"
                  glyph="CC"
                  active={props.panel === "subtitles"}
                />
                <ToolButton
                  onPress={() => props.onTogglePanel("audio")}
                  icon="volume-2"
                  label="Ses"
                  active={props.panel === "audio"}
                />
                <ToolButton
                  onPress={() => props.onTogglePanel("codec")}
                  icon="cpu"
                  label="Codec"
                  meta={playerCodecLabel(props.codecMode)}
                  active={props.panel === "codec"}
                  accent
                />
                {props.allowDownload ? (
                  <ToolButton
                    onPress={props.onDownload}
                    icon={props.downloadState === "done"
                      ? "check-circle"
                      : props.downloadState === "error"
                        ? "alert-circle"
                        : "download"}
                    label={props.downloadState === "done" ? "İndirildi" : "İndir"}
                    accent={props.downloadState === "done"}
                  />
                ) : null}
              </ScrollView>
            </View>
          </View>
        </>
      ) : null}

      {props.panel ? (
        <View style={panelStyle}>
          <LinearGradient colors={["rgba(14,165,233,.18)", "rgba(6,11,20,0)"]} style={styles.panelGlow} pointerEvents="none" />
          <PanelContent {...props} />
        </View>
      ) : null}

      {props.downloadState === "downloading" ? (
        <View style={styles.toast} pointerEvents="none">
          <View style={styles.toastIcon}><Feather name="download-cloud" size={18} color="#67e8f9" /></View>
          <View>
            <Text style={styles.toastTitle}>İndiriliyor</Text>
            <Text style={styles.toastText}>%{Math.round(props.downloadProgress * 100)}</Text>
          </View>
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
        ListHeaderComponent={<PanelHeader title={props.mediaKind === "live" ? "Kanal listesi" : "İçerik listesi"} hint={`${props.selectableItems.length} öğe`} />}
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() => props.onSwitchTo(item)}
            style={({ pressed }) => [
              styles.row,
              index === props.currentIndex && styles.rowActive,
              pressed && styles.rowPressed,
            ]}
          >
            <View style={styles.rowMain}>
              {index === props.currentIndex ? <View style={styles.rowDot} /> : null}
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={styles.rowTitle}>{item.title}</Text>
                {item.subtitle ? <Text numberOfLines={1} style={styles.rowSub}>{item.subtitle}</Text> : null}
              </View>
            </View>
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
        ListHeaderComponent={<PanelHeader title="Altyazı" hint={props.textTracks.length ? "Gömülü altyazı parçasını seçin." : "Bu içerikte gömülü altyazı bulunamadı."} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => props.onSelectSubtitle(item.id)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
            <View style={styles.rowHeadline}>
              <View style={styles.rowIcon}><Text style={styles.ccSmall}>CC</Text></View>
              <Text style={styles.rowTitle}>{item.name}</Text>
            </View>
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
        ListHeaderComponent={<PanelHeader title="Ses" hint={props.audioTracks.length ? "Ses parçasını seçin." : "Bu içerikte seçilebilir ek ses parçası bulunamadı."} />}
        ListEmptyComponent={<View />}
        renderItem={({ item }) => (
          <Pressable onPress={() => props.onSelectAudio(item.id)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
            <View style={styles.rowHeadline}>
              <View style={styles.rowIcon}><Feather name="volume-2" size={16} color="#67e8f9" /></View>
              <Text style={styles.rowTitle}>{item.name}</Text>
            </View>
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
          style={({ pressed }) => [
            styles.row,
            props.codecMode === item.id && styles.rowActive,
            pressed && styles.rowPressed,
          ]}
        >
          <View style={styles.rowHeadline}>
            <View style={[styles.rowIcon, props.codecMode === item.id && styles.rowIconActive]}>
              <Feather name={item.icon} size={17} color={props.codecMode === item.id ? "#02131b" : "#67e8f9"} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowSub}>{item.subtitle}</Text>
            </View>
            {props.codecMode === item.id ? <Feather name="check" size={18} color="#67e8f9" /> : null}
          </View>
        </Pressable>
      )}
    />
  );
}

function PanelHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.panelHeader}>
      <View style={styles.panelEyebrow}><View style={styles.panelEyebrowDot} /><Text style={styles.panelEyebrowText}>LEGENDSTREAM PLAYER</Text></View>
      <Text style={styles.panelHeading}>{title}</Text>
      {hint ? <Text style={styles.panelHint}>{hint}</Text> : null}
    </View>
  );
}

function RoundAction({ onPress, icon, disabled = false, badge }: {
  onPress: () => void;
  icon: React.ComponentProps<typeof Feather>["name"];
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.roundAction, disabled && styles.disabled, pressed && styles.pressed]}
      hitSlop={8}
    >
      <Feather name={icon} size={27} color="#fff" />
      {badge ? <Text style={styles.roundBadge}>{badge}</Text> : null}
    </Pressable>
  );
}

function ToolButton({
  onPress,
  icon,
  label,
  meta,
  glyph,
  disabled = false,
  active = false,
  accent = false,
}: {
  onPress: () => void;
  icon?: React.ComponentProps<typeof Feather>["name"];
  label: string;
  meta?: string;
  glyph?: string;
  disabled?: boolean;
  active?: boolean;
  accent?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.tool, disabled && styles.disabled, pressed && styles.toolPressed]}
      hitSlop={4}
    >
      <View style={[styles.toolIcon, (active || accent) && styles.toolIconAccent, active && styles.toolIconActive]}>
        {glyph ? (
          <Text style={[styles.toolGlyph, (active || accent) && styles.toolGlyphAccent]}>{glyph}</Text>
        ) : icon ? (
          <Feather name={icon} size={19} color={(active || accent) ? "#67e8f9" : "#f8fafc"} />
        ) : null}
      </View>
      <Text numberOfLines={1} style={[styles.toolLabel, active && styles.toolLabelActive]}>{label}</Text>
      {meta ? <Text style={styles.toolMeta}>{meta}</Text> : null}
    </Pressable>
  );
}

function DockDivider() {
  return <View style={styles.dockDivider} />;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 20 },
  topShade: { position: "absolute", zIndex: 3, top: 0, left: 0, right: 0, height: 128 },
  bottomShade: { position: "absolute", zIndex: 3, bottom: 0, left: 0, right: 0, height: 225 },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.86 },
  disabled: { opacity: 0.32 },

  back: {
    position: "absolute", zIndex: 7, top: 18, left: 18,
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: "rgba(3,10,18,.78)", borderWidth: 1,
    borderColor: "rgba(255,255,255,.16)", alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 14, elevation: 10,
  },
  mediaHud: {
    position: "absolute", zIndex: 6, top: 18, left: 82, right: 18,
    minHeight: 58, borderRadius: 18, backgroundColor: "rgba(3,10,18,.76)",
    borderWidth: 1, borderColor: "rgba(255,255,255,.13)", paddingRight: 13,
    flexDirection: "row", alignItems: "center", overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 18, elevation: 8,
  },
  accentRail: { alignSelf: "stretch", width: 4, backgroundColor: "#22d3ee", marginRight: 12 },
  mediaCopy: { flex: 1, minWidth: 0, paddingVertical: 9 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  mediaTitle: { flex: 1, color: "#fff", fontSize: 16, fontWeight: "900", letterSpacing: 0.1 },
  mediaMeta: { color: "#9fb0c5", fontSize: 12, marginTop: 3, fontWeight: "600" },
  livePill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: "rgba(34,211,238,.12)", borderWidth: 1, borderColor: "rgba(34,211,238,.28)" },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22d3ee" },
  liveText: { color: "#67e8f9", fontSize: 9, fontWeight: "900", letterSpacing: 0.6 },
  infoBadges: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 8 },
  fitBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: "rgba(255,255,255,.07)", borderWidth: 1, borderColor: "rgba(255,255,255,.13)" },
  fitBadgeText: { color: "#e2e8f0", fontSize: 9, fontWeight: "900", letterSpacing: 0.4 },
  codecBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: "rgba(34,211,238,.12)", borderWidth: 1, borderColor: "rgba(34,211,238,.3)" },
  codecBadgeText: { color: "#67e8f9", fontSize: 9, fontWeight: "900", letterSpacing: 0.4 },

  center: {
    position: "absolute", zIndex: 7, left: 0, right: 0, top: "39%",
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 34,
  },
  roundAction: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: "rgba(3,10,18,.64)", borderWidth: 1,
    borderColor: "rgba(255,255,255,.17)", alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  roundBadge: { position: "absolute", color: "#fff", fontWeight: "900", fontSize: 9, backgroundColor: "rgba(3,10,18,.72)", paddingHorizontal: 3, borderRadius: 4 },
  playShell: {
    width: 78, height: 78, borderRadius: 39, padding: 4,
    backgroundColor: "rgba(255,255,255,.12)", borderWidth: 1,
    borderColor: "rgba(103,232,249,.55)", shadowColor: "#22d3ee",
    shadowOpacity: 0.42, shadowRadius: 20, elevation: 13,
  },
  playGradient: { flex: 1, borderRadius: 35, alignItems: "center", justifyContent: "center" },
  playPressed: { transform: [{ scale: 0.95 }] },

  bottom: { position: "absolute", zIndex: 7, left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingBottom: 12 },
  seekCard: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 9, paddingHorizontal: 10, minHeight: 34 },
  time: { color: "#f8fafc", fontWeight: "800", fontSize: 12, minWidth: 45, fontVariant: ["tabular-nums"] },
  timeRight: { textAlign: "right" },
  seekTouch: { flex: 1, height: 24, justifyContent: "center" },
  seekTrack: { height: 5, backgroundColor: "rgba(255,255,255,.26)", borderRadius: 999, overflow: "hidden" },
  seekFill: { height: 5, borderRadius: 999 },
  dockShell: {
    borderRadius: 22, backgroundColor: "rgba(3,10,18,.86)", borderWidth: 1,
    borderColor: "rgba(255,255,255,.13)", overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.38, shadowRadius: 18, elevation: 12,
  },
  dockContent: { alignItems: "center", paddingHorizontal: 8, paddingVertical: 7, gap: 2 },
  dockDivider: { width: 1, height: 34, marginHorizontal: 4, backgroundColor: "rgba(255,255,255,.11)" },
  tool: { width: 58, minHeight: 57, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 3, paddingVertical: 3 },
  toolPressed: { backgroundColor: "rgba(255,255,255,.07)", transform: [{ scale: 0.96 }] },
  toolIcon: { width: 32, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent" },
  toolIconAccent: { backgroundColor: "rgba(34,211,238,.09)", borderColor: "rgba(34,211,238,.22)" },
  toolIconActive: { backgroundColor: "rgba(34,211,238,.18)", borderColor: "rgba(103,232,249,.42)" },
  toolGlyph: { color: "#f8fafc", fontSize: 11, fontWeight: "900", letterSpacing: -0.2 },
  toolGlyphAccent: { color: "#67e8f9" },
  toolLabel: { color: "#cbd5e1", fontSize: 8.5, fontWeight: "800", marginTop: 1 },
  toolLabelActive: { color: "#fff" },
  toolMeta: { color: "#67e8f9", fontSize: 7.5, fontWeight: "900", marginTop: -1, letterSpacing: 0.3 },

  panel: {
    position: "absolute", zIndex: 11, right: 16, top: 82, bottom: 92,
    backgroundColor: "rgba(4,10,20,.985)", borderRadius: 22, borderWidth: 1,
    borderColor: "rgba(103,232,249,.2)", padding: 8, overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 24, elevation: 16,
  },
  panelLandscape: { width: "46%", maxWidth: 460 },
  panelPortrait: { left: 16, right: 16, width: undefined },
  panelGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 110 },
  panelHeader: { paddingHorizontal: 12, paddingTop: 11, paddingBottom: 9 },
  panelEyebrow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 5 },
  panelEyebrowDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22d3ee" },
  panelEyebrowText: { color: "#67e8f9", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  panelHeading: { color: "#fff", fontSize: 20, fontWeight: "900", letterSpacing: -0.3 },
  panelHint: { color: "#8fa1b7", fontSize: 12, paddingTop: 6, lineHeight: 17 },
  row: { marginHorizontal: 2, paddingVertical: 11, paddingHorizontal: 11, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,.07)", borderRadius: 12 },
  rowActive: { backgroundColor: "rgba(34,211,238,.105)", borderBottomColor: "rgba(34,211,238,.2)" },
  rowPressed: { backgroundColor: "rgba(255,255,255,.06)" },
  rowMain: { flexDirection: "row", alignItems: "center", gap: 9 },
  rowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#22d3ee" },
  rowCopy: { flex: 1, minWidth: 0 },
  rowHeadline: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(34,211,238,.08)", borderWidth: 1, borderColor: "rgba(34,211,238,.16)" },
  rowIconActive: { backgroundColor: "#67e8f9", borderColor: "#67e8f9" },
  rowTitle: { color: "#fff", fontWeight: "800", fontSize: 14 },
  rowSub: { color: "#8fa1b7", fontSize: 11.5, marginTop: 3, lineHeight: 16 },
  ccSmall: { color: "#67e8f9", fontSize: 10, fontWeight: "900", borderWidth: 1, borderColor: "#67e8f9", borderRadius: 3, paddingHorizontal: 2 },

  toast: {
    position: "absolute", zIndex: 12, top: 86, right: 18,
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "rgba(3,10,18,.9)", borderWidth: 1,
    borderColor: "rgba(103,232,249,.22)", borderRadius: 15,
    paddingHorizontal: 13, paddingVertical: 10,
  },
  toastIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(34,211,238,.1)" },
  toastTitle: { color: "#fff", fontWeight: "800", fontSize: 11 },
  toastText: { color: "#67e8f9", fontWeight: "900", fontSize: 12 },

  error: { ...StyleSheet.absoluteFillObject, zIndex: 15, alignItems: "center", justifyContent: "center", padding: 30, backgroundColor: "#07101f" },
  errorIcon: { width: 62, height: 62, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(34,211,238,.1)", borderWidth: 1, borderColor: "rgba(34,211,238,.22)", marginBottom: 14 },
  errorTitle: { color: "#fff", fontSize: 26, fontWeight: "900", marginBottom: 10 },
  errorText: { color: "#9ca3af", textAlign: "center", maxWidth: 560, lineHeight: 21 },
});
