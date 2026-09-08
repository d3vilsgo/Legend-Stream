import { yieldToUi } from "./cooperative";
import { safeLog } from "./safeLog";
import { StalkerPortalError, type StalkerPortalDiagnosticsContext, type StalkerPortalSession } from "./stalkerPortal";
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
import { noteStalkerLivePublishSuccess } from "./stalkerLivePublishRevision";
import type { PersistedLiveCatalogItem } from "./catalogPersistence";

export type StalkerLiveSyncProvider = { id: string; url: string; mac: string };
export type StalkerLiveSyncOwner =
  | "CONNECT_PROVIDER"
  | "REFRESH_PROVIDER"
  | "LIVE_MOUNT"
  | "LIVE_MANUAL_REFRESH"
  | "OTHER_EXPLICIT_CALLER";
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
  owner?: StalkerLiveSyncOwner;
};

type SyncDependencies = {
  acquireSession: (provider: StalkerLiveSyncProvider, diagnostics?: StalkerPortalDiagnosticsContext) => StalkerPortalSession;
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
  notePublishSuccess?: (providerId: string, kind: "live") => void;
  yieldFn: () => void | Promise<void>;
};

const STALKER_LIVE_STAGE_CHUNK_SIZE = 250;
let stalkerLiveSyncRunSequence = 0;

const productionDependencies: SyncDependencies = {
  acquireSession: (provider, diagnostics) => getOrCreateStalkerPortalSession({
    providerId: provider.id,
    portalUrl: provider.url,
    mac: provider.mac,
    diagnostics,
  }),
  cleanupStaging: cleanupStalkerLiveStaging,
  stageItems: stageStalkerLivePage,
  commitStaging: commitStalkerLiveStaging,
  notePublishSuccess: noteStalkerLivePublishSuccess,
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
  const owner = options.owner ?? "OTHER_EXPLICIT_CALLER";
  const syncStartedAt = Date.now();
  const syncRunId = nextStalkerLiveSyncRunToken(syncStartedAt);
  const stagingId = stalkerLiveStagingProviderId(
    providerId,
    syncRunId,
  );
  safeLog.info("LS_STALKER_SYNC_RUN_START", {
    syncRunId,
    owner,
    providerId,
    generation: syncRunId,
    startedAtMs: syncStartedAt,
  });
  const diagnostics = { syncRunId, providerId };
  const session = dependencies.acquireSession(options.provider, diagnostics);
  session.setDiagnosticsContext(diagnostics);
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
      syncRunId,
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

    safeLog.info("LS_STALKER_STAGE_START", {
      rowCount: expectedCount,
      discoverySource: discovery.source,
      elapsedSinceSyncStartMs: Math.max(0, Date.now() - syncStartedAt),
      chunkSize: STALKER_LIVE_STAGE_CHUNK_SIZE,
    });

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
    dependencies.notePublishSuccess?.(providerId, "live");

    const result = {
      pagesFetched: discovery.pagesFetched,
      uniqueItems: expectedCount,
      persisted,
      totalItems: discovery.totalItems,
      maxPageItems: null,
      categories: categories.length,
      discoverySource: discovery.source,
      elapsedMs: Date.now() - syncStartedAt,
    };
    safeLog.info("LS_STALKER_SYNC_RUN_END", {
      syncRunId,
      owner,
      result: "SUCCESS",
      elapsedMs: Math.max(0, Date.now() - syncStartedAt),
    });
    return result;
  } catch (caught) {
    primaryError = caught;
    safeLog.info("LS_STALKER_SYNC_RUN_END", {
      syncRunId,
      owner,
      result: caught instanceof StalkerPortalError && caught.code === "CANCELLED" ? "CANCELLED" : "ERROR",
      elapsedMs: Math.max(0, Date.now() - syncStartedAt),
      errorCode: caught instanceof StalkerPortalError ? caught.code : "UNKNOWN",
    });
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
