import express, {
  Router,
  type ErrorRequestHandler,
  type IRouter,
} from "express";
import {
  parseQuery,
  ProxyFailure,
  TmdbProxy,
  verifySession,
  WindowLimit,
} from "../lib/tmdb/proxy";
export type TmdbServerConfiguration = {
  upstreamToken?: string;
  sessionKey?: string;
  issuer?: string;
  minimumIssuedAt?: number;
};
export function createTmdbRouter(
  configuration: () => TmdbServerConfiguration,
  proxy: TmdbProxy,
  now = Date.now,
): IRouter {
  const router: IRouter = Router();
  const ipLimit = new WindowLimit(120, 2048, now);
  const sessionLimit = new WindowLimit(60, 2048, now);
  const fail = (error: unknown, res: express.Response) => {
    const e =
      error instanceof ProxyFailure
        ? error
        : new ProxyFailure(502, "metadata-unavailable");
    if (e.retryAfter) res.setHeader("Retry-After", String(e.retryAfter));
    res.status(e.status).json({ error: e.code });
  };
  router.use("/metadata", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).json({ error: "method-not-allowed" });
      return;
    }
    try {
      ipLimit.take(req.ip ?? req.socket.remoteAddress ?? "unknown");
      const c = configuration();
      if (
        !c.sessionKey ||
        Buffer.byteLength(c.sessionKey) < 32 ||
        !c.issuer ||
        !c.upstreamToken ||
        !Number.isSafeInteger(c.minimumIssuedAt ?? 0) ||
        (c.minimumIssuedAt ?? 0) < 0
      )
        throw new ProxyFailure(503, "not-configured");
      const principal = verifySession(
        req.get("authorization"),
        c.sessionKey,
        c.issuer,
        now(),
        c.minimumIssuedAt,
      );
      sessionLimit.take(principal);
      if (!req.is("application/json"))
        throw new ProxyFailure(415, "json-required");
      next();
    } catch (error) {
      fail(error, res);
    }
  });
  router.post(
    "/metadata",
    express.json({ limit: "2kb", strict: true }),
    async (req, res) => {
      try {
        res.json(await proxy.execute(parseQuery(req.body)));
      } catch (error) {
        fail(error, res);
      }
    },
  );
  const parseError: ErrorRequestHandler = (error, _req, res, _next) => {
    // Never echo JSON parser messages, body fragments, headers or upstream exceptions.
    const tooLarge =
      error && typeof error === "object" && error.type === "entity.too.large";
    res
      .status(tooLarge ? 413 : 400)
      .json({ error: tooLarge ? "request-too-large" : "invalid-json" });
  };
  router.use(parseError);
  return router;
}
const configuration = (): TmdbServerConfiguration => ({
  upstreamToken: process.env.TMDB_READ_ACCESS_TOKEN,
  sessionKey: process.env.TMDB_SESSION_HMAC_KEY,
  issuer: process.env.TMDB_SESSION_ISSUER,
  minimumIssuedAt:
    process.env.TMDB_SESSION_MIN_IAT === undefined
      ? 0
      : Number(process.env.TMDB_SESSION_MIN_IAT),
});
export default createTmdbRouter(
  configuration,
  new TmdbProxy(() => configuration().upstreamToken),
);
