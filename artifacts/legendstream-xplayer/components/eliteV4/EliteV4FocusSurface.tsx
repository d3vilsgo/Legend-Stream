import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { findNodeHandle, Platform, Pressable, type PressableProps } from "react-native";
import { TVPreviewPressable, useOptionalTVPreviewFocus } from "@/components/tvPreview/TVPreviewFocus";
import type {
  EliteV4Direction,
  EliteV4FocusNode,
  EliteV4Region,
} from "@/lib/eliteV4Focus";
import { resolveEliteV4Target } from "@/lib/eliteV4Focus";
import { eliteV4Theme } from "@/lib/design/eliteV4Theme";

type FocusContextValue = {
  focusedId: string | null;
  selectedId: string | null;
  activeRegion: EliteV4Region;
  setFocused: (node: EliteV4FocusNode) => void;
  setSelected: (id: string) => void;
  register: (
    node: EliteV4FocusNode,
    ref: React.ElementRef<typeof Pressable> | null,
  ) => void;
  focus: (id: string) => boolean;
  target: (id: string, direction: EliteV4Direction) => number | undefined;
};
const FocusContext = createContext<FocusContextValue | null>(null);
const EMPTY_NEIGHBORS: Partial<Record<EliteV4Direction, string>> =
  Object.freeze({});

export function EliteV4FocusSurface({
  children,
  initialFocusId = "hero",
}: React.PropsWithChildren<{ initialFocusId?: string }>) {
  const [focusedId, setFocusedId] = useState<string | null>(initialFocusId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeRegion, setActiveRegion] = useState<EliteV4Region>("content");
  const [, setRegistryRevision] = useState(0);
  const nodes = useRef(
    new Map<
      string,
      { node: EliteV4FocusNode; ref: React.ElementRef<typeof Pressable> | null }
    >(),
  );

  const register = useCallback(
    (
      node: EliteV4FocusNode,
      ref: React.ElementRef<typeof Pressable> | null,
    ) => {
      if (ref) nodes.current.set(node.id, { node, ref });
      else {
        nodes.current.delete(node.id);
        return;
      }
      setRegistryRevision((value) => value + 1);
    },
    [],
  );
  const setFocused = useCallback((node: EliteV4FocusNode) => {
    nodes.current.set(node.id, {
      node,
      ref: nodes.current.get(node.id)?.ref ?? null,
    });
    setFocusedId(node.id);
    setActiveRegion(node.region);
  }, []);
  const focus = useCallback((id: string) => {
    const target = nodes.current.get(id);
    if (!target?.ref) return false;
    setFocusedId(id);
    setActiveRegion(target.node.region);
    target.ref.focus?.();
    return true;
  }, []);
  const target = useCallback((id: string, direction: EliteV4Direction) => {
    const node = nodes.current.get(id)?.node;
    const nextId = resolveEliteV4Target(node, direction);
    const nextRef = nextId ? nodes.current.get(nextId)?.ref : null;
    const handle = nextRef ? findNodeHandle(nextRef) : null;
    return typeof handle === "number" ? handle : undefined;
  }, []);
  const value = useMemo<FocusContextValue>(
    () => ({
      focusedId,
      selectedId,
      activeRegion,
      register,
      focus,
      target,
      setFocused,
      setSelected: setSelectedId,
    }),
    [focusedId, selectedId, activeRegion, register, focus, target, setFocused],
  );
  return (
    <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
  );
}

export function useEliteV4Focus() {
  const value = useContext(FocusContext);
  if (!value) throw new Error("EliteV4FocusSurface is required");
  return value;
}

type EliteV4FocusButtonProps = Omit<
  PressableProps,
  "onFocus" | "onBlur" | "onPress"
> & {
  focusId: string;
  region: EliteV4Region;
  neighbors?: Partial<Record<EliteV4Direction, string>>;
  onPress: () => void;
  selected?: boolean;
  children: React.ReactNode;
  initial?: boolean;
};

export function EliteV4FocusButton({
  focusId,
  region,
  neighbors = EMPTY_NEIGHBORS,
  onPress,
  selected = false,
  children,
  initial = false,
  style,
  ...props
}: EliteV4FocusButtonProps) {
  const focus = useEliteV4Focus();
  const previewFocus = useOptionalTVPreviewFocus();
  const ref = useRef<React.ElementRef<typeof Pressable>>(null);
  const neighborKey = Object.entries(neighbors)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([direction, targetId]) => `${direction}:${targetId}`)
    .join("|");
  const node = useMemo<EliteV4FocusNode>(
    () => ({ id: focusId, region, neighbors }),
    [focusId, region, neighborKey],
  );
  React.useEffect(() => {
    focus.register(node, ref.current);
    return () => focus.register(node, null);
  }, [focus.register, node]);
  const nativeFocus = {
    nextFocusLeft: focus.target(focusId, "left"),
    nextFocusRight: focus.target(focusId, "right"),
    nextFocusUp: focus.target(focusId, "up"),
    nextFocusDown: focus.target(focusId, "down"),
  };
  const buttonStyle = ({ pressed }: { pressed: boolean }) => [
    typeof style === "function" ? style({ pressed }) : style,
    focus.focusedId === focusId && {
      borderColor: eliteV4Theme.color.focus,
      shadowColor: eliteV4Theme.color.focus,
      shadowOpacity: 0.22,
      shadowRadius: 12,
      elevation: 5,
    },
    (selected || focus.selectedId === focusId) && {
      backgroundColor: eliteV4Theme.color.accentSoft,
    },
  ];
  const handleFocus = () => focus.setFocused(node);
  const handlePress = () => {
    focus.setSelected(focusId);
    onPress();
  };
  if (previewFocus?.enabled && !Platform.isTV) {
    return (
      <TVPreviewPressable
        {...props}
        {...nativeFocus}
        focusId={`elite-v4:${focusId}`}
        focusScope="content"
        eliteVisual
        accessibilityRole="button"
        accessibilityState={{ selected: selected || focus.selectedId === focusId }}
        onFocus={handleFocus}
        onPress={handlePress}
        style={buttonStyle}
      >
        {children}
      </TVPreviewPressable>
    );
  }
  return (
    <Pressable
      {...props}
      {...nativeFocus}
      ref={ref}
      focusable
      hasTVPreferredFocus={initial}
      accessibilityRole="button"
      accessibilityState={{
        selected: selected || focus.selectedId === focusId,
      }}
      onFocus={handleFocus}
      onPress={handlePress}
      style={buttonStyle}
    >
      {children}
    </Pressable>
  );
}
