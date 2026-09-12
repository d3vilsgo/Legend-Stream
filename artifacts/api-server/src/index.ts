import app from "./app";
import { logger } from "./lib/logger";
import { shutdownRateLimitCleanup } from "./middlewares/xtreamRateLimit";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, () => {
  logger.info({ port }, "Server listening");
});

server.on("error", (err) => {
  shutdownRateLimitCleanup();
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

let shuttingDown = false;

function gracefulShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Received shutdown signal");

  const forceTimer = setTimeout(() => {
    logger.error({ signal }, "Forced shutdown after timeout");
    shutdownRateLimitCleanup();
    process.exit(1);
  }, 10_000);
  forceTimer.unref?.();

  server.close((err) => {
    clearTimeout(forceTimer);
    shutdownRateLimitCleanup();
    if (err) {
      logger.error({ err, signal }, "HTTP server shutdown failed");
      process.exit(1);
    }
    logger.info({ signal }, "HTTP server closed");
    process.exit(0);
  });
}

process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.once("SIGINT", () => gracefulShutdown("SIGINT"));
