export const ALL_CATEGORY_ID = "__all__";

export function toXtreamCategoryId(categoryId: string): string | undefined {
  return categoryId === ALL_CATEGORY_ID ? undefined : categoryId;
}
