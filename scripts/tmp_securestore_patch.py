import json
from pathlib import Path

secure = Path('artifacts/legendstream-xplayer/lib/secureCredentials.ts')
secure.write_text(r'''import * as SecureStore from "expo-secure-store";

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
''')

app = Path('artifacts/legendstream-xplayer/app.json')
data = json.loads(app.read_text())
plugins = data['expo'].setdefault('plugins', [])
if 'expo-secure-store' not in plugins:
    plugins.append('expo-secure-store')
app.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

p = Path('artifacts/legendstream-xplayer/context/PlayerContext.tsx')
s = p.read_text()

old = 'import { mapInBatches, yieldToUi } from "@/lib/cooperative";\n'
new = old + 'import { deleteCredentials, getCredentials, saveCredentials, type ProviderSecrets } from "@/lib/secureCredentials";\n'
assert s.count(old) == 1
s = s.replace(old, new)

old = 'const LEGACY_STORAGE_KEY = "@legendstream/player-state-v2";\nconst LOGGED_OUT = "__logged_out__";'
new = 'const LEGACY_STORAGE_KEY = "@legendstream/player-state-v2";\nconst SECURE_MIGRATION_KEY = "@legendstream/secure-credentials-v1";\nconst LOGGED_OUT = "__logged_out__";'
assert s.count(old) == 1
s = s.replace(old, new)

marker = '''const sameAccount = (a: ProviderConfig, b: Provider) =>
  normalizeUrl(a.url || a.playlistUrl) === normalizeUrl(b.url) &&
  (a.username || "") === (b.username || "") &&
  (a.mac || "").toLowerCase() === (b.mac || "").toLowerCase();

'''
assert s.count(marker) == 1
helper = r'''type StoredProviderConfig = Omit<
  ProviderConfig,
  "url" | "playlistUrl" | "epgUrl" | "username" | "password" | "mac"
>;

function providerSecretsFrom(provider: Partial<ProviderConfig>): ProviderSecrets {
  return {
    url: typeof provider.url === "string" ? provider.url : undefined,
    playlistUrl: typeof provider.playlistUrl === "string" ? provider.playlistUrl : undefined,
    epgUrl: typeof provider.epgUrl === "string" ? provider.epgUrl : undefined,
    username: typeof provider.username === "string" ? provider.username : undefined,
    password: typeof provider.password === "string" ? provider.password : undefined,
    mac: typeof provider.mac === "string" ? provider.mac : undefined,
  };
}

function hasProviderSecrets(secrets: ProviderSecrets) {
  return Object.values(secrets).some((value) => typeof value === "string" && value.length > 0);
}

function storedProviderFrom(provider: ProviderConfig): StoredProviderConfig {
  const {
    url: _url,
    playlistUrl: _playlistUrl,
    epgUrl: _epgUrl,
    username: _username,
    password: _password,
    mac: _mac,
    ...metadata
  } = provider;
  return metadata;
}

function serializedPlayerState(next: PlayerState) {
  return JSON.stringify({
    providers: next.providers.map(storedProviderFrom),
    provider: next.provider ? storedProviderFrom(next.provider) : null,
    activeProviderId: next.activeProviderId,
    favorites: next.favorites.slice(0, 500),
    history: next.history.slice(0, 50),
  });
}

async function hydrateStoredProvider(
  stored: ProviderConfig | StoredProviderConfig,
  legacySecrets?: ProviderSecrets,
): Promise<ProviderConfig> {
  const secure = await getCredentials(stored.id).catch(() => null);
  const secrets = secure ?? legacySecrets ?? providerSecretsFrom(stored as ProviderConfig);
  const url = secrets.url || secrets.playlistUrl || "";
  return {
    ...stored,
    url,
    playlistUrl: secrets.playlistUrl || secrets.url || "",
    epgUrl: secrets.epgUrl,
    username: secrets.username,
    password: secrets.password,
    mac: secrets.mac,
  } as ProviderConfig;
}

async function saveProviderSecrets(provider: ProviderConfig) {
  await saveCredentials(provider.id, providerSecretsFrom(provider));
}

'''
s = s.replace(marker, marker + helper)

start = s.index('const readState = async (): Promise<PlayerState> => {')
end = s.index('\nfunction decodeBase64Utf8', start)
replacement = r'''const readState = async (): Promise<PlayerState> => {
  let raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) raw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return emptyState;

  try {
    const saved = JSON.parse(raw) as Partial<PlayerState>;
    const storedProviders = (saved.providers ?? []) as ProviderConfig[];
    let migrationSucceeded = true;
    const legacyById = new Map<string, ProviderSecrets>();

    for (const item of storedProviders) {
      const legacySecrets = providerSecretsFrom(item);
      legacyById.set(item.id, legacySecrets);
      if (!hasProviderSecrets(legacySecrets)) continue;
      try {
        await saveCredentials(item.id, legacySecrets);
      } catch {
        migrationSucceeded = false;
      }
    }

    if (saved.provider?.id) {
      const activeLegacy = providerSecretsFrom(saved.provider);
      const existing = legacyById.get(saved.provider.id) ?? {};
      const merged = { ...existing, ...activeLegacy };
      legacyById.set(saved.provider.id, merged);
      if (hasProviderSecrets(activeLegacy)) {
        try {
          await saveCredentials(saved.provider.id, merged);
        } catch {
          migrationSucceeded = false;
        }
      }
    }

    const providers = await Promise.all(
      storedProviders.map((item) => hydrateStoredProvider(item, legacyById.get(item.id))),
    );
    const activeProviderId = saved.activeProviderId;
    const provider =
      activeProviderId === LOGGED_OUT
        ? null
        : providers.find((item) => item.id === activeProviderId) ??
          (saved.provider
            ? providers.find((item) => item.id === saved.provider?.id) ?? null
            : providers[0] ?? null);
    const next: PlayerState = {
      providers,
      provider,
      channels: [],
      epg: [],
      favorites: Array.isArray(saved.favorites) ? saved.favorites.slice(0, 500) : [],
      history: Array.isArray(saved.history) ? saved.history.slice(0, 50) : [],
      activeProviderId: activeProviderId ?? provider?.id,
    };

    if (migrationSucceeded) {
      try {
        await AsyncStorage.setItem(STORAGE_KEY, serializedPlayerState(next));
        await AsyncStorage.setItem(SECURE_MIGRATION_KEY, "1");
        await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        // SecureStore already owns the secrets. A later persist will retry metadata cleanup.
      }
    }
    return next;
  } catch {
    return emptyState;
  }
};
'''
s = s[:start] + replacement + s[end:]

old = '''      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          providers: next.providers,
          provider: next.provider,
          activeProviderId: next.activeProviderId,
          favorites: next.favorites.slice(0, 500),
          history: next.history.slice(0, 50),
        }),
      );'''
new = '''      await AsyncStorage.setItem(STORAGE_KEY, serializedPlayerState(next));
      await AsyncStorage.setItem(SECURE_MIGRATION_KEY, "1");
      await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);'''
assert s.count(old) == 1
s = s.replace(old, new)

old = '''      const providers = duplicate
        ? current.providers.map((item) =>
            item.id === duplicate.id ? savedProvider : item,
          )
        : [...current.providers, savedProvider];'''
new = '''      await saveProviderSecrets(savedProvider);
      const providers = duplicate
        ? current.providers.map((item) =>
            item.id === duplicate.id ? savedProvider : item,
          )
        : [...current.providers, savedProvider];'''
assert s.count(old) == 1
s = s.replace(old, new)

old = '''      epgCacheRef.current.delete(providerId);
      await persist({
        ...stateRef.current,
        provider:
          stateRef.current.provider?.id === providerId
            ? updated'''
new = '''      await saveProviderSecrets(updated);
      epgCacheRef.current.delete(providerId);
      await persist({
        ...stateRef.current,
        provider:
          stateRef.current.provider?.id === providerId
            ? updated'''
assert s.count(old) == 1
s = s.replace(old, new)

old = '''      epgCacheRef.current.delete(providerId);
      await persist({
        ...stateRef.current,
        provider: updated,
        activeProviderId: providerId,'''
new = '''      await saveProviderSecrets(updated);
      epgCacheRef.current.delete(providerId);
      await persist({
        ...stateRef.current,
        provider: updated,
        activeProviderId: providerId,'''
assert s.count(old) == 1
s = s.replace(old, new)

old = '''    await persist({
      ...current,
      providers,
      provider: nextProvider,
      activeProviderId:
        nextProvider?.id ?? (providers.length ? providers[0].id : LOGGED_OUT),
      channels,
      favorites: current.favorites.filter((id) => channelIds.has(id)),
      history: current.history.filter((id) => channelIds.has(id)),
      epg: current.epg.filter((program) => channelIds.has(program.channelId)),
    });
  };'''
new = '''    await persist({
      ...current,
      providers,
      provider: nextProvider,
      activeProviderId:
        nextProvider?.id ?? (providers.length ? providers[0].id : LOGGED_OUT),
      channels,
      favorites: current.favorites.filter((id) => channelIds.has(id)),
      history: current.history.filter((id) => channelIds.has(id)),
      epg: current.epg.filter((program) => channelIds.has(program.channelId)),
    });
    await deleteCredentials(providerId).catch(() => undefined);
  };'''
assert s.count(old) == 1
s = s.replace(old, new)

p.write_text(s)

v = Path('artifacts/legendstream-xplayer/components/OptimizedHomeScreenV6.tsx')
x = v.read_text()
old = '''        ? {
            ...item,
            type: "m3u",
            username: undefined,
            password: undefined,
            loadError: undefined,
          }'''
new = '''        ? {
            ...item,
            type: "m3u",
            loadError: undefined,
          }'''
assert x.count(old) == 1
v.write_text(x.replace(old, new))
