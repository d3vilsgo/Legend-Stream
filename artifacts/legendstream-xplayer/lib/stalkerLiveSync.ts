import { yieldToUi } from "./cooperative";
import { createStalkerPortalSession, StalkerPortalError } from "./stalkerPortal";
import { runStagedStalkerLiveSync } from "./stalkerLiveCatalog";
import {
  cleanupStalkerLiveStaging,
  commitStalkerLiveStaging,
  stageStalkerLivePage,
  stalkerLiveStagingProviderId,
} from "./stalkerLiveCache";

export type StalkerLiveSyncProvider = { id: string; url: string; mac: string };
export type StalkerLiveSyncProgress = {
  phase: "categories" | "pages" | "committing";
  page?: number;
  persisted?: number;
};

type Options = {
  provider: StalkerLiveSyncProvider;
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  onProgress?: (progress: StalkerLiveSyncProgress) => void | Promise<void>;
};

let stalkerLiveSyncRunSequence = 0;

function nextStalkerLiveSyncRunToken(syncStartedAt: number) {
  stalkerLiveSyncRunSequence += 1;
  if (stalkerLiveSyncRunSequence > Number.MAX_SAFE_INTEGER - 1) stalkerLiveSyncRunSequence = 1;
  return `${syncStartedAt.toString(36)}-${stalkerLiveSyncRunSequence.toString(36)}`;
}

function assertCurrent(signal?: AbortSignal, isCurrent?: () => boolean) {
  if (signal?.aborted || (isCurrent && !isCurrent())) {
    throw new StalkerPortalError("CANCELLED", "Stalker portal request was cancelled.");
  }
}

export async function syncStalkerLiveCatalog(options: Options) {
  const providerId = options.provider.id;
  const syncStartedAt = Date.now();
  const stagingId = stalkerLiveStagingProviderId(
    providerId,
    nextStalkerLiveSyncRunToken(syncStartedAt),
  );
  const session = createStalkerPortalSession({
    portalUrl: options.provider.url,
    mac: options.provider.mac,
    afterResponse: yieldToUi,
  });

  const completed = await runStagedStalkerLiveSync({
    session,
    providerId,
    signal: options.signal,
    isCurrent: options.isCurrent,
    cleanupStaging: () => cleanupStalkerLiveStaging(providerId, stagingId),
    persistPage: async (items, page) => {
      assertCurrent(options.signal, options.isCurrent);
      await stageStalkerLivePage(providerId, stagingId, items, syncStartedAt, options.isCurrent);
      assertCurrent(options.signal, options.isCurrent);
      await options.onProgress?.({ phase: "pages", page: page.page, persisted: items.length });
    },
    commit: async (categories, result) => {
      assertCurrent(options.signal, options.isCurrent);
      await options.onProgress?.({ phase: "committing", persisted: result.persisted });
      await commitStalkerLiveStaging(
        providerId,
        stagingId,
        categories,
        result.persisted,
        options.isCurrent,
      );
      assertCurrent(options.signal, options.isCurrent);
    },
    yieldFn: yieldToUi,
    onCategories: async () => options.onProgress?.({ phase: "categories" }),
  });

  return {
    ...completed.result,
    categories: completed.categories.length,
    elapsedMs: Date.now() - syncStartedAt,
  };
}
