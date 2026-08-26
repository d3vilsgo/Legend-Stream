import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { secureCredentialKey } from "@/lib/secureCredentials";

const PLAYER_STATE_V3_KEY = "@legendstream/player-state-v3";
const PLAYER_STATE_V2_KEY = "@legendstream/player-state-v2";
const SECRET_FIELDS = ["url", "playlistUrl", "epgUrl", "username", "password", "mac"] as const;

type SecretField = (typeof SECRET_FIELDS)[number];
type ProviderLike = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  [key: string]: unknown;
};
type PlayerStateLike = {
  providers?: unknown;
  provider?: unknown;
};

export type SecureStoreProbe = {
  scheme: "current-codepoint-hex-v2" | "legacy-raw-id-v1";
  key: string;
  status: "found" | "missing" | "error";
  fields: SecretField[];
  error?: string;
};

export type ProviderCredentialDiagnostic = {
  providerId: string;
  providerName?: string;
  providerType?: string;
  v3: { present: boolean; embeddedSecretFields: SecretField[] };
  v2: { present: boolean; embeddedSecretFields: SecretField[] };
  secureStore: SecureStoreProbe[];
};

export type CredentialDiagnosticsReport = {
  generatedAt: string;
  asyncStorageKeys: string[];
  stores: {
    v3: { present: boolean; providerCount: number; parseError?: string };
    v2: { present: boolean; providerCount: number; parseError?: string };
  };
  providers: ProviderCredentialDiagnostic[];
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function parseState(raw: string | null): { state: PlayerStateLike | null; error?: string } {
  if (!raw) return { state: null };
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? { state: parsed as PlayerStateLike }
      : { state: null, error: "Stored value is not an object." };
  } catch (error) {
    return { state: null, error: errorMessage(error) };
  }
}

function providerMap(state: PlayerStateLike | null) {
  const map = new Map<string, ProviderLike>();
  const add = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const provider = value as ProviderLike;
    if (typeof provider.id !== "string" || provider.id.length === 0) return;
    map.set(provider.id, provider);
  };
  if (Array.isArray(state?.providers)) state.providers.forEach(add);
  add(state?.provider);
  return map;
}

function secretFields(value: ProviderLike | null | undefined): SecretField[] {
  if (!value) return [];
  return SECRET_FIELDS.filter((field) => {
    const item = value[field];
    return typeof item === "string" && item.length > 0;
  });
}

async function probeSecureStore(
  scheme: SecureStoreProbe["scheme"],
  key: string,
): Promise<SecureStoreProbe> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    if (raw === null) return { scheme, key, status: "missing", fields: [] };
    try {
      const parsed = JSON.parse(raw) as ProviderLike;
      return { scheme, key, status: "found", fields: secretFields(parsed) };
    } catch (error) {
      return {
        scheme,
        key,
        status: "error",
        fields: [],
        error: `Stored value is not valid JSON: ${errorMessage(error)}`,
      };
    }
  } catch (error) {
    return { scheme, key, status: "error", fields: [], error: errorMessage(error) };
  }
}

export async function runCredentialDiagnostics(): Promise<CredentialDiagnosticsReport> {
  const [asyncStorageKeys, v3Raw, v2Raw] = await Promise.all([
    AsyncStorage.getAllKeys(),
    AsyncStorage.getItem(PLAYER_STATE_V3_KEY),
    AsyncStorage.getItem(PLAYER_STATE_V2_KEY),
  ]);
  const v3Parsed = parseState(v3Raw);
  const v2Parsed = parseState(v2Raw);
  const v3Providers = providerMap(v3Parsed.state);
  const v2Providers = providerMap(v2Parsed.state);
  const providerIds = Array.from(new Set([...v3Providers.keys(), ...v2Providers.keys()])).sort();

  const providers = await Promise.all(
    providerIds.map(async (providerId): Promise<ProviderCredentialDiagnostic> => {
      const v3 = v3Providers.get(providerId);
      const v2 = v2Providers.get(providerId);
      const currentKey = secureCredentialKey(providerId);
      const legacyKey = `credentials:${providerId}`;
      const [currentProbe, legacyProbe] = await Promise.all([
        probeSecureStore("current-codepoint-hex-v2", currentKey),
        probeSecureStore("legacy-raw-id-v1", legacyKey),
      ]);
      const metadata = v3 ?? v2;
      return {
        providerId,
        providerName: typeof metadata?.name === "string" ? metadata.name : undefined,
        providerType: typeof metadata?.type === "string" ? metadata.type : undefined,
        v3: { present: Boolean(v3), embeddedSecretFields: secretFields(v3) },
        v2: { present: Boolean(v2), embeddedSecretFields: secretFields(v2) },
        secureStore: [currentProbe, legacyProbe],
      };
    }),
  );

  return {
    generatedAt: new Date().toISOString(),
    asyncStorageKeys: [...asyncStorageKeys].sort(),
    stores: {
      v3: {
        present: v3Raw !== null,
        providerCount: v3Providers.size,
        parseError: v3Parsed.error,
      },
      v2: {
        present: v2Raw !== null,
        providerCount: v2Providers.size,
        parseError: v2Parsed.error,
      },
    },
    providers,
  };
}

export function formatCredentialDiagnostics(report: CredentialDiagnosticsReport): string {
  const lines: string[] = [
    `Generated: ${report.generatedAt}`,
    `AsyncStorage keys (${report.asyncStorageKeys.length}): ${report.asyncStorageKeys.join(", ") || "none"}`,
    `v3: ${report.stores.v3.present ? "present" : "missing"}, providers=${report.stores.v3.providerCount}${report.stores.v3.parseError ? `, parseError=${report.stores.v3.parseError}` : ""}`,
    `v2: ${report.stores.v2.present ? "present" : "missing"}, providers=${report.stores.v2.providerCount}${report.stores.v2.parseError ? `, parseError=${report.stores.v2.parseError}` : ""}`,
  ];

  for (const provider of report.providers) {
    lines.push("");
    lines.push(`Provider ${provider.providerId} (${provider.providerType ?? "unknown"}) ${provider.providerName ?? ""}`.trim());
    lines.push(`  v3=${provider.v3.present ? "yes" : "no"}; embeddedFields=${provider.v3.embeddedSecretFields.join(",") || "none"}`);
    lines.push(`  v2=${provider.v2.present ? "yes" : "no"}; embeddedFields=${provider.v2.embeddedSecretFields.join(",") || "none"}`);
    for (const probe of provider.secureStore) {
      if (probe.scheme === "legacy-raw-id-v1") {
        lines.push("  legacy scheme: INVALID KEY (beklenen, kanıt değeri yok)");
        continue;
      }
      lines.push(`  current scheme: ${probe.status}; fields=${probe.fields.join(",") || "none"}${probe.error ? `; error=${probe.error}` : ""}`);
    }
  }

  return lines.join("\n");
}
