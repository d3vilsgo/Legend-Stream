import React, { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, View, type PressableProps } from "react-native";
import { useUiPresentation } from "@/context/UiPresentationContext";
import { useColors } from "@/hooks/useColors";
import { createTVPreviewFocusController, type TVPreviewDirection, type TVPreviewFocusEntry } from "@/lib/tvPreviewFocus";

type FocusContextValue = {
  enabled: boolean;
  focusedId: string | null;
  lastActivatedId: string | null;
  register: (entry: TVPreviewFocusEntry) => () => void;
  move: (direction: TVPreviewDirection) => Promise<void>;
  getFocusedEntry: () => TVPreviewFocusEntry | null;
  setViewport: (viewport: { x: number; y: number; width: number; height: number } | null) => void;
  viewport: { x: number; y: number; width: number; height: number } | null;
  activate: () => void;
  setBackAction: (action: (() => void) | null) => void;
  registerBackAction: (action: () => void) => () => void;
  pushFocusScope: (scope: string) => () => void;
  back: () => void;
};
const FocusContext = createContext<FocusContextValue | null>(null);

export function TVPreviewFocusProvider({ children }: { children: ReactNode }) {
  const { tvPreview } = useUiPresentation();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [lastActivatedId, setLastActivatedId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const controllerRef = useRef<ReturnType<typeof createTVPreviewFocusController> | null>(null);
  if (!controllerRef.current) controllerRef.current = createTVPreviewFocusController(setFocusedId, setLastActivatedId);
  const controller = controllerRef.current;

  useEffect(() => {
    if (tvPreview) controller.focusFirst();
    else { controller.clear(); setViewport(null); }
  }, [controller, tvPreview]);

  const value = useMemo(() => ({
    enabled: tvPreview,
    focusedId,
    lastActivatedId,
    register: controller.register,
    move: (direction: TVPreviewDirection) => viewport ? controller.move(direction, viewport) : Promise.resolve(),
    getFocusedEntry: controller.getFocusedEntry,
    setViewport,
    viewport,
    activate: controller.activate,
    setBackAction: controller.setBackAction,
    registerBackAction: controller.registerBackAction,
    pushFocusScope: controller.pushFocusScope,
    back: controller.back,
  }), [controller, focusedId, lastActivatedId, tvPreview, viewport]);
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

/** Reports the actual content viewport in the same window coordinate space used by measureInWindow. */
export function TVPreviewFocusRegion({ children }: { children: ReactNode }) {
  const { setViewport } = useTVPreviewFocus();
  const ref = useRef<View>(null);
  const measureRevision = useRef(0);
  const measure = useCallback(() => {
    const revision = ++measureRevision.current;
    const node = ref.current as (View & { measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void }) | null;
    if (!node?.measureInWindow) { setViewport(null); return; }
    node.measureInWindow((x, y, width, height) => {
      if (revision !== measureRevision.current) return;
      if (Number.isFinite(x) && Number.isFinite(y) && width > 0 && height > 0) setViewport({ x, y, width, height });
      else setViewport(null);
    });
  }, [setViewport]);
  useEffect(() => () => { measureRevision.current += 1; setViewport(null); }, [setViewport]);
  return <View ref={ref} collapsable={false} onLayout={measure} style={{ flex: 1 }}>{children}</View>;
}

export function useTVPreviewFocus() {
  const value = useContext(FocusContext);
  if (!value) throw new Error("useTVPreviewFocus must be used inside TVPreviewFocusProvider");
  return value;
}

type PreviewPressableProps = PressableProps & { focusId?: string; focusScope?: string };
export function TVPreviewPressable({ focusId, focusScope = "content", style, onPress, children, disabled, onLayout, onFocus, onBlur, accessibilityLabel, nativeID, ...props }: PreviewPressableProps) {
  const focus = useTVPreviewFocus();
  const colors = useColors();
  const [nativeFocused, setNativeFocused] = useState(false);
  const ref = useRef<React.ElementRef<typeof Pressable>>(null);
  const generatedId = useId();
  const id = focusId ?? nativeID ?? accessibilityLabel ?? generatedId;

  const measureAndRegister = useCallback(() => {
    type MeasurablePressable = React.ElementRef<typeof Pressable> & {
      measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
      focus?: () => void;
    };
    const native = ref.current as MeasurablePressable | null;
    if (disabled || !native?.measureInWindow) {
      unregisterRef.current?.();
      unregisterRef.current = null;
      return;
    }
    native.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) {
        unregisterRef.current?.();
        unregisterRef.current = null;
        return;
      }
      const bounds = { x, y, width, height };
      const measure = () => new Promise<{ x: number; y: number; width: number; height: number } | null>((resolve) => {
        const current = ref.current as MeasurablePressable | null;
        if (!current?.measureInWindow) { resolve(null); return; }
        current.measureInWindow((nextX, nextY, nextWidth, nextHeight) => {
          resolve(nextWidth > 0 && nextHeight > 0 && Number.isFinite(nextX) && Number.isFinite(nextY)
            ? { x: nextX, y: nextY, width: nextWidth, height: nextHeight }
            : null);
        });
      });
      const reveal = async () => {
        const current = ref.current as MeasurablePressable | null;
        if (!current?.focus) return null;
        current.focus();
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        return measure();
      };
      const next = focus.register({
        id,
        scope: focusScope,
        bounds,
        measure,
        reveal,
        press: () => onPress?.({} as never),
        setFocused: (value) => {
          setNativeFocused(value);
          if (value && focus.enabled) (ref.current as MeasurablePressable | null)?.focus?.();
        },
      });
      const previous = unregisterRef.current;
      unregisterRef.current = next;
      previous?.();
    });
  }, [disabled, focus.enabled, focus.register, focusScope, id, onPress]);
  const unregisterRef = useRef<(() => void) | null>(null);
  useEffect(() => () => unregisterRef.current?.(), []);
  useEffect(() => { measureAndRegister(); }, [measureAndRegister, disabled]);

  return <Pressable
    {...props}
    ref={ref}
    disabled={disabled}
    focusable={!disabled && (focus.enabled || undefined)}
    accessibilityLabel={accessibilityLabel}
    nativeID={nativeID}
    onLayout={(event) => { onLayout?.(event); measureAndRegister(); }}
    onFocus={(event) => { setNativeFocused(true); onFocus?.(event); }}
    onBlur={(event) => { setNativeFocused(false); onBlur?.(event); }}
    onPress={onPress}
    style={(state) => [typeof style === "function" ? style(state) : style, ((focus.enabled && focus.focusedId === id) || (Platform.isTV && nativeFocused)) && { borderColor: colors.primary, borderWidth: 3, shadowColor: colors.primary, shadowOpacity: 0.65, shadowRadius: 10, elevation: 8 }]}
  >{children}</Pressable>;
}

export function TVPreviewControls() {
  const { tvPreview } = useUiPresentation();
  const focus = useTVPreviewFocus();
  if (!tvPreview) return null;
  const focusedEntry = focus.getFocusedEntry();
  const focusedBounds = focusedEntry?.bounds;
  const focusReadout = focusedEntry
    ? `${focusedEntry.id} · ${Math.round(focusedBounds?.x ?? 0)},${Math.round(focusedBounds?.y ?? 0)}`
    : "—";
  const button = (label: string, glyph: string, onPress: () => void, testID: string) => (
    <Pressable key={label} testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.key}>
      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 17 }}>{glyph}</Text>
    </Pressable>
  );
  return <View style={styles.dock}>
    <Text testID="tv-preview-focus-target" accessibilityLiveRegion="polite" numberOfLines={1} style={styles.focusReadout}>Odak: {focusReadout}</Text>
    <Text testID="tv-preview-activation-target" accessibilityLiveRegion="polite" numberOfLines={1} style={styles.focusReadout}>Son OK: {focus.lastActivatedId ?? "—"}</Text>
    <View accessibilityLabel="Sanal TV kumandası" style={styles.pad}>
      {button("Yukarı", "↑", () => { void focus.move("up"); }, "tv-preview-dpad-up")}
      <View style={styles.middle}>
        {button("Sol", "←", () => { void focus.move("left"); }, "tv-preview-dpad-left")}
        {button("OK", "OK", focus.activate, "tv-preview-dpad-ok")}
        {button("Sağ", "→", () => { void focus.move("right"); }, "tv-preview-dpad-right")}
      </View>
      <View style={styles.bottomRow}>
        <View style={styles.keySpacer} />
        {button("Aşağı", "↓", () => { void focus.move("down"); }, "tv-preview-dpad-down")}
        <Pressable testID="tv-preview-dpad-back" accessibilityRole="button" accessibilityLabel="Geri" onPress={focus.back} style={[styles.key, styles.back]}><Text style={{ color: "#fff", fontWeight: "800", fontSize: 17 }}>↶</Text></Pressable>
      </View>
    </View>
  </View>;
}

const styles = {
  dock: { alignSelf: "stretch" as const, alignItems: "center" as const, paddingTop: 3, paddingBottom: 5, backgroundColor: "rgba(5,10,20,0.76)" },
  focusReadout: { color: "rgba(255,255,255,0.82)", fontSize: 10, lineHeight: 13, maxWidth: "90%" as const, marginBottom: 2 },
  pad: { alignItems: "center" as const, gap: 3, padding: 4, borderRadius: 30, backgroundColor: "rgba(255,255,255,0.08)" },
  middle: { flexDirection: "row" as const, alignItems: "center" as const, gap: 3 },
  bottomRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 3 },
  keySpacer: { width: 40, height: 40 },
  key: { width: 40, height: 40, borderRadius: 22, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: "rgba(255,255,255,0.23)", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)", color: "#fff", fontWeight: "800" as const, fontSize: 17, overflow: "hidden" as const },
  back: { backgroundColor: "rgba(5,10,20,0.76)" },
};
