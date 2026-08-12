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
 * library render with heavy letterboxing. Episodes are limited to 1-5,
 * which are the free tier - a demo viewer should never hit a paywall they
 * cannot clear.
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
  readonly clips: readonly number[];
  readonly posters: readonly number[];
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
