import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  bindMetadata,
  bindingBelongsTo,
  TMDB_CACHE_TTL_MS,
  type EnrichmentInput,
  type TmdbCandidate,
  type TmdbMetadata,
} from "../lib/tmdb/contract";
import {
  matchTmdb,
  normalizeTmdbTitle as normalize,
} from "../lib/tmdb/matcher";
import {
  MemoryTmdbCache,
  freshRecord,
  matchCacheKey,
  matchCacheRecord,
  metadataCacheKey,
  metadataCacheRecord,
} from "../lib/tmdb/cache";
import { TmdbRequestGate, TmdbRateLimit } from "../lib/tmdb/requestGate";
import { TmdbFoundation } from "../lib/tmdb/foundation";
import { localizedMetadata, tmdbImageUrl } from "../lib/tmdb/metadata";
import {
  xtreamMovieInput,
  xtreamSeriesInput,
  m3uMovieInput,
  m3uSeriesInput,
  stalkerMovieInput,
  stalkerSeriesInput,
} from "../lib/tmdb/providerInput";

async function main() {
  let count = 0;
  async function test(name: string, run: () => unknown | Promise<unknown>) {
    await run();
    process.stdout.write(`ok TMDB ${++count} - ${name}\n`);
  }
  const input: EnrichmentInput = {
    identity: {
      provider: "xtream",
      providerId: "provider-a",
      kind: "movie",
      catalogId: "77",
    },
    catalogRevision: "r1",
    title: "Arrival (2016) [1080p HEVC TR]",
    year: 2016,
  };
  const candidate: TmdbCandidate = {
    id: 329865,
    kind: "movie",
    title: "Geliş",
    originalTitle: "Arrival",
    year: 2016,
    evidence: "search",
  };
  const rejected = (i: EnrichmentInput, c: TmdbCandidate[] = [candidate]) =>
    assert.equal(matchTmdb(i, c).status, "rejected");
  await test("technical suffixes and bracketed year cleaned", () =>
    assert.equal(normalize(input.title), "arrival"));
  await test("codec language version and extension suffixes", () =>
    assert.equal(
      normalize("Arrival WEB-DL x265 DUAL Extended.mkv"),
      "arrival",
    ));
  await test("Turkish dotted/dotless names", () =>
    assert.equal(normalize("IŞIK ÇIĞLIĞI"), normalize("ışık çığlığı")));
  for (const title of [
    "1917",
    "1984",
    "Blade Runner 2049",
    "Up",
    "It",
    "Dual",
    "TR",
    "Spider-Man 2",
  ])
    await test(`meaningful title and sequel retained ${title}`, () =>
      assert(
        normalize(title).length > 0 &&
          /\d/u.test(title) === /\d/u.test(normalize(title)),
      ));
  await test("localized and original title match with same year", () =>
    assert.equal(matchTmdb(input, [candidate]).status, "matched"));
  await test("wrong remake year rejected", () =>
    rejected({ ...input, year: 2015, title: "Arrival" }));
  await test("conflicting explicit and bracketed year rejected", () =>
    rejected({ ...input, year: 2015 }));
  await test("multiple bracketed years rejected", () =>
    rejected({ ...input, title: "Arrival (2015) (2016)" }));
  await test("unknown year search match rejected", () =>
    rejected({ ...input, title: "Arrival", year: undefined }));
  await test("wrong media type rejected", () =>
    rejected(input, [{ ...candidate, kind: "series" }]));
  await test("sequel number mismatch rejected", () =>
    rejected({ ...input, title: "Alien 2" }, [
      { ...candidate, title: "Alien", originalTitle: "Alien" },
    ]));
  await test("fuzzy title not silently accepted", () =>
    rejected({ ...input, title: "Arriva" }));
  await test("two exact same-year different IDs rejected", () =>
    assert.deepEqual(matchTmdb(input, [candidate, { ...candidate, id: 12 }]), {
      status: "rejected",
      reason: "ambiguous",
    }));
  await test("same ID duplicated in language results accepted", () =>
    assert.equal(matchTmdb(input, [candidate, candidate]).status, "matched"));
  await test("provider hint needs detail verification", () =>
    assert.deepEqual(
      matchTmdb({ ...input, providerTmdbId: candidate.id }, [candidate]),
      { status: "rejected", reason: "id-unverified" },
    ));
  await test("verified provider ID succeeds without substituting playback ID", () => {
    const i = { ...input, providerTmdbId: candidate.id };
    const match = matchTmdb(i, [{ ...candidate, evidence: "detail" }]);
    const bound = bindMetadata(i, match)!;
    assert.equal(bound.catalog.catalogId, "77");
    assert.equal(bound.tmdb.id, 329865);
  });
  await test("incorrect provider ID never falls through to title guess", () =>
    rejected({ ...input, providerTmdbId: 3 }, [
      { ...candidate, evidence: "detail" },
    ]));
  await test("verified wrong title rejected", () =>
    rejected({ ...input, providerTmdbId: candidate.id }, [
      {
        ...candidate,
        title: "Alien",
        originalTitle: "Alien",
        evidence: "detail",
      },
    ]));
  await test("verified wrong year rejected", () =>
    rejected({ ...input, providerTmdbId: candidate.id }, [
      { ...candidate, year: 2017, evidence: "detail" },
    ]));
  for (const bad of [0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1])
    await test(`invalid provider TMDB ID ${String(bad)}`, () =>
      rejected({ ...input, providerTmdbId: bad }));
  await test("empty identity rejected", () =>
    rejected({ ...input, identity: { ...input.identity, catalogId: "" } }));
  await test("URL or token shaped titles fail before outbound lookup", () =>
    rejected({ ...input, title: "https://host/path?token=private" }));
  await test("oversized input rejected", () =>
    rejected({ ...input, title: "a".repeat(513) }));
  await test("bracketed meaningful subtitle retained", () =>
    assert.equal(normalize("Alien (Resurrection)"), "alien resurrection"));
  const match = matchTmdb(input, [candidate]);
  const binding = bindMetadata(input, match)!;
  await test("binding cannot cross provider, family, kind or revision", () => {
    assert(bindingBelongsTo(binding, input.identity, "r1"));
    assert(
      !bindingBelongsTo(binding, { ...input.identity, providerId: "b" }, "r1"),
    );
    assert(
      !bindingBelongsTo(
        binding,
        { ...input.identity, provider: "stalker" },
        "r1",
      ),
    );
    assert(
      !bindingBelongsTo(binding, { ...input.identity, kind: "series" }, "r1"),
    );
    assert(!bindingBelongsTo(binding, input.identity, "r2"));
  });
  await test("rejected results do not bind", () =>
    assert.equal(
      bindMetadata(input, { status: "rejected", reason: "ambiguous" }),
      null,
    ));
  await test("cache keys isolate revision, source ID, family, year, hint and original title", () => {
    const key = matchCacheKey(input);
    for (const patch of [
      { catalogRevision: "r2" },
      { identity: { ...input.identity, providerId: "b" } },
      { identity: { ...input.identity, catalogId: "78" } },
      { identity: { ...input.identity, provider: "m3u" as const } },
      { year: 2015 },
      { providerTmdbId: 3 },
      { originalTitle: "other" },
    ])
      assert.notEqual(matchCacheKey({ ...input, ...patch }), key);
    assert.notEqual(
      metadataCacheKey({ id: 1, kind: "movie" }, "tr-TR"),
      metadataCacheKey({ id: 1, kind: "series" }, "tr-TR"),
    );
    assert.notEqual(
      metadataCacheKey({ id: 1, kind: "movie" }, "tr-TR"),
      metadataCacheKey({ id: 1, kind: "movie" }, "en-US"),
    );
  });
  await test("inferred year is part of cache fingerprint", () =>
    assert.notEqual(
      matchCacheKey({ ...input, year: undefined, title: "Arrival (2016)" }),
      matchCacheKey({ ...input, year: undefined, title: "Arrival (2017)" }),
    ));
  await test("invalid candidate year is rejected", () =>
    rejected({ ...input, providerTmdbId: candidate.id }, [
      { ...candidate, evidence: "detail", year: NaN },
    ]));
  await test("7-day TTL boundary and clock rollback", () => {
    const record = matchCacheRecord(match, 1000);
    assert(freshRecord(record, 1000 + TMDB_CACHE_TTL_MS - 1));
    assert.equal(freshRecord(record, 1000 + TMDB_CACHE_TTL_MS), null);
    assert.equal(freshRecord(record, 999), null);
  });
  await test("negative cache short TTL", () =>
    assert.equal(
      matchCacheRecord({ status: "rejected", reason: "ambiguous" }, 0)
        .expiresAt,
      6 * 60 * 60 * 1000,
    ));
  await test("bounded cache and mutation isolation", async () => {
    const cache = new MemoryTmdbCache(2);
    await cache.write("one", matchCacheRecord(match, 0));
    await cache.write("two", matchCacheRecord(match, 0));
    await cache.read("one");
    await cache.write("three", matchCacheRecord(match, 0));
    assert.equal(cache.size, 2);
    assert.equal(await cache.read("two"), null);
    const a = await cache.read<any>("one");
    assert(a);
    a.value.status = "corrupt";
    assert.equal((await cache.read<any>("one"))?.value.status, "matched");
  });
  const metadata: TmdbMetadata = {
    kind: "movie",
    id: 329865,
    locale: "tr-TR",
    title: "Geliş",
    genres: [],
    cast: [],
    directors: [],
    seasons: [],
    similar: [],
  };
  await test("Turkish fields preferred and English fallback provenance", () => {
    const result = localizedMetadata(metadata, {
      ...metadata,
      locale: "en-US",
      title: "Arrival",
      overview: "English synopsis",
      runtimeMinutes: 116,
    });
    assert.equal(result.title, "Geliş");
    assert.equal(result.overview, "English synopsis");
    assert.equal(result.fieldLocales?.overview, "en-US");
    assert.equal(result.runtimeMinutes, 116);
    assert.equal(result.year, undefined);
  });
  await test("cross-content fallback blocked", () =>
    assert.throws(() =>
      localizedMetadata(metadata, { ...metadata, id: 4, locale: "en-US" }),
    ));
  await test("metadata cache distinct from provider identity", () =>
    assert.equal(metadataCacheRecord(metadata, 0).value.id, 329865));
  await test("untrusted image hosts paths and querystrings rejected", () => {
    assert.equal(
      tmdbImageUrl("/good_123.jpg", "w780"),
      "https://image.tmdb.org/t/p/w780/good_123.jpg",
    );
    for (const p of [
      "https://evil/image.jpg",
      "//evil/image.jpg",
      "/../secret.jpg",
      "/image.jpg?api_key=secret",
    ])
      assert.equal(tmdbImageUrl(p, "w780"), null);
  });
  await test("all provider adapters project IDs and exclude playback secrets", () => {
    const xt = xtreamMovieInput(
      "a",
      "r",
      {
        stream_id: 77,
        name: "Arrival",
        release_date: "2016-01-01",
        direct_source: "secret-url",
      },
      { movie_data: { stream_id: 77 }, info: { tmdb_id: "329865" } },
    );
    const fixtures = [
      xt,
      xtreamSeriesInput("a", "r", { series_id: 77, name: "Arrival" }),
      m3uMovieInput("r", {
        id: "m3u:77",
        providerId: "a",
        name: "Arrival",
        streamUrl: "private-stream",
        category: "c",
        contentType: "movie",
      }),
      m3uSeriesInput("r", {
        id: "m3u:s",
        providerId: "a",
        name: "Series",
        category: "c",
        contentType: "series",
        seasons: {},
      }),
      stalkerMovieInput("a", "r", {
        portalId: "portal:77",
        title: "Arrival",
        cmd: "secret-cmd",
      }),
      stalkerSeriesInput("a", "r", { id: "series:77", title: "Series" }),
    ];
    assert.equal(xt.providerTmdbId, 329865);
    assert.equal(xt.identity.catalogId, "77");
    assert.equal(xt.year, 2016);
    for (const f of fixtures)
      assert(!/secret|streamUrl|direct_source|cmd/u.test(JSON.stringify(f)));
    assert.equal(
      xtreamMovieInput(
        "a",
        "r",
        { stream_id: 77, name: "X" },
        { movie_data: { stream_id: 78 }, info: { tmdb_id: 4 } },
      ).providerTmdbId,
      undefined,
    );
  });
  const tick = () => new Promise<void>((r) => setImmediate(r));
  await test("concurrency=2 bounded queue and duplicate coalescing", async () => {
    const gate = new TmdbRequestGate(() => 0, 2, 1);
    let running = 0,
      peak = 0,
      calls = 0;
    const release: (() => void)[] = [];
    const job = async () => {
      calls++;
      running++;
      peak = Math.max(peak, running);
      await new Promise<void>((r) => release.push(r));
      running--;
      return calls;
    };
    const a = gate.schedule("a", job),
      same = gate.schedule("a", job),
      b = gate.schedule("b", job),
      c = gate.schedule("c", job);
    assert.equal(a, same);
    await assert.rejects(gate.schedule("d", job), /QUEUE_FULL/u);
    await tick();
    assert.equal(calls, 2);
    release.splice(0).forEach((r) => r());
    await tick();
    release.splice(0).forEach((r) => r());
    await Promise.all([a, b, c]);
    assert.equal(peak, 2);
    assert.equal(calls, 3);
  });
  await test("429 honors retry delay, queued work stops, later retry succeeds", async () => {
    let time = 100;
    const gate = new TmdbRequestGate(() => time, 1, 3);
    let attempted = 0;
    const a = gate.schedule("a", async () => {
      throw new TmdbRateLimit(5000);
    });
    const b = gate.schedule("b", async () => {
      attempted++;
    });
    await assert.rejects(a, /RATE_LIMITED/u);
    await assert.rejects(b, /BACKOFF/u);
    assert.equal(attempted, 0);
    assert.equal(gate.retryAt, 5100);
    await assert.rejects(
      gate.schedule("c", async () => 1),
      /BACKOFF/u,
    );
    time = 5100;
    assert.equal(await gate.schedule("c", async () => 1), 1);
  });
  await test("429 without Retry-After uses exponential delay", async () => {
    let time = 0;
    const gate = new TmdbRequestGate(() => time);
    await assert.rejects(
      gate.schedule("a", async () => {
        throw new TmdbRateLimit();
      }),
    );
    assert.equal(gate.retryAt, 1000);
    time = 1000;
    await assert.rejects(
      gate.schedule("b", async () => {
        throw new TmdbRateLimit();
      }),
    );
    assert.equal(gate.retryAt, 3000);
  });
  await test("foundation uses cache, normalized minimal queries, no source authority", async () => {
    let time = 0,
      calls = 0;
    const cache = new MemoryTmdbCache();
    let query: unknown;
    const service = new TmdbFoundation(
      cache,
      new TmdbRequestGate(() => time),
      async (q) => {
        calls++;
        query = q;
        return [candidate];
      },
      () => time,
    );
    const [one, two] = await Promise.all([
      service.match(input),
      service.match(input),
    ]);
    assert.equal(one.status, "ready");
    assert.equal(two.status, "ready");
    assert.equal(calls, 1);
    assert.deepEqual(query, {
      kind: "movie",
      title: "arrival",
      originalTitle: undefined,
      year: 2016,
      providerTmdbId: undefined,
    });
    const cached = await service.match(input);
    assert(cached.status === "ready" && cached.cached);
    assert.equal(calls, 1);
    time = TMDB_CACHE_TTL_MS;
    await service.match(input);
    assert.equal(calls, 2);
    await service.match({ ...input, catalogRevision: "r2" });
    assert.equal(calls, 3);
  });
  await test("network exceptions do not expose secrets or become negative cache hits", async () => {
    let calls = 0;
    const service = new TmdbFoundation(
      new MemoryTmdbCache(),
      new TmdbRequestGate(),
      async () => {
        calls++;
        throw new Error("https://private?token=secret password=value");
      },
    );
    assert.deepEqual(await service.match(input), {
      status: "deferred",
      reason: "unavailable",
    });
    await service.match(input);
    assert.equal(calls, 2);
  });
  await test("cache failures degrade to safe enrichment", async () => {
    const service = new TmdbFoundation(
      {
        read: async () => {
          throw new Error("bad");
        },
        write: async () => {
          throw new Error("bad");
        },
      },
      new TmdbRequestGate(),
      async () => [candidate],
    );
    assert.equal((await service.match(input)).status, "ready");
  });
  await test("invalid input never starts lookup", async () => {
    let calls = 0;
    const service = new TmdbFoundation(
      new MemoryTmdbCache(),
      new TmdbRequestGate(),
      async () => {
        calls++;
        return [];
      },
    );
    await service.match({ ...input, title: "https://user:password@host" });
    assert.equal(calls, 0);
  });
  await test("service rate-limit response uses fixed safe category", async () => {
    const service = new TmdbFoundation(
      new MemoryTmdbCache(),
      new TmdbRequestGate(() => 0),
      async () => {
        throw new TmdbRateLimit(1000);
      },
      () => 0,
    );
    assert.deepEqual(await service.match(input), {
      status: "deferred",
      reason: "backoff",
      retryAt: 1000,
    });
  });
  await test("foundation modules cannot own UI player network or provider API", () => {
    for (const file of readdirSync(resolve(__dirname, "../lib/tmdb"))) {
      const source = readFileSync(
        resolve(__dirname, "../lib/tmdb", file),
        "utf8",
      );
      assert(
        !/\b(?:fetch|XMLHttpRequest|console\.(?:log|error|warn)|setInterval)\s*\(/u.test(
          source,
        ),
      );
      assert(
        !/from\s+["'][^"']*(?:react-native|PlayerContext|CompatibilityVideoPlayer|orientation|safeLog)/u.test(
          source,
        ),
      );
    }
  });
  process.stdout.write(`TMDB foundation scenarios: ${count}/${count} passed\n`);
}
void main().catch((error) => {
  process.stderr.write(String(error) + "\n");
  process.exitCode = 1;
});
