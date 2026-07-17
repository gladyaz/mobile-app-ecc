import { buildMediaUrl } from '@/services/media/media-url';
import type { Video } from '@/types/video';

export const mockDramaVideos: readonly Video[] = [
  {
    id: 'drama-episode-1',
    storageKey: 'processed-videos/drama-china/ceo-dingin/ep-01-id-sub.mp4',
    // Local dev source (requires the local media server, see README):
    // /Users/gladyaz/VideoDracin/短剧下载/10-雨夜校花（34集）/01.mp4
    playbackUrl: buildMediaUrl('短剧下载/10-雨夜校花（34集）/01.mp4'),
    thumbnailUrl: 'https://cdn.example.com/thumbnails/drama-china/ceo-dingin/ep-01.jpg',
    title: 'Kontrak Cinta CEO Dingin',
    episodeNumber: 1,
    channelName: 'Mandarin Drama ID',
    category: 'CEO',
    sourceLanguage: 'Mandarin',
    hasEmbeddedIndonesianSubtitle: true,
    processingStatus: 'completed',
    caption: 'Pertemuan pertama yang mengubah hidup Lin Yue.',
    likeCount: 12800,
    isSaved: false,
  },
  {
    id: 'drama-episode-2',
    storageKey: 'processed-videos/drama-china/putri-hilang/ep-02-id-sub.mp4',
    // Local dev source (requires the local media server, see README):
    // /Users/gladyaz/VideoDracin/短剧下载/10-花卷致富：我的小吃店通古今！（76集）/1.mp4
    playbackUrl: buildMediaUrl('短剧下载/10-花卷致富：我的小吃店通古今！（76集）/1.mp4'),
    thumbnailUrl: 'https://cdn.example.com/thumbnails/drama-china/putri-hilang/ep-02.jpg',
    title: 'Rahasia Putri yang Hilang',
    episodeNumber: 2,
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
    id: 'drama-episode-3',
    storageKey: 'processed-videos/drama-china/pewaris/ep-03-id-sub.mp4',
    // Local dev source (requires the local media server, see README):
    // /Users/gladyaz/VideoDracin/短剧下载/101-我与女帝的快乐生活（84集）/第1集.mp4
    playbackUrl: buildMediaUrl('短剧下载/101-我与女帝的快乐生活（84集）/第1集.mp4'),
    thumbnailUrl: 'https://cdn.example.com/thumbnails/drama-china/pewaris/ep-03.jpg',
    title: 'Balas Dendam Sang Pewaris',
    episodeNumber: 3,
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
    id: 'drama-episode-4',
    storageKey: 'processed-videos/drama-china/nona-shen/ep-04-id-sub.mp4',
    // Local dev source (requires the local media server, see README):
    // /Users/gladyaz/VideoDracin/短剧下载/106-找工作抱歉老娘快成仙了（70集）/1.mp4
    playbackUrl: buildMediaUrl('短剧下载/106-找工作抱歉老娘快成仙了（70集）/1.mp4'),
    thumbnailUrl: 'https://cdn.example.com/thumbnails/drama-china/nona-shen/ep-04.jpg',
    title: 'Pernikahan Kilat Nona Shen',
    episodeNumber: 4,
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
    id: 'drama-episode-5',
    storageKey: 'processed-videos/drama-china/topeng/ep-05-id-sub.mp4',
    // Local dev source (requires the local media server, see README):
    // /Users/gladyaz/VideoDracin/短剧下载/100-过年回家，与三个精神小妹挤软卧（74集）/11.mp4
    playbackUrl: buildMediaUrl(
      '短剧下载/100-过年回家，与三个精神小妹挤软卧（74集）/11.mp4'
    ),
    thumbnailUrl: 'https://cdn.example.com/thumbnails/drama-china/topeng/ep-05.jpg',
    title: 'Cinta di Balik Topeng',
    episodeNumber: 5,
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
