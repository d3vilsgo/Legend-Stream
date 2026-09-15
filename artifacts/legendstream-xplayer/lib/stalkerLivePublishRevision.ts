type StalkerLivePublishListener = (revision: number) => void;

const stalkerLivePublishRevisions = new Map<string, number>();
const stalkerLivePublishListeners = new Map<string, Set<StalkerLivePublishListener>>();

function stalkerLivePublishKey(providerId: string, kind: "live") {
  return `${providerId}:${kind}`;
}

export function readStalkerLivePublishRevision(providerId: string, kind: "live" = "live") {
  return stalkerLivePublishRevisions.get(stalkerLivePublishKey(providerId, kind)) ?? 0;
}

export function noteStalkerLivePublishSuccess(providerId: string, kind: "live" = "live") {
  const key = stalkerLivePublishKey(providerId, kind);
  const revision = (stalkerLivePublishRevisions.get(key) ?? 0) + 1;
  stalkerLivePublishRevisions.set(key, revision);
  stalkerLivePublishListeners.get(key)?.forEach((listener) => listener(revision));
  return revision;
}

export function subscribeStalkerLivePublishRevision(
  providerId: string,
  kind: "live",
  listener: StalkerLivePublishListener,
) {
  const key = stalkerLivePublishKey(providerId, kind);
  let listeners = stalkerLivePublishListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    stalkerLivePublishListeners.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) stalkerLivePublishListeners.delete(key);
  };
}

export function resetStalkerLivePublishRevisionForTests() {
  stalkerLivePublishRevisions.clear();
  stalkerLivePublishListeners.clear();
}
