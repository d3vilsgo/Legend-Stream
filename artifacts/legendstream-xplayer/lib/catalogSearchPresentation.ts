export function shouldUseWholeCatalogLoadingSkeleton(
  loadingInitial: boolean,
  itemCount: number,
  search: string,
) {
  return loadingInitial && itemCount === 0 && search.trim() === "";
}
