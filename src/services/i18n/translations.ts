export const LANGUAGES = ['id', 'en', 'zh'] as const;

export type Language = (typeof LANGUAGES)[number];

/**
 * Indonesian stays the default, and its entries are the exact strings the app
 * shipped before it spoke anything else. Nothing visible changes for an
 * Indonesian viewer, and every test that queries literal copy keeps passing.
 */
export const DEFAULT_LANGUAGE: Language = 'id';

/** Each language names itself, so the picker reads correctly in any of them. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  id: 'Bahasa Indonesia',
  en: 'English',
  zh: '中文',
};

/**
 * Only the app's own chrome lives here. Titles, captions and subtitles come
 * from whatever the admin uploaded and are deliberately left untouched - the
 * language switch is not supposed to imply the content was translated too.
 */
const id = {
  'common.retry': 'Retry',
  'common.back': 'Back',

  'home.title': 'Home',
  'home.loadError': 'Video gagal dimuat.',
  'home.empty': 'Belum ada video tersedia.',
  'home.linkCopied': 'Link video disalin',
  'home.shareUnavailable': 'Share unavailable',
  'home.shareUnavailableHint': 'Please try again later.',
  'home.removedFromSaved': 'Dihapus dari Saved',
  'home.addedToSaved': 'Disimpan ke Saved',

  'discover.title': 'Discover',
  'discover.searchPlaceholder': 'Cari judul drama…',
  'discover.noResults': 'Tidak ada hasil',
  'discover.resetSearch': 'Reset pencarian',

  'saved.title': 'Saved',
  'saved.empty': 'Belum ada video tersimpan',
  'saved.videoCount': '{count} video',
  'saved.emptyBlurb': 'Simpan drama favoritmu dari Home agar mudah ditonton lagi.',
  'saved.browseHome': 'Jelajahi Home',
  'saved.unsave': 'Unsave',

  'profile.title': 'Profile',
  'profile.savedCount': 'Video tersimpan',
  'profile.likedCount': 'Video disukai',
  'profile.accountSecurity': 'Keamanan Akun',
  'profile.dataPrivacy': 'Data & Privasi',
  'profile.processingHistory': 'Processing History',
  'profile.logout': 'Logout',
  'profile.loggedOut': 'Kamu telah logout',
  'profile.guest': 'Guest User',
  'profile.guestBlurb':
    'Masuk untuk menyimpan drama favoritmu dan melanjutkan tontonan di semua perangkat.',
  'profile.login': 'Login',
  'profile.language': 'Bahasa',

  'series.loadError': 'Series gagal dimuat.',
  'series.notFound': 'Series tidak ditemukan.',
  'series.episodeCount': '{count} episode',
  'series.continueWatching': 'Lanjutkan Menonton',
  'series.startWatching': 'Mulai Menonton',
  'series.episodes': 'Episodes',
  'series.noEpisodes': 'Belum ada episode tersedia.',
  'series.free': 'Free',
  'series.premium': 'Premium',
  'series.unavailable': 'Tidak tersedia',
  'series.nowPlaying': 'Sedang diputar',

  'feed.videoUnavailable': 'Video unavailable',
  'feed.videoUnavailableHint': 'Check the local media server connection.',
  'feed.fullscreen': 'Fullscreen',
  'feed.nextEpisode': 'Episode Berikutnya',
  'feed.more': 'more',
  'feed.less': 'less',
  'feed.clearDisplay': 'Tampilan bersih',

  'login.title': 'Masuk',
  'login.subtitle': 'Gunakan akun Red Panda kamu.',
  'login.email': 'Email',
  'login.emailPlaceholder': 'nama@email.com',
  'login.password': 'Password',
  'login.submit': 'Login',
  'login.submitting': 'Memproses...',
  'login.hint': 'Isi email valid & password apa pun — akun dibuat otomatis jika belum ada.',
  'login.emailRequired': 'Email wajib diisi',
  'login.emailInvalid': 'Format email tidak valid',
  'login.passwordRequired': 'Password wajib diisi',
  'login.welcome': 'Selamat datang!',
  'login.failed': 'Login gagal. Periksa koneksi kamu dan coba lagi.',
} as const;

export type TranslationKey = keyof typeof id;

type Copy = Record<TranslationKey, string>;

const en: Copy = {
  'common.retry': 'Retry',
  'common.back': 'Back',

  'home.title': 'Home',
  'home.loadError': 'Could not load videos.',
  'home.empty': 'No videos yet.',
  'home.linkCopied': 'Video link copied',
  'home.shareUnavailable': 'Share unavailable',
  'home.shareUnavailableHint': 'Please try again later.',
  'home.removedFromSaved': 'Removed from Saved',
  'home.addedToSaved': 'Added to Saved',

  'discover.title': 'Discover',
  'discover.searchPlaceholder': 'Search drama titles…',
  'discover.noResults': 'No results',
  'discover.resetSearch': 'Reset search',

  'saved.title': 'Saved',
  'saved.empty': 'Nothing saved yet',
  'saved.videoCount': '{count} videos',
  'saved.emptyBlurb': 'Save dramas you like from Home so they are easy to find again.',
  'saved.browseHome': 'Browse Home',
  'saved.unsave': 'Unsave',

  'profile.title': 'Profile',
  'profile.savedCount': 'Saved videos',
  'profile.likedCount': 'Liked videos',
  'profile.accountSecurity': 'Account Security',
  'profile.dataPrivacy': 'Data & Privacy',
  'profile.processingHistory': 'Processing History',
  'profile.logout': 'Log out',
  'profile.loggedOut': 'You have been logged out',
  'profile.guest': 'Guest User',
  'profile.guestBlurb':
    'Sign in to keep your favourite dramas and pick up where you left off on any device.',
  'profile.login': 'Log in',
  'profile.language': 'Language',

  'series.loadError': 'Could not load the series.',
  'series.notFound': 'Series not found.',
  'series.episodeCount': '{count} episodes',
  'series.continueWatching': 'Continue Watching',
  'series.startWatching': 'Start Watching',
  'series.episodes': 'Episodes',
  'series.noEpisodes': 'No episodes yet.',
  'series.free': 'Free',
  'series.premium': 'Premium',
  'series.unavailable': 'Unavailable',
  'series.nowPlaying': 'Now playing',

  'feed.videoUnavailable': 'Video unavailable',
  'feed.videoUnavailableHint': 'Check the local media server connection.',
  'feed.fullscreen': 'Fullscreen',
  'feed.nextEpisode': 'Next Episode',
  'feed.more': 'more',
  'feed.less': 'less',
  'feed.clearDisplay': 'Clear display',

  'login.title': 'Sign in',
  'login.subtitle': 'Use your Red Panda account.',
  'login.email': 'Email',
  'login.emailPlaceholder': 'name@email.com',
  'login.password': 'Password',
  'login.submit': 'Log in',
  'login.submitting': 'Signing in...',
  'login.hint': 'Any valid email and any password — an account is created if you do not have one.',
  'login.emailRequired': 'Email is required',
  'login.emailInvalid': 'That email address is not valid',
  'login.passwordRequired': 'Password is required',
  'login.welcome': 'Welcome!',
  'login.failed': 'Sign in failed. Check your connection and try again.',
};

const zh: Copy = {
  'common.retry': '重试',
  'common.back': '返回',

  'home.title': '首页',
  'home.loadError': '视频加载失败。',
  'home.empty': '暂无视频。',
  'home.linkCopied': '已复制视频链接',
  'home.shareUnavailable': '无法分享',
  'home.shareUnavailableHint': '请稍后再试。',
  'home.removedFromSaved': '已从收藏中移除',
  'home.addedToSaved': '已加入收藏',

  'discover.title': '发现',
  'discover.searchPlaceholder': '搜索剧名…',
  'discover.noResults': '没有结果',
  'discover.resetSearch': '重置搜索',

  'saved.title': '收藏',
  'saved.empty': '还没有收藏的视频',
  'saved.videoCount': '{count} 个视频',
  'saved.emptyBlurb': '在首页收藏喜欢的短剧，方便随时再看。',
  'saved.browseHome': '去首页看看',
  'saved.unsave': '取消收藏',

  'profile.title': '我的',
  'profile.savedCount': '收藏的视频',
  'profile.likedCount': '点赞的视频',
  'profile.accountSecurity': '账号安全',
  'profile.dataPrivacy': '数据与隐私',
  'profile.processingHistory': '处理记录',
  'profile.logout': '退出登录',
  'profile.loggedOut': '你已退出登录',
  'profile.guest': '访客',
  'profile.guestBlurb': '登录后即可收藏喜欢的短剧，并在任意设备上继续观看。',
  'profile.login': '登录',
  'profile.language': '语言',

  'series.loadError': '剧集加载失败。',
  'series.notFound': '未找到该剧集。',
  'series.episodeCount': '{count} 集',
  'series.continueWatching': '继续观看',
  'series.startWatching': '开始观看',
  'series.episodes': '剧集',
  'series.noEpisodes': '暂无剧集。',
  'series.free': '免费',
  'series.premium': '会员',
  'series.unavailable': '暂不可用',
  'series.nowPlaying': '正在播放',

  'feed.videoUnavailable': '视频不可用',
  'feed.videoUnavailableHint': '请检查本地媒体服务器连接。',
  'feed.fullscreen': '全屏',
  'feed.nextEpisode': '下一集',
  'feed.more': '展开',
  'feed.less': '收起',
  'feed.clearDisplay': '清屏模式',

  'login.title': '登录',
  'login.subtitle': '使用你的 Red Panda 账号。',
  'login.email': '邮箱',
  'login.emailPlaceholder': 'name@email.com',
  'login.password': '密码',
  'login.submit': '登录',
  'login.submitting': '正在登录...',
  'login.hint': '填写有效邮箱和任意密码 — 没有账号会自动创建。',
  'login.emailRequired': '请填写邮箱',
  'login.emailInvalid': '邮箱格式不正确',
  'login.passwordRequired': '请填写密码',
  'login.welcome': '欢迎！',
  'login.failed': '登录失败，请检查网络后重试。',
};

export const translations: Record<Language, Copy> = { id, en, zh };
