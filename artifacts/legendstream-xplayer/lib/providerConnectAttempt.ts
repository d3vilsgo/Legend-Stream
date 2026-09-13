export type ProviderConnectCancelReason = "USER" | "TIMEOUT" | "SUPERSEDED";

export type ProviderConnectAttempt = {
  id: number;
  controller: AbortController;
  signal: AbortSignal;
  startedAt: number;
  cancelReason?: ProviderConnectCancelReason;
};

export type ProviderConnectBeginResult = {
  attempt: ProviderConnectAttempt;
  superseded: ProviderConnectAttempt | null;
};

export class ProviderConnectAttemptGate {
  private sequence = 0;
  private active: ProviderConnectAttempt | null = null;

  begin(now = Date.now()): ProviderConnectBeginResult {
    const superseded = this.active;
    if (superseded && !superseded.signal.aborted) {
      superseded.cancelReason = "SUPERSEDED";
      superseded.controller.abort();
    }
    this.active = null;

    const controller = new AbortController();
    const attempt: ProviderConnectAttempt = {
      id: ++this.sequence,
      controller,
      signal: controller.signal,
      startedAt: now,
    };
    this.active = attempt;
    return { attempt, superseded };
  }

  current() {
    return this.active;
  }

  isCurrent(attempt: ProviderConnectAttempt) {
    return this.active === attempt && !attempt.signal.aborted;
  }

  cancel(attempt: ProviderConnectAttempt, reason: ProviderConnectCancelReason) {
    if (this.active !== attempt) return false;
    attempt.cancelReason = reason;
    this.active = null;
    if (!attempt.signal.aborted) attempt.controller.abort();
    return true;
  }

  cancelCurrent(reason: ProviderConnectCancelReason) {
    const attempt = this.active;
    if (!attempt) return null;
    this.cancel(attempt, reason);
    return attempt;
  }

  finish(attempt: ProviderConnectAttempt) {
    if (this.active !== attempt) return false;
    this.active = null;
    return true;
  }
}

type ProviderConnectDeadlineScheduler = {
  setTimeout: (callback: () => void, timeoutMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const defaultDeadlineScheduler: ProviderConnectDeadlineScheduler = {
  setTimeout: (callback, timeoutMs) => setTimeout(callback, timeoutMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function withProviderConnectDeadline<T>(
  promise: Promise<T>,
  options: {
    timeoutMs: number;
    onTimeout: () => Error;
    scheduler?: ProviderConnectDeadlineScheduler;
  },
): Promise<T> {
  const scheduler = options.scheduler ?? defaultDeadlineScheduler;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = scheduler.setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        reject(options.onTimeout());
      } catch (caught) {
        reject(caught);
      }
    }, options.timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        scheduler.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        scheduler.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
