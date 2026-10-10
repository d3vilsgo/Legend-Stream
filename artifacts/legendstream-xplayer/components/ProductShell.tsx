import React from "react";
import { shortSafeId, traceStalker } from "@/lib/stalkerPlaybackTrace";
import OptimizedHomeScreenV6 from "@/components/OptimizedHomeScreenV6";
import StalkerMainPage from "@/components/StalkerMainPage";
import { usePlayer } from "@/context/PlayerContext";
import { deriveProductCapabilities } from "@/lib/productContract";
import { selectTransitionalProductSurface } from "@/lib/productShell";
import { UiPresentationProvider } from "@/context/UiPresentationContext";

export default function ProductShell() {
  const { provider } = usePlayer();

  traceStalker("PRODUCT_SHELL_RENDER", { providerPresent: Boolean(provider), providerType: provider?.type ?? "none", providerShortId: shortSafeId(provider?.id), selectedDelegate: provider ? selectTransitionalProductSurface(deriveProductCapabilities(provider.type)) : "paged", delegateKey: provider ? shortSafeId(provider.id) : "none" });

  if (!provider) {
    return (
      <UiPresentationProvider>
        <OptimizedHomeScreenV6 />
      </UiPresentationProvider>
    );
  }

  const capabilities = deriveProductCapabilities(provider.type);
  const surface = selectTransitionalProductSurface(capabilities);

  // Keying the delegate by provider prevents product/player view state from
  // surviving a provider switch. Existing provider-switch generation/abort
  // guards remain authoritative below this boundary.
  return (
    <UiPresentationProvider>
      {surface === "stalker"
        ? <StalkerMainPage key={provider.id} />
        : <OptimizedHomeScreenV6 key={provider.id} />}
    </UiPresentationProvider>
  );
}
