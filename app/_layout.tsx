import "../global.css";
import { useEffect } from "react";
import { Platform } from "react-native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useUserStore } from "../stores/useUserStore";

if (Platform.OS !== "web") {
  void SplashScreen.preventAutoHideAsync().catch((error: unknown) => {
    console.warn("Unable to keep the native splash screen visible.", error);
  });
}

const queryClient = new QueryClient();

function waitForUserStoreHydration(): Promise<void> {
  if (useUserStore.persist.hasHydrated()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let unsubscribe = () => {};
    const timeout = setTimeout(() => {
      unsubscribe();
      console.warn("Timed out waiting for persisted user state hydration.");
      resolve();
    }, 2000);
    const finishHydration = () => {
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    };

    unsubscribe = useUserStore.persist.onFinishHydration(finishHydration);
    if (useUserStore.persist.hasHydrated()) {
      finishHydration();
    }
  });
}

export default function RootLayout() {
  useEffect(() => {
    let active = true;
    const minimumFrameTime = new Promise<void>((resolve) => {
      setTimeout(resolve, 400);
    });

    void Promise.all([minimumFrameTime, waitForUserStoreHydration()])
      .catch((error: unknown) => {
        console.error("Unable to hydrate persisted user state.", error);
      })
      .finally(async () => {
        if (active && Platform.OS !== "web") {
          try {
            await SplashScreen.hideAsync();
          } catch (error) {
            console.warn("Unable to hide the native splash screen.", error);
          }
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#060913" },
          }}
        >
          <Stack.Screen name="(tabs)" />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}