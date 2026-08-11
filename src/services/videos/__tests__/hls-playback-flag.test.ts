import { isHlsPlaybackEnabled } from '@/services/videos/hls-playback-flag';

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_HLS_PLAYBACK_ENABLED;

afterEach(() => {
  process.env.EXPO_PUBLIC_HLS_PLAYBACK_ENABLED = ORIGINAL_ENV;
});

describe('isHlsPlaybackEnabled (Slice 11R HLS playback enable/disable flag)', () => {
  it('defaults to enabled when the env var is unset', () => {
    delete process.env.EXPO_PUBLIC_HLS_PLAYBACK_ENABLED;

    expect(isHlsPlaybackEnabled()).toBe(true);
  });

  it('is disabled only by the exact string "false"', () => {
    process.env.EXPO_PUBLIC_HLS_PLAYBACK_ENABLED = 'false';

    expect(isHlsPlaybackEnabled()).toBe(false);
  });

  it.each(['true', 'False', '0', ''])(
    'stays enabled for any other value, e.g. %j (only the literal "false" disables it)',
    (value) => {
      process.env.EXPO_PUBLIC_HLS_PLAYBACK_ENABLED = value;

      expect(isHlsPlaybackEnabled()).toBe(true);
    }
  );
});
