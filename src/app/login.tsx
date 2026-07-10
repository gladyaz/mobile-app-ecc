import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/stores/auth';

export default function LoginScreen() {
  const { loginDummy } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [validationError, setValidationError] = useState('');

  const handleLogin = () => {
    const nextEmail = email.trim();
    const nextPassword = password.trim();

    if (!nextEmail && !nextPassword) {
      setValidationError('Email and password are required.');
      return;
    }

    if (!nextEmail) {
      setValidationError('Email is required.');
      return;
    }

    if (!nextPassword) {
      setValidationError('Password is required.');
      return;
    }

    setValidationError('');
    loginDummy();
    router.replace('/profile');
  };

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (router.canGoBack()) {
            router.back();
            return;
          }

          router.replace('/');
        }}
        style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}>
        <Text style={styles.backButtonText}>Back</Text>
      </Pressable>

      <Text style={styles.title}>Login</Text>

      <TextInput
        autoCapitalize="none"
        keyboardType="email-address"
        onChangeText={setEmail}
        placeholder="Email"
        style={styles.input}
        value={email}
      />
      <TextInput
        onChangeText={setPassword}
        placeholder="Password"
        secureTextEntry
        style={styles.input}
        value={password}
      />

      {validationError ? <Text style={styles.errorText}>{validationError}</Text> : null}

      <Pressable
        accessibilityRole="button"
        onPress={handleLogin}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}>
        <Text style={styles.primaryButtonText}>Login Dummy</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 24,
    paddingVertical: 8,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#d11f3f',
  },
  title: {
    marginBottom: 24,
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
  },
  input: {
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    fontSize: 16,
    color: '#111827',
  },
  errorText: {
    marginBottom: 12,
    fontSize: 14,
    lineHeight: 20,
    color: '#b91c1c',
  },
  primaryButton: {
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#d11f3f',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  buttonPressed: {
    opacity: 0.75,
  },
});
