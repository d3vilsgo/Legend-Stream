import React from "react";
import { PagedLiveCatalog } from "./PagedCatalogViews";
import { useCatalogSync } from "@/context/CatalogSyncContext";
import { usePlayer } from "@/context/PlayerContext";
import type { EpgProgram } from "@/context/PlayerContext";
import type { Channel } from "@/lib/iptv";

export function StalkerLiveCatalog({
  providerId,
  epgByChannel,
  favorites,
  epgLoading,
  refreshing,
  onRefresh: _onRefresh,
  onOpen,
  onFavorite,
}: {
  providerId: string;
  channels: Channel[];
  epgByChannel: ReadonlyMap<string, readonly EpgProgram[]>;
  favorites: string[];
  epgLoading: boolean;
  refreshing: boolean;
  onRefresh: () => Promise<void> | void;
  onOpen: (channel: Channel) => void;
  onFavorite: (id: string) => void;
}) {
  const { provider } = usePlayer();
  const {
    snapshot,
    hasUsableCache,
    isSyncing,
    isRefreshing,
    refreshCatalog,
  } = useCatalogSync();

  if (!provider || provider.id !== providerId || provider.type !== "stalker") return null;
  const matches = snapshot.providerId === provider.id;
  const countKnown = matches && (
    hasUsableCache ||
    snapshot.ready ||
    snapshot.counts.live > 0
  );

  return <PagedLiveCatalog
    provider={provider}
    snapshotCount={{
      totalCount: countKnown ? snapshot.counts.live : null,
      countKnown,
    }}
    hasMeaningfulM3ULiveGroups={null}
    epgByChannel={epgByChannel}
    favorites={favorites}
    epgLoading={epgLoading}
    refreshing={refreshing || isRefreshing || isSyncing}
    onRefresh={refreshCatalog}
    onOpen={onOpen}
    onFavorite={onFavorite}
    onDrawerVisibilityChange={() => undefined}
  />;
}
