import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { Palette } from '@/constants/theme';
import { VideoCatalogProvider } from '@/features/videos/video-catalog-provider';
import { AuthProvider, useAuth } from '@/stores/auth';
import { EntitlementProvider } from '@/stores/entitlement';
import { SeriesProgressProvider, useSeriesProgress } from '@/stores/series-progress';
import { ToastProvider } from '@/stores/toast';
import { useVideoInteractions, VideoInteractionsProvider } from '@/stores/video-interactions';

SplashScreen.preventAutoHideAsync();

// The "Red Panda" design is dark-only by intent - there is no light-theme
// variant in the source design - so the navigation theme is fixed instead
// of following the device color scheme.
const NavigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Palette.background,
    card: Palette.backgroundElevated,
    border: Palette.border,
    primary: Palette.primary,
    text: Palette.text,
  },
};

// Persisted state (auth/likes-saves/watch-progress) loads asynchronously,
// and the brand font loads asynchronously too. Keep the native splash
// screen up (it's already blocked from auto-hiding above) until both are
// ready, instead of hiding it and briefly flashing an incorrect Guest
// state, an empty Saved tab, or a fallback system font.
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
        <Stack.Screen name="processing" options={{ headerShown: false }} />
        <Stack.Screen name="series/[id]" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  useEffect(() => {
    // app.json allows any orientation so fullscreen video can go landscape;
    // lock portrait here so every other screen stays portrait by default.
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  }, []);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider value={NavigationTheme}>
        <ToastProvider>
          <AuthProvider>
            <EntitlementProvider>
              <VideoCatalogProvider>
                <VideoInteractionsProvider>
                  <SeriesProgressProvider>
                    <AppContent />
                  </SeriesProgressProvider>
                </VideoInteractionsProvider>
              </VideoCatalogProvider>
            </EntitlementProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
