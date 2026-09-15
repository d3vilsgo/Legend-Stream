import type { Channel } from "./iptv";

export type HomeLiveSourceSnapshot = {
  providerId?: string;
  ready: boolean;
  counts: { live: number };
  live: Channel[];
};

export type HomeLiveSourceProvider = {
  id: string;
  type: string;
};

export type HomeLiveSourceResult = {
  channels: Channel[];
  totalCount: number | null;
  countKnown: boolean;
};

export function selectHomeLiveSource({
  provider,
  snapshot,
  hasUsableCache,
  legacyChannels,
  limit = 48,
}: {
  provider: HomeLiveSourceProvider | null;
  snapshot: HomeLiveSourceSnapshot;
  hasUsableCache: boolean;
  legacyChannels: readonly Channel[];
  limit?: number;
}): HomeLiveSourceResult {
  if (!provider) {
    return { channels: [], totalCount: null, countKnown: false };
  }

  const matches = snapshot.providerId === provider.id;
  if (provider.type === "stalker") {
    const countKnown = matches && (hasUsableCache || snapshot.ready || snapshot.counts.live > 0);
    return {
      channels: matches ? snapshot.live.slice(0, limit) : [],
      totalCount: countKnown ? snapshot.counts.live : null,
      countKnown,
    };
  }

  const canonicalChannels = matches && snapshot.live.length ? snapshot.live : null;
  const countKnown = matches && (hasUsableCache || snapshot.ready || snapshot.counts.live > 0);
  return {
    channels: (canonicalChannels ?? legacyChannels).slice(0, limit),
    totalCount: countKnown ? snapshot.counts.live : null,
    countKnown,
  };
}
