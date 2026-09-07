import { StalkerPortalError, type StalkerPortalSession } from "./stalkerPortal";

export type StalkerProfileRequestOptions = {
  hd?: string | number | boolean;
  stbType?: string;
};

export type StalkerProfileBootstrapOptions = {
  signal?: AbortSignal;
  profileOptions?: StalkerProfileRequestOptions;
};

export type StalkerProfileBootstrapResult =
  | { supported: true; payload: unknown }
  | { supported: false; reason: "unsupported" };

const EXPLICIT_UNSUPPORTED_PATTERNS = [
  /\bunknown\s+(?:action|method|command)\b/i,
  /\bunsupported\s+(?:action|method|command)\b/i,
  /\b(?:action|method|command)\s+(?:is\s+)?(?:unknown|unsupported)\b/i,
  /\bnot\s+implemented\b/i,
] as const;

function textLooksExplicitlyUnsupported(value: unknown) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return Boolean(text) && EXPLICIT_UNSUPPORTED_PATTERNS.some((pattern) => pattern.test(text));
}

function payloadLooksExplicitlyUnsupported(payload: unknown) {
  if (textLooksExplicitlyUnsupported(payload)) return true;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const row = payload as Record<string, unknown>;
  return [row.error, row.message, row.reason].some(textLooksExplicitlyUnsupported);
}

function payloadLooksLikeGenericError(payload: unknown) {
  if (typeof payload === "string") {
    return /^(?:error|failed|failure)(?:\b|\s|:|-)/i.test(payload.trim());
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const row = payload as Record<string, unknown>;
  if (row.error !== undefined && row.error !== null && row.error !== false && row.error !== "") return true;
  if (row.success === false) return true;
  return typeof row.status === "string" && /^(?:error|failed|failure)$/i.test(row.status.trim());
}

function validateSupportedProfilePayload(payload: unknown) {
  if (payload === null || payload === undefined) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker profile response is empty.");
  }
  if (typeof payload === "string" && !payload.trim()) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker profile response is empty.");
  }
  if (!Array.isArray(payload) && typeof payload === "object" && Object.keys(payload as object).length === 0) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker profile response is empty.");
  }
  if (payloadLooksLikeGenericError(payload)) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker profile response contains an error envelope.");
  }
  return payload;
}

function profileRequestParams(options?: StalkerProfileRequestOptions) {
  const stbType = options?.stbType?.trim();
  return {
    type: "stb",
    action: "get_profile",
    hd: options?.hd,
    stb_type: stbType || undefined,
  };
}

export async function bootstrapStalkerProfile(
  session: StalkerPortalSession,
  options: StalkerProfileBootstrapOptions = {},
): Promise<StalkerProfileBootstrapResult> {
  let payload: unknown;
  try {
    payload = await session.request(profileRequestParams(options.profileOptions), options.signal);
  } catch (caught) {
    if (
      caught instanceof StalkerPortalError &&
      caught.code === "HTTP_ERROR" &&
      (caught.status === 404 || caught.status === 405)
    ) {
      return { supported: false, reason: "unsupported" };
    }
    throw caught;
  }

  if (payloadLooksExplicitlyUnsupported(payload)) {
    return { supported: false, reason: "unsupported" };
  }
  return { supported: true, payload: validateSupportedProfilePayload(payload) };
}
