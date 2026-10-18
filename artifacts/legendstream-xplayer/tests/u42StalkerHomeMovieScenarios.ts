import assert from "node:assert/strict";
import {
  createStalkerHomeMovieController,
  findStalkerHomeMovie,
  type HomeMovieState,
  type HomeMoviePlayable,
} from "../lib/stalkerHomeMovie";
import {
  parseStalkerHomeSummary,
  writeStalkerMovieHomePreview,
} from "../lib/stalkerHomeSummary";
import {
  isRegisteredStalkerPortalSession,
  getOrCreateStalkerPortalSession,
  releaseStalkerPortalSession,
  subscribeStalkerPortalRuntime,
} from "../lib/stalkerPortalRuntime";
import { stalkerMovieInput } from "../lib/tmdb/providerInput";
import {
  localStalkerMovie,
  movieInfoPresentation,
} from "../lib/tmdb/movieInfoModel";
import type { StalkerPortalSession } from "../lib/stalkerPortal";

let count = 0;
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  await fn();
  console.log(`ok U4.2 ${++count} - ${name}`);
}
const preview = {
  id: "movie:2",
  title: "Same title",
  image: "https://images.invalid/p.jpg",
  lookupCategoryId: "all:vod",
  lookupPage: 1,
};
const rows = () => [
  { id: "movie:1", name: "Same title", cmd: "wrong-cmd" },
  {
    id: "movie:2",
    name: "Same title",
    cmd: "fresh-session-cmd",
    category_id: "7",
    description: "Current description",
  },
];
function fixture() {
  const calls: Record<string, unknown>[] = [];
  const states: (HomeMovieState | null)[] = [];
  const played: HomeMoviePlayable[] = [];
  let current = true,
    fail = false,
    hold: ((p: Record<string, unknown>) => Promise<unknown>) | null = null,
    starts = 0;
  const session = {
    request: async (p: Record<string, unknown>, signal?: AbortSignal) => {
      calls.push(p);
      if (hold) return hold(p);
      if (fail)
        throw new Error("https://user:password@portal.invalid?token=secret");
      if (p.action === "get_categories")
        return [{ id: "all:vod", title: "All" }];
      if (p.action === "get_ordered_list")
        return {
          data: rows(),
          cur_page: 1,
          total_items: 1000000,
          max_page_items: 20,
        };
      if (p.action === "create_link")
        return { cmd: "ffmpeg https://play.invalid/current" };
      throw new Error("unexpected request");
    },
  };
  const controller = createStalkerHomeMovieController({
    preview,
    session: session as any,
    isCurrent: () => current,
    onState: (s) => states.push(s),
    onPlayable: (p) => played.push(p),
    onPlaybackStart: () => {
      starts++;
    },
  });
  return {
    controller,
    calls,
    states,
    played,
    session,
    get starts() {
      return starts;
    },
    set current(v: boolean) {
      current = v;
    },
    set fail(v: boolean) {
      fail = v;
    },
    set hold(v: typeof hold) {
      hold = v;
    },
  };
}
async function main() {
  await test("Info open is local and starts no network or playback", () => {
    const h = fixture();
    h.controller.open();
    assert.equal(h.states.at(-1)?.preview.id, preview.id);
    assert.equal(h.calls.length, 0);
    assert.equal(h.starts, 0);
  });
  await test("same-title films are resolved strictly by opaque portal id", async () => {
    const h = fixture();
    await h.controller.play();
    assert.equal(h.played[0]?.itemId, "movie:2");
    assert.equal(h.played[0]?.categoryId, "7");
    assert.equal(
      h.calls.find((p) => p.action === "create_link")?.cmd,
      "fresh-session-cmd",
    );
    assert.equal(
      h.calls.filter((p) => p.action === "get_ordered_list").length,
      1,
    );
    assert.equal(h.calls[0]?.category, "all:vod");
  });
  await test("double Play shares one attempt and a consumed modal cannot replay", async () => {
    const h = fixture();
    await Promise.all([h.controller.play(), h.controller.play()]);
    await h.controller.play();
    assert.equal(h.starts, 1);
    assert.equal(h.played.length, 1);
    assert.equal(h.calls.filter((p) => p.action === "create_link").length, 1);
  });
  await test("provider/session change during lookup blocks create_link and handoff", async () => {
    const h = fixture();
    let done!: (x: unknown) => void;
    h.hold = () =>
      new Promise((r) => {
        done = r;
      });
    const pending = h.controller.play();
    h.current = false;
    done({ data: rows() });
    await pending;
    assert.equal(h.calls.length, 1);
    assert.equal(h.played.length, 0);
  });
  await test("close aborts request and ignores a transport that returns anyway", async () => {
    const h = fixture();
    let done!: (x: unknown) => void;
    let signal: AbortSignal | undefined;
    const session = {
      request: async (_p: unknown, s?: AbortSignal) => {
        signal = s;
        return new Promise((r) => {
          done = r;
        });
      },
    };
    let handed = 0;
    const c = createStalkerHomeMovieController({
      preview,
      session: session as any,
      isCurrent: () => true,
      onState: () => {},
      onPlayable: () => {
        handed++;
      },
      onPlaybackStart: () => {},
    });
    const pending = c.play();
    c.cancel();
    assert.equal(signal?.aborted, true);
    done({ data: rows() });
    await pending;
    await c.play();
    assert.equal(handed, 0);
  });
  await test("session changes after create_link cannot start Player", async () => {
    const h = fixture();
    let done!: (x: unknown) => void;
    h.hold = async (p) => {
      if (p.action === "get_ordered_list") return { data: rows() };
      return new Promise((r) => {
        done = r;
      });
    };
    const pending = h.controller.play();
    while (!done) await Promise.resolve();
    h.current = false;
    done({ cmd: "https://play.invalid/old-session" });
    await pending;
    assert.equal(h.played.length, 0);
  });
  await test("missing film never scans more pages or starts another movie", async () => {
    const h = fixture();
    h.hold = async () => ({
      data: [rows()[0]],
      total_items: 999999,
      max_page_items: 1,
      cur_page: 1,
    });
    await h.controller.play();
    assert.equal(h.calls.length, 1);
    assert.equal(h.played.length, 0);
    assert.match(h.states.at(-1)?.error ?? "", /kaldırılmış/);
  });
  await test("failure provides safe actionable error and retry uses fresh command", async () => {
    const h = fixture();
    h.fail = true;
    await h.controller.play();
    assert.doesNotMatch(h.states.at(-1)?.error ?? "", /password|secret|https:/);
    assert.match(h.states.at(-1)?.error ?? "", /Tekrar/);
    h.fail = false;
    await h.controller.play();
    assert.equal(h.played.length, 1);
    assert.equal(h.starts, 2);
  });
  await test("legacy summary uses only initial category page, not a title search", async () => {
    const h = fixture();
    const { item } = await findStalkerHomeMovie(
      h.session as any,
      { id: preview.id, title: "Same title" },
      new AbortController().signal,
      () => true,
    );
    assert.equal(item.portalId, preview.id);
    assert.deepEqual(
      h.calls.map((p) => p.action),
      ["get_categories", "get_ordered_list"],
    );
  });
  await test("no category fails safely without list or playback request", async () => {
    const h = fixture();
    h.hold = async () => [];
    await assert.rejects(
      findStalkerHomeMovie(
        h.session as any,
        { id: "m", title: "Missing" },
        new AbortController().signal,
        () => true,
      ),
    );
    assert.deepEqual(
      h.calls.map((p) => p.action),
      ["get_categories"],
    );
  });
  await test("cancelled legacy lookup does not issue a page request", async () => {
    const h = fixture();
    const abort = new AbortController();
    h.hold = async () => {
      abort.abort();
      return [{ id: "all:vod", title: "All" }];
    };
    await assert.rejects(
      findStalkerHomeMovie(
        h.session as any,
        { id: "m", title: "Missing" },
        abort.signal,
        () => true,
      ),
    );
    assert.equal(h.calls.length, 1);
  });
  await test("old v1 summary remains readable; new locator has no command/URL", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: async (k: string) => values.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        values.set(k, v);
      },
    };
    const s = await writeStalkerMovieHomePreview(
      "p",
      [{ portalId: preview.id, title: preview.title, cmd: "secret-cmd" }],
      storage,
      { categoryId: "all:vod", page: 1 },
    );
    const raw = [...values.values()][0]!;
    assert.doesNotMatch(raw, /secret-cmd|cmd|token|mac/);
    assert.equal(
      parseStalkerHomeSummary(raw, "p").movies[0]?.lookupCategoryId,
      "all:vod",
    );
    assert.equal(s.movies[0]?.lookupPage, 1);
    const legacy = JSON.stringify({
      schemaVersion: 1,
      providerId: "p",
      movies: [{ id: "m", title: "Legacy" }],
      series: [],
    });
    assert.equal(parseStalkerHomeSummary(legacy, "p").movies[0]?.id, "m");
    assert.deepEqual(parseStalkerHomeSummary(raw, "other").movies, []);
  });
  await test("local Stalker Film Info has no dependency on TMDB success", () => {
    const input = stalkerMovieInput("p", "scope", {
      portalId: preview.id,
      title: preview.title,
      year: "2025",
    });
    const local = localStalkerMovie({
      portalId: preview.id,
      title: preview.title,
      cmd: "",
      description: "Provider plot",
    });
    const view = movieInfoPresentation(local, input);
    assert.equal(view.title, preview.title);
    assert.equal(view.overview, "Provider plot");
    assert.equal(view.enriched, false);
    assert.equal(input.identity.catalogId, preview.id);
    assert.equal(input.identity.provider, "stalker");
  });
  await test("runtime ownership read never recreates a released session", () => {
    const events: string[] = [];
    const pop = subscribeStalkerPortalRuntime((id) => events.push(id));
    const opts = {
      providerId: "u42-test",
      portalUrl: "https://portal.invalid/c/",
      mac: "00:11:22:33:44:55",
    };
    const first = getOrCreateStalkerPortalSession(opts);
    assert(isRegisteredStalkerPortalSession(opts.providerId, first));
    const second = getOrCreateStalkerPortalSession({
      ...opts,
      mac: "00:11:22:33:44:66",
    });
    assert(!isRegisteredStalkerPortalSession(opts.providerId, first));
    assert(isRegisteredStalkerPortalSession(opts.providerId, second));
    assert(releaseStalkerPortalSession(opts.providerId));
    assert(!isRegisteredStalkerPortalSession(opts.providerId, second));
    assert.equal(releaseStalkerPortalSession(opts.providerId), false);
    assert.equal(events.length, 3);
    pop();
  });
  console.log(
    `U4.2 Stalker Home movie: ${count}/${count} passed; SERVICE_MOCK_NOT_PHYSICAL`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
