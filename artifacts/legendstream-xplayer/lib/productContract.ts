import type { ProviderType } from "./iptv";
import type { CatalogPlaybackIdentity } from "./catalogPageRepository";
import type { MediaPlaybackRef } from "./mediaProgress";
import type { LiveChannelIdentity } from "./playerLiveQueue";

/** R18 provider-neutral product vocabulary. Protocol/session/runtime authority stays below this boundary. */
export const PRODUCT_VIEWS = ["home", "live", "movies", "series", "history", "downloads", "settings"] as const;
export type ProductView = typeof PRODUCT_VIEWS[number];
export type ProductPlaybackReturnView = Extract<ProductView, "live" | "movies" | "series" | "history" | "downloads">;
export type LiveCategoryMode = "implicit-all" | "provider-global";

export type ProductCapabilities = Readonly<{
  live: boolean;
  movies: boolean;
  series: boolean;
  epg: boolean;
  supportsMovieAddedSort: boolean;
  liveCategoryMode: LiveCategoryMode;
}>;

/** Current presentation decisions: Xtream alone exposes added-sort; Stalker Live preserves provider-global category semantics. */
export function deriveProductCapabilities(providerType: ProviderType): ProductCapabilities {
  return {
    live: true,
    movies: true,
    series: true,
    epg: true,
    supportsMovieAddedSort: providerType === "xtream",
    liveCategoryMode: providerType === "stalker" ? "provider-global" : "implicit-all",
  };
}

export type ProductPlaybackKind = "live" | "movie" | "episode" | "download";

/**
 * Canonical identity types are composed rather than redefined.
 * runtimeSource is an in-memory resolved source for the current player handoff, not a durable identity.
 * Stalker Live CMD/session/create_link material is intentionally absent.
 */
export type ProductPlayableIntent = Readonly<{
  title: string;
  subtitle?: string;
  kind: ProductPlaybackKind;
  returnTo: ProductPlaybackReturnView;
  runtimeSource: string;
  liveIdentity?: LiveChannelIdentity;
  vodIdentity?: CatalogPlaybackIdentity;
  progressRef?: MediaPlaybackRef;
}>;