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
import { StalkerLiveSyncSingleFlight } from "./stalkerLiveSyncSingleFlight";
import {
  beginStalkerDiagnosticTimer,
  logStalkerDiagnosticMarker,
  stalkerDiagnosticNowMs,
} from "./stalkerDiagnostics";
export { StalkerLiveSyncSingleFlight } from "./stalkerLiveSyncSingleFlight";

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
  const diagnosticSyncStartedAt = stalkerDiagnosticNowMs();
  const diagnosticSyncElapsed = () => Math.max(0, stalkerDiagnosticNowMs() - diagnosticSyncStartedAt);
  const syncRunId = nextStalkerLiveSyncRunToken(syncStartedAt);
  const stagingId = stalkerLiveStagingProviderId(providerId, syncRunId);
  safeLog.info("LS_STALKER_SYNC_RUN_START", {
    syncRunId,
    owner,
    providerId,
    generation: syncRunId,
    startedAtMs: syncStartedAt,
  });
  const diagnostics = { syncRunId, providerId };
  const session = dependencies.acquireSession(options.provider, diagnostics);
  let primaryError: unknown = null;
  let diagnosticResult: "SUCCESS" | "CANCELLED" | "ERROR" = "ERROR";
  let diagnosticErrorCode: string | undefined;

  await dependencies.cleanupStaging(providerId, stagingId);
  try {
    assertCurrent(options.signal, options.isCurrent);
    await bootstrapStalkerProfile(session, { signal: options.signal, diagnostics });
    assertCurrent(options.signal, options.isCurrent);

    const categories = await fetchStalkerLiveCategories(session, options.signal, diagnostics);
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
    const stageStartedAt = stalkerDiagnosticNowMs();
    logStalkerDiagnosticMarker("STALKER_STAGE_START", {
      syncRunId,
      providerId,
      elapsedMs: diagnosticSyncElapsed(),
      rowCount: expectedCount,
      expectedCount,
      chunkSize: STALKER_LIVE_STAGE_CHUNK_SIZE,
      discoverySource: discovery.source,
    });

    let persisted = 0;
    let chunkNumber = 0;
    let firstStageProbe: ReturnType<typeof beginStalkerDiagnosticTimer> | null = null;
    for (let offset = 0; offset < discovery.rows.length; offset += STALKER_LIVE_STAGE_CHUNK_SIZE) {
      assertCurrent(options.signal, options.isCurrent);
      const chunk = discovery.rows
        .slice(offset, offset + STALKER_LIVE_STAGE_CHUNK_SIZE)
        .map((channel) => projectStalkerLiveItem(providerId, channel));
      if (chunkNumber === 0) {
        firstStageProbe = beginStalkerDiagnosticTimer();
        logStalkerDiagnosticMarker("STALKER_FIRST_STAGE_WRITE_START", {
          syncRunId,
          providerId,
          elapsedMs: diagnosticSyncElapsed(),
          chunkIndex: 0,
          chunkRows: chunk.length,
          expectedCount,
        });
      }
      const written = await dependencies.stageItems(
        providerId,
        stagingId,
        chunk,
        syncStartedAt,
        options.isCurrent,
      );
      assertCurrent(options.signal, options.isCurrent);
      if (chunkNumber === 0 && firstStageProbe) {
        logStalkerDiagnosticMarker("STALKER_FIRST_STAGE_WRITE_END", {
          syncRunId,
          providerId,
          elapsedMs: diagnosticSyncElapsed(),
          durationMs: firstStageProbe.elapsed(),
          timerLatenessMs: firstStageProbe.lateness(),
          chunkIndex: 0,
          chunkRows: chunk.length,
          persisted: written,
          expectedCount,
        });
      }
      if (written !== chunk.length) {
        throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live staging write did not persist the complete discovery chunk.");
      }
      persisted += written;
      chunkNumber += 1;
      await options.onProgress?.({ phase: "pages", page: chunkNumber, persisted });
      await dependencies.yieldFn();
      if (chunkNumber === 1 && firstStageProbe) {
        logStalkerDiagnosticMarker("STALKER_FIRST_STAGE_YIELD", {
          syncRunId,
          providerId,
          elapsedMs: diagnosticSyncElapsed(),
          durationMs: firstStageProbe.elapsed(),
          timerLatenessMs: firstStageProbe.lateness(),
          chunkIndex: 0,
          chunkRows: chunk.length,
          persisted,
          expectedCount,
        });
        firstStageProbe.cancel();
        firstStageProbe = null;
      }
    }

    logStalkerDiagnosticMarker("STALKER_STAGE_END", {
      syncRunId,
      providerId,
      elapsedMs: diagnosticSyncElapsed(),
      durationMs: Math.max(0, stalkerDiagnosticNowMs() - stageStartedAt),
      persisted,
      expectedCount,
      chunkSize: STALKER_LIVE_STAGE_CHUNK_SIZE,
    });

    assertCurrent(options.signal, options.isCurrent);
    if (persisted !== expectedCount) {
      throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live staged cardinality does not match discovered cardinality.");
    }

    await options.onProgress?.({ phase: "committing", persisted });
    const commitProbe = beginStalkerDiagnosticTimer();
    logStalkerDiagnosticMarker("STALKER_COMMIT_START", {
      syncRunId,
      providerId,
      elapsedMs: diagnosticSyncElapsed(),
      persisted,
      expectedCount,
      categoryCount: categories.length,
    });
    await dependencies.commitStaging(
      providerId,
      stagingId,
      categories,
      expectedCount,
      options.isCurrent,
    );
    logStalkerDiagnosticMarker("STALKER_COMMIT_END", {
      syncRunId,
      providerId,
      elapsedMs: diagnosticSyncElapsed(),
      durationMs: commitProbe.elapsed(),
      timerLatenessMs: commitProbe.lateness(),
      persisted,
      expectedCount,
      categoryCount: categories.length,
    });
    commitProbe.cancel();
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
    diagnosticResult = "SUCCESS";
    safeLog.info("LS_STALKER_SYNC_RUN_END", {
      syncRunId,
      owner,
      result: "SUCCESS",
      elapsedMs: Math.max(0, Date.now() - syncStartedAt),
    });
    return result;
  } catch (caught) {
    primaryError = caught;
    diagnosticResult = caught instanceof StalkerPortalError && caught.code === "CANCELLED" ? "CANCELLED" : "ERROR";
    diagnosticErrorCode = caught instanceof StalkerPortalError ? caught.code : "UNKNOWN";
    safeLog.info("LS_STALKER_SYNC_RUN_END", {
      syncRunId,
      owner,
      result: diagnosticResult,
      elapsedMs: Math.max(0, Date.now() - syncStartedAt),
      errorCode: diagnosticErrorCode,
    });
    throw caught;
  } finally {
    try {
      await dependencies.cleanupStaging(providerId, stagingId);
    } catch (cleanupError) {
      if (primaryError === null) {
        diagnosticResult = "ERROR";
        diagnosticErrorCode = cleanupError instanceof StalkerPortalError ? cleanupError.code : "UNKNOWN";
        throw cleanupError;
      }
    } finally {
      logStalkerDiagnosticMarker("STALKER_SYNC_END", {
        syncRunId,
        providerId,
        elapsedMs: diagnosticSyncElapsed(),
        durationMs: diagnosticSyncElapsed(),
        result: diagnosticResult,
        errorCode: diagnosticErrorCode,
      });
    }
  }
}

type ProductionSyncResult = Awaited<ReturnType<typeof syncStalkerLiveCatalogWithDependencies>>;
const productionSyncSingleFlight = new StalkerLiveSyncSingleFlight<ProductionSyncResult>();

export function syncStalkerLiveCatalog(options: Options): Promise<ProductionSyncResult> {
  const providerId = options.provider.id;
  const owner = options.owner ?? "OTHER_EXPLICIT_CALLER";
  return productionSyncSingleFlight.run(
    providerId,
    options.signal,
    () => syncStalkerLiveCatalogWithDependencies(options, productionDependencies),
    () => {
      safeLog.info("LS_STALKER_SYNC_SINGLE_FLIGHT_JOIN", {
        providerId,
        owner,
        activeSyncCountForProvider: 1,
      });
    },
  );
}
