import { buildMediaUrl } from '@/services/media/media-url';
import type { Video } from '@/types/video';

// The "10-雨夜校花（34集）" folder name indicates the local dev source has 34
// episode files following the "01.mp4", "02.mp4", ... naming convention.
// Episodes 2-7 below extend that same series so Phase 6A's free (ep 1-5) /
// premium (ep 6+) boundary and numeric-ordering behavior have real data to
// exercise. Episodes 6-7 are intentionally the first premium episodes.
const ceoDinginEpisodes: readonly Video[] = [1, 2, 3, 4, 5, 6, 7].map((episodeNumber) => ({
  id: `series-ceo-dingin-ep-${episodeNumber}`,
  seriesId: 'series-ceo-dingin',
  storageKey: `processed-videos/drama-china/ceo-dingin/ep-${String(episodeNumber).padStart(2, '0')}-id-sub.mp4`,
  playbackUrl: buildMediaUrl(
    `短剧下载/10-雨夜校花（34集）/${String(episodeNumber).padStart(2, '0')}.mp4`
  ),
  thumbnailUrl: `https://cdn.example.com/thumbnails/drama-china/ceo-dingin/ep-${String(episodeNumber).padStart(2, '0')}.jpg`,
  // Measured with ffprobe against the real local file: 1280x720 (horizontal).
  width: 1280,
  height: 720,
  title: 'Kontrak Cinta CEO Dingin',
  episodeNumber,
  channelName: 'Mandarin Drama ID',
  category: 'CEO',
  sourceLanguage: 'Mandarin',
  hasEmbeddedIndonesianSubtitle: true,
  processingStatus: 'completed',
  caption: [
    'Pertemuan pertama yang mengubah hidup Lin Yue.',
    'Lin Yue mulai curiga dengan kontrak yang ia tanda tangani.',
    'Rahasia keluarga CEO mulai terbongkar sedikit demi sedikit.',
    'Sebuah kecelakaan mempertemukan Lin Yue dengan masa lalu sang CEO.',
    'Lin Yue harus memilih antara cinta dan kebenaran.',
    'Konflik memuncak saat identitas asli CEO terungkap.',
    'Babak akhir: siapa yang benar-benar mengendalikan kontrak ini?',
  ][episodeNumber - 1],
  likeCount: 12800 + episodeNumber * 320,
  isSaved: false,
}));

export const mockDramaVideos: readonly Video[] = [
  ...ceoDinginEpisodes,
  {
    id: 'series-putri-hilang-ep-1',
    seriesId: 'series-putri-hilang',
    storageKey: 'processed-videos/drama-china/putri-hilang/ep-01-id-sub.mp4',
    // Local dev source (requires the local media server, see README):
    // /Users/gladyaz/VideoDracin/短剧下载/10-花卷致富：我的小吃店通古今！（76集）/1.mp4
    playbackUrl: buildMediaUrl('短剧下载/10-花卷致富：我的小吃店通古今！（76集）/1.mp4'),
    thumbnailUrl: 'https://cdn.example.com/thumbnails/drama-china/putri-hilang/ep-01.jpg',
    // Measured with ffprobe against the real local file: 1280x720 (horizontal).
    width: 1280,
    height: 720,
    title: 'Rahasia Putri yang Hilang',
    episodeNumber: 1,
    channelName: 'CDrama Mini',
    category: 'Family',
    sourceLanguage: 'Mandarin',
    hasEmbeddedIndonesianSubtitle: true,
    processingStatus: 'completed',
    caption: 'Sebuah liontin tua membuka identitas yang tersembunyi.',
    likeCount: 9200,
    isSaved: false,
  },
  {
    id: 'series-pewaris-ep-1',
    seriesId: 'series-pewaris',
    storageKey: 'processed-videos/drama-china/pewaris/ep-01-id-sub.mp4',
    // Local dev source (requires the local media server, see README):
    // /Users/gladyaz/VideoDracin/短剧下载/101-我与女帝的快乐生活（84集）/第1集.mp4
    playbackUrl: buildMediaUrl('短剧下载/101-我与女帝的快乐生活（84集）/第1集.mp4'),
    thumbnailUrl: 'https://cdn.example.com/thumbnails/drama-china/pewaris/ep-01.jpg',
    // Measured with ffprobe against the real local file: 720x1280 (vertical).
    width: 720,
    height: 1280,
    title: 'Balas Dendam Sang Pewaris',
    episodeNumber: 1,
    channelName: 'Short Drama Mandarin',
    category: 'Revenge',
    sourceLanguage: 'Mandarin',
    hasEmbeddedIndonesianSubtitle: true,
    processingStatus: 'completed',
    caption: 'Chen Wei kembali dengan nama baru dan rencana besar.',
    likeCount: 18400,
    isSaved: false,
  },
  {
    id: 'series-nona-shen-ep-1',
    seriesId: 'series-nona-shen',
    storageKey: 'processed-videos/drama-china/nona-shen/ep-01-id-sub.mp4',
    // Local dev source (requires the local media server, see README):
    // /Users/gladyaz/VideoDracin/短剧下载/106-找工作抱歉老娘快成仙了（70集）/1.mp4
    playbackUrl: buildMediaUrl('短剧下载/106-找工作抱歉老娘快成仙了（70集）/1.mp4'),
    thumbnailUrl: 'https://cdn.example.com/thumbnails/drama-china/nona-shen/ep-01.jpg',
    // Measured with ffprobe against the real local file: 720x1280 (vertical).
    width: 720,
    height: 1280,
    title: 'Pernikahan Kilat Nona Shen',
    episodeNumber: 1,
    channelName: 'Drama Harian CN',
    category: 'Romance',
    sourceLanguage: 'Mandarin',
    hasEmbeddedIndonesianSubtitle: true,
    processingStatus: 'completed',
    caption: 'Pernikahan palsu mulai terasa terlalu nyata.',
    likeCount: 15100,
    isSaved: false,
  },
  {
    id: 'series-topeng-ep-1',
    seriesId: 'series-topeng',
    storageKey: 'processed-videos/drama-china/topeng/ep-01-id-sub.mp4',
    // Local dev source (requires the local media server, see README):
    // /Users/gladyaz/VideoDracin/短剧下载/100-过年回家，与三个精神小妹挤软卧（74集）/11.mp4
    playbackUrl: buildMediaUrl(
      '短剧下载/100-过年回家，与三个精神小妹挤软卧（74集）/11.mp4'
    ),
    thumbnailUrl: 'https://cdn.example.com/thumbnails/drama-china/topeng/ep-01.jpg',
    // Measured with ffprobe against the real local file: 720x1280 (vertical).
    width: 720,
    height: 1280,
    title: 'Cinta di Balik Topeng',
    episodeNumber: 1,
    channelName: 'Mandarin Hits',
    category: 'Historical',
    sourceLanguage: 'Mandarin',
    hasEmbeddedIndonesianSubtitle: true,
    processingStatus: 'completed',
    caption: 'Satu pesta topeng mempertemukan dua musuh lama.',
    likeCount: 11300,
    isSaved: false,
  },
];
