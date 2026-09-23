import type { ProductCapabilities } from "./productContract";

export type TransitionalProductSurface = "paged" | "stalker";

/**
 * Temporary R18-C delegate choice expressed in product capability terms.
 * Remove as the product surfaces converge in later R18 slices.
 */
export function selectTransitionalProductSurface(
  capabilities: ProductCapabilities,
): TransitionalProductSurface {
  return capabilities.liveCategoryMode === "provider-global" ? "stalker" : "paged";
}
