import { Platform } from "react-native";
import { yieldToUi } from "../cooperative";
import { XtreamCatalogError } from "../xtreamCatalogErrors";

export type XtreamCredentials = {
  baseUrl: string;
  username: string;
  password: string;
};

export type XtreamCategory = {
  category_id: string | number;
  category_name: string;
  parent_id?: number;
};

export type XtreamLiveItem = {
  stream_id: string | number;
  name?: string;
  stream_icon?: string;
  category_id?: string | number;
  epg_channel_id?: string;
  container_extension?: string;
  direct_source?: string;
} & Record<string, unknown>;

export type XtreamParseMetrics = {
  bodyReadMs: number;
  jsonParseMs: number;
  parseMs: number;
  responseChars: number;
};

export type XtreamParseMetricsSink = (metrics: XtreamParseMetrics) => void;

type XtreamRequestParams = Record<string, string | number | undefined>;

type XtreamClientOptions = {
  timeoutMs?: number;
  webTimeoutMs?: number;
};

const DEFAULT_NATIVE_TIMEOUT_MS = 20_000;
const DEFAULT_WEB_TIMEOUT_MS = 25_000;

export function normalizeXtreamBaseUrl(value: string) {
  const trimmed = value.trim();
  const candidate = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new XtreamCatalogError("INVALID_URL", "Enter a valid Xtream server URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new XtreamCatalogError(
      "INVALID_URL",
      "Xtream server URLs must use HTTP or HTTPS.",
    );
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

export function normalizeXtreamCredentials(credentials: XtreamCredentials): XtreamCredentials {
  return {
    baseUrl: normalizeXtreamBaseUrl(credentials.baseUrl),
    username: credentials.username.trim(),
    password: credentials.password,
  };
}

export function buildXtreamPlayerApiUrl(
  credentials: XtreamCredentials,
  action?: string,
  params: XtreamRequestParams = {},
) {
  const normalized = normalizeXtreamCredentials(credentials);
  const url = new URL("player_api.php", `${normalized.baseUrl}/`);
  url.searchParams.set("username", normalized.username);
  url.searchParams.set("password", normalized.password);
  if (action) url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return url;
}

async function parseResponse(response: Response, onParseMetrics?: XtreamParseMetricsSink) {
  const bodyReadStartedAt = Date.now();
  const text = await response.text();
  const bodyReadMs = Date.now() - bodyReadStartedAt;
  await yieldToUi();

  if (response.status === 404) {
    throw new XtreamCatalogError(
      "NOT_FOUND",
      "Xtream endpoint is not available on this server.",
      404,
    );
  }
  if (response.status >= 500) {
    throw new XtreamCatalogError(
      "HTTP_ERROR",
      `Xtream request failed with HTTP ${response.status}.`,
      response.status,
    );
  }

  let data: unknown;
  const jsonParseStartedAt = Date.now();
  try {
    data = JSON.parse(text);
  } catch {
    if (!response.ok) {
      throw new XtreamCatalogError(
        "HTTP_ERROR",
        `Xtream request failed with HTTP ${response.status}.`,
        response.status,
      );
    }
    throw new XtreamCatalogError(
      "INVALID_RESPONSE",
      "Xtream server returned an invalid JSON response.",
      response.status,
    );
  }
  const jsonParseMs = Date.now() - jsonParseStartedAt;
  onParseMetrics?.({
    bodyReadMs,
    jsonParseMs,
    parseMs: bodyReadMs + jsonParseMs,
    responseChars: text.length,
  });

  if (!response.ok) {
    const message = typeof (data as any)?.error?.message === "string"
      ? (data as any).error.message
      : `Xtream request failed with HTTP ${response.status}.`;
    throw new XtreamCatalogError("HTTP_ERROR", message, response.status);
  }
  return data;
}

function linkedRequestSignal(external: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  if (external) {
    external.addEventListener("abort", onAbort, { once: true });
    if (external.aborted) controller.abort();
  }
  return {
    signal: controller.signal,
    wasTimedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

function mapTransportError(
  caught: unknown,
  external: AbortSignal | undefined,
  timedOut: boolean,
  target: "server" | "web proxy",
) {
  if (external?.aborted) {
    return new XtreamCatalogError("CANCELLED", "Xtream request was cancelled.");
  }
  const name = caught instanceof Error ? caught.name : "";
  if (timedOut || name === "TimeoutError") {
    return new XtreamCatalogError("TIMEOUT", `Xtream ${target} timed out.`);
  }
  if (caught instanceof XtreamCatalogError) return caught;
  return new XtreamCatalogError("UNREACHABLE", `Xtream ${target} could not be reached.`);
}

async function requestNative(
  credentials: XtreamCredentials,
  action: string | undefined,
  params: XtreamRequestParams,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  onParseMetrics?: XtreamParseMetricsSink,
) {
  const url = buildXtreamPlayerApiUrl(credentials, action, params);
  const requestAbort = linkedRequestSignal(signal, timeoutMs);
  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "LegendStream-XPlayer/1.0 Android",
      },
      signal: requestAbort.signal,
    });
    return await parseResponse(response, onParseMetrics);
  } catch (caught) {
    throw mapTransportError(caught, signal, requestAbort.wasTimedOut(), "server");
  } finally {
    requestAbort.cleanup();
  }
}

async function requestWeb(
  credentials: XtreamCredentials,
  action: string | undefined,
  params: XtreamRequestParams,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  onParseMetrics?: XtreamParseMetricsSink,
) {
  const requestAbort = linkedRequestSignal(signal, timeoutMs);
  try {
    const response = await fetch("/api/iptv/xtream/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...normalizeXtreamCredentials(credentials), action, params }),
      signal: requestAbort.signal,
    });
    return await parseResponse(response, onParseMetrics);
  } catch (caught) {
    throw mapTransportError(caught, signal, requestAbort.wasTimedOut(), "web proxy");
  } finally {
    requestAbort.cleanup();
  }
}

function requireArray<T>(data: unknown, label: string): T[] {
  if (!Array.isArray(data)) {
    throw new XtreamCatalogError(
      "UNSUPPORTED_RESPONSE",
      `Xtream server returned an unsupported ${label} response.`,
    );
  }
  return data as T[];
}

function requireAuthenticatedPayload(data: unknown) {
  const payload = data as any;
  const userInfo = payload?.user_info;
  const authValue = userInfo?.auth;
  const status = String(userInfo?.status ?? "").trim().toLowerCase();
  const authenticated = authValue === 1 || authValue === "1" || authValue === true;
  if (!userInfo || !authenticated || ["disabled", "banned", "expired"].includes(status)) {
    throw new XtreamCatalogError(
      "AUTHENTICATION",
      "Xtream rejected these credentials or the subscription is inactive.",
    );
  }
  return payload;
}

export function createXtreamClient(
  credentials: XtreamCredentials,
  options: XtreamClientOptions = {},
) {
  const normalized = normalizeXtreamCredentials(credentials);
  const request = (
    action?: string,
    params: XtreamRequestParams = {},
    signal?: AbortSignal,
    onParseMetrics?: XtreamParseMetricsSink,
  ) => Platform.OS === "web"
    ? requestWeb(
        normalized,
        action,
        params,
        signal,
        options.webTimeoutMs ?? DEFAULT_WEB_TIMEOUT_MS,
        onParseMetrics,
      )
    : requestNative(
        normalized,
        action,
        params,
        signal,
        options.timeoutMs ?? DEFAULT_NATIVE_TIMEOUT_MS,
        onParseMetrics,
      );

  return {
    credentials: normalized,
    async authenticate(signal?: AbortSignal) {
      return requireAuthenticatedPayload(await request(undefined, {}, signal));
    },
    async getLiveCategories(signal?: AbortSignal) {
      try {
        return requireArray<XtreamCategory>(
          await request("get_live_categories", {}, signal),
          "live categories",
        );
      } catch (error) {
        if (
          signal?.aborted ||
          (error instanceof XtreamCatalogError && error.code === "CANCELLED")
        ) {
          throw error;
        }
        return [];
      }
    },
    async getLiveStreams(signal?: AbortSignal, onParseMetrics?: XtreamParseMetricsSink) {
      return requireArray<XtreamLiveItem>(
        await request("get_live_streams", {}, signal, onParseMetrics),
        "live streams",
      );
    },
    async getVodCategories(signal?: AbortSignal) {
      return requireArray<XtreamCategory>(await request("get_vod_categories", {}, signal), "VOD categories");
    },
    async getVodStreams(
      categoryId?: string | number,
      signal?: AbortSignal,
      onParseMetrics?: XtreamParseMetricsSink,
    ) {
      return requireArray<any>(
        await request("get_vod_streams", { category_id: categoryId }, signal, onParseMetrics),
        "VOD streams",
      );
    },
    async getSeriesCategories(signal?: AbortSignal) {
      return requireArray<XtreamCategory>(await request("get_series_categories", {}, signal), "series categories");
    },
    async getSeries(
      categoryId?: string | number,
      signal?: AbortSignal,
      onParseMetrics?: XtreamParseMetricsSink,
    ) {
      return requireArray<any>(
        await request("get_series", { category_id: categoryId }, signal, onParseMetrics),
        "series catalog",
      );
    },
    async getVodInfo(vodId: string | number, signal?: AbortSignal) {
      return (await request("get_vod_info", { vod_id: vodId }, signal)) ?? {};
    },
    async getSeriesInfo(seriesId: string | number, signal?: AbortSignal) {
      return (await request("get_series_info", { series_id: seriesId }, signal)) ?? {};
    },
  };
}

export type XtreamClient = ReturnType<typeof createXtreamClient>;
