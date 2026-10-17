import React, { useEffect, useId, useReducer, useRef, useState } from "react";
import {
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewStyle,
} from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";
import {
  eliteLayout,
  eliteOverlaySurface,
  eliteTargetVisual,
  eliteTokens as t,
  type EliteMode,
  type EliteEdges,
} from "../../lib/design/eliteTokens";
import {
  eliteChannels,
  eliteDemoReduce,
  eliteInitialState,
  elitePosters,
  eliteRestoreId,
  eliteSections,
} from "../../lib/design/eliteShowcaseModel";

type FocusNode = { focus?: () => void };
type IconName =
  | "home"
  | "tv"
  | "film"
  | "grid"
  | "settings"
  | "play"
  | "list"
  | "close"
  | "menu"
  | "arrow";
const paths: Record<IconName, string> = {
  home: "M3 10 12 3l9 7v10H4V10m5 10v-7h6v7",
  tv: "M4 6h16v13H4ZM8 2l4 4 4-4",
  film: "M3 4h18v16H3ZM7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4",
  grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
  settings:
    "M9 3h6l1 4 4 2v6l-4 2-1 4H9l-1-4-4-2V9l4-2ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  play: "m8 4 12 8-12 8Z",
  list: "M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1",
  close: "m5 5 14 14M19 5 5 19",
  menu: "M4 6h16M4 12h16M4 18h16",
  arrow: "m14 5-7 7 7 7M7 12h14",
};
function Icon({
  name,
  color = t.color.text,
  size = 24,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={paths[name]}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={name === "play" ? color : "none"}
      />
    </Svg>
  );
}
/** Original vector fixture art; no licensed poster, network image or provider title is fetched. */
function LandscapeArt({ tone = "#24636A" }: { tone?: string }) {
  const suffix = useId().replace(/\W/g, "");
  const sky = `sky${suffix}`,
    shade = `shade${suffix}`;
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 1000 540"
      preserveAspectRatio="xMidYMid slice"
    >
      <Defs>
        <LinearGradient id={sky} x1="0" y1="0" x2="1" y2="1">
          <Stop stopColor="#111D2B" />
          <Stop offset="1" stopColor={tone} />
        </LinearGradient>
        <LinearGradient id={shade} x1="0" y1="0" x2="1" y2="0">
          <Stop stopColor="#090C10" stopOpacity=".94" />
          <Stop offset=".75" stopColor="#090C10" stopOpacity=".05" />
        </LinearGradient>
      </Defs>
      <Rect width="1000" height="540" fill={`url(#${sky})`} />
      <Circle cx="745" cy="145" r="83" fill="#E0EAD9" opacity=".7" />
      <Path
        d="M0 430 200 190 330 350 580 100 820 380 1000 200V540H0Z"
        fill="#263A43"
      />
      <Path
        d="m480 230 100-130 110 145-95-37-25 29-31-34Z"
        fill="#ACC1C0"
        opacity=".7"
      />
      <Path d="M0 440 240 340 440 460 700 300 1000 410V540H0Z" fill="#12252D" />
      <Path d="M0 490 350 450 680 480 1000 435V540H0Z" fill="#09151B" />
      <Rect width="1000" height="540" fill={`url(#${shade})`} />
    </Svg>
  );
}

/** Isolated design fixture. No production player/provider/navigation/orientation dependencies. */
export function EliteShowcase({
  mode = Platform.isTV ? "nativeTv" : "mobile",
  width: suppliedWidth,
  height: suppliedHeight,
  fontScale: suppliedFont,
  safeArea = {},
}: {
  mode?: EliteMode;
  width?: number;
  height?: number;
  fontScale?: number;
  safeArea?: Partial<EliteEdges>;
}) {
  const window = useWindowDimensions();
  const width = suppliedWidth ?? window.width,
    height = suppliedHeight ?? window.height;
  const fontScale = suppliedFont ?? window.fontScale;
  const fontFactor = Platform.OS === "web" ? fontScale : 1;
  const m = eliteLayout(width, height, mode, fontScale, safeArea);
  const [state, dispatch] = useReducer(eliteDemoReduce, eliteInitialState);
  const [focused, setFocused] = useState<string | null>(null);
  const nodes = useRef(new Map<string, FocusNode>());
  const previousPanel = useRef(false);
  useEffect(() => {
    if (state.overlay) nodes.current.get("overlay:close")?.focus?.();
    else if (previousPanel.current) {
      const id = eliteRestoreId(state.opener, [...nodes.current.keys()]);
      if (id) nodes.current.get(id)?.focus?.();
    }
    previousPanel.current = state.overlay;
  }, [state.overlay, state.opener]);
  useEffect(() => {
    if (!state.overlay) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      dispatch({ type: "close" });
      return true;
    });
    return () => listener.remove();
  }, [state.overlay]);

  const label = (
    text: string,
    large = false,
    color: string = t.color.text,
    lines = 1,
  ) => (
    <Text
      numberOfLines={lines}
      style={{
        color,
        fontSize: (large ? m.type.title : m.type.body) * fontFactor,
        fontFamily: large ? t.typography.strong : t.typography.family,
        flexShrink: 1,
      }}
    >
      {text}
    </Text>
  );
  const target = (
    id: string,
    text: string,
    onPress: () => void,
    options: {
      icon?: IconName;
      selected?: boolean;
      active?: boolean;
      primary?: boolean;
      style?: ViewStyle;
      children?: React.ReactNode;
      panel?: boolean;
      iconOnly?: boolean;
    } = {},
  ) => {
    const visual = eliteTargetVisual(
      focused === id,
      !!options.selected,
      !!options.active,
    );
    const enabled = !state.overlay || !!options.panel;
    return (
      <Pressable
        key={id}
        ref={(node) => {
          if (node) nodes.current.set(id, node as unknown as FocusNode);
          else nodes.current.delete(id);
        }}
        testID={`elite-target:${id}`}
        nativeID={`elite:${id}`}
        accessibilityRole="button"
        accessibilityLabel={text}
        accessibilityState={{
          selected: !!options.selected,
          disabled: !enabled,
        }}
        disabled={!enabled}
        focusable={enabled}
        hasTVPreferredFocus={
          Platform.isTV && !!options.panel && id === "overlay:close"
        }
        onFocus={() => setFocused(id)}
        onBlur={() =>
          setFocused((current) => (current === id ? null : current))
        }
        onPress={onPress}
        style={[
          s.target,
          {
            minHeight: m.target,
            borderColor: visual.borderColor,
            borderWidth: visual.borderWidth,
            backgroundColor:
              options.primary && focused !== id
                ? t.color.accent
                : visual.backgroundColor,
          },
          options.style,
        ]}
      >
        {options.active ? <View style={s.activeMark} /> : null}
        {options.children ?? (
          <>
            {options.icon ? (
              <Icon
                name={options.icon}
                color={
                  options.primary && focused !== id
                    ? t.color.onAccent
                    : options.active
                      ? t.color.accent
                      : t.color.text
                }
              />
            ) : null}
            {!options.iconOnly
              ? label(
                  text,
                  false,
                  options.primary && focused !== id
                    ? t.color.onAccent
                    : t.color.text,
                )
              : null}
            {options.selected ? label("✓", false, t.color.accent) : null}
          </>
        )}
      </Pressable>
    );
  };
  const open = (opener: string) => dispatch({ type: "open", opener });
  const selected = eliteChannels.find((c) => c.id === state.selectedChannel)!;
  const channel = (c: (typeof eliteChannels)[number], panel = false) =>
    target(
      `${panel ? "panel" : "live"}:${c.id}`,
      c.name,
      () => dispatch({ type: "selectChannel", id: c.id }),
      {
        selected: state.selectedChannel === c.id,
        panel,
        style: {
          minHeight: m.rowHeight,
          width: "100%",
          justifyContent: "flex-start",
        },
        children: (
          <>
            <View
              style={[s.logo, { width: m.target - 12, height: m.target - 12 }]}
            >
              {label(c.number, false, t.color.accent)}
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
              {label(c.name)}
              <Text
                numberOfLines={1}
                style={{
                  color: t.color.muted,
                  fontSize: m.type.meta * fontFactor,
                }}
              >
                {c.epg ? `Şimdi · ${c.now}` : c.now}
              </Text>
              {c.epg ? (
                <>
                  <View style={s.progress}>
                    <View
                      style={[
                        s.progressFill,
                        { width: `${c.progress * 100}%` },
                      ]}
                    />
                  </View>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: t.color.muted,
                      fontSize: m.type.meta * fontFactor,
                    }}
                  >
                    Sonraki · {c.next}
                  </Text>
                </>
              ) : null}
            </View>
            {state.selectedChannel === c.id
              ? label("✓", false, t.color.accent)
              : null}
          </>
        ),
      },
    );
  const railItems = eliteSections.map((section) =>
    target(
      `navigation:${section.id}`,
      section.label,
      () => dispatch({ type: "navigate", section: section.id }),
      {
        icon: section.icon,
        active: state.active === section.id,
        iconOnly: !!m.rail && !state.railExpanded,
        style: { width: m.rail ? (state.railExpanded ? 232 : 64) : undefined },
      },
    ),
  );
  const shelf = (name: string, index: number) => (
    <View key={name} style={{ gap: 8 }}>
      {label(name)}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 16, padding: t.focus.gutter }}
      >
        {elitePosters.map((p, i) =>
          target(
            `shelf:${index}:${p.id}`,
            p.title,
            () => open(`shelf:${index}:${p.id}`),
            {
              style: {
                width: m.posterWidth,
                padding: 0,
                flexDirection: "column",
                overflow: "hidden",
                alignItems: "stretch",
              },
              children: (
                <>
                  <View style={{ width: "100%", aspectRatio: 2 / 3 }}>
                    <LandscapeArt tone={p.tone} />
                    <View style={s.posterCopy}>
                      <Text style={s.eyebrow}>{p.tag}</Text>
                      <Text
                        numberOfLines={2}
                        style={{
                          color: t.color.text,
                          fontFamily: t.typography.strong,
                          fontSize: m.type.body * fontFactor,
                        }}
                      >
                        {p.title}
                      </Text>
                    </View>
                  </View>
                  {index === 0 ? (
                    <View
                      style={[
                        s.progressFill,
                        { width: `${30 + i * 12}%`, height: 3 },
                      ]}
                    />
                  ) : null}
                </>
              ),
            },
          ),
        )}
      </ScrollView>
    </View>
  );
  return (
    <View style={{ width, height, backgroundColor: t.color.canvas }}>
      <View
        accessibilityElementsHidden={state.overlay}
        importantForAccessibility={
          state.overlay ? "no-hide-descendants" : "auto"
        }
        pointerEvents={state.overlay ? "none" : "auto"}
        style={{
          flex: 1,
          flexDirection: m.rail ? "row" : "column",
          maxWidth: t.limit.contentWidth,
          alignSelf: "flex-start",
          marginLeft:
            m.left + Math.max(0, width - m.left - m.right - m.contentWidth) / 2,
          width: m.contentWidth,
          paddingTop: m.top,
          paddingBottom: m.bottom,
          gap: 24,
        }}
      >
        {m.rail ? (
          <View style={{ width: m.rail, gap: 12, zIndex: 10 }}>
            <Text style={[s.wordmark, { textAlign: "center" }]}>L</Text>
            {target(
              "rail:expand",
              state.railExpanded ? "Menüyü daralt" : "Menüyü genişlet",
              () => dispatch({ type: "rail", expanded: !state.railExpanded }),
              { icon: "menu", iconOnly: true },
            )}
            {railItems}
          </View>
        ) : (
          <ScrollView
            horizontal
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: 8, padding: 8 }}
          >
            {railItems}
          </ScrollView>
        )}
        <ScrollView
          style={{ flex: 1, minWidth: 0 }}
          contentContainerStyle={{
            gap: 24,
            padding: t.focus.gutter,
            paddingBottom: 40,
          }}
        >
          <View style={s.header}>
            <View>
              <Text style={s.wordmark}>
                LEGEND<Text style={{ color: t.color.accent }}>STREAM</Text>
              </Text>
              <Text style={s.eyebrow}>
                ELITE EXPERIENCE · TASARIM ÖNİZLEMESİ
              </Text>
            </View>
            <Text style={s.status}>ÖRNEK VERİ</Text>
          </View>
          {state.active === "home" ? (
            <>
              <View style={[s.hero, { minHeight: m.heroHeight }]}>
                <View style={StyleSheet.absoluteFill}>
                  <LandscapeArt />
                </View>
                <View
                  style={{ padding: m.tv ? 32 : 20, gap: 12, maxWidth: 620 }}
                >
                  <Text style={s.eyebrow}>LEGEND SEÇKİSİ · KEŞFET</Text>
                  {label("Kuzeyin Ötesinde", true, t.color.text, 2)}
                  <Text
                    numberOfLines={2}
                    style={{
                      color: t.color.muted,
                      fontSize: m.type.body * fontFactor,
                    }}
                  >
                    Yolun bittiği yerde, hikâye başlar.
                  </Text>
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}
                  >
                    {target(
                      "hero:discover",
                      "Keşfet",
                      () => open("hero:discover"),
                      { icon: "play", primary: true },
                    )}
                    {target(
                      "hero:live",
                      "Canlı TV",
                      () => dispatch({ type: "navigate", section: "live" }),
                      { icon: "tv" },
                    )}
                  </View>
                </View>
              </View>
              {shelf("Devam Et", 0)}
              {label("Favori Kanallar")}
              <View style={{ gap: 12 }}>
                {eliteChannels.slice(0, 2).map((c) => channel(c))}
              </View>
              {shelf("Son İzlenenler", 1)}
              {shelf("Filmler", 2)}
              {shelf("Diziler", 3)}
              {label("Canlı Kategoriler")}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {["Sinema", "Belgesel", "Kültür"].map((name, i) =>
                  target(`category:${i}`, name, () =>
                    dispatch({ type: "navigate", section: "live" }),
                  ),
                )}
              </View>
            </>
          ) : state.active === "live" ? (
            <>
              <View style={s.header}>
                {label("Canlı TV", true)}
                {target(
                  "live:channels",
                  "Kanal listesi",
                  () => open("live:channels"),
                  { icon: "list" },
                )}
              </View>
              <Text
                style={{
                  color: t.color.muted,
                  fontSize: m.type.body * fontFactor,
                }}
              >
                3 örnek kanal · {selected.name}
              </Text>
              <View style={{ gap: 12 }}>
                {eliteChannels.map((c) => channel(c))}
              </View>
              <View style={[s.hero, { minHeight: m.heroHeight }]}>
                <View style={StyleSheet.absoluteFill}>
                  <LandscapeArt tone="#285A84" />
                </View>
                <View style={{ padding: 24, gap: 12 }}>
                  <Text style={s.eyebrow}>VİDEO ALANI TEMSİLİDİR</Text>
                  {label(selected.name, true)}
                  {label("Bu showcase yayın başlatmaz.", false, t.color.muted)}
                </View>
              </View>
            </>
          ) : state.active === "settings" ? (
            <>
              {label("Görünüm İlkeleri", true)}
              {label(
                "Odak: beyaz çerçeve · Seçili: onay · Aktif: turkuaz işaret",
                false,
                t.color.muted,
                3,
              )}
              {target(
                "settings:overlay",
                "Overlay örneğini aç",
                () => open("settings:overlay"),
                { icon: "list" },
              )}
            </>
          ) : (
            <>
              {label(state.active === "movies" ? "Filmler" : "Diziler", true)}
              {shelf("Legend Seçkisi", 4)}
            </>
          )}
          <Text
            testID="elite-state"
            style={{ color: t.color.muted, fontSize: 13 }}
          >
            Focus: {focused ?? "yok"} · Active: {state.active} · Selected:{" "}
            {state.selectedChannel} · {state.lastAction}
          </Text>
        </ScrollView>
      </View>
      {state.overlay ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: `rgba(0,0,0,${t.opacity.scrim})`,
              alignItems: "flex-end",
              justifyContent: "center",
              paddingLeft: m.left,
              paddingRight: m.right,
              paddingTop: m.top,
              paddingBottom: m.bottom,
            },
          ]}
        >
          <View
            accessibilityViewIsModal
            style={{
              width: m.panelWidth,
              maxHeight: height - m.top - m.bottom,
              backgroundColor:
                eliteOverlaySurface("interaction").backgroundColor,
              borderRadius: t.radius.panel,
              borderWidth: 1,
              borderColor: t.color.border,
              padding: 24,
              gap: 20,
              elevation: t.elevation.panel,
            }}
          >
            <View style={s.header}>
              <View style={{ flex: 1 }}>
                <Text style={s.eyebrow}>HIZLI ERİŞİM</Text>
                {label("Kanallar", true)}
              </View>
              {target(
                "overlay:close",
                "Paneli kapat",
                () => dispatch({ type: "close" }),
                { icon: "close", iconOnly: true, panel: true },
              )}
            </View>
            <ScrollView contentContainerStyle={{ gap: 12, padding: 8 }}>
              {eliteChannels.map((c) => channel(c, true))}
            </ScrollView>
            <Text
              style={{
                color: t.color.muted,
                fontSize: m.type.meta * fontFactor,
              }}
            >
              Örnek seçim · Back paneli kapatır
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  target: {
    borderRadius: t.radius.control,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  activeMark: {
    position: "absolute",
    left: 0,
    top: 14,
    bottom: 14,
    width: 3,
    borderRadius: 3,
    backgroundColor: t.color.accent,
  },
  logo: {
    borderRadius: 12,
    backgroundColor: t.color.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  progress: { height: 3, backgroundColor: t.color.border, borderRadius: 3 },
  progressFill: {
    height: "100%",
    backgroundColor: t.color.accent,
    borderRadius: 3,
  },
  wordmark: {
    color: t.color.text,
    fontSize: 20,
    letterSpacing: 2,
    fontFamily: t.typography.strong,
  },
  eyebrow: {
    color: t.color.accent,
    fontSize: 12,
    letterSpacing: 2,
    fontFamily: t.typography.strong,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
  },
  status: { fontSize: 11, color: t.color.muted, letterSpacing: 2 },
  hero: {
    borderRadius: t.radius.panel,
    overflow: "hidden",
    justifyContent: "center",
    backgroundColor: t.color.surface,
  },
  posterCopy: { position: "absolute", left: 16, right: 16, bottom: 20, gap: 8 },
});
