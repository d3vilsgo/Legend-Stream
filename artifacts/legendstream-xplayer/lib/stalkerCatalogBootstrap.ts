import { getOrCreateStalkerPortalSession } from "./stalkerPortalRuntime";
import { bootstrapStalkerProfile } from "./stalkerProfileBootstrap";
import { fetchStalkerLiveCategories } from "./stalkerLiveCatalog";
import { rememberStalkerLiveCategories } from "./stalkerCategoryCapability";
import { StalkerPortalError } from "./stalkerPortal";

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

function assertCurrent(signal?: AbortSignal, isCurrent?: () => boolean) {
  if (signal?.aborted || (isCurrent && !isCurrent())) {
    throw new StalkerPortalError("CANCELLED", "Stalker provider bootstrap was cancelled.");
  }
}

export async function bootstrapStalkerProviderForLifecycle(
  provider: StalkerBootstrapProvider,
  options: StalkerBootstrapOptions = {},
) {
  if (provider.type !== "stalker") return null;
  const portalUrl = provider.url.trim();
  const mac = provider.mac?.trim() || "";
  if (!portalUrl || !mac) throw new Error("Stalker provider credentials are incomplete.");

  assertCurrent(options.signal, options.isCurrent);
  const diagnostics = { providerId: provider.id };
  const session = getOrCreateStalkerPortalSession({
    providerId: provider.id,
    portalUrl,
    mac,
    diagnostics,
  });
  await session.handshake(options.signal);
  assertCurrent(options.signal, options.isCurrent);
  const profile = await bootstrapStalkerProfile(session, {
    signal: options.signal,
    diagnostics,
  });
  assertCurrent(options.signal, options.isCurrent);
  const liveCategories = await fetchStalkerLiveCategories(session, options.signal, diagnostics);
  assertCurrent(options.signal, options.isCurrent);
  rememberStalkerLiveCategories(provider.id, liveCategories);

  return {
    authenticated: true as const,
    profileSupported: profile.supported,
    liveCategories,
    cachedCatalogCount: Math.max(0, Number(provider.channelCount ?? 0) || 0),
  };
}
