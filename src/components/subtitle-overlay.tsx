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
    right: 86,
    bottom: 150,
    left: 18,
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  text: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
  },
});
