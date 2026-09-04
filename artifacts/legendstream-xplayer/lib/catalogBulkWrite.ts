import type { CatalogKind, PersistedCatalogItem } from "./catalogPersistence";
import {
  CATALOG_LOGICAL_BATCH_MAX,
  executePreparedCatalogMultiRowBatch,
  type CatalogWriteDatabase,
} from "./catalogWriteBatch";

export type CatalogBulkWriteSqliteStage = "begin-transaction" | "insert-statement" | "commit";

export type CatalogBulkWriteBatchObservation = {
  batchIndex: number;
  batchRows: number;
  committedRows: number;
};

type CatalogBulkNonCancellableOptions = {
  database: CatalogWriteDatabase;
  providerId: string;
  kind: CatalogKind;
  items: PersistedCatalogItem[];
  seenAt: number;
  markNew: boolean;
  onProgress?: (written: number) => void;
  onBatchStarted?: (batchIndex: number) => void;
  onBatchCommitted?: (observation: CatalogBulkWriteBatchObservation) => void;
  onSqliteStage?: (stage: CatalogBulkWriteSqliteStage) => void;
  yieldToUi: () => Promise<void>;
};

function observableDatabase(
  database: CatalogWriteDatabase,
  onSqliteStage?: (stage: CatalogBulkWriteSqliteStage) => void,
): CatalogWriteDatabase {
  return {
    withExclusiveTransactionAsync: async (task) => {
      onSqliteStage?.("begin-transaction");
      await database.withExclusiveTransactionAsync(async (transaction) => {
        onSqliteStage?.("insert-statement");
        await task(transaction);
        onSqliteStage?.("commit");
      });
    },
  };
}

export async function executeCatalogBulkNonCancellableBatches(
  options: CatalogBulkNonCancellableOptions,
) {
  const observedDatabase = observableDatabase(options.database, options.onSqliteStage);
  let written = 0;

  for (let start = 0; start < options.items.length; start += CATALOG_LOGICAL_BATCH_MAX) {
    const batch = options.items.slice(start, start + CATALOG_LOGICAL_BATCH_MAX);
    const batchIndex = Math.floor(start / CATALOG_LOGICAL_BATCH_MAX) + 1;
    options.onBatchStarted?.(batchIndex);

    const result = await executePreparedCatalogMultiRowBatch({
      database: observedDatabase,
      providerId: options.providerId,
      kind: options.kind,
      items: batch,
      seenAt: options.seenAt,
      markNew: options.markNew,
    });

    if (result.actualExecutedRows !== batch.length) {
      throw new Error(
        `Catalog bulk non-cancellable committed row mismatch: expected=${batch.length} actual=${result.actualExecutedRows}`,
      );
    }

    written += result.actualExecutedRows;
    const observation = {
      batchIndex,
      batchRows: batch.length,
      committedRows: written,
    };
    options.onBatchCommitted?.(observation);
    options.onProgress?.(written);
    await options.yieldToUi();
  }

  return written;
}
