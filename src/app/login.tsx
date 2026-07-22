import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FontFamily, Gradients, Palette, Radius } from '@/constants/theme';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export default function LoginScreen() {
  const { login } = useAuth();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const trimmedEmail = email.trim();
  const emailError = isSubmitted
    ? !trimmedEmail
      ? 'Email wajib diisi'
      : !EMAIL_PATTERN.test(trimmedEmail)
        ? 'Format email tidak valid'
        : null
    : null;
  const passwordError = isSubmitted && !password.trim() ? 'Password wajib diisi' : null;

  const handleLogin = async () => {
    setIsSubmitted(true);

    if (!trimmedEmail || !EMAIL_PATTERN.test(trimmedEmail) || !password.trim()) {
      return;
    }

    setIsSubmitting(true);

    try {
      await login(trimmedEmail, password);
      router.replace('/profile');
      showToast('Selamat datang!');
    } catch {
      showToast('Login gagal. Periksa koneksi kamu dan coba lagi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel="Kembali"
        accessibilityRole="button"
        onPress={() => {
          if (router.canGoBack()) {
            router.back();
            return;
          }

          router.replace('/');
        }}
        style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}>
        <SymbolView
          name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
          size={18}
          tintColor={Palette.text}
        />
      </Pressable>

      <Text style={styles.title}>Masuk</Text>
      <Text style={styles.subtitle}>Gunakan akun Red Panda kamu.</Text>

      <View style={styles.form}>
        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="nama@email.com"
            placeholderTextColor={Palette.textMuted}
            style={[styles.input, emailError && styles.inputError]}
            value={email}
          />
          {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={Palette.textMuted}
            secureTextEntry
            style={[styles.input, passwordError && styles.inputError]}
            value={password}
          />
          {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting}
          onPress={() => {
            void handleLogin();
          }}
          style={({ pressed }) => [
            styles.primaryButton,
            (pressed || isSubmitting) && styles.buttonPressed,
          ]}>
          <LinearGradient
            colors={Gradients.primary}
            end={{ x: 1, y: 1 }}
            start={{ x: 0, y: 0 }}
            style={styles.primaryButtonGradient}>
            <Text style={styles.primaryButtonText}>{isSubmitting ? 'Memproses...' : 'Login'}</Text>
          </LinearGradient>
        </Pressable>

        <Text style={styles.hint}>Isi email valid &amp; password apa pun — akun dibuat otomatis jika belum ada.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 40,
    backgroundColor: Palette.background,
  },
  backButton: {
    width: 44,
    height: 44,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  title: {
    marginTop: 28,
    fontSize: 26,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  form: {
    marginTop: 28,
    gap: 16,
  },
  field: {
    gap: 7,
  },
  label: {
    fontSize: 12,
    fontFamily: FontFamily.bold,
    letterSpacing: 0.3,
    color: Palette.textSecondary,
  },
  input: {
    height: 52,
    paddingHorizontal: 16,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
    fontSize: 14.5,
    fontFamily: FontFamily.regular,
    color: Palette.text,
  },
  inputError: {
    borderColor: Palette.error,
  },
  errorText: {
    fontSize: 12,
    fontFamily: FontFamily.semiBold,
    color: Palette.error,
  },
  primaryButton: {
    marginTop: 8,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  primaryButtonGradient: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 15,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  hint: {
    fontSize: 11.5,
    lineHeight: 17,
    fontFamily: FontFamily.regular,
    color: Palette.textMuted,
    textAlign: 'center',
  },
  buttonPressed: {
    opacity: 0.75,
  },
});
