import { Router, type IRouter } from "express";

const router: IRouter = Router();

type XtreamRequest = {
  baseUrl?: unknown;
  username?: unknown;
  password?: unknown;
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
  if (
    /\/(?:player_api|panel_api|get|xmltv|server\/load)\.php$/i.test(path)
  ) {
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
  let response: Response;
  try {
    response = await fetch(url, {
      headers: providerHeaders,
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
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

  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new UpstreamError(
      "The Xtream server returned an invalid response instead of JSON.",
      502,
      "INVALID_PROVIDER_RESPONSE",
    );
  }
  if (!response.ok) {
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

router.post("/xtream", async (req, res) => {
  try {
    const credentials = readCredentials(req.body as XtreamRequest);
    const authUrl = new URL("player_api.php", `${credentials.baseUrl}/`);
    const auth = await providerJson(authUrl, credentials);
    const userInfo = auth?.user_info;
    const authValue = userInfo?.auth;
    const status = String(userInfo?.status ?? "").toLowerCase();

    if (
      authValue === 0 ||
      authValue === "0" ||
      authValue === false ||
      status === "disabled" ||
      status === "banned" ||
      status === "expired"
    ) {
      throw new UpstreamError(
        "Xtream rejected these credentials or the subscription is inactive.",
        401,
        "INVALID_CREDENTIALS",
      );
    }

    // A successful Xtream login normally includes user_info. Reject HTML/error
    // objects that happen to parse as JSON before asking for channel lists.
    if (!userInfo || (authValue === undefined && !userInfo.username)) {
      throw new UpstreamError(
        "The server responded, but it did not return a valid Xtream account payload.",
        502,
        "INVALID_PROVIDER_RESPONSE",
      );
    }

    const streamsUrl = new URL("player_api.php", `${credentials.baseUrl}/`);
    streamsUrl.searchParams.set("action", "get_live_streams");
    const streams = await providerJson(streamsUrl, credentials);
    if (!Array.isArray(streams)) {
      throw new UpstreamError(
        "Xtream authentication succeeded, but no live stream list was returned.",
        422,
        "NO_LIVE_STREAMS",
      );
    }

    let categories: unknown[] = [];
    try {
      const categoriesUrl = new URL("player_api.php", `${credentials.baseUrl}/`);
      categoriesUrl.searchParams.set("action", "get_live_categories");
      const categoryData = await providerJson(categoriesUrl, credentials);
      categories = Array.isArray(categoryData) ? categoryData : [];
    } catch {
      // Some providers omit live categories. The stream list remains usable.
    }

    res.json({
      auth,
      streams,
      categories,
      baseUrl: credentials.baseUrl,
    });
  } catch (error) {
    const status = error instanceof UpstreamError ? error.status : 500;
    const code = error instanceof UpstreamError ? error.code : "PROXY_ERROR";
    const message =
      error instanceof UpstreamError
        ? error.message
        : "The provider proxy could not complete the request.";
    res.status(status).json({ error: { code, message } });
  }
});

export default router;