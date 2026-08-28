import type { CredentialFields } from "./providerCredentialState";

export const MEDIA_PROGRESS_V1_STORAGE_KEY = "@legendstream/media-progress-v1";
export const MEDIA_PROGRESS_V2_STORAGE_KEY = "@legendstream/media-progress-v2";
export const MEDIA_PROGRESS_MIGRATION_ERROR = "MEDIA_PROGRESS_MIGRATION_FAILED";

export type MediaKind = "movie" | "episode";
export type MediaSourceMode = "canonical" | "direct";

export type MediaPlaybackRef =
  | {
      type: "xtream-vod";
      streamId: string;
      containerExtension: string;
      sourceMode: MediaSourceMode;
    }
  | {
      type: "xtream-episode";
      episodeId: string;
      containerExtension: string;
      sourceMode: MediaSourceMode;
      seriesId?: string;
    }
  | { type: "m3u-vod"; itemId: string }
  | { type: "m3u-episode"; itemId: string }
  | { type: "unresolved"; mediaKind: MediaKind; legacyTag: string };

export type MediaProgressV2 = {
  schemaVersion: 2;
  id: string;
  providerId: string | null;
  kind: MediaKind;
  title: string;
  subtitle?: string;
  playbackRef: MediaPlaybackRef;
  position: number;
  duration: number;
  updatedAt: number;
};

export type LegacyMediaProgressV1 = {
  id?: string;
  kind: MediaKind;
  title: string;
  subtitle?: string;
  source: string;
  position: number;
  duration: number;
  updatedAt: number;
};

export type MediaProgressCredentialSnapshot = {
  providerId: string;
  type: "m3u" | "xtream" | "stalker";
  secrets: CredentialFields;
};

export type MediaProgressStorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const safeDecode = (value: string) => {
  try { return decodeURIComponent(value); }
  catch { return value; }
};

const safeExtension = (value: string | undefined, fallback = "mp4") =>
  value && /^[a-zA-Z0-9]{1,10}$/.test(value) ? value : fallback;

const hashText = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

export function normalizeXtreamProgressBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(candidate);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    let path = url.pathname.replace(/\/+$/, "");
    if (/\/get\.php$/i.test(path)) path = path.slice(0, path.length - "/get.php".length);
    url.pathname = path || "/";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export type ParsedCanonicalXtreamProgressSource = {
  kind: MediaKind;
  baseUrl: string;
  username: string;
  password: string;
  itemId: string;
  containerExtension: string;
};

export function parseCanonicalXtreamProgressSource(
  source: string,
): ParsedCanonicalXtreamProgressSource | null {
  try {
    const url = new URL(source);
    const rawParts = url.pathname.split("/").filter(Boolean);
    let markerIndex = -1;
    for (let index = rawParts.length - 4; index >= 0; index -= 1) {
      const part = rawParts[index].toLowerCase();
      if ((part === "movie" || part === "series") && rawParts.length === index + 4) {
        markerIndex = index;
        break;
      }
    }
    if (markerIndex < 0) return null;
    const marker = rawParts[markerIndex].toLowerCase();
    const username = safeDecode(rawParts[markerIndex + 1]);
    const password = safeDecode(rawParts[markerIndex + 2]);
    const file = safeDecode(rawParts[markerIndex + 3]);
    const dot = file.lastIndexOf(".");
    if (!username || !password || dot <= 0 || dot === file.length - 1) return null;
    const itemId = file.slice(0, dot);
    const containerExtension = safeExtension(file.slice(dot + 1));
    const prefix = rawParts.slice(0, markerIndex).map((part) => `/${part}`).join("");
    const baseUrl = normalizeXtreamProgressBaseUrl(`${url.origin}${prefix || "/"}`);
    if (!baseUrl || !itemId) return null;
    return {
      kind: marker === "movie" ? "movie" : "episode",
      baseUrl,
      username,
      password,
      itemId,
      containerExtension,
    };
  } catch {
    return null;
  }
}

function playbackRefFromCanonical(parsed: ParsedCanonicalXtreamProgressSource): MediaPlaybackRef {
  return parsed.kind === "movie"
    ? {
        type: "xtream-vod",
        streamId: parsed.itemId,
        containerExtension: parsed.containerExtension,
        sourceMode: "canonical",
      }
    : {
        type: "xtream-episode",
        episodeId: parsed.itemId,
        containerExtension: parsed.containerExtension,
        sourceMode: "canonical",
      };
}

function parseLegacyCatalogRuntimeSource(source: string): { providerId: string; ref: MediaPlaybackRef } | null {
  if (!source.startsWith("legendstream-catalog:")) return null;
  try {
    const url = new URL(source);
    if (url.protocol !== "legendstream-catalog:" || url.hostname !== "xtream") return null;
    const parts = url.pathname.split("/").filter(Boolean).map(safeDecode);
    if (parts.length !== 3 || parts[0] !== "movie") return null;
    const containerExtension = safeExtension(url.searchParams.get("ext") || undefined);
    if (!parts[1] || !parts[2]) return null;
    return {
      providerId: parts[1],
      ref: {
        type: "xtream-vod",
        streamId: parts[2],
        containerExtension,
        sourceMode: "direct",
      },
    };
  } catch {
    return null;
  }
}

function exactProviderForCanonical(
  parsed: ParsedCanonicalXtreamProgressSource,
  snapshots: readonly MediaProgressCredentialSnapshot[],
): string | null {
  const matches = snapshots.filter((snapshot) => {
    if (snapshot.type !== "xtream") return false;
    const base = normalizeXtreamProgressBaseUrl(snapshot.secrets.url || snapshot.secrets.playlistUrl || "");
    return base === parsed.baseUrl &&
      (snapshot.secrets.username || "") === parsed.username &&
      (snapshot.secrets.password || "") === parsed.password;
  });
  return matches.length === 1 ? matches[0].providerId : null;
}

function legacyTag(kind: MediaKind, title: string, updatedAt: number, index: number) {
  return hashText(`${kind}\u0000${title}\u0000${updatedAt}\u0000${index}`);
}

function progressId(
  providerId: string | null,
  kind: MediaKind,
  ref: MediaPlaybackRef,
  title: string,
  updatedAt: number,
  index = 0,
) {
  return `media-v2-${hashText(`${providerId ?? "unscoped"}\u0000${kind}\u0000${playbackRefKey(ref)}\u0000${title}\u0000${updatedAt}\u0000${index}`)}`;
}

function parseLegacyEntry(value: unknown): LegacyMediaProgressV1 | null {
  const raw = asObject(value);
  if (!raw || (raw.kind !== "movie" && raw.kind !== "episode")) return null;
  if (typeof raw.title !== "string" || typeof raw.source !== "string") return null;
  const position = Number(raw.position);
  const duration = Number(raw.duration);
  const updatedAt = Number(raw.updatedAt);
  if (!Number.isFinite(position) || position < 0 || !Number.isFinite(duration) || duration < 0 || !Number.isFinite(updatedAt)) {
    return null;
  }
  return {
    kind: raw.kind,
    title: raw.title,
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle : undefined,
    source: raw.source,
    position,
    duration,
    updatedAt,
  };
}

export function migrateMediaProgressV1Entries(
  raw: unknown,
  snapshots: readonly MediaProgressCredentialSnapshot[],
): MediaProgressV2[] {
  if (!Array.isArray(raw)) throw asMediaProgressMigrationError();
  return raw.map((value, index) => {
    const legacy = parseLegacyEntry(value);
    if (!legacy) throw asMediaProgressMigrationError();

    const runtime = parseLegacyCatalogRuntimeSource(legacy.source);
    const canonical = runtime ? null : parseCanonicalXtreamProgressSource(legacy.source);
    const runtimeProviderId = runtime && snapshots.some((snapshot) => snapshot.providerId === runtime.providerId)
      ? runtime.providerId
      : null;
    const providerId = runtimeProviderId ?? (canonical ? exactProviderForCanonical(canonical, snapshots) : null);
    const ref = runtime?.ref ?? (canonical
      ? playbackRefFromCanonical(canonical)
      : {
          type: "unresolved" as const,
          mediaKind: legacy.kind,
          legacyTag: legacyTag(legacy.kind, legacy.title, legacy.updatedAt, index),
        });

    return {
      schemaVersion: 2 as const,
      id: progressId(providerId, legacy.kind, ref, legacy.title, legacy.updatedAt, index),
      providerId,
      kind: legacy.kind,
      title: legacy.title,
      subtitle: legacy.subtitle,
      playbackRef: ref,
      position: legacy.position,
      duration: legacy.duration,
      updatedAt: legacy.updatedAt,
    };
  });
}

function isPlaybackRef(value: unknown): value is MediaPlaybackRef {
  const raw = asObject(value);
  if (!raw || typeof raw.type !== "string") return false;
  if (raw.type === "xtream-vod") {
    return typeof raw.streamId === "string" && raw.streamId.length > 0 &&
      typeof raw.containerExtension === "string" && /^[a-zA-Z0-9]{1,10}$/.test(raw.containerExtension) &&
      (raw.sourceMode === "canonical" || raw.sourceMode === "direct");
  }
  if (raw.type === "xtream-episode") {
    return typeof raw.episodeId === "string" && raw.episodeId.length > 0 &&
      typeof raw.containerExtension === "string" && /^[a-zA-Z0-9]{1,10}$/.test(raw.containerExtension) &&
      (raw.sourceMode === "canonical" || raw.sourceMode === "direct") &&
      (raw.seriesId === undefined || typeof raw.seriesId === "string");
  }
  if (raw.type === "m3u-vod" || raw.type === "m3u-episode") {
    return typeof raw.itemId === "string" && raw.itemId.length > 0;
  }
  return raw.type === "unresolved" &&
    (raw.mediaKind === "movie" || raw.mediaKind === "episode") &&
    typeof raw.legacyTag === "string" && raw.legacyTag.length > 0;
}

export function parseMediaProgressV2Payload(raw: string): MediaProgressV2[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw asMediaProgressMigrationError(); }
  if (!Array.isArray(parsed)) throw asMediaProgressMigrationError();
  const entries: MediaProgressV2[] = [];
  for (const value of parsed) {
    const item = asObject(value);
    if (!item || item.schemaVersion !== 2 || typeof item.id !== "string" || !item.id ||
      (item.providerId !== null && typeof item.providerId !== "string") ||
      (item.kind !== "movie" && item.kind !== "episode") ||
      typeof item.title !== "string" ||
      (item.subtitle !== undefined && typeof item.subtitle !== "string") ||
      !isPlaybackRef(item.playbackRef)) {
      throw asMediaProgressMigrationError();
    }
    const position = Number(item.position);
    const duration = Number(item.duration);
    const updatedAt = Number(item.updatedAt);
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(duration) || duration < 0 || !Number.isFinite(updatedAt)) {
      throw asMediaProgressMigrationError();
    }
    entries.push({
      schemaVersion: 2,
      id: item.id,
      providerId: item.providerId as string | null,
      kind: item.kind,
      title: item.title,
      subtitle: item.subtitle as string | undefined,
      playbackRef: item.playbackRef,
      position,
      duration,
      updatedAt,
    });
  }
  return entries;
}

const FORBIDDEN_PERSISTED_KEYS = new Set([
  "source", "url", "playlistUrl", "epgUrl", "username", "password", "mac", "credentials",
]);

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  const raw = asObject(value);
  if (!raw) return false;
  for (const [key, child] of Object.entries(raw)) {
    if (FORBIDDEN_PERSISTED_KEYS.has(key)) return true;
    if (containsForbiddenKey(child)) return true;
  }
  return false;
}

function secretValues(snapshots: readonly MediaProgressCredentialSnapshot[]) {
  const values = new Set<string>();
  for (const snapshot of snapshots) {
    const secrets = snapshot.secrets;
    for (const key of ["url", "playlistUrl", "epgUrl", "username", "password", "mac"] as const) {
      const value = secrets[key];
      if (!value || value.length < 4) continue;
      values.add(value);
      try { values.add(encodeURIComponent(value)); } catch { /* no-op */ }
    }
  }
  return [...values];
}

export function isMediaProgressV2PayloadSafe(
  entries: readonly MediaProgressV2[],
  snapshots: readonly MediaProgressCredentialSnapshot[],
): boolean {
  if (containsForbiddenKey(entries)) return false;
  const serialized = JSON.stringify(entries);
  if (/https?:\/\//i.test(serialized)) return false;
  for (const secret of secretValues(snapshots)) {
    if (serialized.includes(secret)) return false;
  }
  return true;
}

export function asMediaProgressMigrationError(_caught?: unknown): Error {
  const error = new Error(MEDIA_PROGRESS_MIGRATION_ERROR);
  error.name = "MediaProgressMigrationError";
  return error;
}

export async function commitMediaProgressV2(
  storage: MediaProgressStorageAdapter,
  entries: readonly MediaProgressV2[],
  snapshots: readonly MediaProgressCredentialSnapshot[],
): Promise<MediaProgressV2[]> {
  try {
    if (!isMediaProgressV2PayloadSafe(entries, snapshots)) throw asMediaProgressMigrationError();
    const serialized = JSON.stringify(entries);
    await storage.setItem(MEDIA_PROGRESS_V2_STORAGE_KEY, serialized);
    const readBack = await storage.getItem(MEDIA_PROGRESS_V2_STORAGE_KEY);
    if (readBack !== serialized) throw asMediaProgressMigrationError();
    const verified = parseMediaProgressV2Payload(readBack);
    if (!isMediaProgressV2PayloadSafe(verified, snapshots)) throw asMediaProgressMigrationError();
    return verified;
  } catch (caught) {
    throw asMediaProgressMigrationError(caught);
  }
}

export async function migrateMediaProgressStorage(
  storage: MediaProgressStorageAdapter,
  snapshots: readonly MediaProgressCredentialSnapshot[],
): Promise<MediaProgressV2[]> {
  try {
    const [v2Raw, v1Raw] = await Promise.all([
      storage.getItem(MEDIA_PROGRESS_V2_STORAGE_KEY),
      storage.getItem(MEDIA_PROGRESS_V1_STORAGE_KEY),
    ]);

    if (v2Raw !== null) {
      const existing = parseMediaProgressV2Payload(v2Raw);
      if (!isMediaProgressV2PayloadSafe(existing, snapshots)) throw asMediaProgressMigrationError();
      if (v1Raw !== null) await storage.removeItem(MEDIA_PROGRESS_V1_STORAGE_KEY);
      return existing;
    }

    if (v1Raw === null) return [];
    let legacy: unknown;
    try { legacy = JSON.parse(v1Raw); }
    catch { throw asMediaProgressMigrationError(); }
    const migrated = migrateMediaProgressV1Entries(legacy, snapshots);
    const verified = await commitMediaProgressV2(storage, migrated, snapshots);
    await storage.removeItem(MEDIA_PROGRESS_V1_STORAGE_KEY);
    return verified;
  } catch (caught) {
    throw asMediaProgressMigrationError(caught);
  }
}

export function playbackRefKey(ref: MediaPlaybackRef): string {
  if (ref.type === "xtream-vod") {
    return `xtream-vod:${ref.streamId}:${ref.containerExtension}:${ref.sourceMode}`;
  }
  if (ref.type === "xtream-episode") {
    return `xtream-episode:${ref.episodeId}:${ref.containerExtension}:${ref.sourceMode}:${ref.seriesId ?? ""}`;
  }
  if (ref.type === "m3u-vod") return `m3u-vod:${ref.itemId}`;
  if (ref.type === "m3u-episode") return `m3u-episode:${ref.itemId}`;
  return `unresolved:${ref.mediaKind}:${ref.legacyTag}`;
}

export function samePlaybackRef(a: MediaPlaybackRef, b: MediaPlaybackRef): boolean {
  if (a.type === "unresolved" || b.type === "unresolved" || a.type !== b.type) return false;
  if (a.type === "xtream-vod" && b.type === "xtream-vod") return a.streamId === b.streamId;
  if (a.type === "xtream-episode" && b.type === "xtream-episode") return a.episodeId === b.episodeId;
  if (a.type === "m3u-vod" && b.type === "m3u-vod") return a.itemId === b.itemId;
  if (a.type === "m3u-episode" && b.type === "m3u-episode") return a.itemId === b.itemId;
  return false;
}

export function trimMediaProgressByScope(entries: readonly MediaProgressV2[], limit = 100): MediaProgressV2[] {
  const counts = new Map<string, number>();
  const result: MediaProgressV2[] = [];
  for (const entry of entries) {
    const scope = entry.providerId ?? "__unscoped__";
    const count = counts.get(scope) ?? 0;
    if (count >= limit) continue;
    counts.set(scope, count + 1);
    result.push(entry);
  }
  return result;
}

export function makeMediaProgressId(
  providerId: string | null,
  kind: MediaKind,
  ref: MediaPlaybackRef,
  title: string,
  updatedAt: number,
) {
  return progressId(providerId, kind, ref, title, updatedAt);
}

export function claimProgressForProvider(
  entries: readonly MediaProgressV2[],
  providerId: string,
  ref: MediaPlaybackRef,
): { entry?: MediaProgressV2; entries: MediaProgressV2[]; changed: boolean } {
  if (ref.type === "unresolved") return { entries: [...entries], changed: false };
  const candidates = entries.filter(
    (entry) => (entry.providerId === providerId || entry.providerId === null) && samePlaybackRef(entry.playbackRef, ref),
  );
  if (!candidates.length) return { entries: [...entries], changed: false };
  const winner = [...candidates].sort((a, b) => b.updatedAt - a.updatedAt || b.position - a.position)[0];
  const claimed: MediaProgressV2 = winner.providerId === providerId
    ? winner
    : { ...winner, providerId };
  const candidateIds = new Set(candidates.map((entry) => entry.id));
  const next = [claimed, ...entries.filter((entry) => !candidateIds.has(entry.id))];
  const changed = candidates.length > 1 || winner.providerId === null;
  return { entry: claimed, entries: changed ? trimMediaProgressByScope(next) : [...entries], changed };
}
