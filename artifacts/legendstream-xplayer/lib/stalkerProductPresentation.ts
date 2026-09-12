import type { StalkerIsolatedCategory, StalkerIsolatedChannel } from "./stalkerIsolatedLogin";

export type ProductCategoryRow = {
  id: string;
  title: string;
};

export type ProductChannelRow = {
  id: string;
  title: string;
  logoUrl?: string;
  number?: number;
};

export function isFetchableStalkerProductCategory(category: StalkerIsolatedCategory) {
  const id = category.id.trim();
  return Boolean(id) && id !== "*";
}

export function normalizeStalkerProductCategories(
  categories: readonly StalkerIsolatedCategory[],
): StalkerIsolatedCategory[] {
  return categories.filter(isFetchableStalkerProductCategory).map((category) => ({ ...category }));
}

export function toProductCategoryRows(
  categories: readonly StalkerIsolatedCategory[],
): ProductCategoryRow[] {
  return normalizeStalkerProductCategories(categories).map(({ id, title }) => ({ id, title }));
}

export function toProductChannelRows(
  channels: readonly StalkerIsolatedChannel[],
): ProductChannelRow[] {
  return channels.map(({ id, title, logoUrl, number }) => ({ id, title, logoUrl, number }));
}
