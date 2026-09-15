import type { CatalogSyncMode } from "./catalogAvailability";
import { StalkerPortalError, type StalkerPortalErrorCode } from "./stalkerPortal";
import type {
  StalkerLiveSyncOwner,
  StalkerLiveSyncProgress,
  StalkerLiveSyncProvider,
} from "./stalkerLiveSync";

export type StalkerCatalogLifecyclePhase =
  | "idle"
  | "credentials-required"
  | "cache-ready"
  | "preparing"
  | "syncing"
  | "ready"
  | "error"
  | "cancelled";

export type StalkerCatalogLifecycleErrorCode =
  | StalkerPortalErrorCode
  | "CREDENTIALS_REQUIRED"
  | "UNKNOWN";

export type StalkerCatalogLifecycleState = {
  providerId: string;
  phase: StalkerCatalogLifecyclePhase;
  completed: number;
  total: number;
  message?: string;
  updatedAt: number;
  errorCode?: StalkerCatalogLifecycleErrorCode;
  retryAvailable?: boolean;
};

export type StalkerCatalogLifecycleDecision =
  | "CREDENTIALS_REQUIRED"
  | "USE_CACHE"
  | "INITIAL_SYNC"
  | "BACKGROUND_REFRESH"
  | "MANUAL_REFRESH";

export type StalkerCatalogLifecycleProvider = {
  id: string;
  type: string;
  needsCredentials: boolean;
  url: string;
  playlistUrl: string;
  mac?: string;
};

export type StalkerCatalogCredentialStatus = {
  ready: boolean;
  needsCredentials: boolean;
  hasPortalUrl: boolean;
  hasMac: boolean;
  portalUrl: string;
  mac: string;
};

export type StalkerLifecycleLog = (
  marker: string,
  payload: Record<string, string | number | boolean | undefined>,
) => void;

export const STALKER_CREDENTIALS_REQUIRED_MESSAGE =
  "Stalker bağlantı bilgileri eksik. Portal URL ve MAC adresini yeniden doğrulayın.";

export function isStalkerCatalogLifecycleProvider(type: string | undefined) {
  return type === "stalker";
}

export function evaluateStalkerCatalogCredentials(
  provider: StalkerCatalogLifecycleProvider,
): StalkerCatalogCredentialStatus {
  const portalUrl = (provider.url || provider.playlistUrl).trim();
  const mac = provider.mac?.trim() || "";
  const hasPortalUrl = portalUrl.length > 0;
  const hasMac = mac.length > 0;
  const needsCredentials = provider.needsCredentials || !hasPortalUrl || !hasMac;
  return {
    ready: !needsCredentials,
    needsCredentials,
    hasPortalUrl,
    hasMac,
    portalUrl,
    mac,
  };
}

export function makeStalkerCatalogLifecycleState(
  providerId: string,
  phase: StalkerCatalogLifecyclePhase,
  options: {
    message?: string;
    errorCode?: StalkerCatalogLifecycleErrorCode;
    retryAvailable?: boolean;
    completed?: number;
    total?: number;
  } = {},
): StalkerCatalogLifecycleState {
  return {
    providerId,
    phase,
    completed: options.completed ?? 0,
    total: options.total ?? 1,
    message: options.message,
    updatedAt: Date.now(),
    errorCode: options.errorCode,
    retryAvailable: options.retryAvailable,
  };
}

export function safeStalkerCatalogLifecycleError(caught: unknown): {
  errorCode: StalkerCatalogLifecycleErrorCode;
  message: string;
} {
  const code = caught instanceof StalkerPortalError ? caught.code : "UNKNOWN";
  switch (code) {
    case "TIMEOUT":
      return { errorCode: code, message: "Stalker portalı zaman aşımına uğradı." };
    case "AUTH_FAILED":
    case "MISSING_TOKEN":
      return { errorCode: code, message: "Stalker oturumu doğrulanamadı." };
    case "NETWORK_ERROR":
    case "HTTP_ERROR":
    case "PORTAL_RATE_LIMITED_OR_ANTI_DDOS":
      return { errorCode: code, message: "Stalker portalına ulaşılamadı." };
    case "INVALID_RESPONSE":
      return { errorCode: code, message: "Stalker kanal listesi alınamadı." };
    case "INVALID_URL":
    case "MISSING_MAC":
      return { errorCode: code, message: STALKER_CREDENTIALS_REQUIRED_MESSAGE };
    case "CANCELLED":
      return { errorCode: code, message: "Canlı TV kataloğu hazırlama işlemi iptal edildi." };
    default:
      return { errorCode: "UNKNOWN", message: "Canlı TV kataloğu hazırlanamadı." };
  }
}

function progressMessage(progress: StalkerLiveSyncProgress) {
  if (progress.phase === "categories") return "Stalker kanal kategorileri hazırlanıyor…";
  if (progress.phase === "committing") return "Canlı TV kataloğu yayınlanıyor…";
  return "Canlı TV kanalları hazırlanıyor…";
}

function ownerForMode(mode: CatalogSyncMode): StalkerLiveSyncOwner {
  return mode === "manual" ? "LIVE_MANUAL_REFRESH" : "LIVE_MOUNT";
}

export async function executeStalkerCatalogLifecycleSync(options: {
  provider: StalkerCatalogLifecycleProvider;
  mode: CatalogSyncMode;
  signal: AbortSignal;
  isCurrent: () => boolean;
  sync: (input: {
    provider: StalkerLiveSyncProvider;
    signal?: AbortSignal;
    isCurrent?: () => boolean;
    onProgress?: (progress: StalkerLiveSyncProgress) => void | Promise<void>;
    owner?: StalkerLiveSyncOwner;
  }) => Promise<{ persisted: number }>;
  refreshSnapshot: () => Promise<void>;
  onState: (state: StalkerCatalogLifecycleState) => void;
  log?: StalkerLifecycleLog;
}) {
  const credentials = evaluateStalkerCatalogCredentials(options.provider);
  if (!credentials.ready) {
    if (options.isCurrent()) {
      options.onState(makeStalkerCatalogLifecycleState(
        options.provider.id,
        "credentials-required",
        {
          message: STALKER_CREDENTIALS_REQUIRED_MESSAGE,
          errorCode: "CREDENTIALS_REQUIRED",
          retryAvailable: false,
        },
      ));
    }
    return {
      result: "CREDENTIALS_REQUIRED" as const,
      persisted: 0,
      errorCode: "CREDENTIALS_REQUIRED" as const,
    };
  }

  if (options.isCurrent()) {
    options.onState(makeStalkerCatalogLifecycleState(
      options.provider.id,
      options.mode === "initial" ? "preparing" : "syncing",
      {
        message: options.mode === "initial"
          ? "Canlı TV hazırlanıyor…"
          : "Canlı TV kataloğu yenileniyor…",
      },
    ));
  }

  options.log?.("LS_STALKER_LIFECYCLE_SYNC_START", {
    providerId: options.provider.id,
    mode: options.mode,
  });

  try {
    const result = await options.sync({
      provider: {
        id: options.provider.id,
        url: credentials.portalUrl,
        mac: credentials.mac,
      },
      signal: options.signal,
      isCurrent: options.isCurrent,
      owner: ownerForMode(options.mode),
      onProgress: (progress) => {
        if (!options.isCurrent()) return;
        options.onState(makeStalkerCatalogLifecycleState(
          options.provider.id,
          "syncing",
          {
            message: progressMessage(progress),
            completed: 0,
            total: 1,
          },
        ));
      },
    });

    if (options.signal.aborted || !options.isCurrent()) {
      options.log?.("LS_STALKER_LIFECYCLE_SYNC_END", {
        providerId: options.provider.id,
        result: "CANCELLED",
        errorCode: "CANCELLED",
        persisted: 0,
      });
      return { result: "CANCELLED" as const, persisted: 0, errorCode: "CANCELLED" as const };
    }

    await options.refreshSnapshot();
    if (options.signal.aborted || !options.isCurrent()) {
      options.log?.("LS_STALKER_LIFECYCLE_SYNC_END", {
        providerId: options.provider.id,
        result: "CANCELLED",
        errorCode: "CANCELLED",
        persisted: 0,
      });
      return { result: "CANCELLED" as const, persisted: 0, errorCode: "CANCELLED" as const };
    }

    options.onState(makeStalkerCatalogLifecycleState(
      options.provider.id,
      "ready",
      {
        message: "Canlı TV kataloğu hazır.",
        completed: 1,
        total: 1,
      },
    ));
    options.log?.("LS_STALKER_LIFECYCLE_SYNC_END", {
      providerId: options.provider.id,
      result: "SUCCESS",
      errorCode: undefined,
      persisted: result.persisted,
    });
    return { result: "SUCCESS" as const, persisted: result.persisted };
  } catch (caught) {
    const cancelled =
      options.signal.aborted ||
      !options.isCurrent() ||
      (caught instanceof StalkerPortalError && caught.code === "CANCELLED");
    if (cancelled) {
      if (options.isCurrent()) {
        options.onState(makeStalkerCatalogLifecycleState(
          options.provider.id,
          "cancelled",
          {
            message: "Canlı TV kataloğu hazırlama işlemi iptal edildi.",
            errorCode: "CANCELLED",
            retryAvailable: true,
          },
        ));
      }
      options.log?.("LS_STALKER_LIFECYCLE_SYNC_END", {
        providerId: options.provider.id,
        result: "CANCELLED",
        errorCode: "CANCELLED",
        persisted: 0,
      });
      return { result: "CANCELLED" as const, persisted: 0, errorCode: "CANCELLED" as const };
    }

    const safe = safeStalkerCatalogLifecycleError(caught);
    if (options.isCurrent()) {
      options.onState(makeStalkerCatalogLifecycleState(
        options.provider.id,
        "error",
        {
          message: safe.message,
          errorCode: safe.errorCode,
          retryAvailable: true,
        },
      ));
    }
    options.log?.("LS_STALKER_LIFECYCLE_SYNC_END", {
      providerId: options.provider.id,
      result: "ERROR",
      errorCode: safe.errorCode,
      persisted: 0,
    });
    return { result: "ERROR" as const, persisted: 0, errorCode: safe.errorCode };
  }
}

export async function runStalkerActivationLifecycle(options: {
  provider: StalkerCatalogLifecycleProvider;
  isCurrent: () => boolean;
  readLiveCount: () => Promise<number>;
  refreshSnapshot: () => Promise<void>;
  runInitialSync: () => Promise<void>;
  onState: (state: StalkerCatalogLifecycleState) => void;
  log?: StalkerLifecycleLog;
}) {
  const credentials = evaluateStalkerCatalogCredentials(options.provider);
  options.log?.("LS_STALKER_LIFECYCLE_HYDRATED", {
    providerId: options.provider.id,
    needsCredentials: credentials.needsCredentials,
    hasPortalUrl: credentials.hasPortalUrl,
    hasMac: credentials.hasMac,
  });

  if (!credentials.ready) {
    if (options.isCurrent()) {
      options.onState(makeStalkerCatalogLifecycleState(
        options.provider.id,
        "credentials-required",
        {
          message: STALKER_CREDENTIALS_REQUIRED_MESSAGE,
          errorCode: "CREDENTIALS_REQUIRED",
          retryAvailable: false,
        },
      ));
    }
    options.log?.("LS_STALKER_LIFECYCLE_DECISION", {
      providerId: options.provider.id,
      decision: "CREDENTIALS_REQUIRED",
    });
    return { decision: "CREDENTIALS_REQUIRED" as const, liveCount: 0 };
  }

  const liveCount = await options.readLiveCount();
  if (!options.isCurrent()) return { decision: "CANCELLED" as const, liveCount };
  const usable = liveCount > 0;
  options.log?.("LS_STALKER_LIFECYCLE_CACHE", {
    providerId: options.provider.id,
    liveCount,
    usable,
  });

  await options.refreshSnapshot();
  if (!options.isCurrent()) return { decision: "CANCELLED" as const, liveCount };

  if (usable) {
    options.onState(makeStalkerCatalogLifecycleState(
      options.provider.id,
      "cache-ready",
      {
        message: "Canlı TV önbellekten hazır.",
        completed: liveCount,
        total: liveCount,
      },
    ));
    options.log?.("LS_STALKER_LIFECYCLE_DECISION", {
      providerId: options.provider.id,
      decision: "USE_CACHE",
    });
    return { decision: "USE_CACHE" as const, liveCount };
  }

  options.log?.("LS_STALKER_LIFECYCLE_DECISION", {
    providerId: options.provider.id,
    decision: "INITIAL_SYNC",
  });
  await options.runInitialSync();
  return { decision: "INITIAL_SYNC" as const, liveCount };
}
