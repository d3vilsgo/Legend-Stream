import { readLatestIsolatedStalkerSessionForProbe, type StalkerIsolatedSession } from "./stalkerIsolatedLogin";

const sessionScopes = new WeakMap<object, string>();
let nextScope = 0;

export type StalkerProductSession = {
  session: StalkerIsolatedSession;
  providerScopeId: string;
};

export function readCurrentStalkerProductSession(): StalkerProductSession | null {
  const session = readLatestIsolatedStalkerSessionForProbe();
  if (!session) return null;
  const key = session as object;
  let providerScopeId = sessionScopes.get(key);
  if (!providerScopeId) {
    nextScope += 1;
    providerScopeId = `stalker-session-${nextScope}`;
    sessionScopes.set(key, providerScopeId);
  }
  return { session, providerScopeId };
}

export function isCurrentStalkerProductSession(session: StalkerIsolatedSession) {
  return readLatestIsolatedStalkerSessionForProbe() === session;
}
