import * as SecureStore from "expo-secure-store";

export type ProviderSecrets = {
  url?: string;
  playlistUrl?: string;
  epgUrl?: string;
  username?: string;
  password?: string;
  mac?: string;
};

const KEY_PREFIX = "credentials:";
const keyFor = (providerId: string) => `${KEY_PREFIX}${providerId}`;

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
  if (!providerId) throw new Error("A provider id is required for secure credential storage.");
  await SecureStore.setItemAsync(keyFor(providerId), JSON.stringify(compactSecrets(secrets)));
}

export async function getCredentials(providerId: string): Promise<ProviderSecrets | null> {
  if (!providerId) return null;
  const raw = await SecureStore.getItemAsync(keyFor(providerId));
  if (!raw) return null;
  try {
    return compactSecrets(JSON.parse(raw) as ProviderSecrets);
  } catch {
    return null;
  }
}

export async function deleteCredentials(providerId: string): Promise<void> {
  if (!providerId) return;
  await SecureStore.deleteItemAsync(keyFor(providerId));
}
