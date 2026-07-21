import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text } from 'react-native';

import { FontFamily, Gradients } from '@/constants/theme';

type BrandMarkProps = {
  readonly size?: number;
  readonly letter?: string;
};

/** The "R" gradient mark used for the Red Panda brand and as a fallback channel avatar. */
export function BrandMark({ size = 26, letter = 'R' }: BrandMarkProps) {
  return (
    <LinearGradient
      colors={Gradients.primary}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={[styles.mark, { width: size, height: size, borderRadius: Math.round(size * 0.3) }]}>
      <Text style={[styles.letter, { fontSize: size * 0.5 }]}>{letter}</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontFamily: FontFamily.extraBold,
    color: '#FFFFFF',
  },
});
