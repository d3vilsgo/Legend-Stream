import fs from "node:fs";
import path from "node:path";
import {
  abortCatalogRequest,
  freshCatalogRunState,
  hasUsableCatalogCache,
  shouldBlockInitialCatalogSync,
} from "../lib/catalogAvailability";

let passed = 0;
const expect = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
  passed += 1;
};

const contextSource = fs.readFileSync(
  path.join(process.cwd(), "context/CatalogSyncContext.tsx"),
  "utf8",
);
const homeSource = fs.readFileSync(
  path.join(process.cwd(), "components/OptimizedHomeScreenPaged.tsx"),
  "utf8",
);
const xtreamSource = fs.readFileSync(
  path.join(process.cwd(), "lib/xtreamCatalog.ts"),
  "utf8",
);

const fullCounts = { live: 5264, vod: 22675, series: 4120 };
const emptyCounts = { live: 0, vod: 0, series: 0 };

expect(
  hasUsableCatalogCache(fullCounts) && !shouldBlockInitialCatalogSync(true, true, "cancelled"),
  "cache rows must remain usable after a cancelled refresh and must not block startup",
);
expect(
  hasUsableCatalogCache(fullCounts) && !shouldBlockInitialCatalogSync(true, true, "error"),
  "cache rows must remain usable after a failed refresh and must not block startup",
);
expect(
  !hasUsableCatalogCache(emptyCounts) && shouldBlockInitialCatalogSync(false, true, "preparing"),
  "an empty first-time cache must block while initial preparation is active",
);
expect(
  !hasUsableCatalogCache(emptyCounts) && !shouldBlockInitialCatalogSync(false, true, "ready"),
  "an empty cache explicitly marked ready must not reopen the blocking modal",
);

const fresh = freshCatalogRunState("provider-A", 42, "initial");
expect(
  fresh.runId === 42 && fresh.completed === 0 && fresh.total === 1 &&
  fresh.phase === "preparing" && fresh.message === "Catalogs are being prepared" &&
  contextSource.includes("activeRunIdRef.current") &&
  contextSource.includes("setSyncStateLocal(freshCatalogRunState(provider.id, generation, mode))") &&
  contextSource.includes("if (activeRunIdRef.current === null) setSyncStateLocal(state)"),
  "a new run must own fresh message/progress state instead of rendering persisted stale state",
);

expect(
  homeSource.includes("const activeSnapshot = provider && snapshot.providerId === provider.id ? snapshot : null;") &&
  homeSource.includes("snapshotCount(provider.id, snapshot.providerId, snapshot.counts.live, snapshot.ready, hasUsableCache)") &&
  contextSource.includes("getCatalogCounts(active.id)") &&
  contextSource.includes("hasUsableCatalogCache(counts)") &&
  contextSource.includes("isCatalogSyncOwnershipCurrent(") &&
  contextSource.includes("const HOME_SAMPLE_LIMIT = 48;") &&
  contextSource.includes("const NEW_SAMPLE_LIMIT = 24;") &&
  !shouldBlockInitialCatalogSync(true, true, "syncing") &&
  shouldBlockInitialCatalogSync(false, true, "preparing"),
  "Home availability must be current-provider scoped, persisted-count driven, preview bounded, and cache-aware",
);

let aborted = false;
abortCatalogRequest({ abort: () => { aborted = true; } });
expect(
  aborted &&
  contextSource.includes("abortCatalogRequest(abortControllerRef.current)") &&
  contextSource.includes("getVodCategories(credentials, controller.signal)") &&
  contextSource.includes("getSeries(credentials, category.category_id, controller.signal)") &&
  xtreamSource.includes("signal?: AbortSignal") &&
  xtreamSource.includes("if (signal?.aborted) throw caught;"),
  "Cancel must abort the active Xtream fetch through a real AbortController signal",
);

process.stdout.write(`catalog availability scenarios: ${passed}/7 passed\n`);
