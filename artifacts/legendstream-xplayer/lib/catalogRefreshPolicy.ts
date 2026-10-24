export type CatalogRefreshPolicy = {
  version: 1;
  automaticRefreshEnabled: boolean;
  refreshIntervalHours: 24 | 72;
};

export const DEFAULT_CATALOG_REFRESH_POLICY: CatalogRefreshPolicy = {
  version: 1,
  automaticRefreshEnabled: true,
  refreshIntervalHours: 24,
};

export type CatalogRefreshMode = "initial" | "automatic" | "manual";

export function shouldStartCatalogRefresh(input: {
  mode: CatalogRefreshMode;
  hasUsableCache: boolean;
  policy: CatalogRefreshPolicy;
  lastSuccessfulAt: number | null;
  now: number;
}): boolean {
  if (input.mode === "manual") return true;
  if (input.mode === "initial") return !input.hasUsableCache;
  return shouldRefreshCatalogAutomatically(input);
}

export function parseCatalogRefreshPolicy(
  value: unknown,
): CatalogRefreshPolicy {
  if (!value || typeof value !== "object")
    return DEFAULT_CATALOG_REFRESH_POLICY;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return DEFAULT_CATALOG_REFRESH_POLICY;
  return {
    version: 1,
    automaticRefreshEnabled: candidate.automaticRefreshEnabled === true,
    refreshIntervalHours: candidate.refreshIntervalHours === 72 ? 72 : 24,
  };
}

export function shouldRefreshCatalogAutomatically(input: {
  policy: CatalogRefreshPolicy;
  hasUsableCache: boolean;
  lastSuccessfulAt: number | null;
  now: number;
}): boolean {
  if (
    !input.policy.automaticRefreshEnabled ||
    !input.hasUsableCache ||
    !Number.isFinite(input.now)
  )
    return false;
  if (
    input.lastSuccessfulAt === null ||
    !Number.isFinite(input.lastSuccessfulAt) ||
    input.lastSuccessfulAt <= 0
  )
    return true;
  if (!Number.isFinite(input.now) || input.now < input.lastSuccessfulAt)
    return false;
  return (
    input.now - input.lastSuccessfulAt >=
    input.policy.refreshIntervalHours * 60 * 60 * 1000
  );
}

export function lastSuccessfulCatalogRefresh(
  fullSyncAt: number | null | undefined,
  backgroundSyncAt: number | null | undefined,
): number | null {
  const candidates = [fullSyncAt, backgroundSyncAt].filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  return candidates.length ? Math.max(...candidates) : null;
}
