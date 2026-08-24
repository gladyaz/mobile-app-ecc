import { qaFixtureVideos, shouldIncludeQaFixtures } from '@/data/qa-fixture-videos';
import { resolveBundledMediaUri } from '@/services/media/media-url';
import type { Video, VideoCategory } from '@/types/video';

/**
 * The bundled catalog, used when EXPO_PUBLIC_USE_MOCK_DATA=true or in a
 * demo build (see services/demo/demo-mode.ts).
 *
 * Both clips and posters ship inside the app binary so an offline showcase
 * build plays real content with no backend, no media server, and no
 * network. They are resolved through `resolveBundledMediaUri` into the
 * same `playbackUrl` / `thumbnailUrl` fields the backend normally fills,
 * so nothing downstream has to know where the bytes came from (see
 * docs/internal-storage.md).
 *
 * Only vertically-shot source material is used here: the feed is a
 * full-bleed vertical player, and the horizontal 1280x720 series in the
 * library render with heavy letterboxing.
 *
 * Every episode declares `accessTier: 'free'` EXPLICITLY. An offline build
 * has no backend to resolve a tier from, and the app no longer owns a
 * fallback rule to compute one with, so the fixture has to state it - the
 * value reaches the rest of the app already decided, exactly as a
 * backend-served row would. `free` is not an arbitrary pick: a demo viewer
 * must never hit a paywall they cannot clear, which is the same reason the
 * bundled catalog stops at episode 5.
 *
 * `require` paths are relative on purpose. Metro resolves these at bundle
 * time and the argument must be a static literal, so they cannot be built
 * from a variable.
 */

const pewarisClips = [
  require('../../assets/videos/pewaris-ep-1.mp4'),
  require('../../assets/videos/pewaris-ep-2.mp4'),
  require('../../assets/videos/pewaris-ep-3.mp4'),
  require('../../assets/videos/pewaris-ep-4.mp4'),
  require('../../assets/videos/pewaris-ep-5.mp4'),
];

const pewarisPosters = [
  require('../../assets/thumbnails/pewaris-ep-1.jpg'),
  require('../../assets/thumbnails/pewaris-ep-2.jpg'),
  require('../../assets/thumbnails/pewaris-ep-3.jpg'),
  require('../../assets/thumbnails/pewaris-ep-4.jpg'),
  require('../../assets/thumbnails/pewaris-ep-5.jpg'),
];

const nonaShenClips = [
  require('../../assets/videos/nona-shen-ep-1.mp4'),
  require('../../assets/videos/nona-shen-ep-2.mp4'),
  require('../../assets/videos/nona-shen-ep-3.mp4'),
  require('../../assets/videos/nona-shen-ep-4.mp4'),
  require('../../assets/videos/nona-shen-ep-5.mp4'),
];

const nonaShenPosters = [
  require('../../assets/thumbnails/nona-shen-ep-1.jpg'),
  require('../../assets/thumbnails/nona-shen-ep-2.jpg'),
  require('../../assets/thumbnails/nona-shen-ep-3.jpg'),
  require('../../assets/thumbnails/nona-shen-ep-4.jpg'),
  require('../../assets/thumbnails/nona-shen-ep-5.jpg'),
];

type BundledSeries = {
  readonly seriesId: string;
  readonly slug: string;
  readonly title: string;
  readonly channelName: string;
  readonly category: VideoCategory;
  readonly baseLikeCount: number;
  readonly captions: readonly string[];
  // `unknown`, not `number`: an asset module id is what `require` yields
  // when the bundled media is on disk, but a production build is made from a
  // checkout that does not have it (the media is gitignored) and
  // `metro.config.js` then resolves these to Metro's empty module. See
  // `resolveBundledMediaUri`, which is the one place that difference is
  // handled.
  readonly clips: readonly unknown[];
  readonly posters: readonly unknown[];
};

const bundledSeries: readonly BundledSeries[] = [
  {
    seriesId: 'series-pewaris',
    slug: 'pewaris',
    title: 'Balas Dendam Sang Pewaris',
    channelName: 'Short Drama Mandarin',
    category: 'Revenge',
    baseLikeCount: 18400,
    captions: [
      'Chen Wei kembali dengan nama baru dan rencana besar.',
      'Pertemuan pertama dengan keluarga yang dulu membuangnya.',
      'Satu tanda tangan mengubah peta kekuasaan perusahaan.',
      'Sekutu lama ternyata menyimpan agenda sendiri.',
      'Kartu terakhir Chen Wei akhirnya dibuka di meja rapat.',
    ],
    clips: pewarisClips,
    posters: pewarisPosters,
  },
  {
    seriesId: 'series-nona-shen',
    slug: 'nona-shen',
    title: 'Pernikahan Kilat Nona Shen',
    channelName: 'Drama Harian CN',
    category: 'Romance',
    baseLikeCount: 15100,
    captions: [
      'Pernikahan palsu mulai terasa terlalu nyata.',
      'Satu malam yang membuat keduanya sulit berpura-pura.',
      'Mantan tunangan muncul di saat paling tidak tepat.',
      'Rahasia keluarga Shen perlahan terbongkar.',
      'Nona Shen harus memilih: kontrak atau perasaannya.',
    ],
    clips: nonaShenClips,
    posters: nonaShenPosters,
  },
];

function buildEpisodes(series: BundledSeries): readonly Video[] {
  return series.clips.map((clip, index) => {
    const episodeNumber = index + 1;
    const paddedEpisode = String(episodeNumber).padStart(2, '0');

    return {
      id: `${series.seriesId}-ep-${episodeNumber}`,
      seriesId: series.seriesId,
      storageKey: `processed-videos/drama-china/${series.slug}/ep-${paddedEpisode}-id-sub.mp4`,
      playbackUrl: resolveBundledMediaUri(clip),
      thumbnailUrl: resolveBundledMediaUri(series.posters[index]),
      // Every bundled clip is re-encoded from vertical 720x1280 source.
      width: 720,
      height: 1280,
      title: series.title,
      episodeNumber,
      channelName: series.channelName,
      category: series.category,
      sourceLanguage: 'Mandarin',
      hasEmbeddedIndonesianSubtitle: true,
      processingStatus: 'completed',
      caption: series.captions[index] ?? series.title,
      likeCount: series.baseLikeCount + episodeNumber * 320,
      isSaved: false,
      // The bundled catalog is real drama content, mirroring the backend's
      // own classification of the same rows.
      contentKind: 'drama',
      // Explicit, not derived - see this module's header comment.
      accessTier: 'free',
    } satisfies Video;
  });
}

// QA fixtures (e.g. the 16:9 fullscreen sample) ride along ONLY behind the
// local `EXPO_PUBLIC_INCLUDE_QA_FIXTURES=true` opt-in - a demo/showcase
// build's catalog is byte-identical with the flag unset. See
// `qa-fixture-videos.ts` for why the fixture exists at all.
export const mockDramaVideos: readonly Video[] = [
  ...bundledSeries.flatMap(buildEpisodes),
  ...(shouldIncludeQaFixtures() ? qaFixtureVideos : []),
];
