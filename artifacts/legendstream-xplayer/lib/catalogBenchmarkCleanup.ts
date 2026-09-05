import {
  catalogBenchmarkArtifactNames,
} from "./catalogWriteBenchmarkRunner";

export type CatalogBenchmarkArtifactFile = {
  readonly exists: boolean;
  delete(): void;
};

export type CatalogBenchmarkArtifactFileFactory = (
  fileUri: string,
) => CatalogBenchmarkArtifactFile;

function failureText(caught: unknown) {
  if (caught instanceof Error) return caught.stack ?? `${caught.name}: ${caught.message}`;
  return String(caught);
}

export class CatalogBenchmarkCleanupError extends Error {
  readonly failures: unknown[];

  constructor(failures: unknown[]) {
    super(`Catalog benchmark cleanup failed:\n${failures.map(failureText).join("\n---\n")}`);
    this.name = "CatalogBenchmarkCleanupError";
    this.failures = failures;
  }
}

export class CatalogBenchmarkLifecycleError extends Error {
  readonly primaryError: unknown;
  readonly cleanupError: unknown;

  constructor(primaryError: unknown, cleanupError: unknown) {
    super(
      `Catalog benchmark failed and cleanup also failed.\n` +
      `Primary failure:\n${failureText(primaryError)}\n` +
      `Cleanup failure:\n${failureText(cleanupError)}`,
    );
    this.name = "CatalogBenchmarkLifecycleError";
    this.primaryError = primaryError;
    this.cleanupError = cleanupError;
  }
}

/** Adapts expo-sqlite's Android filesystem path to expo-file-system's URI contract. */
export function normalizeBenchmarkDirectoryFileUri(directory: string) {
  if (directory !== directory.trim() || directory.length === 0) {
    throw new Error("INVALID_BENCHMARK_DATABASE_DIRECTORY");
  }
  if (/^file:\/\/\/[^?#]+$/.test(directory)) return directory;
  if (/^\/[^/][^?#]*$/.test(directory)) return `file://${directory}`;
  throw new Error("INVALID_BENCHMARK_DATABASE_DIRECTORY");
}

export function catalogBenchmarkArtifactFileUris(
  databaseName: string,
  directory: string,
) {
  const directoryUri = normalizeBenchmarkDirectoryFileUri(directory);
  const separator = directoryUri.endsWith("/") ? "" : "/";
  return catalogBenchmarkArtifactNames(databaseName).map(
    (artifactName) => `${directoryUri}${separator}${artifactName}`,
  );
}

/**
 * Deletes only exact, safe benchmark artifacts. Missing files are the normal case
 * for a fresh UUID-scoped run and therefore make no native delete call.
 */
export async function deleteExistingCatalogBenchmarkArtifacts(options: {
  databaseName: string;
  directory: string;
  createFile: CatalogBenchmarkArtifactFileFactory;
}) {
  const failures: unknown[] = [];
  for (const fileUri of catalogBenchmarkArtifactFileUris(
    options.databaseName,
    options.directory,
  )) {
    try {
      const artifact = options.createFile(fileUri);
      if (!artifact.exists) continue;
      artifact.delete();
      if (artifact.exists) {
        throw new Error("BENCHMARK_ARTIFACT_DELETE_INCOMPLETE");
      }
    } catch (caught) {
      failures.push(caught);
    }
  }
  if (failures.length > 0) throw new CatalogBenchmarkCleanupError(failures);
}
