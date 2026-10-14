export type TVPreviewDirection = "up" | "down" | "left" | "right";
export type TVPreviewBounds = { x: number; y: number; width: number; height: number };
export type TVPreviewFocusEntry = {
  id: string;
  bounds: TVPreviewBounds;
  press: () => void;
  setFocused: (value: boolean) => void;
};

export function resolveTVPreviewFocusTarget(
  current: TVPreviewFocusEntry,
  direction: TVPreviewDirection,
  entries: readonly TVPreviewFocusEntry[],
): TVPreviewFocusEntry | null {
  const cx = current.bounds.x + current.bounds.width / 2;
  const cy = current.bounds.y + current.bounds.height / 2;
  const candidates = entries.flatMap((entry) => {
    if (entry.id === current.id) return [];
    const dx = entry.bounds.x + entry.bounds.width / 2 - cx;
    const dy = entry.bounds.y + entry.bounds.height / 2 - cy;
    const primary = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
    if (primary <= 0) return [];
    const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    return [{ entry, score: primary + cross * 2.2 + (cross * cross) / Math.max(primary, 1) }];
  }).sort((a, b) => a.score - b.score);
  return candidates[0]?.entry ?? null;
}

export function createTVPreviewFocusController(onFocusChange?: (id: string | null) => void) {
  const entries = new Map<string, TVPreviewFocusEntry>();
  let focusedId: string | null = null;
  let backAction: (() => void) | null = null;
  const scopedBackActions = new Map<number, () => void>();
  let nextBackActionId = 0;

  const focus = (id: string | null) => {
    if (focusedId === id) return;
    if (focusedId) entries.get(focusedId)?.setFocused(false);
    focusedId = id;
    if (id) entries.get(id)?.setFocused(true);
    onFocusChange?.(id);
  };
  const register = (entry: TVPreviewFocusEntry) => {
    entries.set(entry.id, entry);
    if (!focusedId) focus(entry.id);
    return () => {
      if (entries.get(entry.id) !== entry) return;
      entries.delete(entry.id);
      if (focusedId === entry.id) focus(entries.keys().next().value ?? null);
    };
  };
  const focusFirst = () => focus(entries.keys().next().value ?? null);
  const move = (direction: TVPreviewDirection) => {
    const current = focusedId ? entries.get(focusedId) : undefined;
    if (!current) { focusFirst(); return; }
    const next = resolveTVPreviewFocusTarget(current, direction, [...entries.values()]);
    if (next) focus(next.id);
  };
  const activate = () => { if (focusedId) entries.get(focusedId)?.press(); };
  const setBackAction = (action: (() => void) | null) => { backAction = action; };
  const registerBackAction = (action: () => void) => {
    const id = ++nextBackActionId;
    scopedBackActions.set(id, action);
    return () => { scopedBackActions.delete(id); };
  };
  const back = () => {
    const actions = [...scopedBackActions.values()];
    const active = actions[actions.length - 1];
    (active ?? backAction)?.();
  };
  const clear = () => focus(null);
  return { register, focusFirst, move, activate, setBackAction, registerBackAction, back, clear, getFocusedId: () => focusedId };
}
