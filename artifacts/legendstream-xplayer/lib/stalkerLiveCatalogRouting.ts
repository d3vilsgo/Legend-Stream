import type { Channel, Provider } from "./iptv";
import { bootstrapStalkerProviderForLifecycle } from "./stalkerCatalogBootstrap";
import { syncStalkerLiveCatalog, type StalkerLiveSyncOwner } from "./stalkerLiveSync";

export type StalkerCatalogLifecycleProvider = Pick<
  Provider,
  "id" | "type" | "url" | "mac" | "channelCount"
>;

export type StalkerCatalogLifecycleOptions = {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  owner?: StalkerLiveSyncOwner;
};

type StalkerCatalogSync = typeof syncStalkerLiveCatalog;

export function removeLegacyStalkerCatalogChannels(
  channels: readonly Channel[],
  providerId: string,
) {
  return channels.filter((channel) => channel.providerId !== providerId);
}

export async function bootstrapStalkerCatalogForLifecycle(
  provider: StalkerCatalogLifecycleProvider,
  options: StalkerCatalogLifecycleOptions = {},
) {
  return bootstrapStalkerProviderForLifecycle(provider, {
    signal: options.signal,
    isCurrent: options.isCurrent,
  });
}

// The historical name is intentionally retained because PlayerContext and
// older deterministic harnesses own this seam. Without an injected legacy
// sync implementation, lifecycle work is now validation/bootstrap only.
export async function syncStalkerCatalogForLifecycle(
  provider: StalkerCatalogLifecycleProvider,
  options: StalkerCatalogLifecycleOptions = {},
  legacySync?: StalkerCatalogSync,
) {
  if (provider.type !== "stalker") return null;
  const portalUrl = provider.url.trim();
  const mac = provider.mac?.trim() || "";
  if (!portalUrl || !mac) {
    throw new Error("Stalker provider credentials are incomplete.");
  }

  if (legacySync) {
    return legacySync({
      provider: { id: provider.id, url: portalUrl, mac },
      signal: options.signal,
      isCurrent: options.isCurrent,
      owner: options.owner,
    });
  }

  const bootstrap = await bootstrapStalkerCatalogForLifecycle(provider, options);
  if (!bootstrap) return null;
  return {
    pagesFetched: 0,
    uniqueItems: bootstrap.cachedCatalogCount,
    persisted: bootstrap.cachedCatalogCount,
    totalItems: bootstrap.cachedCatalogCount,
    maxPageItems: null,
    categories: 0,
    discoverySource: "bootstrap" as const,
    elapsedMs: 0,
  };
}
