import React from "react";
import OptimizedHomeScreenV6 from "@/components/OptimizedHomeScreenV6";
import StalkerMainPage from "@/components/StalkerMainPage";
import { usePlayer } from "@/context/PlayerContext";
import {
  deriveProductCapabilities,
  type ProductCapabilities,
} from "@/lib/productContract";

type TransitionalProductSurface = "paged" | "stalker";

/**
 * R18-C transitional delegate selection.
 *
 * ProductShell is now the single root product boundary. Existing provider
 * surfaces remain authoritative for their view/navigation/player state until
 * their dedicated R18 convergence slices. The capability describes the
 * product behavior that requires the temporary Stalker surface; provider
 * identity does not select architecture at the app root anymore.
 */
export function selectTransitionalProductSurface(
  capabilities: ProductCapabilities,
): TransitionalProductSurface {
  return capabilities.liveCategoryMode === "provider-global" ? "stalker" : "paged";
}

export default function ProductShell() {
  const { provider } = usePlayer();

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
