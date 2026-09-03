import { useEffect, useMemo, useRef, useState } from "react";
import type { ProviderConfig } from "@/context/PlayerContext";
import { normalizeLiveIdentityIds } from "@/lib/catalogLiveIdentity";
import { getCachedLiveItemsByIds } from "@/lib/catalogLiveIdentityRepository";
import type { Channel } from "@/lib/iptv";

export function useResolvedLiveIdentityChannels(
  provider: ProviderConfig | null,
  ids: readonly string[],
  inMemoryChannels: readonly Channel[],
) {
  const [resolved, setResolved] = useState<Channel[]>([]);
  const generationRef = useRef(0);
  const identityKey = useMemo(
    () => normalizeLiveIdentityIds(ids).join("\u0000"),
    [ids],
  );
  const requestedIds = useMemo(
    () => identityKey ? identityKey.split("\u0000") : [],
    [identityKey],
  );

  useEffect(() => {
    const generation = ++generationRef.current;
    if (!provider || !requestedIds.length) {
      setResolved([]);
      return;
    }

    const requested = new Set(requestedIds);
    const localById = new Map(
      inMemoryChannels
        .filter((channel) => channel.providerId === provider.id && requested.has(channel.id))
        .map((channel) => [channel.id, channel] as const),
    );
    const publishOrdered = (persisted: readonly Channel[] = []) => {
      if (generationRef.current !== generation) return;
      const byId = new Map(localById);
      for (const channel of persisted) {
        if (channel.providerId === provider.id && requested.has(channel.id)) {
          byId.set(channel.id, channel);
        }
      }
      setResolved(
        requestedIds
          .map((id) => byId.get(id))
          .filter((item): item is Channel => Boolean(item)),
      );
    };

    publishOrdered();
    if (provider.type === "stalker") return;
    if (provider.type !== "m3u" && provider.type !== "xtream") return;

    void getCachedLiveItemsByIds(provider, requestedIds)
      .then((rows) => publishOrdered(rows))
      .catch(() => publishOrdered());

    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [provider?.id, provider?.type, identityKey, inMemoryChannels]);

  return resolved;
}
