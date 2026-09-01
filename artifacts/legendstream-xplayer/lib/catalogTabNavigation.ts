import type { ProviderType } from "./iptv";

export type CatalogTabTarget = "live" | "movies" | "series" | string;

type CatalogTabLoaders = {
  loadLocalLive: () => void | Promise<void>;
  loadLocalMovies: () => void | Promise<void>;
  loadLocalSeries: () => void | Promise<void>;
  loadXtreamMovies: () => void | Promise<void>;
  loadXtreamSeries: () => void | Promise<void>;
};

export type CatalogTabNavigationOptions = CatalogTabLoaders & {
  providerType?: ProviderType | null;
  target: CatalogTabTarget;
  m3uCatalogCounts: {
    movies: number;
    series: number;
  };
};

export function dispatchCatalogTabNavigation(options: CatalogTabNavigationOptions) {
  if (options.providerType === "m3u") {
    if (options.target === "movies") {
      void options.loadLocalMovies();
      return;
    }
    if (options.target === "series") {
      void options.loadLocalSeries();
      return;
    }
    if (options.target === "live") {
      void options.loadLocalLive();
    }
    return;
  }

  if (options.target !== "movies" && options.target !== "series") return;
  if (options.providerType !== "xtream") return;
  if (options.target === "movies") {
    void options.loadXtreamMovies();
    return;
  }
  void options.loadXtreamSeries();
}
