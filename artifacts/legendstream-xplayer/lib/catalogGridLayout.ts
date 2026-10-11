export type PosterGridLayout = {
  columns: number;
  columnWidth: number;
  contentWidth: number;
  outerPadding: number;
};

const MAX_CONTENT_WIDTH = 1500;
const MIN_COLUMNS = 2;
const MAX_COLUMNS = 7;
const MAX_COLUMN_WIDTH = 210;

export function computePosterGridLayout(width: number): PosterGridLayout {
  const viewportWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const contentWidth = Math.min(viewportWidth, MAX_CONTENT_WIDTH);
  const outerPadding = contentWidth < 380 ? 14 : 18;
  const usableWidth = Math.max(0, contentWidth - outerPadding * 2);

  const rawColumns = usableWidth > 0
    ? Math.ceil(usableWidth / MAX_COLUMN_WIDTH)
    : MIN_COLUMNS;
  const columns = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, rawColumns));
  const columnWidth = usableWidth > 0 ? usableWidth / columns : MAX_COLUMN_WIDTH;

  return {
    columns,
    columnWidth,
    contentWidth,
    outerPadding,
  };
}
