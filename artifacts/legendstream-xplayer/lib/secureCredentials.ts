import * as SecureStore from "expo-secure-store";

export type ProviderSecrets = {
  url?: string;
  playlistUrl?: string;
  epgUrl?: string;
  username?: string;
  password?: string;
  mac?: string;
};

const KEY_PREFIX = "credentials.";
const SECURE_STORE_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * SecureStore only accepts [A-Za-z0-9._-] keys. Encode every Unicode code
 * point to a fixed-width six-digit hex token so arbitrary historical provider
 * ids remain deterministic and collision-free without putting the raw id in
 * the SecureStore key.
 */
export function secureCredentialKey(providerId: string): string {
  if (!providerId) {
    throw new Error("A provider id is required for secure credential storage.");
  }
  const token = Array.from(providerId, (character) =>
    character.codePointAt(0)!.toString(16).padStart(6, "0"),
  ).join("");
  const key = `${KEY_PREFIX}${token}`;
  if (!SECURE_STORE_KEY_PATTERN.test(key)) {
    throw new Error("Unable to derive a valid SecureStore key for this provider.");
  }
  return key;
}

function compactSecrets(secrets: ProviderSecrets): ProviderSecrets {
  const compact: ProviderSecrets = {};
  for (const [key, value] of Object.entries(secrets) as Array<[
    keyof ProviderSecrets,
    string | undefined,
  ]>) {
    if (typeof value === "string" && value.length > 0) compact[key] = value;
  }
  return compact;
}

export async function saveCredentials(
  providerId: string,
  secrets: ProviderSecrets,
): Promise<void> {
  await SecureStore.setItemAsync(
    secureCredentialKey(providerId),
    JSON.stringify(compactSecrets(secrets)),
  );
}

export async function getCredentials(providerId: string): Promise<ProviderSecrets | null> {
  if (!providerId) return null;
  const raw = await SecureStore.getItemAsync(secureCredentialKey(providerId));
  if (!raw) return null;
  try {
    return compactSecrets(JSON.parse(raw) as ProviderSecrets);
  } catch {
    return null;
  }
}

export async function deleteCredentials(providerId: string): Promise<void> {
  if (!providerId) return;
  await SecureStore.deleteItemAsync(secureCredentialKey(providerId));
}
