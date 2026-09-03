import type { Channel } from "./iptv";

export type ProviderScopedChannelIndex = ReadonlyMap<string, Channel>;

const scopedKey = (providerId: string, channelId: string) => `${providerId}\u0000${channelId}`;

export function indexLiveChannelsByProviderAndId(
  channels: readonly Channel[],
): ProviderScopedChannelIndex {
  const index = new Map<string, Channel>();
  for (const channel of channels) {
    index.set(scopedKey(channel.providerId, channel.id), channel);
  }
  return index;
}

export function resolveLiveIdentityPresentationRows(
  providerId: string,
  ids: readonly string[],
  index: ProviderScopedChannelIndex,
): Channel[] {
  const rows: Channel[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id) continue;
    const channel = index.get(scopedKey(providerId, id));
    if (channel) rows.push(channel);
  }
  return rows;
}
