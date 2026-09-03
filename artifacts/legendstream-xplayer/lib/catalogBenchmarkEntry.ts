export const CATALOG_BENCHMARK_ROUTE = "/catalog-benchmark" as const;

export type CatalogAppRuntime = Readonly<{
  kind: "production" | "benchmark";
  benchmarkRoute: typeof CATALOG_BENCHMARK_ROUTE | null;
  mountQueryClientProvider: boolean;
  mountI18nProvider: boolean;
  mountPlayerProvider: boolean;
  mountCatalogSyncProvider: boolean;
  mountMediaLibraryProvider: boolean;
  runBackupTempCleanup: boolean;
}>;

const PRODUCTION_RUNTIME: CatalogAppRuntime = Object.freeze({
  kind: "production",
  benchmarkRoute: null,
  mountQueryClientProvider: true,
  mountI18nProvider: true,
  mountPlayerProvider: true,
  mountCatalogSyncProvider: true,
  mountMediaLibraryProvider: true,
  runBackupTempCleanup: true,
});

const BENCHMARK_RUNTIME: CatalogAppRuntime = Object.freeze({
  kind: "benchmark",
  benchmarkRoute: CATALOG_BENCHMARK_ROUTE,
  mountQueryClientProvider: false,
  mountI18nProvider: false,
  mountPlayerProvider: false,
  mountCatalogSyncProvider: false,
  mountMediaLibraryProvider: false,
  runBackupTempCleanup: false,
});

export function isCatalogBenchmarkBuildEnabled(
  flag = process.env.EXPO_PUBLIC_ENABLE_CATALOG_BENCHMARK,
) {
  return flag === "1";
}

export function resolveCatalogBenchmarkEntry(flag?: string) {
  return isCatalogBenchmarkBuildEnabled(flag) ? CATALOG_BENCHMARK_ROUTE : null;
}

/**
 * Pure startup contract used by the root layout. Benchmark builds deliberately
 * exclude every production provider and its cold-start cleanup lifecycle.
 */
export function resolveCatalogAppRuntime(
  flag = process.env.EXPO_PUBLIC_ENABLE_CATALOG_BENCHMARK,
): CatalogAppRuntime {
  return isCatalogBenchmarkBuildEnabled(flag) ? BENCHMARK_RUNTIME : PRODUCTION_RUNTIME;
}

export function createProductionQueryClient<T>(
  runtime: CatalogAppRuntime,
  create: () => T,
): T | null {
  return runtime.mountQueryClientProvider ? create() : null;
}
