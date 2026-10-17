import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  parseQuery,
  verifySession,
  WindowLimit,
  TmdbProxy,
  ProxyFailure,
} from "../../api-server/src/lib/tmdb/proxy";
import {
  createMovieProxyTransport,
  proxyOrigin,
} from "../lib/tmdbProxy/transport";
import { MovieInfoService } from "../lib/tmdb/movieInfoService";
import { TmdbRateLimit } from "../lib/tmdb/requestGate";
async function main() {
  let count = 0;
  async function test(name: string, run: () => unknown) {
    await run();
    count++;
    console.log(`ok ${name}`);
  }
  const key = "synthetic-session-signing-key-for-tests-only";
  const now = 1700000000000;
  const claims = {
    iss: "test-issuer",
    aud: "legendstream-tmdb",
    sub: "anonymous-test-account",
    app: "xplayer",
    iat: now / 1000,
    exp: now / 1000 + 300,
  };
  function sign(c: object, alg = "HS256") {
    const h = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString(
        "base64url",
      ),
      p = Buffer.from(JSON.stringify(c)).toString("base64url");
    return `${h}.${p}.${createHmac("sha256", key).update(`${h}.${p}`).digest("base64url")}`;
  }
  const session = sign(claims);
  await test("valid short lived session", () =>
    assert.equal(
      verifySession(`Bearer ${session}`, key, "test-issuer", now),
      "xplayer:anonymous-test-account",
    ));
  for (const [name, c] of Object.entries({
    expired: { ...claims, exp: now / 1000 },
    future: { ...claims, iat: now / 1000 + 1 },
    audience: { ...claims, aud: "other" },
    issuer: { ...claims, iss: "other" },
    app: { ...claims, app: "unknown" },
    lifetime: { ...claims, exp: now / 1000 + 301 },
    nbf: { ...claims, nbf: now / 1000 + 1 },
  }))
    await test(`reject ${name}`, () =>
      assert.throws(
        () => verifySession(`Bearer ${sign(c)}`, key, "test-issuer", now),
        /unauthorized/,
      ));
  await test("tamper and algorithm rejection", () => {
    assert.throws(() =>
      verifySession(`Bearer ${session}x`, key, "test-issuer", now),
    );
    assert.throws(() =>
      verifySession(`Bearer ${sign(claims, "none")}`, key, "test-issuer", now),
    );
  });
  await test("missing auth and weak server key", () => {
    assert.throws(() => verifySession(undefined, key, "test-issuer", now));
    assert.throws(() =>
      verifySession(`Bearer ${session}`, "weak", "test-issuer", now),
    );
  });
  await test("strict endpoint allowlist", () => {
    for (const body of [
      { op: "tv", id: 1 },
      { op: "detail", id: -1, locale: "tr-TR" },
      { op: "search", title: "Film", url: "https://example.org" },
      { op: "search", title: "https://example.org/password=x" },
      { op: "detail", id: 1, locale: "de-DE" },
    ])
      assert.throws(() => parseQuery(body));
  });
  await test("no provider fields accepted", () =>
    assert.throws(() =>
      parseQuery({ op: "search", title: "Film", providerId: "provider" }),
    ));
  await test("window bounded and expires", () => {
    let clock = now;
    const l = new WindowLimit(2, 1, () => clock);
    l.take("a");
    l.take("a");
    assert.throws(() => l.take("a"));
    assert.throws(() => l.take("b"));
    clock += 60001;
    l.take("b");
  });
  const movie = {
    id: 123,
    title: "Test Film",
    original_title: "Test Film",
    release_date: "2020-01-02",
    overview: "Türkçe açıklama",
    poster_path: "/poster.jpg",
    backdrop_path: "/back.jpg",
    genres: [{ id: 1, name: "Dram" }],
    runtime: 120,
    vote_average: 8,
    credits: {
      cast: [{ id: 2, name: "Oyuncu", character: "Rol" }],
      crew: [{ id: 3, name: "Yönetmen", job: "Director" }],
    },
    similar: { results: [{ id: 4 }] },
    secret: "must-not-be-projected",
  };
  const json = (
    v: unknown,
    status = 200,
    headers: Record<string, string> = {},
  ) =>
    new Response(JSON.stringify(v), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  let calls = 0;
  const seen: URL[] = [];
  const proxy = new TmdbProxy(
    () => "synthetic-upstream-credential",
    async (url, init) => {
      calls++;
      seen.push(new URL(String(url)));
      assert.equal(init?.redirect, "error");
      return json(
        String(url).includes("search/movie") ? { results: [movie] } : movie,
      );
    },
    () => now,
  );
  await test("single flight and metadata projection", async () => {
    const q = parseQuery({ op: "detail", id: 123, locale: "tr-TR" });
    const [a, b] = await Promise.all([proxy.execute(q), proxy.execute(q)]);
    assert.deepEqual(a, b);
    assert.equal(calls, 1);
    assert(!JSON.stringify(a).includes("must-not-be-projected"));
    assert.equal((a as any).directors[0].name, "Yönetmen");
  });
  await test("cache avoids another upstream call", async () => {
    await proxy.execute(parseQuery({ op: "detail", id: 123, locale: "tr-TR" }));
    assert.equal(calls, 1);
  });
  await test("fixed upstream and append credits", () => {
    assert.equal(seen[0]!.origin, "https://api.themoviedb.org");
    assert.equal(
      seen[0]!.searchParams.get("append_to_response"),
      "credits,similar",
    );
  });
  await test("missing upstream token stays closed", async () => {
    let fetched = false;
    const p = new TmdbProxy(
      () => undefined,
      async () => {
        fetched = true;
        return json(movie);
      },
    );
    await assert.rejects(
      p.execute({ op: "detail", id: 123, locale: "tr-TR" }),
      /not-configured/,
    );
    assert(!fetched);
  });
  await test("upstream mismatch rejected", async () => {
    const p = new TmdbProxy(
      () => "fixture",
      async () => json({ ...movie, id: 124 }),
    );
    await assert.rejects(
      p.execute({ op: "detail", id: 123, locale: "tr-TR" }),
      /invalid-upstream/,
    );
  });
  await test("429 creates cooldown across requests", async () => {
    let n = 0;
    const p = new TmdbProxy(
      () => "fixture",
      async () => {
        n++;
        return json({}, 429, { "retry-after": "9" });
      },
      () => now,
    );
    for (const id of [1, 2])
      await assert.rejects(
        p.execute({ op: "detail", id, locale: "tr-TR" }),
        (e: any) => e instanceof ProxyFailure && e.retryAfter === 9,
      );
    assert.equal(n, 1);
  });
  await test("upstream exception cannot leak credential", async () => {
    const p = new TmdbProxy(
      () => "fixture",
      async () => {
        throw new Error("private-provider-url-and-token");
      },
    );
    await assert.rejects(
      p.execute({ op: "detail", id: 1, locale: "tr-TR" }),
      (e: any) => e.message === "metadata-unavailable",
    );
  });
  await test("oversized upstream response rejected", async () => {
    const p = new TmdbProxy(
      () => "fixture",
      async () => json({ data: "x".repeat(1048577) }),
    );
    await assert.rejects(
      p.execute({ op: "detail", id: 1, locale: "tr-TR" }),
      /invalid-upstream/,
    );
  });
  for (const origin of [
    "http://api.example.org",
    "https://localhost",
    "https://127.0.0.1",
    "https://api.example.org/path",
    "https://user:pass@api.example.org",
  ])
    await test("reject unsafe origin", () =>
      assert.throws(() => proxyOrigin(origin)));
  await test("missing application session sends no request", async () => {
    let n = 0;
    const t = createMovieProxyTransport(
      { origin: "https://metadata.example.org", getSession: async () => null },
      async () => {
        n++;
        return json(movie);
      },
    );
    await assert.rejects(t.detail({ kind: "movie", id: 123 }, "tr-TR"));
    assert.equal(n, 0);
  });
  const bodies: any[] = [];
  const transport = createMovieProxyTransport(
    { origin: "https://metadata.example.org", getSession: async () => session },
    async (url, init) => {
      assert.equal(
        String(url),
        "https://metadata.example.org/api/tmdb/metadata",
      );
      verifySession(
        (init?.headers as any).Authorization,
        key,
        "test-issuer",
        now,
      );
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return json(await proxy.execute(parseQuery(body)));
    },
  );
  await test("mock end to end Film Info enriches without playback identity", async () => {
    const service = new MovieInfoService(transport);
    const input = {
      identity: {
        provider: "xtream" as const,
        providerId: "private-provider",
        kind: "movie" as const,
        catalogId: "provider-playback-987",
      },
      catalogRevision: "revision",
      title: "Test Film",
      year: 2020,
      providerTmdbId: 123,
    };
    const result = await service.enrich(input);
    assert.equal(result.status, "enriched");
    if (result.status === "enriched") {
      assert.equal(result.metadata.overview, "Türkçe açıklama");
      assert.equal(result.metadata.runtimeMinutes, 120);
    }
    const wire = JSON.stringify(bodies);
    assert(!wire.includes("private-provider"));
    assert(!wire.includes("provider-playback-987"));
    assert.equal(input.identity.catalogId, "provider-playback-987");
  });
  await test("client translates retry after", async () => {
    const t = createMovieProxyTransport(
      {
        origin: "https://metadata.example.org",
        getSession: async () => session,
      },
      async () => json({}, 429, { "retry-after": "5" }),
    );
    await assert.rejects(
      t.detail({ kind: "movie", id: 1 }, "tr-TR"),
      (e: any) => e instanceof TmdbRateLimit && e.retryAfterMs === 5000,
    );
  });
  console.log(
    `TMDB secure proxy scenarios: ${count}/${count} passed; LIVE_TMDB_NOT_TESTED`,
  );
}
main().catch(() => {
  console.error(
    "TMDB secure proxy scenarios failed (details intentionally redacted)",
  );
  process.exitCode = 1;
});
