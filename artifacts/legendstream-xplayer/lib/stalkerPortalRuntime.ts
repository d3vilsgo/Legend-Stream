import {
  createStalkerPortalSession,
  normalizeStalkerPortalTarget,
  type StalkerPortalSession,
} from "./stalkerPortal";
import { yieldToUi } from "./cooperative";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type StalkerPortalRuntimeIdentity = {
  providerId: string;
  portalUrl: string;
  mac: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

type RuntimeEntry = {
  endpointUrl: string;
  mac: string;
  session: StalkerPortalSession;
};

const sessions = new Map<string, RuntimeEntry>();

export function getOrCreateStalkerPortalSession(
  identity: StalkerPortalRuntimeIdentity,
) {
  const providerId = identity.providerId.trim();
  const mac = identity.mac.trim();
  const target = normalizeStalkerPortalTarget(identity.portalUrl);
  if (!providerId) throw new Error("Stalker portal runtime requires a provider identifier.");

  const current = sessions.get(providerId);
  if (current && current.endpointUrl === target.endpointUrl && current.mac === mac) {
    return current.session;
  }

  current?.session.dispose();
  const session = createStalkerPortalSession({
    portalUrl: identity.portalUrl,
    mac,
    fetchImpl: identity.fetchImpl,
    timeoutMs: identity.timeoutMs,
    afterResponse: yieldToUi,
  });
  sessions.set(providerId, { endpointUrl: target.endpointUrl, mac, session });
  return session;
}

export function releaseStalkerPortalSession(providerId: string) {
  const key = providerId.trim();
  const current = sessions.get(key);
  if (!current) return false;
  sessions.delete(key);
  current.session.dispose();
  return true;
}
