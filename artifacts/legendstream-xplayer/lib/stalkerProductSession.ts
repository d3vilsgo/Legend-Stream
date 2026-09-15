import type { StalkerPortalSession } from "./stalkerPortal";
import { getOrCreateStalkerPortalSession } from "./stalkerPortalRuntime";

export type StalkerProductProviderIdentity = {
  id: string;
  type: "stalker";
  url: string;
  playlistUrl?: string;
  mac?: string;
};

export type StalkerProductSession = {
  session: StalkerPortalSession;
  providerScopeId: string;
};

const sessionScopes = new WeakMap<object, string>();
let nextScope = 0;

function runtimeIdentity(provider: StalkerProductProviderIdentity) {
  const portalUrl = (provider.url || provider.playlistUrl || "").trim();
  const mac = provider.mac?.trim() ?? "";
  if (!portalUrl || !mac) {
    throw new Error("Stalker provider credentials are incomplete.");
  }
  return {
    providerId: provider.id,
    portalUrl,
    mac,
    diagnostics: { providerId: provider.id },
  };
}

export function readCurrentStalkerProductSession(
  provider: StalkerProductProviderIdentity,
): StalkerProductSession {
  const session = getOrCreateStalkerPortalSession(runtimeIdentity(provider));
  const key = session as object;
  let providerScopeId = sessionScopes.get(key);
  if (!providerScopeId) {
    nextScope += 1;
    providerScopeId = `${provider.id}:runtime-${nextScope}`;
    sessionScopes.set(key, providerScopeId);
  }
  return { session, providerScopeId };
}

export function isCurrentStalkerProductSession(
  provider: StalkerProductProviderIdentity,
  session: StalkerPortalSession,
) {
  return getOrCreateStalkerPortalSession(runtimeIdentity(provider)) === session;
}
