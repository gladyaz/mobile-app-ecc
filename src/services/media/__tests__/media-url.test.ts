import { buildMediaUrl, resolveBundledMediaUri } from '@/services/media/media-url';

jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: (assetModule: number) => ({ uri: `asset://module/${assetModule}` }),
  },
}));

const ORIGINAL_MEDIA_BASE_URL = process.env.EXPO_PUBLIC_MEDIA_BASE_URL;

afterEach(() => {
  if (ORIGINAL_MEDIA_BASE_URL === undefined) {
    delete process.env.EXPO_PUBLIC_MEDIA_BASE_URL;
  } else {
    process.env.EXPO_PUBLIC_MEDIA_BASE_URL = ORIGINAL_MEDIA_BASE_URL;
  }
});

describe('resolveBundledMediaUri', () => {
  it('resolves an asset module id to its bundled URI', () => {
    // Arrange
    const assetModuleId = 42;

    // Act
    const uri = resolveBundledMediaUri(assetModuleId);

    // Assert
    expect(uri).toBe('asset://module/42');
  });

  // THE RELEASE-SAFETY CASE. A production build is made from a checkout with
  // no `assets/videos` / `assets/thumbnails` (they are gitignored), so
  // `metro.config.js` resolves those `require`s to Metro's empty module and
  // what arrives here is `{}`, not an asset module id. Unhandled,
  // `Asset.fromModule({})` throws during module evaluation of
  // `mock-drama-videos.ts` - which `_layout.tsx` imports transitively, so the
  // app would fail at startup rather than at the point of use.
  it('returns an empty URI when the bundled media was not in the build', () => {
    // Arrange
    const emptyModule = {};

    // Act
    const uri = resolveBundledMediaUri(emptyModule);

    // Assert
    expect(uri).toBe('');
  });

  it('returns an empty URI rather than throwing for any non-asset value', () => {
    expect(resolveBundledMediaUri(undefined)).toBe('');
    expect(resolveBundledMediaUri(null)).toBe('');
    expect(resolveBundledMediaUri('../../assets/videos/pewaris-ep-1.mp4')).toBe('');
  });
});

describe('buildMediaUrl', () => {
  it('joins the media base URL with an encoded relative path', () => {
    // Arrange
    process.env.EXPO_PUBLIC_MEDIA_BASE_URL = 'https://media.example.com/';

    // Act
    const url = buildMediaUrl('drama china/ep 01.mp4');

    // Assert
    expect(url).toBe('https://media.example.com/drama%20china/ep%2001.mp4');
  });

  it('returns an empty string when no media base URL is configured', () => {
    // Arrange
    delete process.env.EXPO_PUBLIC_MEDIA_BASE_URL;

    // Act
    const url = buildMediaUrl('drama-china/ep-01.mp4');

    // Assert
    expect(url).toBe('');
  });
});
