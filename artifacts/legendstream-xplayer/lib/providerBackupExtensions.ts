import * as SecureStore from "expo-secure-store";
import { assertSecureRecordFits } from "./providerBackupCore";
import { secureCredentialKey } from "./secureCredentials";

export type OpaqueExtensionRecord = Record<string, unknown>;

export type ExtensionReadResult =
  | { status: "found"; value: OpaqueExtensionRecord }
  | { status: "missing" }
  | { status: "error"; error: Error };

const ROOT_EXTENSION_KEY = "provider-backup.root-ext";

function providerExtensionKey(providerId: string) {
  const credentialKey = secureCredentialKey(providerId);
  const token = credentialKey.slice("credentials.".length);
  return `provider-backup.ext.${token}`;
}

function asError(error: unknown, fallback: string) {
  return error instanceof Error ? error : new Error(fallback);
}

async function readExtensionKey(key: string): Promise<ExtensionReadResult> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    if (raw === null) return { status: "missing" };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Extension record is not an object.");
      }
      return { status: "found", value: parsed as OpaqueExtensionRecord };
    } catch (error) {
      return { status: "error", error: asError(error, "Secure extension record is unreadable.") };
    }
  } catch (error) {
    return { status: "error", error: asError(error, "Secure extension storage could not be read.") };
  }
}

async function writeVerifiedExtensionKey(key: string, value: OpaqueExtensionRecord): Promise<void> {
  const raw = JSON.stringify(value);
  assertSecureRecordFits(value, "opaque extension record");
  await SecureStore.setItemAsync(key, raw);
  const readBack = await SecureStore.getItemAsync(key);
  if (readBack !== raw) throw new Error("Secure extension write verification failed.");
}

export function readProviderBackupExtension(providerId: string) {
  return readExtensionKey(providerExtensionKey(providerId));
}

export function saveProviderBackupExtension(providerId: string, value: OpaqueExtensionRecord) {
  return writeVerifiedExtensionKey(providerExtensionKey(providerId), value);
}

export async function deleteProviderBackupExtension(providerId: string) {
  await SecureStore.deleteItemAsync(providerExtensionKey(providerId));
}

export function readRootBackupExtension() {
  return readExtensionKey(ROOT_EXTENSION_KEY);
}

export function saveRootBackupExtension(value: OpaqueExtensionRecord) {
  return writeVerifiedExtensionKey(ROOT_EXTENSION_KEY, value);
}

export async function deleteRootBackupExtension() {
  await SecureStore.deleteItemAsync(ROOT_EXTENSION_KEY);
}
