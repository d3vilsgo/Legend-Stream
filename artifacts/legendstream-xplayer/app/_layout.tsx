import React, { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
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

// Keep the native splash visible briefly while startup assets are prepared,
// but never allow a font-loading problem to strand the app on the splash screen.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

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
      try {
        await SplashScreen.hideAsync();
      } catch {
        // The splash may already have been hidden by the native lifecycle.
      }
    };

    if (fontsLoaded || fontError) {
      void hideSplash();
      return () => {
        cancelled = true;
      };
    }

    // Safety valve for real devices: startup must remain usable even if
    // a bundled font loader never settles on a particular Android build.
    const timer = setTimeout(() => {
      if (!cancelled) void hideSplash();
    }, 2000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fontsLoaded, fontError]);

  // Do not block the React tree on font loading. React Native will render with
  // its fallback font until Inter is ready, avoiding an infinite native splash.
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <PlayerProvider>
                <RootLayoutNav />
              </PlayerProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
