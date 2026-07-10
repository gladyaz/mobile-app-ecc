import { StyleSheet, Text, View } from 'react-native';

import type { Subtitle } from '@/types/subtitle';

type SubtitleOverlayProps = {
  readonly subtitles: readonly Subtitle[];
};

export function SubtitleOverlay({ subtitles }: SubtitleOverlayProps) {
  const subtitleText = subtitles
    .slice(0, 2)
    .map((subtitle) => subtitle.text)
    .join('\n');

  return (
    <View style={styles.container}>
      <Text numberOfLines={2} style={styles.text}>
        {subtitleText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 24,
    bottom: 132,
    left: 24,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  text: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
});
