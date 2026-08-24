import { useEffect, useRef } from "react";
import * as ReactNative from "react-native";

export type LegendTvRemoteEvent = {
  eventType?: string;
  eventKeyAction?: number;
  tag?: number;
};

const platform = ReactNative.Platform as typeof ReactNative.Platform & {
  isTV?: boolean;
  constants?: { uiMode?: string } & Record<string, unknown>;
};

export const isAndroidTV = Boolean(
  platform.OS === "android" &&
    (platform.isTV || String(platform.constants?.uiMode ?? "").toLowerCase() === "tv"),
);

const nativeUseTVEventHandler = (ReactNative as typeof ReactNative & {
  useTVEventHandler?: (handler: (event: LegendTvRemoteEvent) => void) => void;
}).useTVEventHandler;

function useLegacyTVEventHandler(handler: (event: LegendTvRemoteEvent) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!isAndroidTV) return;
    const TVEventHandlerCtor = (ReactNative as typeof ReactNative & {
      TVEventHandler?: new () => {
        enable: (
          component: unknown,
          callback: (component: unknown, event: LegendTvRemoteEvent) => void,
        ) => void;
        disable: () => void;
      };
    }).TVEventHandler;
    if (!TVEventHandlerCtor) return;

    const tvHandler = new TVEventHandlerCtor();
    tvHandler.enable(null, (_component, event) => handlerRef.current(event));
    return () => tvHandler.disable();
  }, []);
}

/**
 * React Native TV forks expose useTVEventHandler while stock Android builds may
 * still expose the legacy TVEventHandler class. Keep one hook surface so the
 * phone build remains untouched and Fire/Google TV can use whichever runtime
 * API is available.
 */
export const useLegendTVEventHandler: (
  handler: (event: LegendTvRemoteEvent) => void,
) => void = nativeUseTVEventHandler
  ? (handler) => {
      const handlerRef = useRef(handler);
      handlerRef.current = handler;
      nativeUseTVEventHandler((event) => {
        if (isAndroidTV) handlerRef.current(event);
      });
    }
  : useLegacyTVEventHandler;

export const tvPreferredFocusProps = (preferred = false) =>
  isAndroidTV && preferred ? ({ hasTVPreferredFocus: true } as const) : {};
