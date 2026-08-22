import AsyncStorage from "@react-native-async-storage/async-storage";

export type PlayerDiagnosticDetails = Record<string, string | number | boolean | null | undefined>;

export type PlayerDiagnosticEntry = {
  at: number;
  event: string;
  details?: Record<string, string | number | boolean | null>;
};

const PLAYER_DIAGNOSTICS_KEY = "@legendstream/player-diagnostics-v1";
const MAX_ENTRIES = 80;
let writeQueue: Promise<void> = Promise.resolve();

const sanitizeDetails = (details?: PlayerDiagnosticDetails) => {
  if (!details) return undefined;
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) continue;
    if (typeof value === "string") clean[key] = value.slice(0, 240);
    else if (typeof value === "number" && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === "boolean" || value === null) clean[key] = value;
  }
  return Object.keys(clean).length ? clean : undefined;
};

export async function getPlayerDiagnostics(): Promise<PlayerDiagnosticEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(PLAYER_DIAGNOSTICS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.event === "string" && Number.isFinite(Number(entry.at)))
      .slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function logPlayerDiagnostic(event: string, details?: PlayerDiagnosticDetails) {
  const entry: PlayerDiagnosticEntry = {
    at: Date.now(),
    event: event.slice(0, 80),
    details: sanitizeDetails(details),
  };

  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const existing = await getPlayerDiagnostics();
      existing.push(entry);
      await AsyncStorage.setItem(
        PLAYER_DIAGNOSTICS_KEY,
        JSON.stringify(existing.slice(-MAX_ENTRIES)),
      );
    });

  return writeQueue;
}

export async function clearPlayerDiagnostics() {
  await AsyncStorage.removeItem(PLAYER_DIAGNOSTICS_KEY);
}
