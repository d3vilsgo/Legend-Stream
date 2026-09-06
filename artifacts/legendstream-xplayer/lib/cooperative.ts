type InteractionTask = { cancel?: () => void };
type InteractionManagerLike = {
  runAfterInteractions: (callback: () => void) => InteractionTask;
};

function nativeInteractionManager(): InteractionManagerLike | null {
  try {
    // Keep this utility importable by the Node/tsx regression harness. React Native
    // is resolved lazily only when a yield actually runs; non-RN runtimes fall
    // through to the macrotask timer below.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const runtime = require("react-native") as { InteractionManager?: InteractionManagerLike };
    return runtime.InteractionManager ?? null;
  } catch {
    return null;
  }
}

/**
 * Yield back to React Native so input, layout and pending renders can run
 * between expensive batches. Falls back to a timer when the RN interaction
 * scheduler is unavailable (including the platform-neutral test harness).
 */
export async function yieldToUi(): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    try {
      const manager = nativeInteractionManager();
      if (!manager) {
        setTimeout(finish, 0);
        return;
      }
      const task = manager.runAfterInteractions(finish);
      // InteractionManager can wait indefinitely while gestures are active.
      // The timer guarantees forward progress and still yields a JS turn.
      setTimeout(() => {
        task.cancel?.();
        finish();
      }, 8);
    } catch {
      setTimeout(finish, 0);
    }
  });
}

export async function mapInBatches<T, R>(
  input: readonly T[],
  mapper: (value: T, index: number) => R,
  batchSize = 250,
): Promise<R[]> {
  const output: R[] = new Array(input.length);
  const size = Math.max(1, batchSize);

  for (let start = 0; start < input.length; start += size) {
    const end = Math.min(start + size, input.length);
    for (let index = start; index < end; index += 1) {
      output[index] = mapper(input[index], index);
    }
    if (end < input.length) await yieldToUi();
  }

  return output;
}

export async function forEachBatch<T>(
  input: readonly T[],
  visitor: (value: T, index: number) => void,
  batchSize = 250,
): Promise<void> {
  const size = Math.max(1, batchSize);
  for (let start = 0; start < input.length; start += size) {
    const end = Math.min(start + size, input.length);
    for (let index = start; index < end; index += 1) {
      visitor(input[index], index);
    }
    if (end < input.length) await yieldToUi();
  }
}
