import {
  MATCHER_VERSION,
  TMDB_CACHE_TTL_MS,
  type EnrichmentInput,
  type MatchResult,
  type TmdbIdentity,
  type TmdbLocale,
  type TmdbMetadata,
} from "./contract";
import { inferredYear, normalizeTmdbTitle } from "./matcher";
export type CacheRecord<T> = Readonly<{
  value: T;
  writtenAt: number;
  expiresAt: number;
}>;
/** Storage seam for a later separate SQLite database; no production DB migration in this PR. */
export interface TmdbCacheStore {
  read<T>(key: string): Promise<CacheRecord<T> | null>;
  write<T>(key: string, record: CacheRecord<T>): Promise<void>;
}
export function matchCacheKey(input: EnrichmentInput): string {
  return JSON.stringify([
    "tmdb-match",
    MATCHER_VERSION,
    input.identity.provider,
    input.identity.providerId,
    input.identity.kind,
    input.identity.catalogId,
    input.catalogRevision,
    normalizeTmdbTitle(input.title),
    normalizeTmdbTitle(input.originalTitle ?? ""),
    input.year ?? inferredYear(input.title) ?? null,
    input.providerTmdbId ?? null,
  ]);
}
export function metadataCacheKey(id: TmdbIdentity, locale: TmdbLocale): string {
  return JSON.stringify(["tmdb-metadata", 1, id.kind, id.id, locale]);
}
export class MemoryTmdbCache implements TmdbCacheStore {
  private readonly entries = new Map<string, CacheRecord<unknown>>();
  constructor(private readonly capacity = 256) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error("INVALID_CACHE_CAPACITY");
  }
  async read<T>(key: string): Promise<CacheRecord<T> | null> {
    const record = this.entries.get(key);
    if (!record) return null;
    this.entries.delete(key);
    this.entries.set(key, record);
    return JSON.parse(JSON.stringify(record)) as CacheRecord<T>;
  }
  async write<T>(key: string, record: CacheRecord<T>): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, JSON.parse(JSON.stringify(record)));
    while (this.entries.size > this.capacity)
      this.entries.delete(this.entries.keys().next().value!);
  }
  get size(): number {
    return this.entries.size;
  }
}
/** An expired or future-dated entry never grants availability or a fresh match. */
export function freshRecord<T>(
  record: CacheRecord<T> | null,
  now: number,
): T | null {
  return record &&
    Number.isFinite(record.writtenAt) &&
    Number.isFinite(record.expiresAt) &&
    record.writtenAt <= now &&
    record.expiresAt > now &&
    record.expiresAt > record.writtenAt &&
    record.expiresAt - record.writtenAt <= TMDB_CACHE_TTL_MS
    ? record.value
    : null;
}
export function matchCacheRecord(
  result: MatchResult,
  now: number,
): CacheRecord<MatchResult> {
  const ttl =
    result.status === "matched" ? TMDB_CACHE_TTL_MS : 6 * 60 * 60 * 1000;
  return { value: result, writtenAt: now, expiresAt: now + ttl };
}
export function metadataCacheRecord(
  metadata: TmdbMetadata,
  now: number,
): CacheRecord<TmdbMetadata> {
  return {
    value: metadata,
    writtenAt: now,
    expiresAt: now + TMDB_CACHE_TTL_MS,
  };
}
