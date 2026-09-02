export type CatalogCategoryMemoryKind = "live" | "vod" | "series";

const ALL_CATEGORY = "__all__";
const selections = new Map<string, string>();

function selectionKey(providerId: string, kind: CatalogCategoryMemoryKind) {
  return `${providerId}\u0000${kind}`;
}

export function readCatalogCategorySelection(
  providerId: string,
  kind: CatalogCategoryMemoryKind,
) {
  return selections.get(selectionKey(providerId, kind)) ?? ALL_CATEGORY;
}

export function rememberCatalogCategorySelection(
  providerId: string,
  kind: CatalogCategoryMemoryKind,
  categoryId: string,
) {
  const normalized = categoryId || ALL_CATEGORY;
  selections.set(selectionKey(providerId, kind), normalized);
  return normalized;
}

export function validateCatalogCategorySelection(
  providerId: string,
  kind: CatalogCategoryMemoryKind,
  availableCategoryIds: readonly string[],
) {
  const selected = readCatalogCategorySelection(providerId, kind);
  if (selected === ALL_CATEGORY || availableCategoryIds.includes(selected)) return selected;
  return rememberCatalogCategorySelection(providerId, kind, ALL_CATEGORY);
}

export function clearCatalogCategoryMemoryForProvider(providerId: string) {
  const prefix = `${providerId}\u0000`;
  for (const key of selections.keys()) {
    if (key.startsWith(prefix)) selections.delete(key);
  }
}
