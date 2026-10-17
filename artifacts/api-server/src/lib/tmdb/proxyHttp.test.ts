import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import express from "express";
import { createTmdbRouter } from "../../routes/tmdb";
import { TmdbProxy, verifySession } from "./proxy";

async function main() {
  let count = 0;
  async function test(name: string, run: () => unknown) {
    await run();
    count++;
    console.log(`ok proxy HTTP ${count} - ${name}`);
  }
  const now = 1700000000000,
    key = "synthetic-session-signing-key-for-http-tests";
  const claims = {
    iss: "fixture-issuer",
    aud: "legendstream-tmdb",
    app: "xplayer",
    sub: "fixture-account",
    iat: now / 1000,
    exp: now / 1000 + 300,
  };
  function sign(c: object) {
    const h = Buffer.from(
        JSON.stringify({ alg: "HS256", typ: "JWT" }),
      ).toString("base64url"),
      p = Buffer.from(JSON.stringify(c)).toString("base64url");
    return `${h}.${p}.${createHmac("sha256", key).update(`${h}.${p}`).digest("base64url")}`;
  }
  const session = sign(claims);
  const json = (
    v: unknown,
    status = 200,
    headers: Record<string, string> = {},
  ) =>
    new Response(JSON.stringify(v), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  let upstream = 0,
    configured = true;
  const proxy = new TmdbProxy(
    () => "synthetic-upstream-fixture",
    async () => {
      upstream++;
      return json({ id: 1, title: "Film", release_date: "2020-01-01" });
    },
    () => now,
  );
  const app = express();
  app.use(
    "/api/tmdb",
    createTmdbRouter(
      () =>
        configured
          ? {
              upstreamToken: "synthetic-upstream-fixture",
              sessionKey: key,
              issuer: "fixture-issuer",
            }
          : {},
      proxy,
      () => now,
    ),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}/api/tmdb/metadata`;
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${session}`,
  };
  const body = JSON.stringify({ op: "detail", id: 1, locale: "tr-TR" });
  try {
    await test("POST with valid application session projects metadata", async () => {
      const r = await fetch(origin, { method: "POST", headers, body });
      assert.equal(r.status, 200);
      assert.equal(((await r.json()) as { kind?: string }).kind, "movie");
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.equal(upstream, 1);
    });
    await test("anonymous request is rejected before upstream", async () => {
      const r = await fetch(origin, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      assert.equal(r.status, 401);
      assert.equal(upstream, 1);
    });
    await test("expired application session denied", async () => {
      const r = await fetch(origin, {
        method: "POST",
        headers: {
          ...headers,
          authorization: `Bearer ${sign({ ...claims, exp: now / 1000 })}`,
        },
        body,
      });
      assert.equal(r.status, 401);
    });
    await test("other method never proxies", async () => {
      const r = await fetch(origin);
      assert.equal(r.status, 405);
      assert.equal(r.headers.get("allow"), "POST");
      assert.equal(upstream, 1);
    });
    await test("invalid JSON is safe JSON not parser body fragment", async () => {
      const r = await fetch(origin, {
        method: "POST",
        headers,
        body: '{"private-fixture-password":secret}',
      });
      assert.equal(r.status, 400);
      assert.deepEqual(await r.json(), { error: "invalid-json" });
    });
    await test("2 KB request bound", async () => {
      const r = await fetch(origin, {
        method: "POST",
        headers,
        body: JSON.stringify({ op: "search", title: "x".repeat(3000) }),
      });
      assert.equal(r.status, 413);
      assert.deepEqual(await r.json(), { error: "request-too-large" });
    });
    await test("non JSON denied", async () => {
      const r = await fetch(origin, {
        method: "POST",
        headers: { ...headers, "content-type": "text/plain" },
        body,
      });
      assert.equal(r.status, 415);
    });
    await test("unlisted URL field denied before network", async () => {
      const r = await fetch(origin, {
        method: "POST",
        headers,
        body: JSON.stringify({
          op: "detail",
          id: 1,
          locale: "tr-TR",
          url: "https://private-fixture.invalid",
        }),
      });
      assert.equal(r.status, 400);
      assert.equal(upstream, 1);
    });
    await test("missing server config is fail closed", async () => {
      configured = false;
      const r = await fetch(origin, { method: "POST", headers, body });
      configured = true;
      assert.equal(r.status, 503);
      assert.equal(upstream, 1);
    });
    await test("per principal limit includes cache hits", async () => {
      let last: Response | undefined;
      for (let i = 0; i < 61; i++)
        last = await fetch(origin, { method: "POST", headers, body });
      assert.equal(last?.status, 429);
      assert(Number(last?.headers.get("retry-after")) > 0);
      assert.equal(upstream, 1);
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
  await test("administrative minimum issue time invalidates older session", () =>
    assert.throws(
      () =>
        verifySession(
          `Bearer ${session}`,
          key,
          "fixture-issuer",
          now,
          claims.iat + 1,
        ),
      /unauthorized/,
    ));
  await test("same central upstream is not a shared app principal", () =>
    assert.notEqual(
      verifySession(`Bearer ${session}`, key, "fixture-issuer", now),
      verifySession(
        `Bearer ${sign({ ...claims, app: "gen2" })}`,
        key,
        "fixture-issuer",
        now,
      ),
    ));
  await test("server timeout cancels upstream and does not cache failure", async () => {
    let aborted = 0;
    const slow = new TmdbProxy(
      () => "fixture",
      async (_u, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborted++;
              reject(new Error("private-fixture-error"));
            },
            { once: true },
          );
        }),
      () => now,
      5,
    );
    for (let i = 0; i < 2; i++)
      await assert.rejects(
        slow.execute({ op: "detail", id: 1, locale: "tr-TR" }),
        /metadata-unavailable/,
      );
    assert.equal(aborted, 2);
  });
  await test("cache TTL hit miss and no negative error caching", async () => {
    let clock = now,
      calls = 0;
    const p = new TmdbProxy(
      () => "fixture",
      async () => {
        calls++;
        return json({ id: 1, title: "Film" });
      },
      () => clock,
    );
    const q = { op: "detail" as const, id: 1, locale: "tr-TR" as const };
    await p.execute(q);
    await p.execute(q);
    assert.equal(calls, 1);
    clock += 7 * 86400000;
    await p.execute(q);
    assert.equal(calls, 2);
  });
  await test("HTTP date retry after and cooldown expire", async () => {
    let clock = now,
      calls = 0;
    const p = new TmdbProxy(
      () => "fixture",
      async () => {
        calls++;
        return calls === 1
          ? json({}, 429, {
              "retry-after": new Date(now + 10000).toUTCString(),
            })
          : json({ id: 1, title: "Film" });
      },
      () => clock,
    );
    const q = { op: "detail" as const, id: 1, locale: "tr-TR" as const };
    await assert.rejects(p.execute(q), (e: any) => e.retryAfter === 10);
    clock += 10000;
    await p.execute(q);
    assert.equal(calls, 2);
  });
  console.log(
    `TMDB proxy HTTP scenarios: ${count}/${count} passed; LOOPBACK_MOCK_UPSTREAM_ONLY`,
  );
}
main().catch(() => {
  console.error("TMDB proxy HTTP scenarios failed (details redacted)");
  process.exitCode = 1;
});
