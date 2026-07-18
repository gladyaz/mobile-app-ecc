import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { VideoCatalogProvider } from '@/features/videos/video-catalog-provider';
import { AuthProvider } from '@/stores/auth';
import { VideoInteractionsProvider } from '@/stores/video-interactions';

SplashScreen.preventAutoHideAsync();

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
            <AnimatedSplashOverlay />
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="login" options={{ headerShown: false }} />
              <Stack.Screen name="series/[id]" options={{ headerShown: false }} />
            </Stack>
          </VideoInteractionsProvider>
        </VideoCatalogProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
