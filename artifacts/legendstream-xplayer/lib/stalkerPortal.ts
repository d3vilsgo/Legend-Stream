export type StalkerPortalErrorCode =
  | "INVALID_URL"
  | "MISSING_MAC"
  | "TIMEOUT"
  | "CANCELLED"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "AUTH_FAILED"
  | "MISSING_TOKEN";

export class StalkerPortalError extends Error {
  constructor(
    public readonly code: StalkerPortalErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "StalkerPortalError";
  }
}

export type StalkerPortalEndpointKind = "portal.php" | "server/load.php";

export type StalkerPortalTarget = {
  baseUrl: string;
  endpointUrl: string;
  endpointKind: StalkerPortalEndpointKind;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type StalkerPortalSessionOptions = {
  portalUrl: string;
  mac: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  afterResponse?: () => void | Promise<void>;
};

type StalkerActionParams = Record<string, string | number | boolean | undefined>;

const DEFAULT_TIMEOUT_MS = 20_000;
const USER_AGENT = "Mozilla/5.0 (Linux; Android 12; SmartTV) AppleWebKit/537.36";
const X_USER_AGENT = "Model: MAG250; Link: WiFi";

function cleanUrlString(url: URL) {
  return url.toString().replace(/\/$/, "");
}

export function normalizeStalkerPortalTarget(value: string): StalkerPortalTarget {
  const trimmed = value.trim();
  const candidate = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new StalkerPortalError("INVALID_URL", "Enter a valid Stalker portal URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new StalkerPortalError(
      "INVALID_URL",
      "Stalker portal URLs must use HTTP or HTTPS.",
    );
  }

  parsed.search = "";
  parsed.hash = "";
  const path = parsed.pathname.replace(/\/+$/, "");
  let basePath = path;
  let endpointPath: string;
  let endpointKind: StalkerPortalEndpointKind;

  if (/\/server\/load\.php$/i.test(path)) {
    endpointPath = path;
    basePath = path.replace(/\/server\/load\.php$/i, "");
    endpointKind = "server/load.php";
  } else if (/\/portal\.php$/i.test(path)) {
    endpointPath = path;
    basePath = path.replace(/\/portal\.php$/i, "");
    endpointKind = "portal.php";
  } else if (/\/stalker_portal$/i.test(path)) {
    endpointPath = `${path}/server/load.php`;
    endpointKind = "server/load.php";
  } else {
    endpointPath = `${path}/portal.php`;
    endpointKind = "portal.php";
  }

  const endpoint = new URL(parsed.toString());
  endpoint.pathname = endpointPath || "/portal.php";
  const base = new URL(parsed.toString());
  base.pathname = basePath || "/";

  return {
    baseUrl: cleanUrlString(base),
    endpointUrl: endpoint.toString(),
    endpointKind,
  };
}

function linkedRequestSignal(external: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  external?.addEventListener("abort", onExternalAbort, { once: true });
  if (external?.aborted) controller.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

function textLooksLikeAuthFailure(value: unknown) {
  if (typeof value !== "string") return false;
  const text = value.trim().toLowerCase();
  if (!text) return false;
  const mentionsAuth = /auth|authoriz|token|session/.test(text);
  const mentionsFailure = /fail|invalid|expired|denied|unauthor|not[ _-]?valid/.test(text);
  return mentionsAuth && mentionsFailure;
}

function payloadLooksLikeAuthFailure(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const row = payload as Record<string, unknown>;
  if (row.status === 401 || row.status === 403 || row.code === 401 || row.code === 403) {
    return true;
  }
  return [row.error, row.message, row.reason, row.status].some(textLooksLikeAuthFailure);
}

function tokenFromHandshake(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const row = payload as Record<string, unknown>;
  const direct = typeof row.token === "string" ? row.token.trim() : "";
  if (direct) return direct;
  const nested = row.js;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return "";
  const token = (nested as Record<string, unknown>).token;
  return typeof token === "string" ? token.trim() : "";
}

export class StalkerPortalSession {
  readonly baseUrl: string;
  readonly endpointKind: StalkerPortalEndpointKind;
  #endpointUrl: string;
  #mac: string;
  #token: string | null = null;
  #fetchImpl: FetchLike;
  #timeoutMs: number;
  #afterResponse: () => void | Promise<void>;

  constructor(options: StalkerPortalSessionOptions) {
    const mac = options.mac.trim();
    if (!mac) {
      throw new StalkerPortalError("MISSING_MAC", "Stalker portal requires a MAC address.");
    }
    const target = normalizeStalkerPortalTarget(options.portalUrl);
    this.baseUrl = target.baseUrl;
    this.endpointKind = target.endpointKind;
    this.#endpointUrl = target.endpointUrl;
    this.#mac = mac;
    this.#fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#afterResponse = options.afterResponse ?? (() => undefined);
  }

  invalidateSession() {
    this.#token = null;
  }

  isAuthenticated() {
    return this.#token !== null;
  }

  async handshake(signal?: AbortSignal) {
    const payload = await this.#requestOnce(
      { type: "stb", action: "handshake", token: "" },
      null,
      signal,
    );
    const token = tokenFromHandshake(payload);
    if (!token) {
      this.invalidateSession();
      throw new StalkerPortalError(
        "MISSING_TOKEN",
        "Stalker portal handshake did not return a session token.",
      );
    }
    this.#token = token;
    return { authenticated: true as const };
  }

  async request(params: StalkerActionParams, signal?: AbortSignal) {
    if (!this.#token) await this.handshake(signal);
    try {
      return await this.#requestOnce(params, this.#token, signal);
    } catch (caught) {
      if (
        !(caught instanceof StalkerPortalError) ||
        caught.code !== "AUTH_FAILED" ||
        signal?.aborted
      ) {
        throw caught;
      }
      this.invalidateSession();
      await this.handshake(signal);
      return this.#requestOnce(params, this.#token, signal);
    }
  }

  async getProfile(signal?: AbortSignal) {
    return this.request({ type: "stb", action: "get_profile" }, signal);
  }

  async #requestOnce(
    params: StalkerActionParams,
    token: string | null,
    externalSignal?: AbortSignal,
  ) {
    const url = new URL(this.#endpointUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    if (!url.searchParams.has("JsHttpRequest")) {
      url.searchParams.set("JsHttpRequest", "1-xml");
    }

    const requestSignal = linkedRequestSignal(externalSignal, this.#timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.#fetchImpl(url.toString(), {
          headers: {
            Accept: "*/*",
            "User-Agent": USER_AGENT,
            "X-User-Agent": X_USER_AGENT,
            Cookie: `mac=${this.#mac}; stb_lang=en; timezone=Europe%2FIstanbul`,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: requestSignal.signal,
        });
      } catch (caught) {
        if (externalSignal?.aborted) {
          throw new StalkerPortalError("CANCELLED", "Stalker portal request was cancelled.");
        }
        if (requestSignal.timedOut()) {
          throw new StalkerPortalError("TIMEOUT", "Stalker portal request timed out.");
        }
        const name = caught instanceof Error ? caught.name : "";
        if (name === "AbortError") {
          throw new StalkerPortalError("CANCELLED", "Stalker portal request was cancelled.");
        }
        throw new StalkerPortalError("NETWORK_ERROR", "Stalker portal could not be reached.");
      }

      let text: string;
      try {
        text = await response.text();
      } catch (caught) {
        if (externalSignal?.aborted) {
          throw new StalkerPortalError("CANCELLED", "Stalker portal request was cancelled.");
        }
        if (requestSignal.timedOut()) {
          throw new StalkerPortalError("TIMEOUT", "Stalker portal request timed out.");
        }
        const name = caught instanceof Error ? caught.name : "";
        if (name === "AbortError") {
          throw new StalkerPortalError("CANCELLED", "Stalker portal request was cancelled.");
        }
        throw new StalkerPortalError(
          "NETWORK_ERROR",
          "Stalker portal response body could not be read.",
        );
      }
      await this.#afterResponse();

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new StalkerPortalError(
            "AUTH_FAILED",
            "Stalker portal session is not authorized.",
            response.status,
          );
        }
        throw new StalkerPortalError(
          "HTTP_ERROR",
          `Stalker portal request failed with HTTP ${response.status}.`,
          response.status,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new StalkerPortalError(
          "INVALID_RESPONSE",
          "Stalker portal returned an invalid JSON response.",
        );
      }
      const payload =
        parsed && typeof parsed === "object" && !Array.isArray(parsed) && "js" in parsed
          ? (parsed as { js?: unknown }).js
          : parsed;
      if (payloadLooksLikeAuthFailure(payload)) {
        throw new StalkerPortalError(
          "AUTH_FAILED",
          "Stalker portal session is not authorized.",
        );
      }
      return payload;
    } finally {
      requestSignal.cleanup();
    }
  }
}

export function createStalkerPortalSession(options: StalkerPortalSessionOptions) {
  return new StalkerPortalSession(options);
}
