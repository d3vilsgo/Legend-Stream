import { StalkerPortalError } from "./stalkerPortal";

export type StalkerLiveCommitOwnershipCheck = () => boolean;
export type StalkerLiveCommitAssertCurrent = () => void;
export type StalkerLiveCommitQueue = <T>(work: () => Promise<T>) => Promise<T>;

export function assertStalkerLiveCommitCurrent(
  isCurrent?: StalkerLiveCommitOwnershipCheck,
) {
  if (isCurrent && !isCurrent()) {
    throw new StalkerPortalError(
      "CANCELLED",
      "Stalker catalog commit lost provider ownership.",
    );
  }
}

export function enqueueOwnedStalkerLiveCommit<T>(options: {
  enqueue: StalkerLiveCommitQueue;
  isCurrent?: StalkerLiveCommitOwnershipCheck;
  mutate: (assertCurrent: StalkerLiveCommitAssertCurrent) => Promise<T>;
}) {
  return options.enqueue(async () => {
    const assertCurrent = () => assertStalkerLiveCommitCurrent(options.isCurrent);
    assertCurrent();
    return options.mutate(assertCurrent);
  });
}
