import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { VideoCatalogProvider } from '@/features/videos/video-catalog-provider';
import { AuthProvider, useAuth } from '@/stores/auth';
import { SeriesProgressProvider, useSeriesProgress } from '@/stores/series-progress';
import { useVideoInteractions, VideoInteractionsProvider } from '@/stores/video-interactions';

SplashScreen.preventAutoHideAsync();

// Persisted state (auth/likes-saves/watch-progress) loads asynchronously.
// Keep the native splash screen up (it's already blocked from auto-hiding
// above) until all three have hydrated, instead of hiding it and briefly
// flashing an incorrect Guest state or an empty Saved tab.
function AppContent() {
  const { isHydrated: isAuthHydrated } = useAuth();
  const { isHydrated: isInteractionsHydrated } = useVideoInteractions();
  const { isHydrated: isProgressHydrated } = useSeriesProgress();
  const isHydrated = isAuthHydrated && isInteractionsHydrated && isProgressHydrated;

  if (!isHydrated) {
    return null;
  }

  return (
    <>
      <AnimatedSplashOverlay />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="series/[id]" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    // app.json allows any orientation so fullscreen video can go landscape;
    // lock portrait here so every other screen stays portrait by default.
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <VideoCatalogProvider>
          <VideoInteractionsProvider>
            <SeriesProgressProvider>
              <AppContent />
            </SeriesProgressProvider>
          </VideoInteractionsProvider>
        </VideoCatalogProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
