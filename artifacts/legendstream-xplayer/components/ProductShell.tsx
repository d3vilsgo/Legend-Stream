import { MovieInfoServiceProvider } from "./tmdb/MovieInfoServiceProvider";
import { TVRemoteInspectorOverlay, TVRemoteInspectorCollector } from "@/components/tvPreview/TVRemoteInspector";
import React, { createContext, useContext, useState } from "react";
import { Platform, View } from "react-native";
import { shortSafeId, traceStalker } from "@/lib/stalkerPlaybackTrace";
import OptimizedHomeScreenV6 from "@/components/OptimizedHomeScreenV6";
import StalkerMainPage from "@/components/StalkerMainPage";
import { usePlayer } from "@/context/PlayerContext";
import { deriveProductCapabilities } from "@/lib/productContract";
import { selectTransitionalProductSurface } from "@/lib/productShell";
import { UiPresentationProvider, useUiPresentation } from "@/context/UiPresentationContext";
import { TVPreviewControls, TVPreviewFocusProvider, TVPreviewFocusRegion } from "@/components/tvPreview/TVPreviewFocus";
import { EliteV4TvShell } from "@/components/eliteV4/EliteV4TvShell";
import { EliteV4PreviewToggle } from "@/components/eliteV4/EliteV4PreviewToggle";

const V4SelectionContext=createContext<{selected:boolean;select:(enabled:boolean)=>void}|null>(null);

export function ProductShellContent() {
  const selection=useContext(V4SelectionContext);
  const { provider } = usePlayer();
  const { tvPreview } = useUiPresentation();
  // UI version is an explicit user choice; presentation mode only controls availability.
  const [localV4Selection, setLocalV4Selection] = useState(false);
  const eliteV4Preview = selection?.selected ?? localV4Selection;
  const setEliteV4Preview = selection?.select ?? setLocalV4Selection;
  const previewAvailable = Platform.isTV || tvPreview;


  traceStalker("PRODUCT_SHELL_RENDER", { providerPresent: Boolean(provider), providerType: provider?.type ?? "none", providerShortId: shortSafeId(provider?.id), selectedDelegate: provider ? selectTransitionalProductSurface(deriveProductCapabilities(provider.type)) : "paged", delegateKey: provider ? shortSafeId(provider.id) : "none" });

  if (provider && previewAvailable && eliteV4Preview) {
    return <View style={{ flex: 1, minHeight: 0 }}><EliteV4TvShell onReturnToV3={() => setEliteV4Preview(false)} /><EliteV4PreviewToggle enabled onChange={setEliteV4Preview} /></View>;
  }

  if (!provider) {
    return <OptimizedHomeScreenV6 />;
  }

  const capabilities = deriveProductCapabilities(provider.type);
  const surface = selectTransitionalProductSurface(capabilities);

  // Keying the delegate by provider prevents product/player view state from
  // surviving a provider switch. Existing provider-switch generation/abort
  // guards remain authoritative below this boundary.
  return <>
    {surface === "stalker"
      ? <StalkerMainPage key={provider.id} />
      : <OptimizedHomeScreenV6 key={provider.id} />}
    {previewAvailable ? <EliteV4PreviewToggle enabled={false} onChange={setEliteV4Preview} /> : null}
  </>;
}


export default function ProductShell() {
  // Preserve the explicit UI choice when provider-owned focus scopes remount.
  const [v4Selection,setV4Selection]=useState(false);
  const { provider } = usePlayer();
  return (
    <V4SelectionContext.Provider value={{selected:v4Selection,select:setV4Selection}}>
    <MovieInfoServiceProvider>
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
    </V4SelectionContext.Provider>
  );
}

