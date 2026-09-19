export const EPG_PAGED_SEED_LIMIT = 48;
export const EPG_BACKGROUND_BUDGET_MS = 5_000;

export type EpgAttemptClassification = "success" | "timeout" | "failure";

export type EpgBackgroundAttemptResult<T> = {
  classification: EpgAttemptClassification;
  value?: T;
  elapsedMs: number;
};

const monotonicNow = () => globalThis.performance?.now?.() ?? Date.now();

export async function runEpgBackgroundAttempt<T>(
  task: (signal: AbortSignal) => Promise<T>,
  budgetMs = EPG_BACKGROUND_BUDGET_MS,
): Promise<EpgBackgroundAttemptResult<T>> {
  const controller = new AbortController();
  const startedAt = monotonicNow();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<EpgBackgroundAttemptResult<T>>((resolve) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      resolve({
        classification: "timeout",
        elapsedMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
      });
    }, Math.max(1, budgetMs));
  });
  const work = Promise.resolve()
    .then(() => task(controller.signal))
    .then((value): EpgBackgroundAttemptResult<T> => ({
      classification: "success",
      value,
      elapsedMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
    }))
    .catch((): EpgBackgroundAttemptResult<T> => ({
      classification: controller.signal.aborted ? "timeout" : "failure",
      elapsedMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
    }));

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export class EpgAttemptGeneration {
  private readonly generations = new Map<string, number>();

  begin(providerId: string) {
    const generation = (this.generations.get(providerId) ?? 0) + 1;
    this.generations.set(providerId, generation);
    return generation;
  }

  invalidate(providerId: string) {
    this.begin(providerId);
  }

  isCurrent(providerId: string, generation: number) {
    return this.generations.get(providerId) === generation;
  }
}

export type EpgProgramLike = {
  channelId: string;
  start: number;
  end: number;
};

export type EpgSelection<T extends EpgProgramLike = EpgProgramLike> = {
  now?: T;
  next?: T;
};

export type EpgChannelLike = {
  id: string;
  providerId: string;
  name?: string;
  streamUrl?: string;
  logoUrl?: string;
  category?: string;
  tvgId?: string;
  streamType?: string;
  contentType?: string;
};

const registeredChannels = new Map<string, EpgChannelLike[]>();

export function registerEpgChannels<T extends EpgChannelLike>(
  providerId: string,
  channels: readonly T[],
  limit = EPG_PAGED_SEED_LIMIT,
) {
  const boundedLimit = Math.max(1, Math.trunc(limit));
  const current = registeredChannels.get(providerId) ?? [];
  const seen = new Set<string>();
  const next: EpgChannelLike[] = [];
  for (const channel of [...channels, ...current]) {
    if (channel.providerId !== providerId || seen.has(channel.id)) continue;
    seen.add(channel.id);
    next.push(channel);
    if (next.length >= boundedLimit) break;
  }
  if (next.length) registeredChannels.set(providerId, next);
  return next as T[];
}

export function getRegisteredEpgChannels<T extends EpgChannelLike>(providerId: string): T[] {
  return [...(registeredChannels.get(providerId) ?? [])] as T[];
}

export function clearRegisteredEpgChannels(providerId: string) {
  registeredChannels.delete(providerId);
}

export function selectProgramsAt<T extends EpgProgramLike>(
  programs: readonly T[] | undefined,
  nowMs = Date.now(),
): EpgSelection<T> {
  if (!programs?.length) return {};
  const ordered = [...programs].sort((a, b) => a.start - b.start);
  const currentIndex = ordered.findIndex(
    (program) => program.start <= nowMs && nowMs < program.end,
  );
  if (currentIndex >= 0) {
    return { now: ordered[currentIndex], next: ordered[currentIndex + 1] };
  }
  return { next: ordered.find((program) => program.start > nowMs) };
}

export function selectChannelEpg<T extends EpgProgramLike>(
  epg: readonly T[],
  channel?: Pick<EpgChannelLike, "id">,
  nowMs = Date.now(),
): EpgSelection<T> {
  if (!channel) return {};
  return selectProgramsAt(
    epg.filter((program) => program.channelId === channel.id),
    nowMs,
  );
}

export function hasUsableChannelEpg<T extends EpgProgramLike>(
  programs: readonly T[],
  channelId: string,
  nowMs = Date.now(),
) {
  return programs.some(
    (program) => program.channelId === channelId && program.end > nowMs,
  );
}

export function mergeEpgPrograms<T extends EpgProgramLike>(
  previous: readonly T[],
  channelIds: ReadonlySet<string>,
  incoming: readonly T[],
): T[] {
  return [
    ...previous.filter((program) => !channelIds.has(program.channelId)),
    ...incoming,
  ];
}

export class EpgSingleFlight {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    let promise: Promise<T>;
    promise = Promise.resolve()
      .then(task)
      .finally(() => {
        if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  has(key: string) {
    return this.inFlight.has(key);
  }
}
