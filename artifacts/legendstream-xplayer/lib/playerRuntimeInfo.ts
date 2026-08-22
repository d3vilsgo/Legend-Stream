export type PlayerRuntimeInfo = Readonly<{
  resolution?: string;
  fps?: number;
}>;

let snapshot: PlayerRuntimeInfo = {};
const listeners = new Set<() => void>();

export function getPlayerRuntimeInfoSnapshot(): PlayerRuntimeInfo {
  return snapshot;
}

export function subscribePlayerRuntimeInfo(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const publish = (next: PlayerRuntimeInfo) => {
  if (snapshot.resolution === next.resolution && snapshot.fps === next.fps) return;
  snapshot = next;
  for (const listener of listeners) listener();
};

export function resetPlayerRuntimeInfo() {
  publish({});
}

export function updatePlayerRuntimeInfo(next: Partial<PlayerRuntimeInfo>) {
  publish({ ...snapshot, ...next });
}
