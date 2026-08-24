import { useEffect, useRef } from "react";
import * as ReactNative from "react-native";

export type LegendTvRemoteEvent = {
  eventType?: string;
  eventKeyAction?: number;
  repeatCount?: number;
  tag?: number;
};

const TV_REMOTE_EVENT = "LegendStreamTVRemote";
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

function useFallbackTVEventHandler(handler: (event: LegendTvRemoteEvent) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const TVEventHandlerCtor = (ReactNative as typeof ReactNative & {
      TVEventHandler?: new () => {
        enable: (
          component: unknown,
          callback: (component: unknown, event: LegendTvRemoteEvent) => void,
        ) => void;
        disable: () => void;
      };
    }).TVEventHandler;

    if (TVEventHandlerCtor) {
      const tvHandler = new TVEventHandlerCtor();
      tvHandler.enable(null, (_component, event) => handlerRef.current(event));
      return () => tvHandler.disable();
    }

    // Expo ships stock React Native rather than react-native-tvos. The Android
    // TV config plugin emits the same semantic events from MainActivity so TV
    // remote support does not depend on the tvOS fork being installed.
    const subscription = ReactNative.DeviceEventEmitter.addListener(
      TV_REMOTE_EVENT,
      (event: LegendTvRemoteEvent) => handlerRef.current(event),
    );
    return () => subscription.remove();
  }, []);
}

/**
 * Prefer react-native-tvos' hook when available. Otherwise fall back to the
 * legacy handler or the small Android MainActivity bridge installed at prebuild.
 */
export const useLegendTVEventHandler: (
  handler: (event: LegendTvRemoteEvent) => void,
) => void = nativeUseTVEventHandler
  ? (handler) => {
      const handlerRef = useRef(handler);
      handlerRef.current = handler;
      nativeUseTVEventHandler((event) => handlerRef.current(event));
    }
  : useFallbackTVEventHandler;

export const tvPreferredFocusProps = (preferred = false) =>
  isAndroidTV && preferred ? ({ hasTVPreferredFocus: true } as const) : {};
