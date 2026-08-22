import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { PlayerChrome as PlayerChromeV2, playerCodecLabel } from "./PlayerChromeV2";
import { getPlayerRuntimeInfoSnapshot, subscribePlayerRuntimeInfo } from "@/lib/playerRuntimeInfo";
import type { PlayerFitMode } from "./VlcPlaybackSurface";

export type { PlayerPanel, PlayerSelectableItem, PlayerMediaKind, PlayerDownloadState } from "./PlayerChromeV2";
export { playerCodecLabel };

const initializedPlayers = new WeakSet<Function>();
type FeatherName = React.ComponentProps<typeof Feather>["name"];
type Props = React.ComponentProps<typeof PlayerChromeV2> & { resolution?: string; fps?: number };
type Action = { key: string; label: string; icon?: FeatherName; glyph?: string; badge?: string; active?: boolean; accent?: boolean; onPress: () => void };

const fitLabel = (mode: PlayerFitMode) => mode === "full" ? "FULL" : mode === "original" ? "ORIG" : mode === "16:9" ? "16:9" : mode === "4:3" ? "4:3" : "FIT";
const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const value = Math.floor(seconds), h = Math.floor(value / 3600), m = Math.floor((value % 3600) / 60), s = value % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};
const formatFps = (fps: number) => Math.abs(fps - Math.round(fps)) < 0.015 ? String(Math.round(fps)) : fps.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");

export function PlayerChrome(props: Props) {
  const { width, height } = useWindowDimensions();
  const portrait = height > width;
  const [seekWidth, setSeekWidth] = useState(1);
  const [moreOpen, setMoreOpen] = useState(false);
  const runtime = useSyncExternalStore(subscribePlayerRuntimeInfo, getPlayerRuntimeInfoSnapshot, getPlayerRuntimeInfoSnapshot);
  const { resolution: resolutionOverride, fps: fpsOverride, ...chrome } = props;

  useEffect(() => {
    const cycle = props.onCycleFit as unknown as Function;
    if (initializedPlayers.has(cycle)) return;
    initializedPlayers.add(cycle);
    if (props.fitMode === "fit") { props.onCycleFit(); props.onCycleFit(); }
  }, [props.fitMode, props.onCycleFit]);

  useEffect(() => {
    if (!chrome.controlsVisible || chrome.panel || !portrait) setMoreOpen(false);
  }, [chrome.controlsVisible, chrome.panel, portrait]);

  const resolution = resolutionOverride ?? runtime.resolution;
  const fps = fpsOverride ?? runtime.fps;
  const tech = resolution ? `${resolution}${fps ? ` · ${formatFps(fps)} FPS` : ""}` : fps ? `${formatFps(fps)} FPS` : undefined;
  const progress = chrome.duration > 0 ? Math.max(0, Math.min(1, chrome.position / chrome.duration)) : 0;
  const showCenter = chrome.controlsVisible && !chrome.panel;

  const portraitMain: Action[] = [
    ...(chrome.selectableItems.length ? [{ key: "list", label: chrome.mediaKind === "live" ? "Kanal listesi" : "İçerik listesi", icon: "list" as FeatherName, active: chrome.panel === "content", onPress: () => chrome.onTogglePanel("content") }] : []),
    { key: "fit", label: `Görüntü ${fitLabel(chrome.fitMode)}`, icon: "maximize-2", badge: fitLabel(chrome.fitMode), accent: true, onPress: chrome.onCycleFit },
    ...(chrome.pipSupported ? [{ key: "pip", label: "Picture in Picture", glyph: "PiP", onPress: chrome.onEnterPip }] : []),
    { key: "cc", label: "Altyazı", glyph: "CC", active: chrome.panel === "subtitles", onPress: () => chrome.onTogglePanel("subtitles") },
  ];
  const portraitMore: Action[] = [
    { key: "rotate", label: "Ekranı döndür", icon: "rotate-cw", onPress: chrome.onRotate },
    { key: "audio", label: "Ses parçası", icon: "volume-2", active: chrome.panel === "audio", onPress: () => chrome.onTogglePanel("audio") },
    { key: "codec", label: `Codec ${playerCodecLabel(chrome.codecMode)}`, icon: "cpu", badge: playerCodecLabel(chrome.codecMode), accent: true, active: chrome.panel === "codec", onPress: () => chrome.onTogglePanel("codec") },
    ...(chrome.allowDownload ? [{ key: "download", label: chrome.downloadState === "done" ? "İndirildi" : "İndir", icon: (chrome.downloadState === "done" ? "check-circle" : chrome.downloadState === "error" ? "alert-circle" : "download") as FeatherName, active: chrome.downloadState === "done", onPress: chrome.onDownload }] : []),
  ];

  return <>
    <PlayerChromeV2 {...chrome} controlsVisible={false} infoVisible={false} />

    {chrome.infoVisible ? <InfoCard portrait={portrait} title={chrome.title} meta={chrome.meta} live={chrome.mediaKind === "live"} tech={tech} fit={chrome.fitMode} codec={chrome.codecMode} /> : null}

    {chrome.controlsVisible && chrome.canExit ? <Pressable accessibilityRole="button" accessibilityLabel="Oynatıcıdan çık" onPress={chrome.onExit} style={({ pressed }) => [styles.back, portrait ? styles.backP : styles.backL, pressed && styles.pressed]}><Feather name="arrow-left" size={portrait ? 24 : 27} color="#fff" /></Pressable> : null}

    {showCenter ? <View style={[styles.center, portrait ? styles.centerP : styles.centerL]} pointerEvents="box-none">
      {chrome.mediaKind !== "live" ? <Round icon="rotate-ccw" badge="10" compact={portrait} label="10 saniye geri" onPress={() => chrome.onSeekBy(-10)} /> : chrome.canNavigate ? <Round icon="skip-back" compact={portrait} label="Önceki kanal" onPress={() => chrome.onMoveRelative(-1)} /> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={chrome.paused ? "Oynat" : "Duraklat"} onPress={chrome.onTogglePause} style={({ pressed }) => [styles.play, portrait && styles.playP, pressed && styles.pressed]}><LinearGradient colors={["#c7fbff", "#22d3ee", "#0ea5e9"]} style={styles.playInner}><Feather name={chrome.paused ? "play" : "pause"} size={portrait ? 30 : 36} color="#02131b" /></LinearGradient></Pressable>
      {chrome.mediaKind !== "live" ? <Round icon="rotate-cw" badge="15" compact={portrait} label="15 saniye ileri" onPress={() => chrome.onSeekBy(15)} /> : chrome.canNavigate ? <Round icon="skip-forward" compact={portrait} label="Sonraki kanal" onPress={() => chrome.onMoveRelative(1)} /> : null}
    </View> : null}

    {chrome.controlsVisible ? <View style={[styles.bottom, portrait ? styles.bottomP : styles.bottomL]} pointerEvents="box-none">
      {chrome.mediaKind !== "live" && !chrome.panel ? <View style={styles.seekRow}>
        <Text style={styles.time}>{formatTime(chrome.position)}</Text>
        <Pressable onLayout={(e: LayoutChangeEvent) => setSeekWidth(Math.max(1, e.nativeEvent.layout.width))} onPress={(e) => chrome.onSeekRatio(Math.max(0, Math.min(1, e.nativeEvent.locationX / seekWidth)))} style={styles.seekTouch} hitSlop={{ top: 12, bottom: 12, left: 0, right: 0 }}><View style={styles.seekTrack}><View style={[styles.seekFill, { width: `${progress * 100}%` }]} /><View style={[styles.seekThumb, { left: `${progress * 100}%` }]} /></View></Pressable>
        <Text style={[styles.time, styles.timeR]}>{formatTime(chrome.duration)}</Text>
      </View> : null}

      {portrait ? <>
        {moreOpen && !chrome.panel ? <View style={styles.more}>{portraitMore.map((a) => <Dock key={a.key} action={a} compact />)}</View> : null}
        <Glass style={styles.dockP}><View style={styles.rowP}>{portraitMain.map((a) => <Dock key={a.key} action={a} compact />)}<Dock compact action={{ key: "more", label: "Daha fazla", icon: moreOpen ? "x" : "more-horizontal", active: moreOpen, onPress: () => setMoreOpen((v) => !v) }} /></View></Glass>
      </> : <Glass style={styles.dockL}><View style={styles.rowL}>
        {chrome.selectableItems.length ? <Dock action={{ key: "list", label: "Liste", icon: "list", active: chrome.panel === "content", onPress: () => chrome.onTogglePanel("content") }} /> : null}
        <Dock action={{ key: "fit", label: "Görüntü", icon: "maximize-2", badge: fitLabel(chrome.fitMode), accent: true, onPress: chrome.onCycleFit }} />
        <Dock action={{ key: "rotate", label: "Döndür", icon: "rotate-cw", onPress: chrome.onRotate }} />
        {chrome.pipSupported ? <Dock action={{ key: "pip", label: "PiP", glyph: "PiP", onPress: chrome.onEnterPip }} /> : null}
        <Divider />
        <Dock action={{ key: "cc", label: "Altyazı", glyph: "CC", active: chrome.panel === "subtitles", onPress: () => chrome.onTogglePanel("subtitles") }} />
        <Dock action={{ key: "audio", label: "Ses", icon: "volume-2", active: chrome.panel === "audio", onPress: () => chrome.onTogglePanel("audio") }} />
        <Dock action={{ key: "codec", label: "Codec", icon: "cpu", badge: playerCodecLabel(chrome.codecMode), accent: true, active: chrome.panel === "codec", onPress: () => chrome.onTogglePanel("codec") }} />
        {chrome.allowDownload ? <Dock action={{ key: "download", label: "İndir", icon: chrome.downloadState === "done" ? "check-circle" : chrome.downloadState === "error" ? "alert-circle" : "download", active: chrome.downloadState === "done", onPress: chrome.onDownload }} /> : null}
      </View></Glass>}
    </View> : null}
  </>;
}

function InfoCard({ portrait, title, meta, live, tech, fit, codec }: { portrait: boolean; title: string; meta?: string; live: boolean; tech?: string; fit: PlayerFitMode; codec: Props["codecMode"] }) {
  return <View pointerEvents="none" style={[styles.info, portrait ? styles.infoP : styles.infoL]}><LinearGradient colors={["rgba(5,14,23,.96)", "rgba(5,12,20,.86)"]} style={StyleSheet.absoluteFillObject} /><View style={styles.rail} /><View style={styles.infoMain}><View style={styles.titleRow}>{live ? <View style={styles.live}><View style={styles.dot} /><Text style={styles.liveText}>CANLI</Text></View> : null}<Text numberOfLines={1} style={[styles.title, portrait && styles.titleP]}>{title}</Text></View><View style={styles.metaRow}>{meta ? <Text numberOfLines={1} style={styles.meta}>{meta}</Text> : null}<View style={[styles.tech, !tech && styles.techMuted]}><Feather name="monitor" size={11} color={tech ? "#67e8f9" : "#64748b"} /><Text numberOfLines={1} style={tech ? styles.techText : styles.techMutedText}>{tech ?? "Akış bilgisi bekleniyor"}</Text></View></View></View>{!portrait ? <View style={styles.modes}><Chip icon="maximize-2" text={fitLabel(fit)} /><Chip icon="cpu" text={playerCodecLabel(codec)} accent /></View> : null}</View>;
}

function Chip({ icon, text, accent }: { icon: FeatherName; text: string; accent?: boolean }) { return <View style={[styles.chip, accent && styles.chipA]}><Feather name={icon} size={11} color={accent ? "#67e8f9" : "#cbd5e1"} /><Text style={[styles.chipText, accent && styles.chipTextA]}>{text}</Text></View>; }
function Round({ icon, badge, compact, label, onPress }: { icon: FeatherName; badge?: string; compact?: boolean; label: string; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.round, compact && styles.roundP, pressed && styles.pressed]}><Feather name={icon} size={compact ? 24 : 29} color="#fff" />{badge ? <Text style={styles.roundBadge}>{badge}</Text> : null}</Pressable>; }
function Glass({ style, children }: { style: object; children: React.ReactNode }) { return <View style={[styles.glass, style]}><LinearGradient pointerEvents="none" colors={["rgba(13,23,34,.97)", "rgba(4,9,15,.97)"]} style={StyleSheet.absoluteFillObject} /><View style={styles.glow} />{children}</View>; }
function Dock({ action, compact }: { action: Action; compact?: boolean }) { const hi = action.active || action.accent; return <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} style={({ pressed }) => [styles.dock, compact && styles.dockC, hi && styles.dockHi, action.active && styles.dockActive, pressed && styles.pressed]}>{action.icon ? <Feather name={action.icon} size={compact ? 20 : 22} color={hi ? "#8beeff" : "#fff"} /> : <Text style={[styles.glyph, hi && styles.glyphA]}>{action.glyph}</Text>}{action.badge ? <View style={styles.badge}><Text numberOfLines={1} style={styles.badgeText}>{action.badge}</Text></View> : null}</Pressable>; }
function Divider() { return <View style={styles.divider} />; }

const styles = StyleSheet.create({
  info: { position: "absolute", zIndex: 52, top: 18, overflow: "hidden", borderWidth: 1, borderColor: "rgba(71,101,124,.42)", backgroundColor: "#07101a", elevation: 8, flexDirection: "row", alignItems: "center" },
  infoL: { left: 94, right: 24, minHeight: 62, borderRadius: 18, paddingLeft: 18, paddingRight: 14 },
  infoP: { left: 72, right: 14, minHeight: 70, borderRadius: 18, paddingLeft: 14, paddingRight: 10 },
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: "#22d3ee" },
  infoMain: { flex: 1, minWidth: 0, paddingVertical: 9 }, titleRow: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }, title: { flex: 1, color: "#f8fafc", fontSize: 18, fontWeight: "900" }, titleP: { fontSize: 15 },
  live: { height: 23, paddingHorizontal: 8, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: "rgba(34,211,238,.38)", backgroundColor: "rgba(8,145,178,.16)" }, dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22d3ee" }, liveText: { color: "#8beeff", fontSize: 10, fontWeight: "900" },
  metaRow: { marginTop: 5, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }, meta: { flexShrink: 1, color: "#94a3b8", fontSize: 11, fontWeight: "700" }, tech: { flexShrink: 0, minHeight: 22, paddingHorizontal: 7, borderRadius: 11, flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: "rgba(103,232,249,.28)", backgroundColor: "rgba(8,145,178,.11)" }, techMuted: { borderColor: "transparent", backgroundColor: "transparent" }, techText: { color: "#dffaff", fontSize: 10, fontWeight: "900" }, techMutedText: { color: "#64748b", fontSize: 9, fontWeight: "700" },
  modes: { marginLeft: 10, flexDirection: "row", gap: 6 }, chip: { height: 29, minWidth: 62, paddingHorizontal: 9, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderWidth: 1, borderColor: "rgba(148,163,184,.22)", backgroundColor: "rgba(15,23,42,.66)" }, chipA: { borderColor: "rgba(34,211,238,.38)", backgroundColor: "rgba(8,145,178,.12)" }, chipText: { color: "#e2e8f0", fontSize: 10, fontWeight: "900" }, chipTextA: { color: "#8beeff" },
  back: { position: "absolute", zIndex: 65, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5,12,20,.88)", borderWidth: 1, borderColor: "rgba(148,163,184,.28)", elevation: 12 }, backL: { left: 22, top: 20, width: 56, height: 56, borderRadius: 28 }, backP: { left: 16, top: 20, width: 48, height: 48, borderRadius: 24 },
  center: { position: "absolute", zIndex: 60, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "center" }, centerL: { top: "50%", transform: [{ translateY: -44 }], gap: 54 }, centerP: { top: "48%", transform: [{ translateY: -38 }], gap: 28 }, round: { width: 66, height: 66, borderRadius: 33, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5,12,20,.72)", borderWidth: 1, borderColor: "rgba(148,163,184,.32)", elevation: 7 }, roundP: { width: 54, height: 54, borderRadius: 27 }, roundBadge: { position: "absolute", color: "#fff", fontSize: 9, fontWeight: "900" }, play: { width: 86, height: 86, borderRadius: 43, padding: 5, backgroundColor: "rgba(34,211,238,.18)", borderWidth: 1, borderColor: "rgba(103,232,249,.58)", elevation: 14 }, playP: { width: 74, height: 74, borderRadius: 37 }, playInner: { flex: 1, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  bottom: { position: "absolute", zIndex: 62, left: 0, right: 0 }, bottomL: { bottom: 18, paddingHorizontal: 28 }, bottomP: { bottom: 14, paddingHorizontal: 12 }, seekRow: { width: "100%", height: 32, marginBottom: 7, flexDirection: "row", alignItems: "center", gap: 8 }, time: { width: 54, color: "#fff", fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] }, timeR: { textAlign: "right" }, seekTouch: { flex: 1, height: 28, justifyContent: "center" }, seekTrack: { height: 4, borderRadius: 2, backgroundColor: "rgba(226,232,240,.3)", overflow: "visible" }, seekFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: "#22d3ee" }, seekThumb: { position: "absolute", top: -4, marginLeft: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: "#67e8f9", borderWidth: 2, borderColor: "#e6fcff" },
  glass: { overflow: "hidden", borderWidth: 1, borderColor: "rgba(71,101,124,.46)", backgroundColor: "#050b12", elevation: 12 }, dockL: { alignSelf: "center", minHeight: 64, paddingHorizontal: 10, borderRadius: 23 }, dockP: { width: "100%", minHeight: 62, paddingHorizontal: 6, borderRadius: 21 }, glow: { position: "absolute", left: 18, right: 18, top: 0, height: 1, backgroundColor: "rgba(103,232,249,.54)" }, rowL: { minHeight: 62, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, rowP: { minHeight: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-evenly" },
  dock: { width: 52, height: 49, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent", backgroundColor: "rgba(15,23,42,.48)" }, dockC: { width: 46, height: 46, borderRadius: 14 }, dockHi: { borderColor: "rgba(34,211,238,.3)", backgroundColor: "rgba(8,145,178,.12)" }, dockActive: { borderColor: "rgba(103,232,249,.72)", backgroundColor: "rgba(8,145,178,.2)" }, glyph: { color: "#fff", fontSize: 15, fontWeight: "900" }, glyphA: { color: "#8beeff" }, badge: { position: "absolute", right: 2, bottom: 2, minWidth: 24, maxWidth: 42, height: 15, paddingHorizontal: 3, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(8,47,73,.96)", borderWidth: 1, borderColor: "rgba(103,232,249,.58)" }, badgeText: { color: "#a5f3fc", fontSize: 7, fontWeight: "900" }, divider: { width: 1, height: 32, marginHorizontal: 1, backgroundColor: "rgba(148,163,184,.18)" },
  more: { alignSelf: "center", marginBottom: 7, padding: 6, borderRadius: 17, flexDirection: "row", gap: 5, backgroundColor: "rgba(4,9,15,.97)", borderWidth: 1, borderColor: "rgba(71,101,124,.5)", elevation: 14 }, pressed: { opacity: 0.76, transform: [{ scale: 0.96 }] },
});
