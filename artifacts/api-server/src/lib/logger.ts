import pino from "pino";
import { serializeServerLogError } from "./logRedaction";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "req.body.password",
      "req.body.username",
      "req.body.token",
      "req.body.accessToken",
      "req.body.refreshToken",
      "req.body.mac",
      "req.body.baseUrl",
      "req.body.url",
      "password",
      "username",
      "token",
      "accessToken",
      "refreshToken",
      "mac",
      "baseUrl",
      "url",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    err(value: unknown) {
      return serializeServerLogError(value, { includeStack: !isProduction });
    },
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
