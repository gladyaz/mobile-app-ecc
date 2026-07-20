import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { resetAllPersistedState } from '@/services/storage/local-storage';
import { useAuth } from '@/stores/auth';
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
  const { savedVideoIds } = useVideoInteractions();

  if (isAuthenticated && user) {
    return (
      <View style={styles.container}>
        <View style={styles.profilePanel}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.name.charAt(0)}</Text>
          </View>
          <Text style={styles.title}>{user.name}</Text>
          <Text style={styles.username}>@{user.username}</Text>
          <Text style={styles.email}>{user.email}</Text>

          <View style={styles.statsBox}>
            <Text style={styles.statsValue}>{savedVideoIds.length}</Text>
            <Text style={styles.statsLabel}>Saved videos</Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.push('../processing');
          }}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
          <Text style={styles.buttonText}>Processing History</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={logout}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}>
          <Text style={styles.secondaryButtonText}>Logout</Text>
        </Pressable>

        <DevResetButton />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.profilePanel}>
        <View style={styles.guestAvatar}>
          <Text style={styles.guestAvatarText}>G</Text>
        </View>
        <Text style={styles.title}>Guest User</Text>
        <Text style={styles.description}>Login to view your profile and saved drama activity.</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.push('/login');
          }}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
          <Text style={styles.buttonText}>Login</Text>
        </Pressable>

        <DevResetButton />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  profilePanel: {
    alignItems: 'flex-start',
    padding: 20,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    backgroundColor: '#f9fafb',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
  },
  description: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 24,
    color: '#4b5563',
  },
  guestAvatar: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    borderRadius: 36,
    backgroundColor: '#111827',
  },
  guestAvatarText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
  },
  avatar: {
    width: 84,
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    borderRadius: 42,
    backgroundColor: '#d11f3f',
  },
  avatarText: {
    fontSize: 34,
    fontWeight: '800',
    color: '#fff',
  },
  username: {
    marginTop: 6,
    fontSize: 17,
    fontWeight: '700',
    color: '#d11f3f',
  },
  email: {
    marginTop: 6,
    fontSize: 16,
    color: '#4b5563',
  },
  statsBox: {
    alignSelf: 'flex-start',
    marginTop: 24,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    backgroundColor: '#f9fafb',
  },
  statsValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
  },
  statsLabel: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  button: {
    alignItems: 'center',
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#d11f3f',
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  secondaryButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  devResetButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#fef3c7',
  },
  devResetButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400e',
  },
});
