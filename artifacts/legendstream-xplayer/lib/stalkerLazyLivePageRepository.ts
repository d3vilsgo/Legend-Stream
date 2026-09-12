import { upsertCatalogItems } from "./catalogCache";
import { liveRuntimeItem, type CatalogRuntimeProvider } from "./catalogRuntime";
import {
  normalizeStalkerLivePage,
  projectStalkerLiveItem,
  type StalkerLiveCategory,
} from "./stalkerLiveCatalog";
import { getOrCreateStalkerPortalSession } from "./stalkerPortalRuntime";
import { fetchStalkerOrderedPage, type StalkerOrderedPage } from "./stalkerPagedCatalog";
import { StalkerPortalError } from "./stalkerPortal";

function pageFromCursor(cursor?: string) {
  if (!cursor) return 1;
  const match = /^p:(\d+)$/.exec(cursor);
  const page = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(page) || page < 1) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker lazy page cursor is invalid.");
  }
  return page;
}

function allCategory(categoryId?: string) {
  const value = categoryId?.trim();
  return !value || value === "__all__" ? "0" : value;
}

function fallbackOrderedPage(payload: unknown, providerId: string): StalkerOrderedPage {
  const normalized = normalizeStalkerLivePage(payload, providerId, 1, []);
  return {
    kind: "itv",
    categoryId: "0",
    page: 1,
    payload,
    rows: normalized.items as unknown as Record<string, unknown>[],
    totalItems: normalized.totalItems,
    maxPageItems: normalized.maxPageItems,
    currentPage: null,
    hasMore: false,
    dialect: "genre_id",
    compatibilityFallback: true,
  };
}

export async function getStalkerLazyLivePage(options: {
  provider: CatalogRuntimeProvider;
  categoryId?: string;
  cursor?: string;
  signal?: AbortSignal;
  categories?: readonly StalkerLiveCategory[];
}) {
  const { provider, signal } = options;
  const portalUrl = provider.url || provider.playlistUrl || "";
  const mac = provider.mac?.trim() || "";
  if (provider.type !== "stalker" || !portalUrl || !mac) {
    throw new Error("Stalker lazy Live credentials are unavailable.");
  }
  const page = pageFromCursor(options.cursor);
  const categoryId = allCategory(options.categoryId);
  const session = getOrCreateStalkerPortalSession({
    providerId: provider.id,
    portalUrl,
    mac,
    diagnostics: { providerId: provider.id },
  });

  const ordered = await fetchStalkerOrderedPage({
    session,
    providerId: provider.id,
    kind: "itv",
    categoryId,
    page,
    signal,
    diagnostics: { providerId: provider.id },
    compatibilityFallback: page === 1
      ? async (fallbackSignal) => fallbackOrderedPage(
          await session.request(
            { type: "itv", action: "get_all_channels" },
            fallbackSignal,
            undefined,
            { providerId: provider.id },
          ),
          provider.id,
        )
      : undefined,
  });
  if (signal?.aborted) throw new StalkerPortalError("CANCELLED", "Stalker lazy Live page was cancelled.");

  const normalized = normalizeStalkerLivePage(
    ordered.payload,
    provider.id,
    page,
    options.categories ?? [],
  );
  const canonical = new Map<string, (typeof normalized.items)[number]>();
  for (const item of normalized.items) {
    const existing = canonical.get(item.portalId);
    if (existing) {
      if (existing.cmd !== item.cmd) {
        throw new StalkerPortalError("INVALID_RESPONSE", "Stalker lazy Live page contains an ambiguous channel identity.");
      }
      continue;
    }
    canonical.set(item.portalId, item);
  }
  const channels = [...canonical.values()];
  const projected = channels.map((item) => projectStalkerLiveItem(provider.id, item));
  if (projected.length) {
    await upsertCatalogItems(provider.id, "live", projected, {
      markNew: false,
      seenAt: Date.now(),
      isCancelled: () => Boolean(signal?.aborted),
    });
  }
  if (signal?.aborted) throw new StalkerPortalError("CANCELLED", "Stalker lazy Live page was cancelled.");

  return {
    items: projected.map((item) => liveRuntimeItem(item, provider)),
    totalCount: ordered.totalItems,
    countKnown: ordered.totalItems !== null,
    nextCursor: ordered.hasMore ? `p:${page + 1}` : null,
    hasMore: ordered.hasMore,
    page,
    maxPageItems: ordered.maxPageItems,
    dialect: ordered.dialect,
    compatibilityFallback: ordered.compatibilityFallback,
  };
}
