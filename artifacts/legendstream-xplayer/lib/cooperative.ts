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

/** A timer turn for Xtream XMLTV CPU work, including pending touch/heartbeat timers. */
export function yieldXtreamXmltvEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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


export async function tokenizeM3ULinesCooperatively(
  content: string,
  batchLines = 500,
  yieldFn: () => Promise<void> = yieldToUi,
  onSlice?: (elapsedMs: number) => void,
): Promise<string[]> {
  const lines: string[] = [];
  const size = Math.max(1, Math.trunc(batchLines));
  let cursor = content.charCodeAt(0) === 0xfeff ? 1 : 0;
  let sinceYield = 0;
  let sliceStartedAt = globalThis.performance?.now?.() ?? Date.now();

  while (cursor <= content.length) {
    const newline = content.indexOf("\n", cursor);
    if (newline < 0) {
      lines.push(content.slice(cursor));
      onSlice?.((globalThis.performance?.now?.() ?? Date.now()) - sliceStartedAt);
      break;
    }
    const lineEnd = newline > cursor && content.charCodeAt(newline - 1) === 13
      ? newline - 1
      : newline;
    lines.push(content.slice(cursor, lineEnd));
    cursor = newline + 1;
    sinceYield += 1;
    if (sinceYield >= size) {
      onSlice?.((globalThis.performance?.now?.() ?? Date.now()) - sliceStartedAt);
      sinceYield = 0;
      await yieldFn();
      sliceStartedAt = globalThis.performance?.now?.() ?? Date.now();
    }
  }
  return lines;
}
