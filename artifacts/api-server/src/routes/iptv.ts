import { Router, type IRouter } from "express";
import { SafeHttpError, safeGetText } from "../lib/safeHttp";
import { xtreamRateLimit } from "../middlewares/xtreamRateLimit";

const router: IRouter = Router();

router.use("/xtream", xtreamRateLimit);

type XtreamRequest = {
  baseUrl?: unknown;
  username?: unknown;
  password?: unknown;
};

type XtreamActionRequest = XtreamRequest & {
  action?: unknown;
  params?: unknown;
};

class UpstreamError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.code = code;
  }
}

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim();
  const candidate = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new UpstreamError("Enter a valid Xtream server URL.", 400, "INVALID_URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new UpstreamError(
      "Xtream server URLs must use HTTP or HTTPS.",
      400,
      "INVALID_URL",
    );
  }
  if (!parsed.hostname) {
    throw new UpstreamError("The Xtream server URL has no host.", 400, "INVALID_URL");
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  if (/\/(?:player_api|panel_api|get|xmltv|server\/load)\.php$/i.test(path)) {
    parsed.pathname = path.slice(0, path.lastIndexOf("/")) || "/";
  } else {
    parsed.pathname = path;
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function readCredentials(body: XtreamRequest) {
  if (
    typeof body.baseUrl !== "string" ||
    typeof body.username !== "string" ||
    typeof body.password !== "string" ||
    !body.username.trim() ||
    !body.password
  ) {
    throw new UpstreamError(
      "Enter the Xtream server URL, username, and password.",
      400,
      "MISSING_CREDENTIALS",
    );
  }
  return {
    baseUrl: normalizeBaseUrl(body.baseUrl),
    username: body.username.trim(),
    password: body.password,
  };
}

const providerHeaders = {
  Accept: "application/json,text/plain,*/*",
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; TV) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  Connection: "keep-alive",
};

async function providerJson(
  url: URL,
  credentials: { username: string; password: string },
) {
  url.searchParams.set("username", credentials.username);
  url.searchParams.set("password", credentials.password);
  let response: { status: number; text: string };
  try {
    response = await safeGetText(url, providerHeaders, 20_000);
  } catch (error) {
    if (error instanceof SafeHttpError && error.code === "SSRF_BLOCKED") {
      throw new UpstreamError(
        "Local, private, link-local, and reserved provider addresses are not allowed.",
        403,
        "BLOCKED_UPSTREAM_ADDRESS",
      );
    }
    if (error instanceof SafeHttpError && error.code === "TIMEOUT") {
      throw new UpstreamError(
        "The Xtream server took too long to respond.",
        504,
        "PROVIDER_TIMEOUT",
      );
    }
    throw new UpstreamError(
      "The Xtream server could not be reached. Check the URL, port, DNS, and network.",
      502,
      "PROVIDER_UNREACHABLE",
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(response.text);
  } catch {
    throw new UpstreamError(
      "The Xtream server returned an invalid response instead of JSON.",
      502,
      "INVALID_PROVIDER_RESPONSE",
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new UpstreamError(
      `The Xtream server returned HTTP ${response.status}.`,
      response.status >= 400 && response.status < 500 ? 401 : 502,
      response.status === 401 || response.status === 403
        ? "PROVIDER_AUTH_HTTP_ERROR"
        : "PROVIDER_HTTP_ERROR",
    );
  }
  return data as any;
}

const allowedActions = new Set([
  "get_live_categories",
  "get_live_streams",
  "get_vod_categories",
  "get_vod_streams",
  "get_vod_info",
  "get_series_categories",
  "get_series",
  "get_series_info",
]);

function validateAuth(data: any) {
  const userInfo = data?.user_info;
  const authValue = userInfo?.auth;
  const status = String(userInfo?.status ?? "").toLowerCase();
  const authenticated = authValue === 1 || authValue === "1" || authValue === true;
  if (!userInfo || !authenticated || ["disabled", "banned", "expired"].includes(status)) {
    throw new UpstreamError(
      "Xtream rejected these credentials or the subscription is inactive.",
      401,
      "INVALID_CREDENTIALS",
    );
  }
  return data;
}

async function executeXtreamRequest(
  credentials: ReturnType<typeof readCredentials>,
  action?: string,
  params?: unknown,
) {
  if (action !== undefined && !allowedActions.has(action)) {
    throw new UpstreamError("Unsupported Xtream action.", 400, "INVALID_ACTION");
  }

  const url = new URL("player_api.php", `${credentials.baseUrl}/`);
  if (action) url.searchParams.set("action", action);
  if (params && typeof params === "object" && !Array.isArray(params)) {
    for (const [key, raw] of Object.entries(params as Record<string, unknown>)) {
      if (!/^[a-z_]+$/i.test(key)) continue;
      if (typeof raw === "string" || typeof raw === "number") {
        url.searchParams.set(key, String(raw));
      }
    }
  }
  const data = await providerJson(url, credentials);
  return action ? data : validateAuth(data);
}

router.post("/xtream/action", async (req, res) => {
  try {
    const body = req.body as XtreamActionRequest;
    const credentials = readCredentials(body);
    const action = body.action === undefined
      ? undefined
      : typeof body.action === "string"
        ? body.action
        : (() => { throw new UpstreamError("Unsupported Xtream action.", 400, "INVALID_ACTION"); })();
    const data = await executeXtreamRequest(credentials, action, body.params);
    res.json(data);
  } catch (error) {
    const status = error instanceof UpstreamError ? error.status : 500;
    const code = error instanceof UpstreamError ? error.code : "PROXY_ERROR";
    const message = error instanceof UpstreamError
      ? error.message
      : "The provider proxy could not complete the request.";
    res.status(status).json({ error: { code, message } });
  }
});

// Legacy browser bootstrap endpoint retained for compatibility. The canonical client uses
// /xtream/action and therefore shares one high-level domain contract on native and web.
router.post("/xtream", async (req, res) => {
  try {
    const credentials = readCredentials(req.body as XtreamRequest);
    const auth = await executeXtreamRequest(credentials);
    const categories = await executeXtreamRequest(credentials, "get_live_categories");
    const streams = await executeXtreamRequest(credentials, "get_live_streams");
    if (!Array.isArray(categories)) {
      throw new UpstreamError(
        "Xtream returned an invalid live categories response.",
        422,
        "INVALID_PROVIDER_RESPONSE",
      );
    }
    if (!Array.isArray(streams)) {
      throw new UpstreamError(
        "Xtream authentication succeeded, but no live stream list was returned.",
        422,
        "NO_LIVE_STREAMS",
      );
    }
    res.json({ auth, categories, streams, baseUrl: credentials.baseUrl });
  } catch (error) {
    const status = error instanceof UpstreamError ? error.status : 500;
    const code = error instanceof UpstreamError ? error.code : "PROXY_ERROR";
    const message = error instanceof UpstreamError
      ? error.message
      : "The provider proxy could not complete the request.";
    res.status(status).json({ error: { code, message } });
  }
});

export default router;
