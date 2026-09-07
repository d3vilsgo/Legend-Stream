import { yieldToUi } from "./cooperative";
import { StalkerPortalError, type StalkerPortalSession } from "./stalkerPortal";
import { getOrCreateStalkerPortalSession } from "./stalkerPortalRuntime";
import { bootstrapStalkerProfile } from "./stalkerProfileBootstrap";
import {
  fetchStalkerLiveCategories,
  projectStalkerLiveItem,
  type StalkerLiveCategory,
} from "./stalkerLiveCatalog";
import { discoverStalkerLiveChannels } from "./stalkerLiveDiscovery";
import {
  cleanupStalkerLiveStaging,
  commitStalkerLiveStaging,
  stageStalkerLivePage,
  stalkerLiveStagingProviderId,
} from "./stalkerLiveCache";
import type { PersistedLiveCatalogItem } from "./catalogPersistence";

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

type SyncDependencies = {
  acquireSession: (provider: StalkerLiveSyncProvider) => StalkerPortalSession;
  cleanupStaging: (providerId: string, stagingId: string) => Promise<unknown>;
  stageItems: (
    providerId: string,
    stagingId: string,
    items: PersistedLiveCatalogItem[],
    seenAt: number,
    isCurrent?: () => boolean,
  ) => Promise<number>;
  commitStaging: (
    providerId: string,
    stagingId: string,
    categories: readonly StalkerLiveCategory[],
    itemCount: number,
    isCurrent?: () => boolean,
  ) => Promise<unknown>;
  yieldFn: () => void | Promise<void>;
};

const STALKER_LIVE_STAGE_CHUNK_SIZE = 250;
let stalkerLiveSyncRunSequence = 0;

const productionDependencies: SyncDependencies = {
  acquireSession: (provider) => getOrCreateStalkerPortalSession({
    providerId: provider.id,
    portalUrl: provider.url,
    mac: provider.mac,
  }),
  cleanupStaging: cleanupStalkerLiveStaging,
  stageItems: stageStalkerLivePage,
  commitStaging: commitStalkerLiveStaging,
  yieldFn: yieldToUi,
};

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

export async function syncStalkerLiveCatalogWithDependencies(
  options: Options,
  dependencies: SyncDependencies,
) {
  const providerId = options.provider.id;
  const syncStartedAt = Date.now();
  const stagingId = stalkerLiveStagingProviderId(
    providerId,
    nextStalkerLiveSyncRunToken(syncStartedAt),
  );
  const session = dependencies.acquireSession(options.provider);
  let primaryError: unknown = null;

  await dependencies.cleanupStaging(providerId, stagingId);
  try {
    assertCurrent(options.signal, options.isCurrent);
    await bootstrapStalkerProfile(session, { signal: options.signal });
    assertCurrent(options.signal, options.isCurrent);

    const categories = await fetchStalkerLiveCategories(session, options.signal);
    assertCurrent(options.signal, options.isCurrent);
    await options.onProgress?.({ phase: "categories" });

    const discovery = await discoverStalkerLiveChannels({
      session,
      providerId,
      categories,
      signal: options.signal,
      isCurrent: options.isCurrent,
      yieldFn: dependencies.yieldFn,
    });
    assertCurrent(options.signal, options.isCurrent);

    const expectedCount = discovery.rows.length;
    if (expectedCount === 0) {
      throw new StalkerPortalError("INVALID_RESPONSE", "The Stalker Portal returned no live channels.");
    }

    let persisted = 0;
    let chunkNumber = 0;
    for (let offset = 0; offset < discovery.rows.length; offset += STALKER_LIVE_STAGE_CHUNK_SIZE) {
      assertCurrent(options.signal, options.isCurrent);
      const chunk = discovery.rows
        .slice(offset, offset + STALKER_LIVE_STAGE_CHUNK_SIZE)
        .map((channel) => projectStalkerLiveItem(providerId, channel));
      const written = await dependencies.stageItems(
        providerId,
        stagingId,
        chunk,
        syncStartedAt,
        options.isCurrent,
      );
      assertCurrent(options.signal, options.isCurrent);
      if (written !== chunk.length) {
        throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live staging write did not persist the complete discovery chunk.");
      }
      persisted += written;
      chunkNumber += 1;
      await options.onProgress?.({ phase: "pages", page: chunkNumber, persisted });
      await dependencies.yieldFn();
    }

    assertCurrent(options.signal, options.isCurrent);
    if (persisted !== expectedCount) {
      throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live staged cardinality does not match discovered cardinality.");
    }

    await options.onProgress?.({ phase: "committing", persisted });
    await dependencies.commitStaging(
      providerId,
      stagingId,
      categories,
      expectedCount,
      options.isCurrent,
    );
    assertCurrent(options.signal, options.isCurrent);

    return {
      pagesFetched: discovery.pagesFetched,
      uniqueItems: expectedCount,
      persisted,
      totalItems: discovery.totalItems,
      maxPageItems: null,
      categories: categories.length,
      discoverySource: discovery.source,
      elapsedMs: Date.now() - syncStartedAt,
    };
  } catch (caught) {
    primaryError = caught;
    throw caught;
  } finally {
    try {
      await dependencies.cleanupStaging(providerId, stagingId);
    } catch (cleanupError) {
      if (primaryError === null) throw cleanupError;
    }
  }
}

export async function syncStalkerLiveCatalog(options: Options) {
  return syncStalkerLiveCatalogWithDependencies(options, productionDependencies);
}
