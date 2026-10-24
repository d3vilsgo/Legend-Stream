import { useRef, useState } from "react";
import {
  FlatList,
  Platform,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOptionalTVPreviewFocus } from "@/components/tvPreview/TVPreviewFocus";
import { useUiPresentation } from "@/context/UiPresentationContext";
import {
  computePosterGridLayout,
  catalogAnchorRow,
} from "@/lib/catalogGridLayout";
import { useNativeTvCatalogGrid } from "./useNativeTvCatalogGrid";

/** Keep the physical TV restore owner intact; touch/Preview use a measured grid. */
export function useResponsiveCatalogGrid<T>(
  ids: readonly string[],
  scopeKey: string,
) {
  const native = useNativeTvCatalogGrid<T>(ids, scopeKey);
  const window = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const { tvPreview } = useUiPresentation();
  const focus = useOptionalTVPreviewFocus();
  const [measured, setMeasured] = useState<{
    width: number;
    windowWidth: number;
  } | null>(null);
  const layout = computePosterGridLayout(window.width, window.height, false, {
    tvPreview,
    safeArea,
    fontScale: window.fontScale,
    density: window.scale,
    containerWidth:
      measured?.windowWidth === window.width ? measured.width : window.width,
  });
  const list = useRef<FlatList<T>>(null);
  const anchor = useRef<string | null>(null);
  const pending = useRef<{
    id: string;
    attempts: number;
    preview: boolean;
  } | null>(null);
  const previous = useRef({ columns: layout.columns, scopeKey });
  const current = useRef({ ids, focus, layout });
  current.current = { ids, focus, layout };
  if (previous.current.scopeKey !== scopeKey) {
    anchor.current = null;
    pending.current = null;
  } else if (previous.current.columns !== layout.columns && !Platform.isTV) {
    const focused =
      tvPreview && ids.includes(focus?.focusedId ?? "")
        ? focus?.focusedId
        : null;
    const id = focused ?? anchor.current;
    pending.current =
      id && ids.includes(id)
        ? { id, attempts: 0, preview: Boolean(focused) }
        : null;
  }
  previous.current = { columns: layout.columns, scopeKey };
  const restore = () => {
    const target = pending.current;
    const latest = current.current;
    if (!target) return;
    const row = catalogAnchorRow(target.id, latest.ids, latest.layout.columns);
    if (
      row === null ||
      (latest.focus?.nativeScope && latest.focus.nativeScope !== "content") ||
      ++target.attempts > 3
    ) {
      pending.current = null;
      return;
    }
    list.current?.scrollToIndex({
      index: row,
      animated: false,
      viewPosition: 0.5,
    });
  };
  const viewability = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<T>[] }) => {
      const latest = current.current;
      const first = viewableItems.find(
        (item) => item.isViewable && item.index !== null,
      );
      if (first?.index !== null && first?.index !== undefined)
        anchor.current = latest.ids[first.index] ?? null;
      const target = pending.current;
      if (
        !target ||
        !viewableItems.some(
          (item) =>
            item.isViewable &&
            item.index !== null &&
            latest.ids[item.index!] === target.id,
        )
      )
        return;
      pending.current = null;
      if (target.preview) void latest.focus?.restoreFocus(target.id);
    },
  ).current;
  if (Platform.isTV) return native;
  return {
    columns: layout.columns,
    cardWidth: layout.columnWidth,
    contentStyle: {
      maxWidth: 1500,
      paddingLeft: layout.paddingLeft,
      paddingRight: layout.paddingRight,
      paddingTop: 12,
      paddingBottom: Math.max(40, safeArea.bottom),
    },
    listProps: {
      ref: list,
      onLayout: (event: LayoutChangeEvent) =>
        setMeasured({
          width: event.nativeEvent.layout.width,
          windowWidth: window.width,
        }),
      onContentSizeChange: restore,
      onViewableItemsChanged: viewability,
      onScrollBeginDrag: () => {
        pending.current = null;
      },
      onScrollToIndexFailed: (info: {
        averageItemLength: number;
        index: number;
      }) => {
        if (!pending.current) return;
        list.current?.scrollToOffset({
          offset: info.averageItemLength * info.index,
          animated: false,
        });
        const ticket = pending.current;
        requestAnimationFrame(() => {
          if (pending.current === ticket) restore();
        });
      },
    },
  };
}
