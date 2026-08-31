let catalogDbWriteTail: Promise<void> = Promise.resolve();
let pendingCatalogDbWrites = 0;

export function enqueueCatalogDbWrite<T>(work: () => Promise<T>): Promise<T> {
  pendingCatalogDbWrites += 1;
  const run = catalogDbWriteTail.then(work, work);
  catalogDbWriteTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run.finally(() => {
    pendingCatalogDbWrites = Math.max(0, pendingCatalogDbWrites - 1);
  });
}

export function catalogDbWriterPendingCount() {
  return pendingCatalogDbWrites;
}
