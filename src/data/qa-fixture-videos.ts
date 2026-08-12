import { resolveBundledMediaUri } from '@/services/media/media-url';
import type { Video } from '@/types/video';

/**
 * Synthetic QA-only fixtures, appended to the bundled mock catalog ONLY when
 * `EXPO_PUBLIC_INCLUDE_QA_FIXTURES=true` (a local, gitignored `.env` value -
 * never set in demo/showcase or production builds, so neither ever shows a
 * test card).
 *
 * The one fixture here exists for fullscreen QA: the feed's fullscreen
 * control only renders for a HORIZONTAL video (`width > height` - see
 * `drama-feed-item.tsx`), and every real bundled clip is vertical 720x1280,
 * so without this there is nothing local that can exercise the fullscreen
 * enter/exit path at all. The clip is generated with ffmpeg (`testsrc2`
 * moving pattern + 440 Hz sine tone, 10 s, 1280x720) and burns the text
 * "QA 16:9 FIXTURE — SYNTHETIC TEST VIDEO" into every frame, so it can
 * never be mistaken for production content.
 *
 * Resolved through `resolveBundledMediaUri` into the same `playbackUrl` /
 * `thumbnailUrl` fields the backend normally fills (docs/internal-storage.md
 * fixes those as the only media fields mobile playback reads), exactly like
 * the real bundled catalog in `mock-drama-videos.ts` - no new media field,
 * no new storage mechanism.
 */

export function shouldIncludeQaFixtures(): boolean {
  return process.env.EXPO_PUBLIC_INCLUDE_QA_FIXTURES === 'true';
}

export const qaFixtureVideos: readonly Video[] = [
  {
    id: 'qa-fixture-16x9-fullscreen',
    seriesId: 'series-qa-fixture-16x9',
    // Deliberately NOT a `processed-videos/...` key: this clip never existed
    // in backend storage, and the key should say so at a glance.
    storageKey: 'qa-fixtures/qa-16x9-fullscreen.mp4',
    playbackUrl: resolveBundledMediaUri(require('../../assets/videos/qa-16x9-fullscreen.mp4')),
    thumbnailUrl: resolveBundledMediaUri(
      require('../../assets/thumbnails/qa-16x9-fullscreen.jpg')
    ),
    // Horizontal on purpose - `width > height` is the exact condition the
    // feed's fullscreen control renders under.
    width: 1280,
    height: 720,
    title: 'QA 16:9 Fullscreen Sample',
    episodeNumber: 1,
    channelName: 'QA Fixtures',
    category: 'Drama',
    sourceLanguage: 'Mandarin',
    hasEmbeddedIndonesianSubtitle: false,
    processingStatus: 'completed',
    caption: 'Synthetic horizontal test clip for fullscreen QA. Not production content.',
    likeCount: 0,
    isSaved: false,
  },
];
