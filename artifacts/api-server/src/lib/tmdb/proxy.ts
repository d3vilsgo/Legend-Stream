import { createHmac, timingSafeEqual } from "node:crypto";

export class ProxyFailure extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfter = 0,
  ) {
    super(code);
  }
}
export type ProxyQuery =
  | { op: "search"; title: string; year?: number }
  | { op: "detail"; id: number; locale: "tr-TR" | "en-US" };
export function parseQuery(value: unknown): ProxyQuery {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProxyFailure(400, "invalid-request");
  const v = value as Record<string, unknown>;
  if (
    v.op === "search" &&
    Object.keys(v).every((k) => ["op", "title", "year"].includes(k)) &&
    typeof v.title === "string" &&
    v.title.trim().length > 0 &&
    v.title.length <= 300 &&
    !/https?:|[\r\n]|(?:token|password|username)=/i.test(v.title) &&
    (v.year === undefined ||
      (Number.isInteger(v.year) &&
        Number(v.year) >= 1880 &&
        Number(v.year) <= 2200))
  )
    return {
      op: "search",
      title: v.title.trim(),
      ...(v.year === undefined ? {} : { year: v.year as number }),
    };
  if (
    v.op === "detail" &&
    Object.keys(v).every((k) => ["op", "id", "locale"].includes(k)) &&
    Number.isSafeInteger(v.id) &&
    Number(v.id) > 0 &&
    (v.locale === "tr-TR" || v.locale === "en-US")
  )
    return { op: "detail", id: v.id as number, locale: v.locale };
  throw new ProxyFailure(400, "invalid-request");
}
/** Server-issued HS256 session, never a static secret embedded in an app. No mint endpoint. */
export function verifySession(
  header: string | undefined,
  key: string,
  issuer: string,
  now = Date.now(),
  minimumIssuedAt = 0,
): string {
  try {
    if (
      Buffer.byteLength(key) < 32 ||
      !issuer ||
      !header?.startsWith("Bearer ") ||
      header.length > 4096
    )
      throw 0;
    const parts = header.slice(7).split(".");
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p)))
      throw 0;
    const [h, p, s] = parts;
    const meta = JSON.parse(Buffer.from(h!, "base64url").toString());
    if (meta.alg !== "HS256" || meta.typ !== "JWT") throw 0;
    const actual = Buffer.from(s!, "base64url");
    const expected = createHmac("sha256", key).update(`${h}.${p}`).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw 0;
    const c = JSON.parse(Buffer.from(p!, "base64url").toString());
    const sec = Math.floor(now / 1000);
    if (
      c.iss !== issuer ||
      c.aud !== "legendstream-tmdb" ||
      !["gen2", "xplayer"].includes(c.app) ||
      typeof c.sub !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(c.sub) ||
      !Number.isInteger(c.iat) ||
      !Number.isInteger(c.exp) ||
      c.iat > sec ||
      c.iat < minimumIssuedAt ||
      c.exp <= sec ||
      c.exp <= c.iat ||
      c.exp - c.iat > 300 ||
      (c.nbf !== undefined && (!Number.isInteger(c.nbf) || c.nbf > sec))
    )
      throw 0;
    return `${c.app}:${c.sub}`;
  } catch {
    throw new ProxyFailure(401, "unauthorized");
  }
}
export class WindowLimit {
  private buckets = new Map<string, { count: number; until: number }>();
  constructor(
    private max: number,
    private capacity = 2048,
    private now = Date.now,
  ) {}
  take(key: string) {
    const now = this.now();
    for (const [k, b] of this.buckets)
      if (b.until <= now) this.buckets.delete(k);
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.capacity)
        throw new ProxyFailure(429, "rate-limited", 60);
      b = { count: 0, until: now + 60000 };
      this.buckets.set(key, b);
    }
    if (++b.count > this.max)
      throw new ProxyFailure(
        429,
        "rate-limited",
        Math.ceil((b.until - now) / 1000),
      );
  }
}
const object = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, any>)
    : {};
const text = (v: unknown, max = 20000) =>
  typeof v === "string" && v.length <= max ? v : undefined;
const id = (v: unknown) =>
  Number.isSafeInteger(v) && Number(v) > 0 ? Number(v) : undefined;
const list = (v: unknown, max: number) =>
  Array.isArray(v) ? v.slice(0, max).map(object) : [];
const year = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? Number(v.slice(0, 4))
    : undefined;
const image = (v: unknown) =>
  typeof v === "string" && /^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(v)
    ? v
    : undefined;
function candidate(v: unknown, evidence: "search" | "detail") {
  const m = object(v);
  if (!id(m.id) || !text(m.title, 1000))
    throw new ProxyFailure(502, "invalid-upstream");
  return {
    kind: "movie" as const,
    id: m.id as number,
    title: m.title as string,
    originalTitle: text(m.original_title, 1000),
    year: year(m.release_date),
    evidence,
  };
}
export function projectDetail(
  raw: unknown,
  q: Extract<ProxyQuery, { op: "detail" }>,
) {
  const m = object(raw);
  if (m.id !== q.id) throw new ProxyFailure(502, "invalid-upstream");
  const named = (v: unknown, max: number) =>
    list(v, max)
      .filter((x) => id(x.id) && text(x.name, 1000))
      .map((x) => ({ id: x.id as number, name: x.name as string }));
  return {
    ...candidate(m, "detail"),
    locale: q.locale,
    overview: text(m.overview),
    posterPath: image(m.poster_path),
    backdropPath: image(m.backdrop_path),
    genres: named(m.genres, 50),
    runtimeMinutes:
      Number.isFinite(m.runtime) && m.runtime > 0 && m.runtime < 2000
        ? m.runtime
        : undefined,
    voteAverage:
      Number.isFinite(m.vote_average) &&
      m.vote_average >= 0 &&
      m.vote_average <= 10
        ? m.vote_average
        : undefined,
    cast: list(object(m.credits).cast, 40)
      .filter((x) => id(x.id) && text(x.name, 1000))
      .map((x) => ({
        id: x.id as number,
        name: x.name as string,
        character: text(x.character, 1000),
      })),
    directors: named(
      list(object(m.credits).crew, 300).filter((x) => x.job === "Director"),
      20,
    ),
    seasons: [],
    similar: list(object(m.similar).results, 20)
      .filter((x) => id(x.id))
      .map((x) => ({ kind: "movie" as const, id: x.id as number })),
  };
}
/** One process: bounded cache/single-flight/global cooldown. Multi-replica requires shared controls. */
export class TmdbProxy {
  private cache = new Map<string, { until: number; value: unknown }>();
  private pending = new Map<string, Promise<unknown>>();
  private retryAt = 0;
  private global: WindowLimit;
  constructor(
    private token: () => string | undefined,
    private request: typeof fetch = fetch,
    private now = Date.now,
    private timeoutMs = 8000,
  ) {
    this.global = new WindowLimit(120, 1, now);
  }
  async execute(q: ProxyQuery): Promise<unknown> {
    const key = JSON.stringify(q),
      now = this.now();
    const cached = this.cache.get(key);
    if (cached && cached.until > now) return cached.value;
    if (this.retryAt > now)
      throw new ProxyFailure(
        429,
        "upstream-backoff",
        Math.ceil((this.retryAt - now) / 1000),
      );
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= 4) throw new ProxyFailure(503, "busy", 1);
    this.global.take("upstream");
    const task = this.load(q)
      .then((value) => {
        if (this.cache.size >= 512)
          this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, {
          value,
          until: this.now() + (q.op === "detail" ? 7 * 86400000 : 21600000),
        });
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
  private async load(q: ProxyQuery): Promise<unknown> {
    const token = this.token();
    if (!token || /\s/.test(token))
      throw new ProxyFailure(503, "not-configured");
    const u = new URL(
      q.op === "search"
        ? "https://api.themoviedb.org/3/search/movie"
        : `https://api.themoviedb.org/3/movie/${q.id}`,
    );
    u.searchParams.set("language", q.op === "detail" ? q.locale : "tr-TR");
    if (q.op === "search") {
      u.searchParams.set("query", q.title);
      u.searchParams.set("include_adult", "false");
      if (q.year) u.searchParams.set("primary_release_year", String(q.year));
    } else u.searchParams.set("append_to_response", "credits,similar");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const r = await this.request(u, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        redirect: "error",
        signal: controller.signal,
      });
      if (r.status === 429) {
        const h = r.headers.get("retry-after");
        const seconds =
          h && /^\d+$/.test(h)
            ? Math.min(3600, Math.max(1, Number(h)))
            : h && Number.isFinite(Date.parse(h))
              ? Math.min(
                  3600,
                  Math.max(1, Math.ceil((Date.parse(h) - this.now()) / 1000)),
                )
              : 60;
        this.retryAt = this.now() + seconds * 1000;
        throw new ProxyFailure(429, "upstream-backoff", seconds);
      }
      if (!r.ok)
        throw new ProxyFailure(
          r.status === 404 ? 404 : 502,
          "metadata-unavailable",
        );
      if (!r.headers.get("content-type")?.includes("application/json"))
        throw new ProxyFailure(502, "invalid-upstream");
      const reader = r.body?.getReader();
      if (!reader) throw new ProxyFailure(502, "invalid-upstream");
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 1048576) {
            await reader.cancel();
            throw new ProxyFailure(502, "invalid-upstream");
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (q.op === "detail") return projectDetail(data, q);
      const results = object(data).results;
      if (!Array.isArray(results) || results.length > 100)
        throw new ProxyFailure(502, "invalid-upstream");
      return results.map((v) => candidate(v, "search"));
    } catch (e) {
      if (e instanceof ProxyFailure) throw e;
      throw new ProxyFailure(502, "metadata-unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
}
