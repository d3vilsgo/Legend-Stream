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

// Retained only for explicit legacy/compatibility callers. Normal provider
// connect/refresh no longer acquires a full Stalker catalog.
export async function syncStalkerCatalogForLifecycle(
  provider: StalkerCatalogLifecycleProvider,
  options: StalkerCatalogLifecycleOptions = {},
  sync: StalkerCatalogSync = syncStalkerLiveCatalog,
) {
  if (provider.type !== "stalker") return null;
  const portalUrl = provider.url.trim();
  const mac = provider.mac?.trim() || "";
  if (!portalUrl || !mac) {
    throw new Error("Stalker provider credentials are incomplete.");
  }
  return sync({
    provider: { id: provider.id, url: portalUrl, mac },
    signal: options.signal,
    isCurrent: options.isCurrent,
    owner: options.owner,
  });
}
