import type { PersistedCatalogItem } from "./catalogPersistence";

const sanitizeIdPart = (value: string) => value.replace(/[^a-zA-Z0-9:_-]/g, "-");

export function stableXtreamLiveId(providerId: string, streamId: string | number) {
  return sanitizeIdPart(`${providerId}:xtream-live:${String(streamId)}`);
}

export function legacyXtreamLiveStreamId(channelId: string) {
  const match = channelId.match(/^[^:]+:\d+:(.+)$/);
  return match?.[1] || null;
}

export function stabilizeXtreamLiveCatalogItems(
  identityProviderId: string,
  items: PersistedCatalogItem[],
) {
  for (const item of items) {
    if (item.catalogKind !== "live" || item.playbackRef.type !== "xtream-live") continue;
    item.id = stableXtreamLiveId(identityProviderId, item.playbackRef.streamId);
  }
  return items;
}
