import {
  createTmdbDirectTransport,
  fetchTmdbSeason,
} from "../lib/tmdb/directTransport";
import { matchTmdb } from "../lib/tmdb/matcher";

const token = process.env.TMDB_API_TOKEN;
if (!token) throw new Error("TMDB_API_TOKEN secret is unavailable");
const transport = createTmdbDirectTransport(token);
const cases = [
  { kind: "movie" as const, title: "Babam ve Oğlum", year: 2005 },
  { kind: "series" as const, title: "Şahsiyet", year: 2018 },
];
async function main() {
  for (const test of cases) {
    const candidates = await transport.lookup({
      kind: test.kind,
      title: test.title,
      year: test.year,
    });
    const input = {
      identity: {
        providerId: "live-acceptance",
        provider: "xtream" as const,
        kind: test.kind,
        catalogId: test.title,
      },
      catalogRevision: "live-acceptance-v1",
      title: test.title,
      year: test.year,
    };
    const match = matchTmdb(input, candidates);
    if (match.status !== "matched")
      throw new Error(`TMDB ${test.kind} title/year match failed`);
    const metadata = await transport.detail(match.tmdb, "tr-TR");
    if (
      !metadata.title ||
      !metadata.overview ||
      metadata.year !== test.year ||
      metadata.kind !== test.kind
    )
      throw new Error(`TMDB ${test.kind} Turkish metadata failed`);
    if (
      !metadata.posterPath ||
      !metadata.backdropPath ||
      !metadata.genres.length ||
      !metadata.cast.length
    )
      throw new Error(`TMDB ${test.kind} metadata fields missing`);
    if (test.kind === "series") {
      if (!metadata.seasons.length)
        throw new Error("TMDB series season metadata missing");
      const regularSeason = metadata.seasons.find(
        (season) => season.number > 0,
      );
      if (!regularSeason) throw new Error("TMDB series has no regular season");
      const episodes = await fetchTmdbSeason(
        token,
        match.tmdb.id,
        regularSeason.number,
        "tr-TR",
      );
      if (!episodes.episodes.length)
        throw new Error("TMDB live season episodes missing");
    }
    console.log(
      `TMDB_LIVE_PASS kind=${test.kind} id=${match.tmdb.id} year=${metadata.year} locale=tr-TR title=present overview=present`,
    );
  }
}
void main().catch(() => {
  console.error("TMDB live acceptance failed");
  process.exitCode = 1;
});
