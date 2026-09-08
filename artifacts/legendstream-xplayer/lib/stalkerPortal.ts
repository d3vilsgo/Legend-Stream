import { safeLog } from "./safeLog";

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

export type StalkerPortalRequestTiming = {
  fetchWaitMs: number;
  bodyReadWaitMs: number;
  postBodyYieldStartMs: number;
  postBodyYieldMs: number;
  jsonParseMs: number;
};

export type StalkerPortalDiagnosticsContext = {
  syncRunId?: string;
  providerId?: string;
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
  diagnostics?: StalkerPortalDiagnosticsContext;
};

type StalkerActionParams = Record<string, string | number | boolean | undefined>;
type RequestTimingObserver = (timing: StalkerPortalRequestTiming) => void;

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
  #handshake: { generation: number; promise: Promise<string> } | null = null;
  #authenticationGeneration = 0;
  #lifecycleController = new AbortController();
  #disposed = false;
  #fetchImpl: FetchLike;
  #timeoutMs: number;
  #afterResponse: () => void | Promise<void>;
  #diagnostics: StalkerPortalDiagnosticsContext;

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
    this.#diagnostics = options.diagnostics ?? {};
  }

  setDiagnosticsContext(context: StalkerPortalDiagnosticsContext = {}) {
    this.#diagnostics = context;
  }

  invalidateSession() {
    this.#authenticationGeneration += 1;
    this.#token = null;
    safeLog.info("LS_STALKER_HANDSHAKE_INVALIDATE", {
      syncRunId: this.#diagnostics.syncRunId,
      providerId: this.#diagnostics.providerId,
      authGeneration: this.#authenticationGeneration,
      reason: "EXPLICIT_OR_AUTH",
    });
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.invalidateSession();
    this.#lifecycleController.abort();
  }

  isAuthenticated() {
    return this.#token !== null;
  }

  async handshake(signal?: AbortSignal) {
    await this.#ensureAuthenticated(signal);
    return { authenticated: true as const };
  }

  async request(
    params: StalkerActionParams,
    signal?: AbortSignal,
    onTiming?: RequestTimingObserver,
  ) {
    const requestToken = await this.#ensureAuthenticated(signal);
    try {
      return await this.#requestOnce(params, requestToken, signal, onTiming);
    } catch (caught) {
      if (
        !(caught instanceof StalkerPortalError) ||
        caught.code !== "AUTH_FAILED" ||
        signal?.aborted
      ) {
        throw caught;
      }
      this.#invalidateTokenIfCurrent(requestToken);
      const retryToken = await this.#ensureAuthenticated(signal);
      return this.#requestOnce(params, retryToken, signal, onTiming);
    }
  }

  async getProfile(signal?: AbortSignal) {
    return this.request({ type: "stb", action: "get_profile" }, signal);
  }

  async #ensureAuthenticated(signal?: AbortSignal) {
    if (this.#disposed) {
      throw new StalkerPortalError("CANCELLED", "Stalker portal session was disposed.");
    }
    if (signal?.aborted) {
      throw new StalkerPortalError("CANCELLED", "Stalker portal request was cancelled.");
    }
    if (this.#token) return this.#token;

    const generation = this.#authenticationGeneration;
    let pending = this.#handshake;
    if (!pending || pending.generation !== generation) {
      const promise = this.#performHandshake(generation);
      pending = { generation, promise };
      this.#handshake = pending;
      void promise.finally(() => {
        if (this.#handshake?.promise === promise) this.#handshake = null;
      }).catch(() => undefined);
    } else {
      safeLog.info("LS_STALKER_HANDSHAKE_REUSE", {
        syncRunId: this.#diagnostics.syncRunId,
        providerId: this.#diagnostics.providerId,
        authGeneration: generation,
        reason: "PENDING",
      });
    }
    return this.#waitForAuthentication(pending.promise, signal);
  }

  async #performHandshake(generation: number) {
    const startedAt = Date.now();
    safeLog.info("LS_STALKER_HANDSHAKE_START", {
      syncRunId: this.#diagnostics.syncRunId,
      providerId: this.#diagnostics.providerId,
      authGeneration: generation,
      reason: "TOKEN_MISSING",
    });
    const payload = await this.#requestOnce(
      { type: "stb", action: "handshake", token: "" },
      null,
      this.#lifecycleController.signal,
    );
    const token = tokenFromHandshake(payload);
    if (!token) {
      if (generation === this.#authenticationGeneration) this.invalidateSession();
      throw new StalkerPortalError(
        "MISSING_TOKEN",
        "Stalker portal handshake did not return a session token.",
      );
    }
    if (this.#disposed || generation !== this.#authenticationGeneration) {
      throw new StalkerPortalError("CANCELLED", "Stalker portal authentication was superseded.");
    }
    this.#token = token;
    safeLog.info("LS_STALKER_HANDSHAKE_SUCCESS", {
      syncRunId: this.#diagnostics.syncRunId,
      providerId: this.#diagnostics.providerId,
      authGeneration: generation,
      elapsedMs: Math.max(0, Date.now() - startedAt),
    });
    return token;
  }

  #waitForAuthentication(promise: Promise<string>, signal?: AbortSignal) {
    if (!signal) return promise;
    if (signal.aborted) {
      return Promise.reject(new StalkerPortalError("CANCELLED", "Stalker portal request was cancelled."));
    }
    return new Promise<string>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(new StalkerPortalError("CANCELLED", "Stalker portal request was cancelled."));
      };
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (token) => {
          cleanup();
          resolve(token);
        },
        (caught) => {
          cleanup();
          reject(caught);
        },
      );
    });
  }

  #invalidateTokenIfCurrent(token: string) {
    if (this.#token !== token) return;
    this.invalidateSession();
  }

  async #requestOnce(
    params: StalkerActionParams,
    token: string | null,
    externalSignal?: AbortSignal,
    onTiming?: RequestTimingObserver,
  ) {
    const url = new URL(this.#endpointUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    if (!url.searchParams.has("JsHttpRequest")) {
      url.searchParams.set("JsHttpRequest", "1-xml");
    }

    const requestSignal = linkedRequestSignal(externalSignal, this.#timeoutMs);
    let fetchWaitMs = 0;
    let bodyReadWaitMs = 0;
    let postBodyYieldStartMs = 0;
    let postBodyYieldMs = 0;
    let jsonParseMs = 0;
    try {
      let response: Response;
      try {
        const fetchStartedAt = Date.now();
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
        fetchWaitMs = Math.max(0, Date.now() - fetchStartedAt);
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
        const bodyReadStartedAt = Date.now();
        text = await response.text();
        bodyReadWaitMs = Math.max(0, Date.now() - bodyReadStartedAt);
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

      const bodyReadFinishedAt = Date.now();
      const postBodyYieldStartedAt = Date.now();
      postBodyYieldStartMs = Math.max(0, postBodyYieldStartedAt - bodyReadFinishedAt);
      await this.#afterResponse();
      postBodyYieldMs = Math.max(0, Date.now() - postBodyYieldStartedAt);

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
      const jsonParseStartedAt = Date.now();
      try {
        parsed = JSON.parse(text);
      } catch {
        jsonParseMs = Math.max(0, Date.now() - jsonParseStartedAt);
        onTiming?.({ fetchWaitMs, bodyReadWaitMs, postBodyYieldStartMs, postBodyYieldMs, jsonParseMs });
        throw new StalkerPortalError(
          "INVALID_RESPONSE",
          "Stalker portal returned an invalid JSON response.",
        );
      }
      jsonParseMs = Math.max(0, Date.now() - jsonParseStartedAt);
      onTiming?.({ fetchWaitMs, bodyReadWaitMs, postBodyYieldStartMs, postBodyYieldMs, jsonParseMs });

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
