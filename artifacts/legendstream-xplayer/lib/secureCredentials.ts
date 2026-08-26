import * as SecureStore from "expo-secure-store";
import {
  compactCredentialFields,
  credentialFieldsEqual,
  type CredentialFields,
} from "./providerCredentialState";

export type ProviderSecrets = CredentialFields;

export type CredentialReadResult =
  | { status: "found"; secrets: ProviderSecrets }
  | { status: "missing" }
  | { status: "error"; error: Error };

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

const asError = (error: unknown, fallback: string) =>
  error instanceof Error ? error : new Error(fallback);

export async function readCredentials(providerId: string): Promise<CredentialReadResult> {
  if (!providerId) {
    return { status: "error", error: new Error("A provider id is required for secure credential storage.") };
  }
  try {
    const raw = await SecureStore.getItemAsync(secureCredentialKey(providerId));
    if (raw === null) return { status: "missing" };
    try {
      const parsed = JSON.parse(raw) as ProviderSecrets;
      return { status: "found", secrets: compactCredentialFields(parsed) };
    } catch (error) {
      return {
        status: "error",
        error: asError(error, "Stored provider credentials are unreadable."),
      };
    }
  } catch (error) {
    return {
      status: "error",
      error: asError(error, "Secure credential storage could not be read."),
    };
  }
}

export async function saveCredentials(
  providerId: string,
  secrets: ProviderSecrets,
): Promise<void> {
  const expected = compactCredentialFields(secrets);
  await SecureStore.setItemAsync(
    secureCredentialKey(providerId),
    JSON.stringify(expected),
  );

  // K1: a write is not successful until the exact compact payload can be
  // read back from SecureStore. Callers may only migrate/strip plaintext
  // after this function resolves.
  const verification = await readCredentials(providerId);
  if (verification.status === "error") throw verification.error;
  if (
    verification.status !== "found" ||
    !credentialFieldsEqual(expected, verification.secrets)
  ) {
    throw new Error("Secure credential write verification failed.");
  }
}

export async function getCredentials(providerId: string): Promise<ProviderSecrets | null> {
  const result = await readCredentials(providerId);
  if (result.status === "error") throw result.error;
  return result.status === "found" ? result.secrets : null;
}

export async function deleteCredentials(providerId: string): Promise<void> {
  if (!providerId) return;
  await SecureStore.deleteItemAsync(secureCredentialKey(providerId));
}
