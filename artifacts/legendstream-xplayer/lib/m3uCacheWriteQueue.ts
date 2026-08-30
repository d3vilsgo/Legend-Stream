let writeTail: Promise<void> = Promise.resolve();

export function enqueueM3UCacheWrite<T>(task: () => Promise<T>): Promise<T> {
  const result = writeTail.then(task);
  writeTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
