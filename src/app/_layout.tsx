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

import { AdsBridge } from '@/components/ads-bridge';
import { isDemoMode } from '@/services/demo/demo-mode';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { Palette } from '@/constants/theme';
import { VideoCatalogProvider } from '@/features/videos/video-catalog-provider';
import { installGlobalErrorReporting } from '@/services/analytics/error-reporting';
import { AuthProvider, useAuth } from '@/stores/auth';
import { EntitlementProvider } from '@/stores/entitlement';
import { LanguageProvider } from '@/stores/language';
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
      {/* Mounted here (not higher, alongside EntitlementProvider) so the
          interstitial hook only starts loading ads once isPremium has
          settled post-hydration, not during the transient false it reports
          while auth/entitlement are still resolving. */}
      {/* A demo build ships without the AdMob native module, so anything
          that reaches into it throws at mount - `useInterstitialAd()` does,
          before any "are ads enabled" check can run. Ads are off in demo
          mode regardless, so the bridge is simply not mounted. */}
      {!isDemoMode() && <AdsBridge />}
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="register" options={{ headerShown: false }} />
        <Stack.Screen name="login-whatsapp" options={{ headerShown: false }} />
        <Stack.Screen name="processing" options={{ headerShown: false }} />
        <Stack.Screen name="account-security" options={{ headerShown: false }} />
        <Stack.Screen name="account-data" options={{ headerShown: false }} />
        {/* The Profile -> Settings -> About hierarchy. Registered as ordinary
            stack screens (not tabs) so each gets native back navigation, and
            NONE of them is auth-gated at the route level: Language, About and
            Help must stay reachable while signed out. */}
        <Stack.Screen name="language" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="account" options={{ headerShown: false }} />
        <Stack.Screen name="about" options={{ headerShown: false }} />
        <Stack.Screen name="help" options={{ headerShown: false }} />
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

    // Phase 11 (11-M1): capture fatal JS errors / unhandled rejections into
    // the self-hosted analytics pipeline. Idempotent; chains RN's own
    // handler, so dev redbox / release crash behavior is unchanged.
    installGlobalErrorReporting();
  }, []);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider value={NavigationTheme}>
        {/* Outermost of the app's own providers: every screen below reads copy
            from it, including the toasts. */}
        <LanguageProvider>
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
        </LanguageProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
