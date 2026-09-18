export type StalkerLiveCategoryLike = {
  category_id: string | number;
  category_name?: string | null;
};

export function normalizeStalkerLiveCategoryIntent(categoryId?: string) {
  const value = categoryId?.trim();
  if (!value) return null;
  return value === "__all__" ? "0" : value;
}

export function isStalkerLiveGlobalCategoryId(categoryId?: string) {
  const value = categoryId?.trim();
  return value === "0" || value === "*" || value === "__all__";
}

export function isStalkerLiveGlobalCategory(category: StalkerLiveCategoryLike) {
  const id = String(category.category_id).trim();
  const name = category.category_name?.trim() ?? "";
  return isStalkerLiveGlobalCategoryId(id) || /^(?:all|tümü|tum)$/i.test(name);
}

export function findStalkerLiveProviderGlobalCategory<T extends StalkerLiveCategoryLike>(
  categories: readonly T[],
) {
  return categories.find(isStalkerLiveGlobalCategory) ?? null;
}
