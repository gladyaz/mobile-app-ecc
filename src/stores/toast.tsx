import { PropsWithChildren, createContext, useCallback, useContext, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';

const TOAST_DURATION_MS = 1900;

type ToastContextValue = {
  readonly showToast: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: PropsWithChildren) {
  const [message, setMessage] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((nextMessage: string) => {
    clearTimeout(timeoutRef.current);
    setMessage(nextMessage);
    timeoutRef.current = setTimeout(() => setMessage(null), TOAST_DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {message ? (
        <View pointerEvents="none" style={styles.container}>
          <Text style={styles.text}>{message}</Text>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const contextValue = useContext(ToastContext);

  if (!contextValue) {
    throw new Error('useToast must be used within ToastProvider');
  }

  return contextValue;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 100,
    alignItems: 'center',
    zIndex: 80,
  },
  text: {
    backgroundColor: 'rgba(24, 24, 27, 0.96)',
    borderWidth: 1,
    borderColor: Palette.border,
    color: Palette.text,
    fontFamily: FontFamily.bold,
    fontSize: 12.5,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
});
