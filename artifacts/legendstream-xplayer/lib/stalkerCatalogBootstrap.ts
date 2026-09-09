import { getOrCreateStalkerPortalSession } from "./stalkerPortalRuntime";
import { bootstrapStalkerProfile } from "./stalkerProfileBootstrap";
import { fetchStalkerLiveCategories } from "./stalkerLiveCatalog";
import { rememberStalkerLiveCategories } from "./stalkerCategoryCapability";
import { StalkerPortalError, type StalkerPortalSession } from "./stalkerPortal";
import { traceStalkerConnectCheckpoint } from "./stalkerConnectTrace";

export type StalkerBootstrapProvider = {
  id: string;
  type: string;
  url: string;
  mac?: string;
  channelCount?: number;
};

export type StalkerBootstrapOptions = {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
};

type StalkerBootstrapDependencies = {
  acquireSession?: (provider: StalkerBootstrapProvider) => Pick<StalkerPortalSession, "handshake" | "request">;
  bootstrapProfile?: typeof bootstrapStalkerProfile;
  fetchLiveCategories?: typeof fetchStalkerLiveCategories;
  rememberLiveCategories?: typeof rememberStalkerLiveCategories;
};

function assertCurrent(signal?: AbortSignal, isCurrent?: () => boolean) {
  if (signal?.aborted || (isCurrent && !isCurrent())) {
    throw new StalkerPortalError("CANCELLED", "Stalker provider bootstrap was cancelled.");
  }
}

export async function bootstrapStalkerProviderForLifecycle(
  provider: StalkerBootstrapProvider,
  options: StalkerBootstrapOptions = {},
  dependencies: StalkerBootstrapDependencies = {},
) {
  if (provider.type !== "stalker") return null;
  const portalUrl = provider.url.trim();
  const mac = provider.mac?.trim() || "";
  if (!portalUrl || !mac) throw new Error("Stalker provider credentials are incomplete.");

  traceStalkerConnectCheckpoint("BOOTSTRAP_START");
  assertCurrent(options.signal, options.isCurrent);
  const diagnostics = { providerId: provider.id };
  const session = dependencies.acquireSession?.(provider) ?? getOrCreateStalkerPortalSession({
    providerId: provider.id,
    portalUrl,
    mac,
    diagnostics,
  });
  await session.handshake(options.signal);
  traceStalkerConnectCheckpoint("HANDSHAKE_DONE");
  assertCurrent(options.signal, options.isCurrent);
  const profile = await (dependencies.bootstrapProfile ?? bootstrapStalkerProfile)(session as StalkerPortalSession, {
    signal: options.signal,
    diagnostics,
  });
  traceStalkerConnectCheckpoint("PROFILE_DONE", { profileSupported: profile.supported });
  assertCurrent(options.signal, options.isCurrent);
  const liveCategories = await (dependencies.fetchLiveCategories ?? fetchStalkerLiveCategories)(
    session,
    options.signal,
    diagnostics,
  );
  assertCurrent(options.signal, options.isCurrent);
  (dependencies.rememberLiveCategories ?? rememberStalkerLiveCategories)(provider.id, liveCategories);
  traceStalkerConnectCheckpoint("CATEGORIES_REMEMBERED", { categoryCount: liveCategories.length });

  traceStalkerConnectCheckpoint("BOOTSTRAP_DONE", { categoryCount: liveCategories.length });
  return {
    authenticated: true as const,
    profileSupported: profile.supported,
    liveCategories,
    cachedCatalogCount: Math.max(0, Number(provider.channelCount ?? 0) || 0),
  };
}
