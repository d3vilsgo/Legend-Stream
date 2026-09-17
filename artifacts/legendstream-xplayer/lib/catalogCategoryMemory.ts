export type CatalogCategoryMemoryKind = "live" | "vod" | "series";

const ALL_CATEGORY = "__all__";
const selections = new Map<string, string>();

function selectionKey(providerId: string, kind: CatalogCategoryMemoryKind) {
  return `${providerId}\u0000${kind}`;
}

export function readCatalogCategorySelection(
  providerId: string,
  kind: CatalogCategoryMemoryKind,
): string;
export function readCatalogCategorySelection(
  providerId: string,
  kind: CatalogCategoryMemoryKind,
  missingSelection: null,
): string | null;
export function readCatalogCategorySelection(
  providerId: string,
  kind: CatalogCategoryMemoryKind,
  missingSelection: string | null = ALL_CATEGORY,
) {
  return selections.get(selectionKey(providerId, kind)) ?? missingSelection;
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
): string;
export function validateCatalogCategorySelection(
  providerId: string,
  kind: CatalogCategoryMemoryKind,
  availableCategoryIds: readonly string[],
  missingSelection: null,
): string | null;
export function validateCatalogCategorySelection(
  providerId: string,
  kind: CatalogCategoryMemoryKind,
  availableCategoryIds: readonly string[],
  missingSelection: string | null = ALL_CATEGORY,
) {
  const key = selectionKey(providerId, kind);
  const selected = selections.get(key) ?? missingSelection;
  if (selected === null) return null;
  if (selected === ALL_CATEGORY || availableCategoryIds.includes(selected)) return selected;
  if (missingSelection === null) {
    selections.delete(key);
    return null;
  }
  return rememberCatalogCategorySelection(providerId, kind, missingSelection);
}

export function clearCatalogCategoryMemoryForProvider(providerId: string) {
  const prefix = `${providerId}\u0000`;
  for (const key of selections.keys()) {
    if (key.startsWith(prefix)) selections.delete(key);
  }
}
