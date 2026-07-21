import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Gradients, Palette, Radius } from '@/constants/theme';
import { resetAllPersistedState } from '@/services/storage/local-storage';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';
import { useVideoInteractions } from '@/stores/video-interactions';

// Development-only escape hatch to clear persisted auth/likes/saved/watch
// progress. Storage is cleared immediately; in-memory state for the
// current session still needs a manual app reload to pick that up, since
// there's no cross-platform way to force-remount every provider from here.
function DevResetButton() {
  if (!__DEV__) {
    return null;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        void resetAllPersistedState().then(() => {
          Alert.alert('Local data cleared', 'Reload the app to see the reset state.');
        });
      }}
      style={({ pressed }) => [styles.devResetButton, pressed && styles.buttonPressed]}>
      <Text style={styles.devResetButtonText}>Reset Local Data (Dev)</Text>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const { isAuthenticated, logout, user } = useAuth();
  const { savedVideoIds, likedVideoIds } = useVideoInteractions();
  const { showToast } = useToast();

  if (isAuthenticated && user) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.identityRow}>
          <LinearGradient
            colors={Gradients.primary}
            end={{ x: 1, y: 1 }}
            start={{ x: 0, y: 0 }}
            style={styles.avatar}>
            <Text style={styles.avatarText}>{user.name.charAt(0)}</Text>
          </LinearGradient>
          <View style={styles.identityText}>
            <Text style={styles.name}>{user.name}</Text>
            <Text style={styles.username}>@{user.username}</Text>
            <Text style={styles.email}>{user.email}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statsBox}>
            <Text style={[styles.statsValue, styles.statsValuePrimary]}>
              {savedVideoIds.length}
            </Text>
            <Text style={styles.statsLabel}>Video tersimpan</Text>
          </View>
          <View style={styles.statsBox}>
            <Text style={styles.statsValue}>{likedVideoIds.length}</Text>
            <Text style={styles.statsLabel}>Video disukai</Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.push('../processing');
          }}
          style={({ pressed }) => [styles.processingButton, pressed && styles.buttonPressed]}>
          <SymbolView
            name={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
            size={20}
            tintColor={Palette.textSecondary}
          />
          <Text style={styles.processingButtonText}>Processing History</Text>
          <Text style={styles.internalBadge}>INTERNAL</Text>
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={16}
            tintColor={Palette.textDisabled}
          />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            logout();
            showToast('Kamu telah logout');
          }}
          style={({ pressed }) => [styles.logoutButton, pressed && styles.buttonPressed]}>
          <Text style={styles.logoutButtonText}>Logout</Text>
        </Pressable>

        <DevResetButton />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>
      <View style={styles.guestState}>
        <View style={styles.guestAvatar}>
          <SymbolView
            name={{ ios: 'person', android: 'person_outline', web: 'person_outline' }}
            size={36}
            tintColor={Palette.textMuted}
          />
        </View>
        <Text style={styles.guestTitle}>Guest User</Text>
        <Text style={styles.description}>
          Masuk untuk menyimpan drama favoritmu dan melanjutkan tontonan di semua perangkat.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.push('/login');
          }}
          style={({ pressed }) => [styles.loginButton, pressed && styles.buttonPressed]}>
          <LinearGradient
            colors={Gradients.primary}
            end={{ x: 1, y: 1 }}
            start={{ x: 0, y: 0 }}
            style={styles.loginButtonGradient}>
            <Text style={styles.loginButtonText}>Login</Text>
          </LinearGradient>
        </Pressable>

        <DevResetButton />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 70,
    backgroundColor: Palette.background,
  },
  title: {
    fontSize: 26,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  guestState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingBottom: 96,
  },
  guestAvatar: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Palette.surface,
    borderWidth: 1.5,
    borderColor: Palette.textDisabled,
    borderStyle: 'dashed',
  },
  guestTitle: {
    marginTop: 6,
    fontSize: 19,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  description: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
    textAlign: 'center',
    maxWidth: 260,
  },
  loginButton: {
    marginTop: 10,
    width: '100%',
    maxWidth: 280,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  loginButtonGradient: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginButtonText: {
    fontSize: 15,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  identityRow: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 68,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  avatarText: {
    fontSize: 26,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 19,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  username: {
    marginTop: 2,
    fontSize: 12.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.primaryHover,
  },
  email: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: FontFamily.regular,
    color: Palette.textMuted,
  },
  statsRow: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 12,
  },
  statsBox: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
  },
  statsValue: {
    fontSize: 22,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  statsValuePrimary: {
    color: Palette.primary,
  },
  statsLabel: {
    marginTop: 2,
    fontSize: 11.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
  },
  processingButton: {
    marginTop: 16,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
  },
  processingButtonText: {
    flex: 1,
    fontSize: 14,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  internalBadge: {
    fontSize: 9,
    letterSpacing: 1,
    fontFamily: FontFamily.bold,
    color: Palette.primaryHover,
    borderWidth: 1,
    borderColor: 'rgba(255, 122, 26, 0.4)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  logoutButton: {
    marginTop: 16,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.textDisabled,
  },
  logoutButtonText: {
    fontSize: 14.5,
    fontFamily: FontFamily.bold,
    color: Palette.error,
  },
  devResetButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.md,
    backgroundColor: '#fef3c7',
  },
  devResetButtonText: {
    fontSize: 13,
    fontFamily: FontFamily.bold,
    color: '#92400e',
  },
  buttonPressed: {
    opacity: 0.75,
  },
});
