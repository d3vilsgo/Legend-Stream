import type { Channel } from "./iptv";

export type LiveChannelIdentity = Readonly<{
  providerId: string;
  channelId: string;
}>;

const isLiveChannel = (channel: Channel) =>
  (channel.contentType ?? "live") === "live";

export function matchesLiveChannel(
  channel: Channel,
  identity: LiveChannelIdentity,
) {
  return channel.providerId === identity.providerId && channel.id === identity.channelId;
}

export function liveQueueIndex(
  queue: readonly Channel[],
  identity: LiveChannelIdentity | null | undefined,
) {
  if (!identity) return -1;
  return queue.findIndex((channel) => matchesLiveChannel(channel, identity));
}

export function buildLiveQueue(
  channels: readonly Channel[],
  identity: LiveChannelIdentity | null | undefined,
): Channel[] {
  if (!identity) return [];
  const providerChannels = channels.filter(
    (channel) => channel.providerId === identity.providerId && isLiveChannel(channel),
  );
  const active = providerChannels.find((channel) => matchesLiveChannel(channel, identity));
  if (!active) return [];

  const sameCategory = providerChannels.filter(
    (channel) => channel.category === active.category,
  );
  return sameCategory.length ? sameCategory : providerChannels;
}

export function resolveLiveQueue(
  connectedChannels: readonly Channel[],
  cachedChannels: readonly Channel[],
  identity: LiveChannelIdentity | null | undefined,
) {
  if (!identity) return [];

  // Prefer the connected in-memory catalog when it contains the exact stable
  // identity. After a cold restart PlayerContext intentionally starts with an
  // empty channel array, so fall back to the persisted catalog projection.
  if (liveQueueIndex(connectedChannels, identity) >= 0) {
    return buildLiveQueue(connectedChannels, identity);
  }
  if (liveQueueIndex(cachedChannels, identity) >= 0) {
    return buildLiveQueue(cachedChannels, identity);
  }
  return [];
}

export function liveNavigationState(
  queue: readonly Channel[],
  identity: LiveChannelIdentity | null | undefined,
) {
  const currentIndex = liveQueueIndex(queue, identity);
  return {
    currentIndex,
    canNavigate: queue.length > 1 && currentIndex >= 0,
    canPrevious: currentIndex > 0,
    canNext: currentIndex >= 0 && currentIndex < queue.length - 1,
  };
}
