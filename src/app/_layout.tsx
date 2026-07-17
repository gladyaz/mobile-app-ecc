import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { VideoCatalogProvider } from '@/features/videos/video-catalog-provider';
import { AuthProvider } from '@/stores/auth';
import { VideoInteractionsProvider } from '@/stores/video-interactions';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <VideoCatalogProvider>
          <VideoInteractionsProvider>
            <AnimatedSplashOverlay />
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="login" options={{ headerShown: false }} />
            </Stack>
          </VideoInteractionsProvider>
        </VideoCatalogProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
