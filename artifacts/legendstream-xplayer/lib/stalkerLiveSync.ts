import { yieldToUi } from "./cooperative";
import { createStalkerPortalSession } from "./stalkerPortal";
import { runStagedStalkerLiveSync } from "./stalkerLiveCatalog";
import {
  cleanupStalkerLiveStaging,
  commitStalkerLiveStaging,
  stageStalkerLivePage,
} from "./stalkerLiveCache";

export type StalkerLiveSyncProvider = {
  id: string;
  url: string;
  mac: string;
};

type StalkerLiveSyncOptions = {
  provider: StalkerLiveSyncProvider;
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  onProgress?: (progress: {
    phase: "categories" | "pages" | "committing";
    page?: number;
    persisted?: number;
  }) => void | Promise<void>;
};

export async function syncStalkerLiveCatalog(options: StalkerLiveSyncOptions) {
  const providerId = options.provider.id;
  const syncStartedAt = Date.now();
  const session = createStalkerPortalSession({
    portalUrl: options.provider.url,
    mac: options.provider.mac,
  });

  const completed = await runStagedStalkerLiveSync({
    session,
    providerId,
    signal: options.signal,
    isCurrent: options.isCurrent,
    cleanupStaging: () => cleanupStalkerLiveStaging(providerId),
    persistPage: async (items, page) => {
      await stageStalkerLivePage(providerId, items, syncStartedAt);
      await options.onProgress?.({
        phase: "pages",
        page: page.page,
        persisted: items.length,
      });
    },
    commit: async (categories, result) => {
      await options.onProgress?.({
        phase: "committing",
        persisted: result.persisted,
      });
      await commitStalkerLiveStaging(providerId, categories);
    },
    yieldFn: yieldToUi,
    onCategories: async () => {
      await options.onProgress?.({ phase: "categories" });
    },
  });

  return {
    ...completed.result,
    categories: completed.categories.length,
    elapsedMs: Date.now() - syncStartedAt,
  };
}
