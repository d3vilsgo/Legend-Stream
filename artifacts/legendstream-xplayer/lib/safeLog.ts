const REDACTED = "[REDACTED]";
const REDACTED_URL = "[REDACTED_URL]";
const REDACTED_MAC = "[REDACTED_MAC]";
const MAX_SANITIZE_DEPTH = 6;

const NETWORK_URL_PATTERN = /\b(?:https?|rtsp|rtmp|rtp|udp|mms|ws|wss):\/\/[^\s<>"')\]}]+/gi;
const AUTH_HEADER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const MAC_PATTERN = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi;
const SECRET_KEY_SOURCE = "password|passwd|pwd|username|user|token|access[_-]?token|refresh[_-]?token|authorization|auth|mac|playlist(?:url)?|epg(?:url)?|stream(?:url)?|url|credential|secret|api[_-]?key";
const QUOTED_SECRET_PATTERN = new RegExp(
  `(["'])(${SECRET_KEY_SOURCE})\\1(\\s*:\\s*)(["'])(.*?)\\4`,
  "gi",
);
const PLAIN_SECRET_PATTERN = new RegExp(
  `\\b(${SECRET_KEY_SOURCE})\\b(\\s*[=:]\\s*)([^\\s,;}\\]]+)`,
  "gi",
);
const SENSITIVE_FIELD_PATTERN = /(?:password|passwd|pwd|username|token|authorization|cookie|mac|playlist|epg|stream|credential|secret|api[_-]?key|(?:^|_)(?:url|uri)$|(?:url|uri)$)/i;

export type SanitizedLogError = {
  name: string;
  message: string;
  stack?: string;
};

export function redactSensitiveText(value: string): string {
  if (!value) return value;
  return value
    .replace(NETWORK_URL_PATTERN, REDACTED_URL)
    .replace(AUTH_HEADER_PATTERN, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(QUOTED_SECRET_PATTERN, (_match, quote: string, key: string, separator: string) =>
      `${quote}${key}${quote}${separator}${quote}${REDACTED}${quote}`,
    )
    .replace(PLAIN_SECRET_PATTERN, (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`)
    .replace(MAC_PATTERN, REDACTED_MAC);
}

function isDevelopmentRuntime(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__ === true;
}

export function sanitizeErrorForLog(
  error: unknown,
  options?: { includeStack?: boolean },
): SanitizedLogError {
  if (error instanceof Error) {
    const sanitized: SanitizedLogError = {
      name: error.name || "Error",
      message: redactSensitiveText(error.message || "Unknown error"),
    };
    if (options?.includeStack && error.stack) {
      sanitized.stack = redactSensitiveText(error.stack);
    }
    return sanitized;
  }
  return {
    name: "NonError",
    message: redactSensitiveText(String(error)),
  };
}

export function sanitizeLogValue(
  value: unknown,
  options?: { includeStack?: boolean },
): unknown {
  const seen = new WeakSet<object>();

  const visit = (current: unknown, depth: number): unknown => {
    if (typeof current === "string") return redactSensitiveText(current);
    if (
      current === null ||
      current === undefined ||
      typeof current === "number" ||
      typeof current === "boolean" ||
      typeof current === "bigint"
    ) {
      return current;
    }
    if (typeof current === "symbol" || typeof current === "function") {
      return redactSensitiveText(String(current));
    }
    if (current instanceof Error) {
      return sanitizeErrorForLog(current, options);
    }
    if (depth >= MAX_SANITIZE_DEPTH) return "[MAX_DEPTH]";
    if (typeof current !== "object") return redactSensitiveText(String(current));
    if (seen.has(current)) return "[CIRCULAR]";
    seen.add(current);

    if (Array.isArray(current)) {
      return current.map((item) => visit(item, depth + 1));
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
      sanitized[key] = SENSITIVE_FIELD_PATTERN.test(key)
        ? REDACTED
        : visit(item, depth + 1);
    }
    return sanitized;
  };

  return visit(value, 0);
}

type LogMethod = "log" | "info" | "warn" | "error" | "debug";

function emit(level: LogMethod, event: string, details: unknown[]) {
  const sink = globalThis.console;
  const method = sink?.[level] ?? sink?.log;
  if (typeof method !== "function") return;
  const safeDetails = details.map((detail) =>
    sanitizeLogValue(detail, { includeStack: isDevelopmentRuntime() }),
  );
  method.call(sink, redactSensitiveText(event), ...safeDetails);
}

export const safeLog = {
  debug(event: string, ...details: unknown[]) {
    emit("debug", event, details);
  },
  info(event: string, ...details: unknown[]) {
    emit("info", event, details);
  },
  warn(event: string, ...details: unknown[]) {
    emit("warn", event, details);
  },
  error(event: string, ...details: unknown[]) {
    emit("error", event, details);
  },
};
