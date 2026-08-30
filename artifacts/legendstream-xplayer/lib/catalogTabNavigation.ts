import type { ProviderType } from "./iptv";

export type CatalogTabTarget = "movies" | "series" | string;

type CatalogTabLoaders = {
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
  if (options.target !== "movies" && options.target !== "series") return;

  if (options.providerType === "m3u") {
    if (options.target === "movies" && options.m3uCatalogCounts.movies > 0) {
      void options.loadLocalMovies();
      return;
    }
    if (options.target === "series" && options.m3uCatalogCounts.series > 0) {
      void options.loadLocalSeries();
    }
    return;
  }

  if (options.providerType !== "xtream") return;
  if (options.target === "movies") {
    void options.loadXtreamMovies();
    return;
  }
  void options.loadXtreamSeries();
}
