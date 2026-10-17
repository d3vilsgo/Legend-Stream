/** Revalidate only the already loaded window; never flash an empty list on refresh. */
export async function refreshCatalogWindow<
  T,
  P extends { items: T[]; hasMore: boolean; nextCursor: string | null },
>(options: {
  loadedRows: number;
  load: (cursor: string | null) => Promise<P>;
  isCurrent: () => boolean;
}): Promise<P | null> {
  let cursor: string | null = null;
  let items: T[] = [];
  const cursors = new Set<string>();
  while (options.isCurrent()) {
    const page = await options.load(cursor);
    if (!options.isCurrent()) return null;
    items = items.concat(page.items);
    if (
      !page.hasMore ||
      !page.nextCursor ||
      items.length >= Math.max(1, options.loadedRows)
    )
      return { ...page, items };
    if (!page.items.length || cursors.has(page.nextCursor))
      throw new Error("Catalog cursor did not advance.");
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return null;
}
