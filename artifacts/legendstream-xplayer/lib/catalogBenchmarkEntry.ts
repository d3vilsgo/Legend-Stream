export const CATALOG_BENCHMARK_ROUTE = "/catalog-benchmark" as const;

export function isCatalogBenchmarkBuildEnabled(
  flag = process.env.EXPO_PUBLIC_ENABLE_CATALOG_BENCHMARK,
) {
  return flag === "1";
}

export function resolveCatalogBenchmarkEntry(flag?: string) {
  return isCatalogBenchmarkBuildEnabled(flag) ? CATALOG_BENCHMARK_ROUTE : null;
}
