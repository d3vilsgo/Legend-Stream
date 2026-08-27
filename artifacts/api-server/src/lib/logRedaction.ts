const REDACTED = "[REDACTED]";
const REDACTED_URL = "[REDACTED_URL]";
const REDACTED_MAC = "[REDACTED_MAC]";

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

export function redactServerLogText(value: string): string {
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

export type ServerLogError = {
  type: string;
  message: string;
  stack?: string;
};

export function serializeServerLogError(
  value: unknown,
  options: { includeStack: boolean },
): ServerLogError {
  if (value instanceof Error) {
    const result: ServerLogError = {
      type: value.name || "Error",
      message: redactServerLogText(value.message || "Unknown error"),
    };
    if (options.includeStack && value.stack) {
      result.stack = redactServerLogText(value.stack);
    }
    return result;
  }
  return {
    type: "NonError",
    message: redactServerLogText(String(value)),
  };
}
