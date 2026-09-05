import {
  runCatalogWriteBenchmark,
  runCatalogWriteNativeCorrectnessProbes,
  createNativeCatalogBenchmarkDatabaseName,
} from "./catalogWriteBenchmark";
import type { CatalogBenchmarkDependencies } from "./catalogWriteBenchmarkRunner";

export const nativeCatalogBenchmarkDependencies: CatalogBenchmarkDependencies = {
  runBenchmark: runCatalogWriteBenchmark,
  runNativeCorrectnessProbes: runCatalogWriteNativeCorrectnessProbes,
  createDatabaseName: createNativeCatalogBenchmarkDatabaseName,
};
