import { inspectorAction } from "@/lib/tvRemoteInspector";
import { useNativeTvTarget } from "@/hooks/useNativeTvTarget";
import { requestTvTargetFocus, setNativeTvScope, subscribeNativeTvFocus } from "@/modules/legendstream-tv-remote";
import { findNodeHandle } from "react-native";
import React, { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type PressableProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUiPresentation } from "@/context/UiPresentationContext";
import { useColors } from "@/hooks/useColors";
import { createTVPreviewFocusController, type TVPreviewDirection, type TVPreviewFocusEntry } from "@/lib/tvPreviewFocus";

type FocusContextValue = {
  enabled: boolean;
  nativeScope: string;
  nativeFocusedId: string | null;
  rememberNativeFocus: (id: string) => void;
  registerNativeTarget: (id: string, focus: () => void) => () => void;
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
  const [nativeScope, setNativeScope] = useState("content");
  const [nativeFocusedId, setNativeFocusedId] = useState<string | null>(null);
  const nativeFocusRef = useRef<string | null>(null);
  const nativeTargets = useRef(new Map<string, () => void>());
  const nativeScopes = useRef<Array<{ scope: string; previous: string | null }>>([]);
  const rememberNativeFocus = useCallback((id: string) => { nativeFocusRef.current = id; setNativeFocusedId(id); }, []);
  const registerNativeTarget = useCallback((id: string, focus: () => void) => {
    nativeTargets.current.set(id, focus);
    return () => { if (nativeTargets.current.get(id) === focus) nativeTargets.current.delete(id); };
  }, []);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [lastActivatedId, setLastActivatedId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const controllerRef = useRef<ReturnType<typeof createTVPreviewFocusController> | null>(null);
  if (!controllerRef.current) controllerRef.current = createTVPreviewFocusController(setFocusedId, setLastActivatedId);
  const controller = controllerRef.current;
  useEffect(() => {
    if(!Platform.isTV) return;
    const subscription=subscribeNativeTvFocus((event) => {
      if(event.id) rememberNativeFocus(event.id);
    });
    return () => subscription?.remove();
  },[rememberNativeFocus]);
  useEffect(() => { if(Platform.isTV) void setNativeTvScope(nativeScope); },[nativeScope]);

  useEffect(() => {
    if (tvPreview) controller.focusFirst();
    else { controller.clear(); setViewport(null); }
  }, [controller, tvPreview]);

  const pushFocusScope = useCallback((scope: string) => {
    const popPreview = controller.pushFocusScope(scope);
    const frame = { scope, previous: nativeFocusRef.current };
    nativeScopes.current.push(frame);
    nativeFocusRef.current = null;
    setNativeFocusedId(null);
    setNativeScope(scope);
    return () => {
      popPreview();
      const index = nativeScopes.current.indexOf(frame);
      if (index < 0) return;
      nativeScopes.current.splice(index, 1);
      if (index !== nativeScopes.current.length) return;
      setNativeScope(nativeScopes.current.at(-1)?.scope ?? "content");
      if (frame.previous) {
        rememberNativeFocus(frame.previous);
        // Native scope transition is the sole physical restore owner.
      }
    };
  }, [controller, rememberNativeFocus]);
  const value = useMemo(() => ({
    nativeScope, nativeFocusedId, rememberNativeFocus, registerNativeTarget,
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
    pushFocusScope,
    back: controller.back,
  }), [controller, focusedId, lastActivatedId, tvPreview, viewport, nativeScope, nativeFocusedId, rememberNativeFocus, registerNativeTarget, pushFocusScope]);
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
  return <View ref={ref} collapsable={false} onLayout={measure} style={{ flex: 1, minHeight: 0 }}>{children}</View>;
}

export const useOptionalTVPreviewFocus = () => useContext(FocusContext);

export function useTVPreviewFocus() {
  const value = useContext(FocusContext);
  if (!value) throw new Error("useTVPreviewFocus must be used inside TVPreviewFocusProvider");
  return value;
}

type PreviewPressableProps = PressableProps & { focusId?: string; focusScope?: string; eliteVisual?: boolean };
export function TVPreviewPressable({ focusId, focusScope = "content", eliteVisual = false, style, onPress, children, disabled, onLayout, onFocus, onBlur, accessibilityLabel, nativeID, ...props }: PreviewPressableProps) {
  const focus = useTVPreviewFocus();
  const colors = useColors();
  const [nativeFocused, setNativeFocused] = useState(false);
  const ref = useRef<React.ElementRef<typeof Pressable>>(null);
  const generatedId = useId();
  const id = focusId ?? nativeID ?? accessibilityLabel ?? generatedId;
  const nativeFocus = useNativeTvTarget(ref,id,focusScope,"content",Boolean(disabled),Boolean(props.hasTVPreferredFocus));

  const measureAndRegister = useCallback(() => {
    if (!focus.enabled) return; // Native focus events alone own the physical highlight.
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
  useEffect(() => {
    if (!Platform.isTV) return;
    return focus.registerNativeTarget(id, () => {
      const node = ref.current as (React.ElementRef<typeof Pressable> & { requestTVFocus?: () => void }) | null;
      const tag=findNodeHandle(node);
      if(tag!=null) void requestTvTargetFocus(tag);
    });
  }, [focus.registerNativeTarget, id]);
  const unregisterRef = useRef<(() => void) | null>(null);
  useEffect(() => () => unregisterRef.current?.(), []);
  useEffect(() => { measureAndRegister(); }, [measureAndRegister, disabled]);

  return <Pressable
    {...props}
    ref={ref}
    disabled={disabled}
    // Native TVs use Android's FocusFinder; handheld preview uses the JS controller.
    focusable={!disabled && (Platform.isTV ? focus.nativeScope === focusScope : focus.enabled || undefined)}
    hasTVPreferredFocus={Platform.isTV ? false : props.hasTVPreferredFocus}
    accessibilityLabel={accessibilityLabel}
    nativeID={nativeID ?? id}
    onLayout={(event) => { nativeFocus.register(); onLayout?.(event); measureAndRegister(); }}
    onFocus={(event) => { setNativeFocused(true); if (Platform.isTV) focus.rememberNativeFocus(id); onFocus?.(event); }}
    onBlur={(event) => { setNativeFocused(false); onBlur?.(event); }}
    onPress={onPress ? (event)=>{onPress(event);if(Platform.isTV)inspectorAction("onPress");} : undefined}
    style={(state) => [typeof style === "function" ? style(state) : style, Platform.isTV && {borderWidth:4,borderColor:"transparent"}, ((focus.enabled && focus.focusedId === id) || (Platform.isTV && nativeFocus.focused)) && { borderColor: "#ffffff", borderWidth: 4, backgroundColor: eliteVisual ? "#1C2530" : "#075985", shadowColor: colors.primary, shadowOpacity: eliteVisual ? 0 : 0.65, shadowRadius: eliteVisual ? 0 : 10, elevation: eliteVisual ? 0 : 8 }]}
  >{children}</Pressable>;
}

export function TVPreviewControls() {
  const { tvPreview } = useUiPresentation();
  const focus = useTVPreviewFocus();
  const insets = useSafeAreaInsets();
  const [collapsed, setCollapsed] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  if (!tvPreview) return null;
  const focusedEntry = focus.getFocusedEntry();
  const focusedBounds = focusedEntry?.bounds;
  const focusReadout = focusedEntry
    ? `${focusedEntry.id} · ${Math.round(focusedBounds?.x ?? 0)},${Math.round(focusedBounds?.y ?? 0)}`
    : "—";
  const button = (label: string, glyph: string, onPress: () => void, testID: string) => (
    <Pressable key={label} testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.key}>
      <Text style={styles.glyph}>{glyph}</Text>
    </Pressable>
  );
  return <View pointerEvents="box-none" style={styles.overlay}>
    {collapsed ? <Pressable testID="tv-preview-dpad-expand" accessibilityRole="button" accessibilityLabel="Sanal kumandayı aç" onPress={() => setCollapsed(false)} style={[styles.collapsedButton, { right: Math.max(insets.right, 10), bottom: Math.max(insets.bottom, 10) }]}>
      <Text style={styles.glyph}>⌖</Text>
    </Pressable> : <View style={[styles.dock, { right: Math.max(insets.right, 10), bottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.toolbar}>
        <Pressable testID="tv-preview-dpad-diagnostics-toggle" accessibilityRole="button" accessibilityLabel="Odak tanı bilgisini aç veya kapat" onPress={() => setShowDiagnostics((value) => !value)} style={styles.toolButton}>
          <Text style={styles.toolGlyph}>i</Text>
        </Pressable>
        <Pressable testID="tv-preview-dpad-collapse" accessibilityRole="button" accessibilityLabel="Sanal kumandayı daralt" onPress={() => setCollapsed(true)} style={styles.toolButton}>
          <Text style={styles.toolGlyph}>⌄</Text>
        </Pressable>
      </View>
      {showDiagnostics ? <View testID="tv-preview-diagnostics-panel" style={styles.diagnostics}>
        <Text testID="tv-preview-focus-target" accessibilityLiveRegion="polite" numberOfLines={2} style={styles.focusReadout}>Odak: {focusReadout}</Text>
        <Text testID="tv-preview-activation-target" accessibilityLiveRegion="polite" numberOfLines={2} style={styles.focusReadout}>Son OK: {focus.lastActivatedId ?? "—"}</Text>
      </View>
      : null}
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
          <Pressable testID="tv-preview-dpad-back" accessibilityRole="button" accessibilityLabel="Geri" onPress={focus.back} style={[styles.key, styles.back]}><Text style={styles.glyph}>↶</Text></Pressable>
        </View>
      </View>
    </View>}
  </View>;
}

const styles = {
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 40, elevation: 40 },
  collapsedButton: { position: "absolute" as const, width: 34, height: 34, borderRadius: 17, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: "rgba(5,10,20,0.52)", borderWidth: 1, borderColor: "rgba(255,255,255,0.28)" },
  dock: { position: "absolute" as const, alignItems: "center" as const, padding: 4, borderRadius: 18, backgroundColor: "rgba(5,10,20,0.42)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  toolbar: { flexDirection: "row" as const, alignSelf: "stretch" as const, justifyContent: "flex-end" as const, gap: 3, marginBottom: 2 },
  toolButton: { width: 20, height: 20, borderRadius: 10, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: "rgba(255,255,255,0.16)" },
  toolGlyph: { color: "rgba(255,255,255,0.9)", fontWeight: "800" as const, fontSize: 12 },
  diagnostics: { position: "absolute" as const, right: 0, bottom: 116, width: 174, padding: 6, borderRadius: 8, backgroundColor: "rgba(5,10,20,0.76)" },
  focusReadout: { color: "rgba(255,255,255,0.9)", fontSize: 9, lineHeight: 12, marginBottom: 2 },
  pad: { alignItems: "center" as const, gap: 2, padding: 2, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.04)" },
  middle: { flexDirection: "row" as const, alignItems: "center" as const, gap: 3 },
  bottomRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 3 },
  keySpacer: { width: 28, height: 28 },
  key: { width: 28, height: 28, borderRadius: 14, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: "rgba(255,255,255,0.18)", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", overflow: "hidden" as const },
  glyph: { color: "rgba(255,255,255,0.94)", fontWeight: "800" as const, fontSize: 13 },
  back: { backgroundColor: "rgba(5,10,20,0.58)" },
};
