import type { TmdbCandidate, TmdbMetadata } from "../tmdb/contract";
import type { MovieMetadataTransport } from "../tmdb/movieInfoService";
import { TmdbRateLimit } from "../tmdb/requestGate";
export type ProxyAccess = Readonly<{
  origin: string;
  /** Trusted login/session integration supplies a short-lived app session. Never a TMDB token. */
  getSession: () => Promise<string | null>;
}>;
export function proxyOrigin(value: string): string {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    u.port ||
    u.hostname === "localhost" ||
    !u.hostname.includes(".") ||
    /^[\d.:\[\]]+$/.test(u.hostname) ||
    u.hostname.endsWith(".local")
  )
    throw new Error("invalid-proxy-origin");
  return u.origin;
}
export function createMovieProxyTransport(
  access: ProxyAccess,
  request: typeof fetch = fetch,
): MovieMetadataTransport {
  const origin = proxyOrigin(access.origin);
  async function send(body: object): Promise<unknown> {
    const session = await access.getSession();
    if (
      !session ||
      session.length > 4096 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(session)
    )
      throw new Error("application-session-required");
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10000);
    try {
      const r = await request(`${origin}/api/tmdb/metadata`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session}`,
        },
        body: JSON.stringify(body),
        signal: abort.signal,
        redirect: "error",
        credentials: "omit",
      });
      if (r.status === 429) {
        const h = r.headers.get("retry-after");
        throw new TmdbRateLimit(
          h && /^\d+$/.test(h)
            ? Math.min(3600, Math.max(1, Number(h))) * 1000
            : 60000,
        );
      }
      if (!r.ok || !r.headers.get("content-type")?.includes("application/json"))
        throw new Error("proxy-unavailable");
      const raw = await r.text();
      if (raw.length > 1048576) throw new Error("invalid-proxy-response");
      return JSON.parse(raw);
    } catch (error) {
      if (error instanceof TmdbRateLimit) throw error;
      throw new Error("proxy-unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
  const detail: MovieMetadataTransport["detail"] = async (identity, locale) => {
    if (
      identity.kind !== "movie" ||
      !Number.isSafeInteger(identity.id) ||
      identity.id <= 0 ||
      !["tr-TR", "en-US"].includes(locale)
    )
      throw new Error("invalid-movie-request");
    const value = (await send({
      op: "detail",
      id: identity.id,
      locale,
    })) as TmdbMetadata;
    if (
      !value ||
      value.kind !== "movie" ||
      value.id !== identity.id ||
      value.locale !== locale
    )
      throw new Error("invalid-proxy-response");
    return value;
  };
  return {
    detail,
    lookup: async (q) => {
      if (q.kind !== "movie") return [];
      if (q.providerTmdbId !== undefined) {
        const d = await detail(
          { kind: "movie", id: q.providerTmdbId },
          "tr-TR",
        );
        if (!d.title) return [];
        return [
          {
            kind: "movie",
            id: d.id,
            title: d.title,
            originalTitle: d.originalTitle,
            year: d.year,
            evidence: "detail",
          },
        ];
      }
      // Local/original title is still checked by the strict matcher; only metadata terms leave the device.
      const value = await send({
        op: "search",
        title: q.title,
        ...(q.year === undefined ? {} : { year: q.year }),
      });
      if (
        !Array.isArray(value) ||
        value.length > 100 ||
        value.some(
          (c) =>
            !c ||
            c.kind !== "movie" ||
            !Number.isSafeInteger(c.id) ||
            c.id <= 0 ||
            typeof c.title !== "string" ||
            c.title.length > 1000 ||
            c.evidence !== "search",
        )
      )
        throw new Error("invalid-proxy-response");
      return value as TmdbCandidate[];
    },
  };
}
