export type TVPreviewDirection = "up" | "down" | "left" | "right";
export type TVPreviewBounds = { x: number; y: number; width: number; height: number };
export type TVPreviewFocusEntry = {
  id: string;
  scope?: string;
  bounds: TVPreviewBounds;
  measure?: () => Promise<TVPreviewBounds | null>;
  reveal?: () => Promise<TVPreviewBounds | null>;
  press: () => void;
  setFocused: (value: boolean) => void;
};

export type TVPreviewViewport = TVPreviewBounds;

function isValidBounds(bounds: TVPreviewBounds): boolean {
  return Number.isFinite(bounds.x) && Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) && Number.isFinite(bounds.height) &&
    bounds.width > 0 && bounds.height > 0;
}

function isVisibleInViewport(entry: TVPreviewFocusEntry, viewport?: TVPreviewViewport): boolean {
  if (!isValidBounds(entry.bounds)) return false;
  if (!viewport) return true;
  if (!isValidBounds(viewport)) return false;
  const centerX = entry.bounds.x + entry.bounds.width / 2;
  const centerY = entry.bounds.y + entry.bounds.height / 2;
  return centerX >= viewport.x && centerX <= viewport.x + viewport.width &&
    centerY >= viewport.y && centerY <= viewport.y + viewport.height;
}

export function resolveTVPreviewFocusTarget(
  current: TVPreviewFocusEntry,
  direction: TVPreviewDirection,
  entries: readonly TVPreviewFocusEntry[],
): TVPreviewFocusEntry | null {
  const cx = current.bounds.x + current.bounds.width / 2;
  const cy = current.bounds.y + current.bounds.height / 2;
  const candidates = entries.flatMap((entry) => {
    if (entry.id === current.id || !isValidBounds(entry.bounds)) return [];
    const dx = entry.bounds.x + entry.bounds.width / 2 - cx;
    const dy = entry.bounds.y + entry.bounds.height / 2 - cy;
    const primary = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
    if (primary <= 0) return [];
    const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    return [{ entry, score: primary + cross * 2.2 + (cross * cross) / Math.max(primary, 1) }];
  }).sort((a, b) => a.score - b.score);
  return candidates[0]?.entry ?? null;
}

export function createTVPreviewFocusController(
  onFocusChange?: (id: string | null) => void,
  onActivate?: (id: string) => void,
) {
  const entries = new Map<string, TVPreviewFocusEntry>();
  let focusedId: string | null = null;
  let backAction: (() => void) | null = null;
  const scopedBackActions = new Map<number, () => void>();
  let nextBackActionId = 0;
  let activeScope = "content";
  const focusScopes: Array<{ token: number; scope: string; previousScope: string; previousFocus: string | null }> = [];
  let nextFocusScopeId = 0;
  let moveRevision = 0;

  const entriesInActiveScope = () => [...entries.values()].filter((entry) => (entry.scope ?? "content") === activeScope);

  const focus = (id: string | null) => {
    if (focusedId === id) return;
    if (focusedId) entries.get(focusedId)?.setFocused(false);
    focusedId = id;
    if (id) entries.get(id)?.setFocused(true);
    onFocusChange?.(id);
  };
  const register = (entry: TVPreviewFocusEntry) => {
    const previous = entries.get(entry.id);
    const wasFocused = focusedId === entry.id;
    if (previous && wasFocused) previous.setFocused(false);
    entries.set(entry.id, entry);
    if (wasFocused) entry.setFocused(true);
    if (!focusedId && (entry.scope ?? "content") === activeScope) focus(entry.id);
    return () => {
      if (entries.get(entry.id) !== entry) return;
      entries.delete(entry.id);
      moveRevision += 1;
      if (focusedId === entry.id) focus(entriesInActiveScope()[0]?.id ?? null);
    };
  };
  const focusFirst = () => focus(entriesInActiveScope()[0]?.id ?? null);
  const move = async (direction: TVPreviewDirection, viewport?: TVPreviewViewport) => {
    const revision = ++moveRevision;
    const activeEntries = entriesInActiveScope();
    const measuredEntries = await Promise.all(activeEntries.map(async (entry) => {
      if (!entry.measure) return { entry, bounds: entry.bounds, measurable: true };
      try {
        const bounds = await entry.measure();
        return { entry, bounds, measurable: bounds !== null };
      } catch {
        return { entry, bounds: null, measurable: false };
      }
    }));
    if (revision !== moveRevision) return;
    const currentEntries: TVPreviewFocusEntry[] = [];
    for (const result of measuredEntries) {
      if (entries.get(result.entry.id) !== result.entry) continue;
      if (!result.measurable || !result.bounds) {
        if (focusedId === result.entry.id) focus(null);
        entries.delete(result.entry.id);
        continue;
      }
      result.entry.bounds = result.bounds;
      currentEntries.push(result.entry);
    }
    const visibleEntries = currentEntries.filter((entry) => isVisibleInViewport(entry, viewport));
    const current = visibleEntries.find((entry) => entry.id === focusedId);
    if (!current) {
      focus(visibleEntries[0]?.id ?? null);
      return;
    }
    const visibleNext = resolveTVPreviewFocusTarget(current, direction, visibleEntries);
    if (visibleNext) { focus(visibleNext.id); return; }

    // Ask the closest mounted off-screen cell to reveal itself. It only receives
    // focus after a fresh measurement confirms it is actually visible.
    const offscreenEntries = currentEntries.filter((entry) => !isVisibleInViewport(entry, viewport));
    const nextOffscreen = resolveTVPreviewFocusTarget(current, direction, offscreenEntries);
    if (!nextOffscreen?.reveal || revision !== moveRevision) return;
    try {
      const revealedBounds = await nextOffscreen.reveal();
      if (revision !== moveRevision || !revealedBounds) return;
      nextOffscreen.bounds = revealedBounds;
      if (isVisibleInViewport(nextOffscreen, viewport) && entries.get(nextOffscreen.id) === nextOffscreen) focus(nextOffscreen.id);
    } catch {
      // A recycled or unmounted virtualized cell cannot be focused.
    }
  };
  const activate = () => {
    if (!focusedId) return;
    const active = entries.get(focusedId);
    if (!active) return;
    onActivate?.(active.id);
    active.press();
  };
  const setBackAction = (action: (() => void) | null) => { backAction = action; };
  const registerBackAction = (action: () => void) => {
    const id = ++nextBackActionId;
    scopedBackActions.set(id, action);
    return () => { scopedBackActions.delete(id); };
  };
  const pushFocusScope = (scope: string) => {
    moveRevision += 1;
    const token = ++nextFocusScopeId;
    const frame = { token, scope, previousScope: activeScope, previousFocus: focusedId };
    focusScopes.push(frame);
    activeScope = scope;
    focusFirst();
    return () => {
      const index = focusScopes.findIndex((item) => item.token === token);
      if (index < 0) return;
      const [removed] = focusScopes.splice(index, 1);
      moveRevision += 1;
      if (index !== focusScopes.length) return;
      activeScope = focusScopes[focusScopes.length - 1]?.scope ?? removed.previousScope;
      const previousEntry = removed.previousFocus ? entries.get(removed.previousFocus) : undefined;
      focus(previousEntry && (previousEntry.scope ?? "content") === activeScope
        ? previousEntry.id
        : entriesInActiveScope()[0]?.id ?? null);
    };
  };
  const back = () => {
    const actions = [...scopedBackActions.values()];
    const active = actions[actions.length - 1];
    (active ?? backAction)?.();
  };
  const clear = () => { moveRevision += 1; focus(null); };
  return {
    register,
    focusFirst,
    move,
    activate,
    setBackAction,
    registerBackAction,
    pushFocusScope,
    back,
    clear,
    getFocusedId: () => focusedId,
    getFocusedEntry: () => focusedId ? entries.get(focusedId) ?? null : null,
  };
}
