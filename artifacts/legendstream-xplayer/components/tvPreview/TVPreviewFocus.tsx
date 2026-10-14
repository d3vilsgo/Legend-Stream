import React, { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, View, type PressableProps } from "react-native";
import { useUiPresentation } from "@/context/UiPresentationContext";
import { useColors } from "@/hooks/useColors";
import { createTVPreviewFocusController, type TVPreviewDirection, type TVPreviewFocusEntry } from "@/lib/tvPreviewFocus";

type FocusContextValue = {
  enabled: boolean;
  focusedId: string | null;
  register: (entry: TVPreviewFocusEntry) => () => void;
  move: (direction: TVPreviewDirection) => void;
  activate: () => void;
  setBackAction: (action: (() => void) | null) => void;
  registerBackAction: (action: () => void) => () => void;
  back: () => void;
};
const FocusContext = createContext<FocusContextValue | null>(null);

export function TVPreviewFocusProvider({ children }: { children: ReactNode }) {
  const { tvPreview } = useUiPresentation();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const controllerRef = useRef<ReturnType<typeof createTVPreviewFocusController> | null>(null);
  if (!controllerRef.current) controllerRef.current = createTVPreviewFocusController(setFocusedId);
  const controller = controllerRef.current;

  useEffect(() => {
    if (tvPreview) controller.focusFirst();
    else controller.clear();
  }, [controller, tvPreview]);

  const value = useMemo(() => ({
    enabled: tvPreview,
    focusedId,
    register: controller.register,
    move: controller.move,
    activate: controller.activate,
    setBackAction: controller.setBackAction,
    registerBackAction: controller.registerBackAction,
    back: controller.back,
  }), [controller, focusedId, tvPreview]);
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

export function useTVPreviewFocus() {
  const value = useContext(FocusContext);
  if (!value) throw new Error("useTVPreviewFocus must be used inside TVPreviewFocusProvider");
  return value;
}

type PreviewPressableProps = PressableProps;
export function TVPreviewPressable({ style, onPress, children, disabled, onLayout, onFocus, onBlur, ...props }: PreviewPressableProps) {
  const focus = useTVPreviewFocus();
  const colors = useColors();
  const [nativeFocused, setNativeFocused] = useState(false);
  const ref = useRef<React.ElementRef<typeof Pressable>>(null);
  const id = useId();

  const measureAndRegister = useCallback(() => {
    const native = ref.current as (React.ElementRef<typeof Pressable> & { measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void }) | null;
    native?.measureInWindow?.((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;
      const next = focus.register({ id, bounds: { x, y, width, height }, press: () => onPress?.({} as never), setFocused: setNativeFocused });
      const previous = unregisterRef.current;
      unregisterRef.current = next;
      previous?.();
    });
  }, [focus.register, id, onPress]);
  const unregisterRef = useRef<(() => void) | null>(null);
  useEffect(() => () => unregisterRef.current?.(), []);
  useEffect(() => { measureAndRegister(); }, [measureAndRegister]);

  return <Pressable
    {...props}
    ref={ref}
    disabled={disabled}
    focusable={!disabled && (focus.enabled || undefined)}
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
  const button = (label: string, glyph: string, onPress: () => void, testID: string) => (
    <Pressable key={label} testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.key}>
      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 17 }}>{glyph}</Text>
    </Pressable>
  );
  return <View pointerEvents="box-none" style={styles.overlay}>
    <View accessibilityLabel="Sanal TV kumandası" style={styles.pad}>
      {button("Yukarı", "↑", () => focus.move("up"), "tv-preview-dpad-up")}
      <View style={styles.middle}>
        {button("Sol", "←", () => focus.move("left"), "tv-preview-dpad-left")}
        {button("OK", "OK", focus.activate, "tv-preview-dpad-ok")}
        {button("Sağ", "→", () => focus.move("right"), "tv-preview-dpad-right")}
      </View>
      {button("Aşağı", "↓", () => focus.move("down"), "tv-preview-dpad-down")}
      <Pressable testID="tv-preview-dpad-back" accessibilityRole="button" accessibilityLabel="Geri" onPress={focus.back} style={[styles.key, styles.back]}><Text style={{ color: "#fff", fontWeight: "800", fontSize: 17 }}>↶</Text></Pressable>
    </View>
  </View>;
}

const styles = {
  overlay: { position: "absolute" as const, right: 14, bottom: 18, zIndex: 90, alignItems: "center" as const },
  pad: { alignItems: "center" as const, gap: 5, padding: 8, borderRadius: 44, backgroundColor: "rgba(5,10,20,0.68)" },
  middle: { flexDirection: "row" as const, alignItems: "center" as const, gap: 5 },
  key: { width: 42, height: 42, borderRadius: 22, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: "rgba(255,255,255,0.23)", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)", color: "#fff", fontWeight: "800" as const, fontSize: 17, overflow: "hidden" as const },
  back: { position: "absolute" as const, left: -54, bottom: 13, backgroundColor: "rgba(5,10,20,0.76)" },
};
