/** Film/series extension of the existing PlayerState favorites persistence. No playback URLs. */
export type ContentFavorite = {
  providerId: string;
  kind: "movie" | "series";
  catalogId: string;
  title: string;
  categoryId?: string;
  addedAt: number;
};
export const contentFavoriteKey = (
  value: Pick<ContentFavorite, "providerId" | "kind" | "catalogId">,
) => JSON.stringify([value.providerId, value.kind, value.catalogId]);
export function parseContentFavorites(value: unknown): ContentFavorite[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("FAVORITES_INVALID_DATA");
  const seen = new Set<string>();
  return value
    .map((raw: unknown) => {
      if (!raw || typeof raw !== "object")
        throw new Error("FAVORITES_INVALID_DATA");
      const v = raw as ContentFavorite;
      if (
        typeof v.providerId !== "string" ||
        !v.providerId ||
        (v.kind !== "movie" && v.kind !== "series") ||
        typeof v.catalogId !== "string" ||
        !v.catalogId ||
        typeof v.title !== "string" ||
        v.title.length > 512 ||
        !Number.isFinite(v.addedAt) ||
        (v.categoryId !== undefined && typeof v.categoryId !== "string")
      )
        throw new Error("FAVORITES_INVALID_DATA");
      return {
        providerId: v.providerId,
        kind: v.kind,
        catalogId: v.catalogId,
        title: v.title,
        addedAt: v.addedAt,
        ...(v.categoryId !== undefined ? { categoryId: v.categoryId } : {}),
      };
    })
    .filter((v) => {
      const key = contentFavoriteKey(v);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
export function setContentFavorite(
  items: readonly ContentFavorite[],
  value: ContentFavorite,
  selected: boolean,
) {
  const next = items.filter(
    (v) => contentFavoriteKey(v) !== contentFavoriteKey(value),
  );
  if (selected) next.unshift(value);
  return next;
}
/** Shared queue for the existing PlayerState key; each operation reads the latest committed state. */
export class LibraryMutationQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => undefined).then(operation);
    this.tail = next;
    return next;
  }
}
