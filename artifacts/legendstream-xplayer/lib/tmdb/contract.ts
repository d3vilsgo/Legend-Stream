/** Metadata-only contracts. Never accept a TMDB identity as a playback request. */
export type MediaKind = "movie" | "series";
export type TmdbLocale = "tr-TR" | "en-US";
export type ProviderFamily = "xtream" | "m3u" | "stalker";
export type CatalogIdentity = Readonly<{
  providerId: string;
  provider: ProviderFamily;
  kind: MediaKind;
  catalogId: string;
}>;
export type ProviderEpisodeIdentity = Readonly<{
  catalog: CatalogIdentity & { kind: "series" };
  seasonId: string;
  episodeId: string;
}>;
export type EnrichmentInput = Readonly<{
  identity: CatalogIdentity;
  catalogRevision: string;
  title: string;
  originalTitle?: string;
  year?: number;
  /** Hint only: must be checked against a detail response of the correct media kind. */
  providerTmdbId?: number;
}>;
export type TmdbIdentity = Readonly<{ kind: MediaKind; id: number }>;
export type TmdbCandidate = TmdbIdentity &
  Readonly<{
    title: string;
    originalTitle?: string;
    year?: number;
    /** Only the transport detail adapter may mark an ID response as verified. */
    evidence: "search" | "detail";
  }>;
export type TmdbMetadata = TmdbIdentity &
  Readonly<{
    locale: TmdbLocale;
    title?: string;
    originalTitle?: string;
    overview?: string;
    year?: number;
    posterPath?: string;
    backdropPath?: string;
    genres: readonly { id: number; name: string }[];
    runtimeMinutes?: number;
    voteAverage?: number;
    cast: readonly { id: number; name: string; character?: string }[];
    directors: readonly { id: number; name: string }[];
    seasons: readonly {
      id: number;
      number: number;
      title?: string;
      episodeCount?: number;
    }[];
    similar: readonly TmdbIdentity[];
    trailerUrl?: string;
    /** Field provenance, including field-level fallback. Unknown fields stay absent. */
    fieldLocales?: Readonly<Partial<Record<"title" | "overview", TmdbLocale>>>;
  }>;
export type MatchResult =
  | Readonly<{
      status: "matched";
      tmdb: TmdbIdentity;
      method: "provider-id" | "title-year";
      confidence: number;
    }>
  | Readonly<{
      status: "rejected";
      reason:
        | "invalid-input"
        | "year-conflict"
        | "no-strong-match"
        | "ambiguous"
        | "id-unverified";
    }>;
export type MetadataBinding = Readonly<{
  catalog: CatalogIdentity;
  catalogRevision: string;
  tmdb: TmdbIdentity;
}>;
export const MATCHER_VERSION = 1;
export const TMDB_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A separate provider lookup + existing playback resolver must establish availability at action time. */
export function bindMetadata(
  input: EnrichmentInput,
  match: MatchResult,
): MetadataBinding | null {
  if (
    match.status !== "matched" ||
    match.tmdb.kind !== input.identity.kind ||
    !Number.isSafeInteger(match.tmdb.id) ||
    match.tmdb.id <= 0
  )
    return null;
  return {
    catalog: { ...input.identity },
    catalogRevision: input.catalogRevision,
    tmdb: { ...match.tmdb },
  };
}
export function sameCatalogIdentity(
  left: CatalogIdentity,
  right: CatalogIdentity,
): boolean {
  return (
    left.providerId === right.providerId &&
    left.provider === right.provider &&
    left.kind === right.kind &&
    left.catalogId === right.catalogId
  );
}
/** Catalog presence is not a playable episode or resolved URL. No network or session operation here. */
export function bindingBelongsTo(
  binding: MetadataBinding,
  identity: CatalogIdentity,
  revision: string,
): boolean {
  return (
    sameCatalogIdentity(binding.catalog, identity) &&
    binding.catalogRevision === revision &&
    binding.tmdb.kind === identity.kind
  );
}
