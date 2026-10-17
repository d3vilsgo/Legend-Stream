import { useRef, useState } from "react";
import { FlatList, Platform, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOptionalTVPreviewFocus } from "@/components/tvPreview/TVPreviewFocus";
import { nativeTvLayout, tvGridAnchorRow } from "@/lib/nativeTvResponsive";

/** Measure the list itself: a side panel must not leave a window-sized grid behind. */
export function useNativeTvCatalogGrid<T>(ids: readonly string[]) {
  const window = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const focus = useOptionalTVPreviewFocus();
  const current = useRef({ focus, ids });
  current.current = { focus, ids };
  const [measuredWidth, setMeasuredWidth] = useState(window.width);
  const layout = nativeTvLayout({ ...window, width: measuredWidth, safeArea });
  const list = useRef<FlatList<T>>(null);
  const pending = useRef<{ id: string; row: number; attempts: number } | null>(null);
  const lastColumns = useRef(layout.columns);
  if (Platform.isTV && lastColumns.current !== layout.columns) {
    const id = focus?.nativeFocusedId ?? null;
    const row = tvGridAnchorRow(id, ids, layout.columns);
    pending.current = id && row !== null ? { id, row, attempts: 0 } : null;
    lastColumns.current = layout.columns;
  }
  const restoreVisibleRow = () => {
    const target = pending.current;
    const latest = current.current;
    if (!target || latest.focus?.nativeScope !== "content" || !latest.ids.includes(target.id) || (latest.focus.nativeFocusedId && latest.focus.nativeFocusedId !== target.id)) {
      pending.current = null;
      return;
    }
    if (++target.attempts > 2) { pending.current = null; return; }
    list.current?.scrollToIndex({ index: target.row, animated: false, viewPosition: .5 });
  };
  return {
    columns: layout.columns,
    contentStyle: Platform.isTV ? { maxWidth: undefined, paddingLeft: layout.left, paddingRight: layout.right, paddingTop: layout.gutter, paddingBottom: layout.bottom } : undefined,
    listProps: Platform.isTV ? {
      ref: list,
      onLayout: (event: LayoutChangeEvent) => setMeasuredWidth(event.nativeEvent.layout.width),
      onContentSizeChange: restoreVisibleRow,
      onScrollToIndexFailed: (info: { averageItemLength: number; index: number }) => {
        if (!pending.current) return;
        list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        requestAnimationFrame(restoreVisibleRow);
      },
    } : {},
  };
}
