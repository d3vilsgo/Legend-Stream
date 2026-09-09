import { safeLog, sanitizeErrorForLog } from "./safeLog";
import { bootstrapStalkerProfile } from "./stalkerProfileBootstrap";
import {
  createStalkerPortalSession,
  StalkerPortalError,
  type StalkerPortalDiagnosticsContext,
  type StalkerPortalSession,
} from "./stalkerPortal";

export type StalkerMainInfoClassification =
  | "GET_MAIN_INFO_OPTIONAL_SUPPORTED"
  | "GET_MAIN_INFO_UNSUPPORTED";

export type StalkerIsolatedLoginStatus =
  | "IDLE"
  | "CONNECTING"
  | "CONNECTED"
  | "ERROR";

export type StalkerIsolatedAccountInfo = {
  profileSupported: boolean;
  profileName?: string;
  accountStatus?: string;
  expiry?: string;
  mainInfoClassification: StalkerMainInfoClassification;
};

export type StalkerIsolatedLoginResult = {
  state: "CONNECTED";
  accountInfo: StalkerIsolatedAccountInfo;
  networkActions: string[];
};

type SessionLike = Pick<StalkerPortalSession, "handshake" | "request">;

type StalkerIsolatedLoginDependencies = {
  createSession?: (input: {
    portalUrl: string;
    mac: string;
    diagnostics: StalkerPortalDiagnosticsContext;
  }) => SessionLike;
};

const UNSUPPORTED_TEXT = /\b(?:unknown|unsupported|not\s+implemented|not\s+available)\b/i;

function stringField(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function objectPayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

function payloadLooksUnsupported(payload: unknown) {
  if (typeof payload === "string") return UNSUPPORTED_TEXT.test(payload);
  const row = objectPayload(payload);
  if (!row) return payload == null;
  return [row.error, row.message, row.reason, row.status].some((value) =>
    typeof value === "string" && UNSUPPORTED_TEXT.test(value),
  );
}

function metadataFromPayload(profilePayload: unknown, mainInfoPayload?: unknown): Omit<
  StalkerIsolatedAccountInfo,
  "profileSupported" | "mainInfoClassification"
> {
  const mainInfo = objectPayload(mainInfoPayload);
  const profile = objectPayload(profilePayload);
  const source = mainInfo ?? profile ?? {};
  return {
    profileName: stringField(source, ["name", "fname", "login", "account", "tariff_plan"]),
    accountStatus: stringField(source, ["status", "account_status", "state"]),
    expiry: stringField(source, ["end_date", "expire_billing_date", "expires", "expiry", "exp_date"]),
  };
}

async function readOptionalMainInfo(
  session: SessionLike,
  signal: AbortSignal | undefined,
  diagnostics: StalkerPortalDiagnosticsContext,
) {
  try {
    const payload = await session.request(
      { type: "account_info", action: "get_main_info" },
      signal,
      undefined,
      diagnostics,
    );
    if (payloadLooksUnsupported(payload)) {
      return {
        classification: "GET_MAIN_INFO_UNSUPPORTED" as const,
        payload: undefined,
      };
    }
    return {
      classification: "GET_MAIN_INFO_OPTIONAL_SUPPORTED" as const,
      payload,
    };
  } catch (caught) {
    safeLog.info("LS_STALKER_ISOLATED_MAIN_INFO_UNAVAILABLE", {
      error: sanitizeErrorForLog(caught),
    });
    return {
      classification: "GET_MAIN_INFO_UNSUPPORTED" as const,
      payload: undefined,
    };
  }
}

export async function runIsolatedStalkerLogin(
  input: { portalUrl: string; mac: string; signal?: AbortSignal },
  dependencies: StalkerIsolatedLoginDependencies = {},
): Promise<StalkerIsolatedLoginResult> {
  const portalUrl = input.portalUrl.trim();
  const mac = input.mac.trim();
  if (!portalUrl || !mac) {
    throw new StalkerPortalError("MISSING_MAC", "Stalker portal URL and MAC address are required.");
  }

  const networkActions: string[] = [];
  const diagnostics = { providerId: "isolated-stalker-login" };
  const session = dependencies.createSession?.({ portalUrl, mac, diagnostics }) ?? createStalkerPortalSession({
    portalUrl,
    mac,
    diagnostics,
  });

  networkActions.push("handshake");
  await session.handshake(input.signal);

  networkActions.push("get_profile");
  const profile = await bootstrapStalkerProfile(session as StalkerPortalSession, {
    signal: input.signal,
    diagnostics,
  });
  if (!profile.supported) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker profile request is not supported.");
  }

  networkActions.push("get_main_info");
  const mainInfo = await readOptionalMainInfo(session, input.signal, diagnostics);
  const accountInfo = metadataFromPayload(profile.payload, mainInfo.payload);

  return {
    state: "CONNECTED",
    accountInfo: {
      profileSupported: true,
      mainInfoClassification: mainInfo.classification,
      ...accountInfo,
    },
    networkActions,
  };
}
