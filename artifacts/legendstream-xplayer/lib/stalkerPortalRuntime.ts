import {
  createStalkerPortalSession,
  normalizeStalkerPortalTarget,
  type StalkerPortalSession,
} from "./stalkerPortal";
import { yieldToUi } from "./cooperative";
import { safeLog } from "./safeLog";

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
  diagnostics?: {
    syncRunId?: string;
    providerId?: string;
  };
};

type RuntimeEntry = {
  endpointUrl: string;
  mac: string;
  session: StalkerPortalSession;
  sessionGeneration: number;
};

const sessions = new Map<string, RuntimeEntry>();
let sessionGenerationSequence = 0;

export function getOrCreateStalkerPortalSession(
  identity: StalkerPortalRuntimeIdentity,
) {
  const providerId = identity.providerId.trim();
  const mac = identity.mac.trim();
  const target = normalizeStalkerPortalTarget(identity.portalUrl);
  if (!providerId) throw new Error("Stalker portal runtime requires a provider identifier.");

  const current = sessions.get(providerId);
  if (current && current.endpointUrl === target.endpointUrl && current.mac === mac) {
    current.session.setDiagnosticsContext(identity.diagnostics ?? { providerId });
    safeLog.info("LS_STALKER_SESSION_ACQUIRE", {
      syncRunId: identity.diagnostics?.syncRunId,
      providerId,
      registryHit: true,
      recreated: false,
      sessionGeneration: current.sessionGeneration,
      reason: "HIT",
    });
    return current.session;
  }

  const reason = !current
    ? "MISS"
    : current.endpointUrl !== target.endpointUrl
      ? "ENDPOINT_CHANGED"
      : current.mac !== mac
        ? "MAC_CHANGED"
        : "OTHER";
  current?.session.dispose();
  const sessionGeneration = ++sessionGenerationSequence;
  const session = createStalkerPortalSession({
    portalUrl: identity.portalUrl,
    mac,
    fetchImpl: identity.fetchImpl,
    timeoutMs: identity.timeoutMs,
    afterResponse: yieldToUi,
    diagnostics: identity.diagnostics ?? { providerId },
  });
  sessions.set(providerId, { endpointUrl: target.endpointUrl, mac, session, sessionGeneration });
  safeLog.info("LS_STALKER_SESSION_ACQUIRE", {
    syncRunId: identity.diagnostics?.syncRunId,
    providerId,
    registryHit: false,
    recreated: Boolean(current),
    sessionGeneration,
    reason,
  });
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
