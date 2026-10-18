import type { StalkerHomeMoviePreview } from "./stalkerHomeSummary";
import type { StalkerPortalSession } from "./stalkerPortal";
import {
  findStalkerVodGlobalCategory,
  loadStalkerVodCategories,
  loadStalkerVodPage,
  resolveStalkerVodLink,
} from "./stalkerVod";

export type HomeMovieState = {
  preview: StalkerHomeMoviePreview;
  busy: boolean;
  error: string | null;
};
export type HomeMoviePlayable = {
  title: string;
  subtitle?: string;
  url: string;
  itemId: string;
  categoryId: string;
};

/** One known page, never a title search or a catalog scan. Old v1 summaries use
 * the provider's initial category page, the only source that populated them. */
export async function findStalkerHomeMovie(
  session: Pick<StalkerPortalSession, "request">,
  preview: StalkerHomeMoviePreview,
  signal: AbortSignal,
  isCurrent: () => boolean,
) {
  const assertCurrent = () => {
    if (signal.aborted || !isCurrent()) throw new Error("Stale Home selection");
  };
  assertCurrent();
  let categoryId = preview.lookupCategoryId;
  let page = preview.lookupPage;
  if (
    !categoryId ||
    !Number.isSafeInteger(page) ||
    page! < 1 ||
    page! > 10_000
  ) {
    const categories = await loadStalkerVodCategories(session, { signal });
    assertCurrent();
    categoryId = (findStalkerVodGlobalCategory(categories) ?? categories[0])
      ?.id;
    page = 1;
  }
  if (!categoryId) throw new Error("Home movie unavailable");
  const result = await loadStalkerVodPage(
    session,
    { id: categoryId, title: "" },
    page!,
    { signal },
  );
  assertCurrent();
  const item = result.items.find((row) => row.portalId === preview.id);
  if (!item) throw new Error("Home movie unavailable");
  return { item, categoryId: item.categoryId ?? categoryId };
}

/** No network on construction/Info open. Only Play can reacquire a command. */
export function createStalkerHomeMovieController(options: {
  preview: StalkerHomeMoviePreview;
  session: Pick<StalkerPortalSession, "request">;
  isCurrent: () => boolean;
  onState: (state: HomeMovieState | null) => void;
  onPlayable: (movie: HomeMoviePlayable) => void;
  onPlaybackStart: () => void;
}) {
  let closed = false;
  let busy = false;
  let consumed = false;
  let request: AbortController | null = null;
  const current = () => !closed && options.isCurrent();
  const cancel = () => {
    closed = true;
    request?.abort();
    options.onState(null);
  };
  const open = () => {
    if (current())
      options.onState({ preview: options.preview, busy: false, error: null });
  };
  const play = async () => {
    if (!current() || busy || consumed) return;
    busy = true;
    const abort = new AbortController();
    request = abort;
    options.onState({ preview: options.preview, busy: true, error: null });
    options.onPlaybackStart();
    try {
      const { item, categoryId } = await findStalkerHomeMovie(
        options.session,
        options.preview,
        abort.signal,
        current,
      );
      if (!current() || abort.signal.aborted) return;
      const url = await resolveStalkerVodLink(options.session, item, {
        signal: abort.signal,
      });
      if (!current() || abort.signal.aborted) return;
      consumed = true;
      options.onState(null);
      options.onPlayable({
        title: item.title,
        subtitle: item.genre,
        url,
        itemId: item.portalId,
        categoryId,
      });
    } catch {
      if (current() && !abort.signal.aborted)
        options.onState({
          preview: options.preview,
          busy: false,
          error:
            "Film şu anda açılamıyor veya katalogdan kaldırılmış olabilir. Tekrar deneyin; sorun sürerse Filmler kataloğunu yenileyin.",
        });
    } finally {
      busy = false;
    }
  };
  return { open, cancel, play, isCurrent: current };
}
