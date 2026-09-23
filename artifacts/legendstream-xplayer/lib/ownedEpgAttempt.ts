export type OwnedEpgAttempt = {
  id: number;
  providerId: string;
  generation: number;
  controller: AbortController;
  diagnosticAttemptId?: number;
};

export class OwnedEpgAttempts {
  private sequence = 0;
  private readonly current = new Map<string, OwnedEpgAttempt>();

  begin(providerId: string, generation: number): OwnedEpgAttempt {
    this.cancel(providerId);
    const attempt = { id: ++this.sequence, providerId, generation, controller: new AbortController() };
    this.current.set(providerId, attempt);
    return attempt;
  }

  isCurrent(attempt: OwnedEpgAttempt): boolean {
    return this.current.get(attempt.providerId) === attempt && !attempt.controller.signal.aborted;
  }

  active(providerId: string): OwnedEpgAttempt | undefined {
    return this.current.get(providerId);
  }

  cancel(providerId: string): void {
    const previous = this.current.get(providerId);
    if (!previous) return;
    this.current.delete(providerId);
    previous.controller.abort();
  }

  cancelAll(): void {
    for (const providerId of this.current.keys()) this.cancel(providerId);
  }

  complete(attempt: OwnedEpgAttempt): void {
    if (this.current.get(attempt.providerId) === attempt) this.current.delete(attempt.providerId);
  }
}
