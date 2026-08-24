import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@legendstream/connection-diagnostics-v1";
const MAX_ENTRIES = 200;

export type ConnectionDiagnosticEntry = {
  at: number;
  elapsedMs: number;
  label: string;
  detail?: string;
};

export type ConnectionDiagnosticSnapshot = {
  startedAt: number;
  entries: ConnectionDiagnosticEntry[];
  complete: boolean;
};

let startedAt = Date.now();
let entries: ConnectionDiagnosticEntry[] = [];
let complete = false;

const persist = () => {
  const snapshot: ConnectionDiagnosticSnapshot = {
    startedAt,
    entries: entries.slice(-MAX_ENTRIES),
    complete,
  };
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)).catch(() => undefined);
};

export function beginConnectionDiagnostics(detail?: string) {
  startedAt = Date.now();
  entries = [];
  complete = false;
  appendConnectionDiagnostic("connect:start", detail);
}

export function appendConnectionDiagnostic(label: string, detail?: string) {
  const now = Date.now();
  const entry: ConnectionDiagnosticEntry = {
    at: now,
    elapsedMs: Math.max(0, now - startedAt),
    label,
    detail,
  };
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), entry];
  // Safe for logcat: never pass provider URLs, usernames or passwords as detail.
  console.info(
    `[ConnectionDiag] +${entry.elapsedMs}ms ${label}${detail ? ` | ${detail}` : ""}`,
  );
  persist();
}

export function markConnectionDiagnosticsComplete() {
  complete = true;
  persist();
}

export function currentConnectionDiagnostics(): ConnectionDiagnosticSnapshot {
  return { startedAt, entries: [...entries], complete };
}

export async function readConnectionDiagnostics(): Promise<ConnectionDiagnosticSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConnectionDiagnosticSnapshot;
    if (!Array.isArray(parsed?.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function formatConnectionDiagnostics(snapshot: ConnectionDiagnosticSnapshot | null) {
  if (!snapshot?.entries?.length) return "";
  const lines = snapshot.entries.map((entry) => {
    const seconds = (entry.elapsedMs / 1000).toFixed(3);
    return `+${seconds}s  ${entry.label}${entry.detail ? `  ${entry.detail}` : ""}`;
  });
  return [
    "Son bağlantı tanılaması / Last connection diagnostics",
    ...lines,
    `durum/status: ${snapshot.complete ? "complete" : "incomplete"}`,
  ].join("\n");
}
