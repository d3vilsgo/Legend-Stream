export type CredentialProviderType = "m3u" | "xtream" | "stalker";

export type CredentialFields = {
  url?: string;
  playlistUrl?: string;
  epgUrl?: string;
  username?: string;
  password?: string;
  mac?: string;
};

export type CredentialReadSnapshot =
  | { status: "found"; secrets: CredentialFields }
  | { status: "missing" }
  | { status: "error"; error: unknown };

export function compactCredentialFields(secrets: CredentialFields): CredentialFields {
  const compact: CredentialFields = {};
  for (const [key, value] of Object.entries(secrets) as Array<[
    keyof CredentialFields,
    string | undefined,
  ]>) {
    if (typeof value === "string" && value.length > 0) compact[key] = value;
  }
  return compact;
}

export function mergeCredentialFields(
  ...sources: Array<CredentialFields | null | undefined>
): CredentialFields {
  const merged: CredentialFields = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source) as Array<[
      keyof CredentialFields,
      string | undefined,
    ]>) {
      if (typeof value === "string" && value.length > 0) merged[key] = value;
    }
  }
  return merged;
}

export function hasRequiredCredentialFields(
  type: CredentialProviderType,
  secrets: CredentialFields,
): boolean {
  const hasUrl = Boolean(secrets.url || secrets.playlistUrl);
  if (!hasUrl) return false;
  if (type === "xtream") return Boolean(secrets.username && secrets.password);
  if (type === "stalker") return Boolean(secrets.mac);
  return true;
}

export function credentialFieldsEqual(a: CredentialFields, b: CredentialFields): boolean {
  const left = compactCredentialFields(a);
  const right = compactCredentialFields(b);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)] as Array<keyof CredentialFields>);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

export function resolveCredentialState(
  type: CredentialProviderType,
  v3Secrets: CredentialFields | undefined,
  v2Secrets: CredentialFields | undefined,
  secure: CredentialReadSnapshot,
) {
  const legacy = mergeCredentialFields(v2Secrets, v3Secrets);
  if (secure.status === "error") {
    return {
      secrets: legacy,
      needsCredentials: true,
      shouldWriteSecureStore: false,
      secureStatus: secure.status,
    } as const;
  }

  const secrets = mergeCredentialFields(
    legacy,
    secure.status === "found" ? secure.secrets : undefined,
  );
  const complete = hasRequiredCredentialFields(type, secrets);
  const secureComplete =
    secure.status === "found" && hasRequiredCredentialFields(type, secure.secrets);
  const secureMatches =
    secure.status === "found" && credentialFieldsEqual(secure.secrets, secrets);

  return {
    secrets,
    needsCredentials: !complete,
    shouldWriteSecureStore: complete && (!secureComplete || !secureMatches),
    secureStatus: secure.status,
  } as const;
}


const LEGACY_CREDENTIAL_KEYS = [
  "url", "playlistUrl", "epgUrl", "username", "password", "mac",
] as const;

function scrubLegacyProviderRecord(record: unknown): Record<string, unknown> | null {
  if (!record || typeof record !== "object") return null;
  const metadata = { ...(record as Record<string, unknown>) };
  for (const key of LEGACY_CREDENTIAL_KEYS) delete metadata[key];
  return metadata;
}

/**
 * K1-EK: retain v2 as metadata only after every credential-bearing legacy
 * provider has passed SecureStore read-back verification. Reconstructing
 * the top level also drops old channel/EPG payloads whose URLs may embed
 * plaintext credentials.
 */
export function migratedLegacyStateAfterVerification(
  saved: unknown,
  readBackVerified: boolean,
): (Record<string, unknown> & { migrated: true }) | null {
  if (!readBackVerified || !saved || typeof saved !== "object") return null;
  const state = saved as Record<string, unknown>;
  const providers = Array.isArray(state.providers)
    ? state.providers
        .map(scrubLegacyProviderRecord)
        .filter((item): item is Record<string, unknown> => item !== null)
    : [];
  return {
    migrated: true,
    providers,
    provider: scrubLegacyProviderRecord(state.provider),
    activeProviderId: state.activeProviderId,
    favorites: Array.isArray(state.favorites) ? state.favorites : [],
    history: Array.isArray(state.history) ? state.history : [],
  };
}
