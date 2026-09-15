type InFlightSync<T> = { promise: Promise<T>; signal?: AbortSignal };

export class StalkerLiveSyncSingleFlight<T> {
  #inFlight = new Map<string, InFlightSync<T>>();

  run(
    providerId: string,
    signal: AbortSignal | undefined,
    task: () => Promise<T>,
    onJoin?: () => void,
  ): Promise<T> {
    const existing = this.#inFlight.get(providerId);
    if (existing && !existing.signal?.aborted) {
      onJoin?.();
      return existing.promise;
    }
    if (existing?.signal?.aborted) this.#inFlight.delete(providerId);

    const promise = task();
    const entry: InFlightSync<T> = { promise, signal };
    this.#inFlight.set(providerId, entry);
    void promise.finally(() => {
      if (this.#inFlight.get(providerId) === entry) this.#inFlight.delete(providerId);
    }).catch(() => undefined);
    return promise;
  }
}
