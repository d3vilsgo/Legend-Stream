import {
  bindMetadata,
  type EnrichmentInput,
  type MatchResult,
  type MetadataBinding,
  type TmdbCandidate,
} from "./contract";
import {
  freshRecord,
  matchCacheKey,
  matchCacheRecord,
  type TmdbCacheStore,
} from "./cache";
import { inferredYear, normalizeTmdbTitle, matchTmdb } from "./matcher";
import { TmdbRequestGate, TmdbGateError, TmdbRateLimit } from "./requestGate";
/** An injected future API/proxy adapter. Receives NO provider identity, URL, credentials or playback ref. */
export type CandidateLookup = (
  query: Readonly<{
    kind: "movie" | "series";
    title: string;
    originalTitle?: string;
    year?: number;
    providerTmdbId?: number;
  }>,
) => Promise<readonly TmdbCandidate[]>;
export type EnrichmentOutcome =
  | Readonly<{
      status: "ready";
      match: MatchResult;
      binding: MetadataBinding | null;
      cached: boolean;
    }>
  | Readonly<{
      status: "deferred";
      reason: "unavailable" | "busy" | "backoff";
      retryAt?: number;
    }>;
export class TmdbFoundation {
  constructor(
    private readonly cache: TmdbCacheStore,
    private readonly gate: TmdbRequestGate,
    private readonly lookup: CandidateLookup,
    private readonly now: () => number = Date.now,
  ) {}
  async match(input: EnrichmentInput): Promise<EnrichmentOutcome> {
    const preflight = matchTmdb(input, []);
    if (
      preflight.status === "rejected" &&
      ["invalid-input", "year-conflict"].includes(preflight.reason)
    )
      return {
        status: "ready",
        match: preflight,
        binding: null,
        cached: false,
      };
    const key = matchCacheKey(input);
    try {
      const cached = freshRecord(
        await this.cache.read<MatchResult>(key),
        this.now(),
      );
      if (
        cached &&
        (cached.status === "rejected" ||
          (cached.status === "matched" &&
            cached.tmdb.kind === input.identity.kind &&
            Number.isSafeInteger(cached.tmdb.id) &&
            cached.tmdb.id > 0 &&
            (cached.method === "provider-id" ||
              cached.method === "title-year")))
      )
        return {
          status: "ready",
          match: cached,
          binding: bindMetadata(input, cached),
          cached: true,
        };
    } catch {
      /* Cache failure never blocks IPTV or prevents a bounded lookup. */
    }
    try {
      const result = await this.gate.schedule(key, async () => {
        const candidates = await this.lookup({
          kind: input.identity.kind,
          title: normalizeTmdbTitle(input.title),
          originalTitle: input.originalTitle
            ? normalizeTmdbTitle(input.originalTitle)
            : undefined,
          year: input.year ?? inferredYear(input.title),
          providerTmdbId: input.providerTmdbId,
        });
        const match = matchTmdb(input, candidates);
        try {
          await this.cache.write(key, matchCacheRecord(match, this.now()));
        } catch {
          /* Optional metadata cache. */
        }
        return match;
      });
      return {
        status: "ready",
        match: result,
        binding: bindMetadata(input, result),
        cached: false,
      };
    } catch (error) {
      // Raw network errors may include tokens; expose only fixed safe categories.
      if (
        error instanceof TmdbRateLimit ||
        (error instanceof TmdbGateError && error.reason === "backoff")
      )
        return {
          status: "deferred",
          reason: "backoff",
          retryAt: this.gate.retryAt,
        };
      return {
        status: "deferred",
        reason: error instanceof TmdbGateError ? "busy" : "unavailable",
      };
    }
  }
}
