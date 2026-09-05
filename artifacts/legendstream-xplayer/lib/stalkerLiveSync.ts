import { yieldToUi } from "./cooperative";
import { createStalkerPortalSession, StalkerPortalError } from "./stalkerPortal";
import {
  fetchStalkerLiveCategories,
  traverseStalkerLivePages,
  type StalkerLiveCategory,
} from "./stalkerLiveCatalog";
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

function cancelled(signal?: AbortSignal, isCurrent?: () => boolean) {
  return Boolean(signal?.aborted || (isCurrent && !isCurrent()));
}

function assertCurrent(signal?: AbortSignal, isCurrent?: () => boolean) {
  if (cancelled(signal, isCurrent)) {
    throw new StalkerPortalError("CANCELLED", "Stalker portal request was cancelled.");
  }
}

export async function syncStalkerLiveCatalog(options: StalkerLiveSyncOptions) {
  const providerId = options.provider.id;
  const syncStartedAt = Date.now();
  let categories: StalkerLiveCategory[] = [];
  let primaryError: unknown = null;

  await cleanupStalkerLiveStaging(providerId);
  try {
    assertCurrent(options.signal, options.isCurrent);
    const session = createStalkerPortalSession({
      portalUrl: options.provider.url,
      mac: options.provider.mac,
    });

    categories = await fetchStalkerLiveCategories(session, options.signal);
    assertCurrent(options.signal, options.isCurrent);
    await options.onProgress?.({ phase: "categories" });

    const result = await traverseStalkerLivePages({
      session,
      providerId,
      categories,
      signal: options.signal,
      isCurrent: options.isCurrent,
      persistPage: async (items, page) => {
        assertCurrent(options.signal, options.isCurrent);
        await stageStalkerLivePage(providerId, items, syncStartedAt);
        assertCurrent(options.signal, options.isCurrent);
        await options.onProgress?.({
          phase: "pages",
          page: page.page,
          persisted: items.length,
        });
      },
      yieldFn: yieldToUi,
    });

    assertCurrent(options.signal, options.isCurrent);
    if (result.uniqueItems === 0) {
      throw new StalkerPortalError(
        "INVALID_RESPONSE",
        "The Stalker Portal returned no live channels.",
      );
    }
    await options.onProgress?.({ phase: "committing", persisted: result.persisted });
    assertCurrent(options.signal, options.isCurrent);
    await commitStalkerLiveStaging(providerId, categories);
    return {
      ...result,
      categories: categories.length,
      elapsedMs: Date.now() - syncStartedAt,
    };
  } catch (caught) {
    primaryError = caught;
    throw caught;
  } finally {
    try {
      await cleanupStalkerLiveStaging(providerId);
    } catch (cleanupError) {
      if (primaryError === null) throw cleanupError;
    }
  }
}
