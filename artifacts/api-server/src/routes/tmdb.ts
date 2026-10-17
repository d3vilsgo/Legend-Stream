import { Router, type IRouter } from "express";
import {
  parseQuery,
  ProxyFailure,
  TmdbProxy,
  verifySession,
  WindowLimit,
} from "../lib/tmdb/proxy";
const router: IRouter = Router();
const proxy = new TmdbProxy(() => process.env.TMDB_READ_ACCESS_TOKEN);
const ipLimit = new WindowLimit(120);
const sessionLimit = new WindowLimit(60);
router.post("/metadata", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    ipLimit.take(req.ip ?? req.socket.remoteAddress ?? "unknown");
    const key = process.env.TMDB_SESSION_HMAC_KEY;
    const issuer = process.env.TMDB_SESSION_ISSUER;
    if (
      !key ||
      Buffer.byteLength(key) < 32 ||
      !issuer ||
      !process.env.TMDB_READ_ACCESS_TOKEN
    )
      throw new ProxyFailure(503, "not-configured");
    const principal = verifySession(req.get("authorization"), key, issuer);
    sessionLimit.take(principal);
    const query = parseQuery(req.body);
    res.json(await proxy.execute(query));
  } catch (error) {
    const e =
      error instanceof ProxyFailure
        ? error
        : new ProxyFailure(502, "metadata-unavailable");
    if (e.retryAfter) res.setHeader("Retry-After", String(e.retryAfter));
    res.status(e.status).json({ error: e.code });
  }
});
export default router;
