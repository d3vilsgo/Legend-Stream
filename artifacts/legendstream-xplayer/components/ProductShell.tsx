import { MovieInfoServiceProvider } from "./tmdb/MovieInfoServiceProvider";
import type { ProxyAccess } from "@/lib/tmdbProxy/transport";
import { TVRemoteInspectorOverlay, TVRemoteInspectorCollector } from "@/components/tvPreview/TVRemoteInspector";
import React from "react";
import { View } from "react-native";
import { shortSafeId, traceStalker } from "@/lib/stalkerPlaybackTrace";
import OptimizedHomeScreenV6 from "@/components/OptimizedHomeScreenV6";
import StalkerMainPage from "@/components/StalkerMainPage";
import { usePlayer } from "@/context/PlayerContext";
import { deriveProductCapabilities } from "@/lib/productContract";
import { selectTransitionalProductSurface } from "@/lib/productShell";
import { UiPresentationProvider } from "@/context/UiPresentationContext";
import { TVPreviewControls, TVPreviewFocusProvider, TVPreviewFocusRegion } from "@/components/tvPreview/TVPreviewFocus";

function ProductShellContent() {
  const { provider } = usePlayer();

  traceStalker("PRODUCT_SHELL_RENDER", { providerPresent: Boolean(provider), providerType: provider?.type ?? "none", providerShortId: shortSafeId(provider?.id), selectedDelegate: provider ? selectTransitionalProductSurface(deriveProductCapabilities(provider.type)) : "paged", delegateKey: provider ? shortSafeId(provider.id) : "none" });

  if (!provider) {
    return <OptimizedHomeScreenV6 />;
  }

  const capabilities = deriveProductCapabilities(provider.type);
  const surface = selectTransitionalProductSurface(capabilities);

  // Keying the delegate by provider prevents product/player view state from
  // surviving a provider switch. Existing provider-switch generation/abort
  // guards remain authoritative below this boundary.
  return surface === "stalker"
    ? <StalkerMainPage key={provider.id} />
    : <OptimizedHomeScreenV6 key={provider.id} />;
}


export default function ProductShell({ metadataAccess }: { metadataAccess?: ProxyAccess } = {}) {
  const { provider } = usePlayer();
  return (
    <MovieInfoServiceProvider access={metadataAccess}>
    <UiPresentationProvider>
      <TVPreviewFocusProvider key={provider?.id ?? "disconnected"}>
        <View style={{ flex: 1, minHeight: 0 }}>
          <View style={{ flex: 1, minHeight: 0 }}><TVPreviewFocusRegion><ProductShellContent /></TVPreviewFocusRegion></View>
          <TVPreviewControls />
          <TVRemoteInspectorCollector />
          <TVRemoteInspectorOverlay />
        </View>
      </TVPreviewFocusProvider>
    </UiPresentationProvider>
    </MovieInfoServiceProvider>
  );
}
