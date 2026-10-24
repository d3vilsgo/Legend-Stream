import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateTmdbProxy,
  tmdbAccessDecision,
} from "../lib/tmdb/accessPolicy";
import {
  MovieInfoService,
  beginMovieEnrichment,
  type MovieMetadataTransport,
} from "../lib/tmdb/movieInfoService";
import {
  currentMovie,
  localXtreamMovie,
  localStalkerMovie,
  movieInfoPresentation,
  pagedMovieInput,
} from "../lib/tmdb/movieInfoModel";
import { MemoryTmdbCache } from "../lib/tmdb/cache";
import { TmdbRateLimit, TmdbRequestGate } from "../lib/tmdb/requestGate";
import {
  TMDB_CACHE_TTL_MS,
  type EnrichmentInput,
  type TmdbMetadata,
} from "../lib/tmdb/contract";
async function main() {
  let count = 0;
  const test = async (name: string, fn: () => unknown | Promise<unknown>) => {
    await fn();
    process.stdout.write(`ok Film Info ${++count} - ${name}\n`);
  };
  const input: EnrichmentInput = {
    identity: {
      providerId: "a",
      provider: "xtream",
      kind: "movie",
      catalogId: "77",
    },
    catalogRevision: "r1",
    title: "Arrival",
    year: 2016,
  };
  const detail: TmdbMetadata = {
    id: 329865,
    kind: "movie",
    locale: "tr-TR",
    title: "Geliş",
    overview: "Türkçe özet",
    year: 2016,
    posterPath: "/poster.jpg",
    backdropPath: "/backdrop.jpg",
    genres: [{ id: 1, name: "Bilimkurgu" }],
    runtimeMinutes: 116,
    voteAverage: 7.6,
    cast: [{ id: 2, name: "Oyuncu" }],
    directors: [{ id: 3, name: "Yönetmen" }],
    seasons: [],
    similar: [{ id: 4, kind: "movie" }],
  };
  const transport: MovieMetadataTransport = {
    lookup: async () => [
      {
        id: detail.id,
        kind: "movie",
        title: "Geliş",
        originalTitle: "Arrival",
        year: 2016,
        evidence: "search",
      },
    ],
    detail: async (_, locale) => ({ ...detail, locale }),
  };
  await test("same-token server policy has no mobile credential", () => {
    assert.equal(
      tmdbAccessDecision.tokenPolicy,
      "reuse-existing-gen2-token-on-server",
    );
    assert.equal(tmdbAccessDecision.clientTokenAllowed, false);
    assert.equal(tmdbAccessDecision.directTmdbAllowed, false);
  });
  await test("unconfigured access cannot imply live connectivity", () =>
    assert.equal(
      evaluateTmdbProxy({ authenticatedSessionAvailable: false }),
      "not-configured",
    ));
  for (const origin of [
    "http://proxy.example",
    "https://user:secret@proxy.example",
    "https://proxy.example?token=secret",
    "https://localhost",
    "https://proxy.example/private",
  ])
    await test(`unsafe origin denied ${origin.split(":")[0]}`, () =>
      assert.equal(
        evaluateTmdbProxy({ origin, authenticatedSessionAvailable: true }),
        "invalid-origin",
      ));
  await test("CORS or HTTPS alone does not grant authentication", () =>
    assert.equal(
      evaluateTmdbProxy({
        origin: "https://proxy.example",
        authenticatedSessionAvailable: false,
      }),
      "authentication-required",
    ));
  await test("authenticated origin still requires a real adapter", () =>
    assert.equal(
      evaluateTmdbProxy({
        origin: "https://proxy.example",
        authenticatedSessionAvailable: true,
      }),
      "adapter-required",
    ));
  await test("production default does no lookup", async () =>
    assert.deepEqual(await new MovieInfoService().enrich(input), {
      status: "not-configured",
    }));
  await test("local provider information is immediately usable", () => {
    const local = localXtreamMovie({
      stream_id: 77,
      name: "Arrival",
      plot: "Yerel özet",
      stream_icon: "provider-poster",
      genre: "Drama",
      cast: "Yerel oyuncu",
      rating: "8",
    });
    const view = movieInfoPresentation(local, input);
    assert.equal(view.title, "Arrival");
    assert.equal(view.overview, "Yerel özet");
    assert.equal(view.poster, "provider-poster");
    assert.equal(view.rating, undefined);
    assert.equal(view.enriched, false);
  });
  await test("Stalker local metadata survives without TMDB", () =>
    assert.equal(
      localStalkerMovie({
        portalId: "77",
        cmd: "private-command",
        title: "Film",
        description: "Açıklama",
      }).overview,
      "Açıklama",
    ));
  await test("M3U paged identity remains M3U rather than Xtream", () => {
    const item = {
      stream_id: "m3u:77",
      name: "Film",
      direct_source: "private-url",
    };
    const info = pagedMovieInput("a", "m3u", "r", item);
    assert.equal(info.identity.provider, "m3u");
    assert.equal(info.identity.catalogId, "m3u:77");
    assert(!JSON.stringify(info).includes("private-url"));
  });
  await test("provider-local fields take precedence; TMDB only fills absent fields", () => {
    const local = {
      title: "Portal title",
      poster: "local.jpg",
      overview: "Portal plot",
      genre: "Portal genre",
      cast: "Portal cast",
      director: "Portal director",
      year: 2015,
    };
    const view = movieInfoPresentation(local, input, detail);
    for (const key of [
      "title",
      "poster",
      "overview",
      "genre",
      "cast",
      "director",
      "year",
    ] as const)
      assert.equal(view[key], local[key]);
    const fallback = movieInfoPresentation(
      { title: " ", overview: " " },
      { ...input, year: undefined },
      detail,
    );
    assert.equal(fallback.title, "Geliş");
    assert.equal(fallback.overview, "Türkçe özet");
    assert.equal(fallback.genre, "Bilimkurgu");
    assert.equal(fallback.year, 2016);
    assert.equal(fallback.ratingSource, "TMDB");
  });
  await test("new presentation cannot manufacture playback fields", () => {
    const view = movieInfoPresentation({ title: "Arrival" }, input, detail);
    assert.equal(view.title, "Arrival");
    assert.equal(view.runtime, 116);
    assert.equal(view.ratingSource, "TMDB");
    assert.equal(view.cast, "Oyuncu");
    for (const key of ["stream_id", "url", "streamUrl", "cmd", "isPlayable"])
      assert(!(key in view));
  });
  await test("missing artwork or synopsis falls back to local data", () => {
    const view = movieInfoPresentation(
      { title: "Film", poster: "local.jpg", overview: "Yerel" },
      input,
      { ...detail, posterPath: undefined, overview: undefined },
    );
    assert.equal(view.poster, "local.jpg");
    assert.equal(view.overview, "Yerel");
  });
  await test("similar TMDB identities are not playable movies", () =>
    assert.equal(
      movieInfoPresentation({ title: "Film" }, input, detail).similarCount,
      1,
    ));
  await test("current provider row revalidated before existing play callback", () => {
    const original = { id: "77", value: "old" },
      updated = { id: "77", value: "new" };
    assert.equal(
      currentMovie([updated], original.id, (item) => item.id),
      updated,
    );
    assert.equal(
      currentMovie<typeof original>([], original.id, (item) => item.id),
      null,
    );
  });
  await test("matched detail is retrieved with exact TMDB identity", async () => {
    let requested: unknown;
    const service = new MovieInfoService({
      ...transport,
      detail: async (id, locale) => {
        requested = { id, locale };
        return { ...detail, locale };
      },
    });
    const result = await service.enrich(input);
    assert.equal(result.status, "enriched");
    assert.deepEqual(requested, {
      id: { id: 329865, kind: "movie" },
      locale: "tr-TR",
    });
  });
  await test("missing Turkish overview uses English field fallback", async () => {
    const locales: string[] = [];
    const service = new MovieInfoService({
      ...transport,
      detail: async (_, locale) => {
        locales.push(locale);
        return {
          ...detail,
          locale,
          overview: locale === "tr-TR" ? "" : "English synopsis",
        };
      },
    });
    const result = await service.enrich(input);
    assert(result.status === "enriched");
    assert.equal(result.metadata.title, "Geliş");
    assert.equal(result.metadata.overview, "English synopsis");
    assert.equal(result.metadata.fieldLocales?.overview, "en-US");
    assert.deepEqual(locales, ["tr-TR", "en-US"]);
  });
  await test("English failure preserves Turkish/local data", async () => {
    const service = new MovieInfoService({
      ...transport,
      detail: async (_, locale) => {
        if (locale === "en-US") throw new Error("failed");
        return { ...detail, overview: "" };
      },
    });
    assert.equal((await service.enrich(input)).status, "enriched");
  });
  await test("invalid remote rating is rejected before rendering", async () =>
    assert.deepEqual(
      await new MovieInfoService({
        ...transport,
        detail: async () => ({ ...detail, voteAverage: NaN }),
      }).enrich(input),
      { status: "unavailable" },
    ));
  await test("malformed remote cast is rejected", async () =>
    assert.deepEqual(
      await new MovieInfoService({
        ...transport,
        detail: async () => ({ ...detail, cast: [{ id: 0, name: "Invalid" }] }),
      }).enrich(input),
      { status: "unavailable" },
    ));
  await test("wrong detail ID is rejected", async () =>
    assert.deepEqual(
      await new MovieInfoService({
        ...transport,
        detail: async () => ({ ...detail, id: 4 }),
      }).enrich(input),
      { status: "unavailable" },
    ));
  await test("wrong detail media kind is rejected", async () =>
    assert.deepEqual(
      await new MovieInfoService({
        ...transport,
        detail: async () => ({ ...detail, kind: "series" }),
      }).enrich(input),
      { status: "unavailable" },
    ));
  await test("wrong detail locale is rejected", async () =>
    assert.deepEqual(
      await new MovieInfoService({
        ...transport,
        detail: async () => ({ ...detail, locale: "en-US" }),
      }).enrich(input),
      { status: "unavailable" },
    ));
  await test("contradictory detail release year is rejected", async () =>
    assert.deepEqual(
      await new MovieInfoService({
        ...transport,
        detail: async () => ({ ...detail, year: 2017 }),
      }).enrich(input),
      { status: "unmatched" },
    ));
  await test("series requests do not enter movie transport", async () =>
    assert.deepEqual(
      await new MovieInfoService(transport).enrich({
        ...input,
        identity: { ...input.identity, kind: "series" },
      }),
      { status: "unmatched" },
    ));
  await test("no trusted match means no detail request", async () => {
    let calls = 0;
    const service = new MovieInfoService({
      lookup: async () => [],
      detail: async () => {
        calls++;
        return detail;
      },
    });
    assert.deepEqual(await service.enrich(input), { status: "unmatched" });
    assert.equal(calls, 0);
  });
  await test("metadata cache avoids repeated detail calls and expires at 7 days", async () => {
    let time = 0,
      calls = 0;
    const service = new MovieInfoService(
      {
        ...transport,
        detail: async () => {
          calls++;
          return detail;
        },
      },
      new MemoryTmdbCache(),
      new TmdbRequestGate(() => time),
      () => time,
    );
    await service.enrich(input);
    await service.enrich(input);
    assert.equal(calls, 1);
    time = TMDB_CACHE_TTL_MS;
    await service.enrich(input);
    assert.equal(calls, 2);
  });
  await test("simultaneous detail requests coalesce", async () => {
    let calls = 0;
    const service = new MovieInfoService({
      ...transport,
      detail: async () => {
        calls++;
        await Promise.resolve();
        return detail;
      },
    });
    await Promise.all([service.enrich(input), service.enrich(input)]);
    assert.equal(calls, 1);
  });
  await test("429 and raw error tokens never reach presentation", async () => {
    const service = new MovieInfoService({
      ...transport,
      detail: async () => {
        throw new TmdbRateLimit(1000);
      },
    });
    assert.deepEqual(await service.enrich(input), { status: "unavailable" });
    const failed = new MovieInfoService({
      ...transport,
      detail: async () => {
        throw new Error("Authorization Bearer private-token");
      },
    });
    assert.deepEqual(await failed.enrich(input), { status: "unavailable" });
  });
  await test("closing info suppresses delayed metadata commit", async () => {
    let release: ((m: TmdbMetadata) => void) | undefined;
    const service = new MovieInfoService({
      ...transport,
      detail: () =>
        new Promise((r) => {
          release = r;
        }),
    });
    let applied = 0;
    const stop = beginMovieEnrichment(service, input, () => applied++);
    await new Promise<void>((r) => setImmediate(r));
    assert(release);
    stop();
    release(detail);
    await new Promise<void>((r) => setImmediate(r));
    assert.equal(applied, 0);
  });
  await test("switching provider suppresses the old result", async () => {
    let applied = 0;
    const stop = beginMovieEnrichment(
      new MovieInfoService(transport),
      input,
      () => applied++,
    );
    stop();
    await new Promise<void>((r) => setImmediate(r));
    assert.equal(applied, 0);
  });
  await test("new service/config files contain no HTTP or secret extraction", () => {
    for (const name of [
      "accessPolicy.ts",
      "movieInfoService.ts",
      "movieInfoModel.ts",
    ]) {
      const text = readFileSync(
        resolve(__dirname, "../lib/tmdb", name),
        "utf8",
      );
      assert(
        !/\bfetch\s*\(|process\.env|EXPO_PUBLIC_|Bearer\s+|TMDB_API_TOKEN/u.test(
          text,
        ),
      );
    }
  });
  process.stdout.write(
    `TMDB Movie Info mock scenarios: ${count}/${count} passed; LIVE_TMDB_NOT_TESTED\n`,
  );
}
const timeout = setTimeout(() => {
  process.stderr.write("Film Info tests timed out\n");
  process.exit(1);
}, 15000);
void main().then(
  () => clearTimeout(timeout),
  (error) => {
    clearTimeout(timeout);
    process.stderr.write(String(error) + "\n");
    process.exitCode = 1;
  },
);
