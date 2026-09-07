import type { Channel, Provider } from "./iptv";
import { syncStalkerLiveCatalog } from "./stalkerLiveSync";

export type StalkerCatalogLifecycleProvider = Pick<
  Provider,
  "id" | "type" | "url" | "mac"
>;

export type StalkerCatalogLifecycleOptions = {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
};

type StalkerCatalogSync = typeof syncStalkerLiveCatalog;

export function removeLegacyStalkerCatalogChannels(
  channels: readonly Channel[],
  providerId: string,
) {
  return channels.filter((channel) => channel.providerId !== providerId);
}

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
  });
}
