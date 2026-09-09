import React from "react";
import { ActivityIndicator, View } from "react-native";
import { PagedLiveCatalog } from "./PagedCatalogViews";
import type { EpgProgram } from "@/context/PlayerContext";
import { usePlayer } from "@/context/PlayerContext";
import { useStalkerLiveCatalogSync } from "@/hooks/useStalkerLiveCatalogSync";
import type { Channel } from "@/lib/iptv";

export function StalkerLiveCatalog({
  providerId,
  channels: _channels,
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
  const sync = useStalkerLiveCatalogSync(
    provider?.id === providerId && provider.type === "stalker" ? provider : null,
  );

  if (!provider || provider.id !== providerId || provider.type !== "stalker") return null;
  if (!sync.categoriesReady) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="small" />
    </View>;
  }

  return <PagedLiveCatalog
    provider={provider}
    snapshotCount={{
      totalCount: sync.totalCount,
      countKnown: sync.countKnown,
    }}
    hasMeaningfulM3ULiveGroups={null}
    epgByChannel={epgByChannel}
    favorites={favorites}
    epgLoading={epgLoading}
    refreshing={refreshing || sync.syncing}
    onRefresh={sync.refresh}
    onOpen={onOpen}
    onFavorite={onFavorite}
    onDrawerVisibilityChange={() => undefined}
  />;
}
