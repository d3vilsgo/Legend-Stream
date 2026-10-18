/** Filter category labels only. Catalog rows remain paged in their provider repository. */
export function filterCategoryOptions<T extends { name: string }>(categories: readonly T[], query: string): T[] {
 const needle=query.trim().toLocaleLowerCase("tr");
 return categories.filter(category=>category.name.toLocaleLowerCase("tr").includes(needle));
}
