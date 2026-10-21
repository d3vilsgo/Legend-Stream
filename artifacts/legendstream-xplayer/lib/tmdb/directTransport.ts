import type {
  TmdbCandidate,
  TmdbIdentity,
  TmdbLocale,
  TmdbMetadata,
} from "./contract";
import type { MovieMetadataTransport } from "./movieInfoService";
import { TmdbRateLimit } from "./requestGate";
import { normalizeTmdbTitle } from "./matcher";

type Json = Record<string, any>;
const yearOf = (value?: string) =>
  value && /^(18|19|20)\d{2}/u.test(value)
    ? Number(value.slice(0, 4))
    : undefined;
const str = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const arr = (value: unknown): Json[] =>
  Array.isArray(value)
    ? value.filter((x): x is Json => !!x && typeof x === "object")
    : [];

/** Direct TMDB HTTPS API v3 transport. Bearer token is public client configuration and is extractable from APKs. */
export function createTmdbDirectTransport(
  token: string,
  request: typeof fetch = fetch,
  timeoutMs = 10000,
): MovieMetadataTransport {
  if (!token.trim()) throw new Error("tmdb-not-configured");
  async function get(path: string, locale: TmdbLocale): Promise<Json> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await request(
        `https://api.themoviedb.org/3${path}${path.includes("?") ? "&" : "?"}language=${encodeURIComponent(locale)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          signal: abort.signal,
          redirect: "error",
          credentials: "omit",
        },
      );
      if (response.status === 429) {
        const retry = response.headers.get("retry-after");
        throw new TmdbRateLimit(
          retry && /^\d+$/u.test(retry)
            ? Math.min(3600, Math.max(1, Number(retry))) * 1000
            : 60000,
        );
      }
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("application/json")
      )
        throw new Error("tmdb-unavailable");
      const body = await response.text();
      if (body.length > 2_000_000) throw new Error("tmdb-invalid-response");
      return JSON.parse(body) as Json;
    } catch (error) {
      if (error instanceof TmdbRateLimit) throw error;
      throw new Error("tmdb-unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
  const lookup: MovieMetadataTransport["lookup"] = async (query) => {
    const kind = query.kind === "movie" ? "movie" : "tv";
    const params = new URLSearchParams({
      query: query.title,
      include_adult: "false",
    });
    if (query.year)
      params.set(
        query.kind === "movie" ? "year" : "first_air_date_year",
        String(query.year),
      );
    const result = await get(`/search/${kind}?${params}`, "tr-TR");
    return arr(result.results)
      .slice(0, 100)
      .map((row) => ({
        kind: query.kind,
        id: Number(row.id),
        title: str(query.kind === "movie" ? row.title : row.name) ?? "",
        originalTitle: str(
          query.kind === "movie" ? row.original_title : row.original_name,
        ),
        year: yearOf(
          query.kind === "movie" ? row.release_date : row.first_air_date,
        ),
        evidence: "search" as const,
      }))
      .filter(
        (row) =>
          Number.isSafeInteger(row.id) &&
          row.id > 0 &&
          normalizeTmdbTitle(row.title),
      );
  };
  const detail: MovieMetadataTransport["detail"] = async (
    identity: TmdbIdentity,
    locale: TmdbLocale,
  ) => {
    const kind = identity.kind === "movie" ? "movie" : "tv";
    const raw = await get(
      `/${kind}/${identity.id}?append_to_response=credits,videos,similar`,
      locale,
    );
    const credits = raw.credits ?? {};
    const cast = arr(credits.cast)
      .slice(0, 100)
      .map((p) => ({
        id: Number(p.id),
        name: str(p.name) ?? "",
        character: str(p.character),
      }))
      .filter((p) => p.id > 0 && p.name);
    const directors = arr(credits.crew)
      .filter(
        (p) =>
          p.job === "Director" ||
          (p.job === "Executive Producer" && identity.kind === "series"),
      )
      .slice(0, 50)
      .map((p) => ({ id: Number(p.id), name: str(p.name) ?? "" }))
      .filter((p) => p.id > 0 && p.name);
    const similar = arr(raw.similar?.results)
      .slice(0, 100)
      .map((p) => ({ kind: identity.kind, id: Number(p.id) }))
      .filter((p) => p.id > 0);
    return {
      kind: identity.kind,
      id: identity.id,
      locale,
      title: str(identity.kind === "movie" ? raw.title : raw.name),
      originalTitle: str(
        identity.kind === "movie" ? raw.original_title : raw.original_name,
      ),
      overview: str(raw.overview),
      year: yearOf(
        identity.kind === "movie" ? raw.release_date : raw.first_air_date,
      ),
      posterPath: str(raw.poster_path),
      backdropPath: str(raw.backdrop_path),
      genres: arr(raw.genres)
        .map((g) => ({ id: Number(g.id), name: str(g.name) ?? "" }))
        .filter((g) => g.id > 0 && g.name),
      runtimeMinutes:
        Number(raw.runtime ?? raw.episode_run_time?.[0]) || undefined,
      voteAverage: Number.isFinite(Number(raw.vote_average))
        ? Number(raw.vote_average)
        : undefined,
      cast,
      directors,
      seasons: arr(raw.seasons)
        .map((s) => ({
          id: Number(s.id),
          number: Number(s.season_number),
          title: str(s.name),
          episodeCount: Number(s.episode_count) || undefined,
        }))
        .filter((s) => s.id > 0 && Number.isInteger(s.number)),
      similar,
      trailerUrl: arr(raw.videos?.results).find(
        (v) => v.site === "YouTube" && v.type === "Trailer",
      )?.key
        ? `https://www.youtube.com/watch?v=${arr(raw.videos.results).find((v) => v.site === "YouTube" && v.type === "Trailer")!.key}`
        : undefined,
    } as TmdbMetadata;
  };
  return { lookup, detail };
}

/** Fetches a selected season and its episodes directly from TMDB. Metadata only; never used for playback. */
export async function fetchTmdbSeason(
  token: string,
  seriesId: number,
  seasonNumber: number,
  locale: TmdbLocale,
  request: typeof fetch = fetch,
  timeoutMs = 10000,
): Promise<
  Readonly<{
    season: number;
    episodes: readonly Readonly<{
      id: number;
      number: number;
      title: string;
      overview?: string;
      airDate?: string;
      stillPath?: string;
    }>[];
  }>
> {
  if (
    !token.trim() ||
    !Number.isSafeInteger(seriesId) ||
    seriesId < 1 ||
    !Number.isSafeInteger(seasonNumber) ||
    seasonNumber < 0
  )
    throw new Error("invalid-tmdb-season");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await request(
      `https://api.themoviedb.org/3/tv/${seriesId}/season/${seasonNumber}?language=${encodeURIComponent(locale)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: abort.signal,
        redirect: "error",
        credentials: "omit",
      },
    );
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("application/json")
    )
      throw new Error("tmdb-unavailable");
    const json = (await response.json()) as Json;
    return {
      season: seasonNumber,
      episodes: arr(json.episodes)
        .slice(0, 500)
        .map((e) => ({
          id: Number(e.id),
          number: Number(e.episode_number),
          title: str(e.name) ?? "",
          overview: str(e.overview),
          airDate: str(e.air_date),
          stillPath: str(e.still_path),
        }))
        .filter((e) => e.id > 0 && Number.isInteger(e.number) && !!e.title),
    };
  } catch {
    throw new Error("tmdb-unavailable");
  } finally {
    clearTimeout(timer);
  }
}
