import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const corsAllowlist = new Set(
  (process.env.CORS_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

app.use((req, res, next) => {
  const origin = req.get("Origin");
  if (origin && !corsAllowlist.has(origin)) {
    res.status(403).json({
      error: { code: "CORS_ORIGIN_DENIED", message: "This web origin is not allowed." },
    });
    return;
  }
  next();
});
app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || corsAllowlist.has(origin));
  },
}));
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: true, limit: "32kb" }));

app.use("/api", router);

export default app;
