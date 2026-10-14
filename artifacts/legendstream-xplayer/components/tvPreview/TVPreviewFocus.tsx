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

type PreviewPressableProps = PressableProps & { focusI