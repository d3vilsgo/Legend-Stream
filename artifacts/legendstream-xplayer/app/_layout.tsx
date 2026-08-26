import "@/lib/cryptoBootstrap";
import React, { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { PlayerProvider } from "@/context/PlayerContext";
import { I18nProvider } from "@/context/I18nContext";
import { MediaLibraryProvider } from "@/context/MediaLibraryContext";
import { CatalogSyncProvider } from "@/context/CatalogSyncContext";
import { cleanupProviderBackupTempFiles } from "@/lib/providerBackupFiles";

const abortSignalCtor = globalThis.AbortSignal as typeof AbortSignal & {
  timeout?: (milliseconds: number) => AbortSignal;
};
if (abortSignalCtor && typeof abortSignalCtor.timeout !== "function") {
  abortSignalCtor.timeout = (milliseconds: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), milliseconds);
    return controller.signal;
  };
}

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

void cleanupProviderBackupTempFiles({ coldStart: true }).catch((error) => {
  console.warn(
    "BACKUP_TEMP_CLEANUP_FAILED",
    error instanceof Error ? error.message : "unknown error",
  );
});

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    let cancelled = false;
    const hideSplash = async () => {
      try { await SplashScreen.hideAsync(); } catch { /* already hidden */ }
    };
    if (fontsLoaded || fontError) {
      void hideSplash();
      return () => { cancelled = true; };
    }
    const timer = setTimeout(() => { if (!cancelled) void hideSplash(); }, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [fontsLoaded, fontError]);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <I18nProvider>
              <PlayerProvider>
                <CatalogSyncProvider>
                  <MediaLibraryProvider>
                    <RootLayoutNav />
                  </MediaLibraryProvider>
                </CatalogSyncProvider>
              </PlayerProvider>
            </I18nProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
