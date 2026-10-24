import { TmdbFoundation, type CandidateLookup } from "./foundation";
import {
  MemoryTmdbCache,
  freshRecord,
  metadataCacheKey,
  metadataCacheRecord,
  type TmdbCacheStore,
} from "./cache";
import { TmdbRequestGate } from "./requestGate";
import {
  bindingBelongsTo,
  type EnrichmentInput,
  type TmdbIdentity,
  type TmdbLocale,
  type TmdbMetadata,
} from "./contract";
import { localizedMetadata } from "./metadata";
import { inferredYear } from "./matcher";
export interface MovieMetadataTransport {
  lookup: CandidateLookup;
  detail: (identity: TmdbIdentity, locale: TmdbLocale) => Promise<TmdbMetadata>;
}
export type MovieEnrichment =
  | Readonly<{ status: "enriched"; metadata: TmdbMetadata }>
  | Readonly<{ status: "not-configured" | "unavailable" | "unmatched" }>;
/** Optional, token-free injection point. Production stays disabled until a controlled proxy adapter exists. */
export class MovieInfoService {
  private readonly foundation: TmdbFoundation | null;
  constructor(
    private readonly transport?: MovieMetadataTransport,
    private readonly cache: TmdbCacheStore = new MemoryTmdbCache(),
    private readonly gate = new TmdbRequestGate(),
    private readonly now: () => number = Date.now,
  ) {
    this.foundation = transport
      ? new TmdbFoundation(cache, gate, transport.lookup, now)
      : null;
  }
  async enrich(input: EnrichmentInput): Promise<MovieEnrichment> {
    if (!this.foundation || !this.transport)
      return { status: "not-configured" };
    try {
      const matched = await this.foundation.match(input);
      if (matched.status !== "ready") return { status: "unavailable" };
      if (
        !matched.binding ||
        !bindingBelongsTo(
          matched.binding,
          input.identity,
          input.catalogRevision,
        )
      )
        return { status: "unmatched" };
      const identity = matched.binding.tmdb;
      const detail = await this.readDetail(identity, "tr-TR");
      const expectedYear = input.year ?? inferredYear(input.title);
      if (
        expectedYear !== undefined &&
        detail.year !== undefined &&
        detail.year !== expectedYear
      )
        return { status: "unmatched" };
      let english: TmdbMetadata | undefined;
      if (!detail.title?.trim() || !detail.overview?.trim()) {
        try {
          english = await this.readDetail(identity, "en-US");
        } catch {
          /* Turkish/local data remains usable. */
        }
      }
      if (
        english?.year !== undefined &&
        expectedYear !== undefined &&
        english.year !== expectedYear
      )
        english = undefined;
      return {
        status: "enriched",
        metadata: localizedMetadata(detail, english),
      };
    } catch {
      return { status: "unavailable" };
    }
  }
  private async readDetail(
    identity: TmdbIdentity,
    locale: TmdbLocale,
  ): Promise<TmdbMetadata> {
    const key = metadataCacheKey(identity, locale);
    const valid = (m: TmdbMetadata) => {
      const id = (value: unknown) =>
        typeof value === "number" && Number.isSafeInteger(value) && value > 0;
      const text = (value: unknown) =>
        value === undefined ||
        (typeof value === "string" && value.length <= 20000);
      const named = (
        list: readonly { id: number; name: string }[],
        limit: number,
      ) =>
        Array.isArray(list) &&
        list.length <= limit &&
        list.every(
          (p) =>
            p && id(p.id) && typeof p.name === "string" && p.name.length <= 512,
        );
      return (
        !!m &&
        m.id === identity.id &&
        m.kind === identity.kind &&
        m.locale === locale &&
        text(m.title) &&
        text(m.originalTitle) &&
        text(m.overview) &&
        (m.year === undefined ||
          (Number.isInteger(m.year) && m.year >= 1888 && m.year <= 2100)) &&
        (m.runtimeMinutes === undefined ||
          (Number.isFinite(m.runtimeMinutes) &&
            m.runtimeMinutes > 0 &&
            m.runtimeMinutes < 10000)) &&
        (m.voteAverage === undefined ||
          (Number.isFinite(m.voteAverage) &&
            m.voteAverage >= 0 &&
            m.voteAverage <= 10)) &&
        named(m.genres, 50) &&
        named(m.cast, 100) &&
        named(m.directors, 50) &&
        Array.isArray(m.seasons) &&
        m.seasons.length <= 200 &&
        Array.isArray(m.similar) &&
        m.similar.length <= 100 &&
        m.similar.every(
          (p) => p && id(p.id) && (p.kind === "movie" || p.kind === "series"),
        )
      );
    };
    try {
      const cached = freshRecord(
        await this.cache.read<TmdbMetadata>(key),
        this.now(),
      );
      if (cached && valid(cached)) return cached;
    } catch {
      /* Cache is optional. */
    }
    return this.gate.schedule(key, async () => {
      const detail = await this.transport!.detail({ ...identity }, locale);
      if (!valid(detail)) throw new Error("TMDB_DETAIL_IDENTITY_MISMATCH");
      try {
        await this.cache.write(key, metadataCacheRecord(detail, this.now()));
      } catch {
        /* Optional cache. */
      }
      return detail;
    });
  }
}
export const unconfiguredMovieInfoService = new MovieInfoService();
/** Suppress late results when a detail closes or a different provider/item replaces it. */
export function beginMovieEnrichment(
  service: MovieInfoService,
  input: EnrichmentInput,
  apply: (result: MovieEnrichment) => void,
): () => void {
  let active = true;
  void service.enrich(input).then(
    (result) => {
      if (active) apply(result);
    },
    () => {
      if (active) apply({ status: "unavailable" });
    },
  );
  return () => {
    active = false;
  };
}
