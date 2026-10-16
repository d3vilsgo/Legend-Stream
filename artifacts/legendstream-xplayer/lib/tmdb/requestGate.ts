/** Bounded and deduplicated work only. No global catalog scan, timer, HTTP client or token. */
export class TmdbRateLimit extends Error {
  constructor(readonly retryAfterMs?: number) {
    super("TMDB_RATE_LIMITED");
  }
}
export class TmdbGateError extends Error {
  constructor(readonly reason: "busy" | "backoff") {
    super(reason === "busy" ? "TMDB_QUEUE_FULL" : "TMDB_BACKOFF");
  }
}
export class TmdbRequestGate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private blockedUntil = 0;
  private rateLimitCount = 0;
  constructor(
    private readonly now: () => number = Date.now,
    private readonly concurrency = 2,
    private readonly queueLimit = 24,
  ) {
    if (
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      !Number.isInteger(queueLimit) ||
      queueLimit < 0
    )
      throw new Error("INVALID_REQUEST_GATE");
  }
  get retryAt(): number {
    return this.blockedUntil;
  }
  schedule<T>(key: string, job: () => Promise<T>): Promise<T> {
    const previous = this.inFlight.get(key);
    if (previous) return previous as Promise<T>;
    if (this.now() < this.blockedUntil)
      return Promise.reject(new TmdbGateError("backoff"));
    if (
      this.active >= this.concurrency &&
      this.waiting.length >= this.queueLimit
    )
      return Promise.reject(new TmdbGateError("busy"));
    const task = new Promise<T>((resolve, reject) => {
      const run = () => {
        if (this.now() < this.blockedUntil) {
          reject(new TmdbGateError("backoff"));
          this.advance();
          return;
        }
        this.active++;
        Promise.resolve()
          .then(job)
          .then(resolve, (error) => {
            if (error instanceof TmdbRateLimit) {
              const delay =
                Number.isFinite(error.retryAfterMs) && error.retryAfterMs! >= 0
                  ? error.retryAfterMs!
                  : Math.min(
                      60000,
                      1000 * 2 ** Math.min(this.rateLimitCount, 6),
                    );
              this.rateLimitCount++;
              this.blockedUntil = Math.max(
                this.blockedUntil,
                this.now() + delay,
              );
            }
            reject(error);
          })
          .finally(() => {
            this.active--;
            this.advance();
          });
      };
      if (this.active < this.concurrency) run();
      else this.waiting.push(run);
    });
    this.inFlight.set(key, task);
    void task
      .finally(() => {
        if (this.inFlight.get(key) === task) this.inFlight.delete(key);
      })
      .catch(() => undefined);
    return task;
  }
  private advance(): void {
    if (this.active < this.concurrency) this.waiting.shift()?.();
  }
}
