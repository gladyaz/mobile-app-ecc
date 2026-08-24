import type { Video, VideoAccessTier, VideoCategory, VideoContentKind } from '@/types/video';

export type BackendVideoDto = {
  readonly id: string;
  readonly seriesId: string;
  readonly title: string;
  readonly episodeNumber: number;
  readonly channelName: string;
  readonly caption: string;
  readonly category: string;
  readonly storageKey: string;
  readonly playbackUrl: string;
  readonly thumbnailUrl?: string;
  readonly width?: number;
  readonly height?: number;
  readonly sourceLanguage: string;
  readonly hasEmbeddedIndonesianSubtitle: boolean;
  readonly likeCount: number;
  readonly contentKind: string;
  /**
   * The backend's RESOLVED effective access tier for this episode
   * (`VideoResponseDto.accessTier`, backend commit 2f285d1) - required on
   * every video the backend serves, on all three surfaces that carry one
   * (`/videos/feed`, `/videos/:id`, `/series/:id`'s embedded episodes),
   * because all three are built by the same `toVideoResponseDto`.
   *
   * Typed `string` rather than the narrowed union for the same reason
   * `contentKind` is: this is the raw wire shape, and narrowing it here
   * would assert a guarantee the network cannot make.
   *
   * The raw admin-set `Video.accessTierOverride` that may have produced this
   * value is deliberately NOT part of the public contract and is never sent
   * here - the client sees only the resolved answer.
   */
  readonly accessTier: string;
  readonly durationSeconds?: number;
};

const VIDEO_CATEGORIES: readonly VideoCategory[] = [
  'Romance',
  'Revenge',
  'Family',
  'CEO',
  'Historical',
  'Action',
  'Comedy',
  'Drama',
];

/**
 * Backend category casing has been observed to vary (e.g. "romance" instead
 * of "Romance"); match case-insensitively and normalize to the mobile
 * app's canonical casing instead of rejecting an otherwise-valid category.
 */
function normalizeCategory(value: string): VideoCategory | undefined {
  return VIDEO_CATEGORIES.find(
    (category) => category.toLowerCase() === value.toLowerCase()
  );
}

function assertField(condition: boolean, fieldName: string, dto: unknown): void {
  if (!condition) {
    throw new Error(
      `[video-mapper] Backend video is missing or has an invalid "${fieldName}" field: ${JSON.stringify(dto)}`
    );
  }
}

/**
 * Maps a raw backend video DTO to the mobile Video model. Validates the
 * fields the UI actually depends on so a malformed backend response fails
 * loudly here instead of silently rendering a broken feed item.
 *
 * storageKey is a backend-only identifier and is never used for playback;
 * playback always uses playbackUrl.
 */
const CONTENT_KINDS: readonly VideoContentKind[] = ['drama', 'qa_fixture'];

/**
 * Reads the backend's explicit classification. NEVER inferred - title,
 * channelName, sourceLanguage, storageKey, seriesId and dimensions were each
 * evaluated and rejected: display strings break on a rename, `sourceLanguage`
 * describes the content's language rather than its realness, and an empty
 * `storageKey` is exactly how legitimate R2-backed media is represented.
 *
 * A missing or unrecognised value is a CONTRACT ERROR and throws in dev, so a
 * backend that stops sending the field fails loudly at the boundary instead of
 * quietly changing what the catalog contains.
 *
 * In production it degrades to `drama` rather than throwing or guessing
 * `qa_fixture`. The asymmetry is deliberate: mislabelling one fixture as
 * content is a cosmetic bug, while mislabelling real content as a fixture
 * would erase it from every user-facing surface - and throwing would blank the
 * whole feed over one bad row.
 */
function resolveContentKind(dto: BackendVideoDto): VideoContentKind {
  const value = dto.contentKind;

  if (typeof value === 'string' && (CONTENT_KINDS as readonly string[]).includes(value)) {
    return value as VideoContentKind;
  }

  assertField(!__DEV__, 'contentKind', dto);

  return 'drama';
}

const ACCESS_TIERS: readonly VideoAccessTier[] = ['free', 'premium'];

/**
 * Reads the backend's authoritative access tier. NEVER derived from
 * `episodeNumber`, from the series' `hasPremiumEpisodes` badge, or from any
 * other field: the backend's `resolveAccessTier` lets an explicit
 * per-episode admin override beat the episode-number default, so episode 2
 * can be premium and episode 8 can be free. Re-deriving it here would
 * reintroduce exactly the client-side policy this field exists to retire,
 * and would let the lock icon disagree with what `/stream` actually allows.
 *
 * A missing or unrecognised value is a CONTRACT ERROR and throws in dev, so
 * a backend that stops sending the field fails loudly at the boundary -
 * matching how `contentKind` is handled one function above.
 *
 * In production it degrades to `premium`, which is the OPPOSITE direction
 * from `contentKind`'s fail-open, and deliberately so. `/stream` remains the
 * only real authority, so neither choice can grant access the backend would
 * refuse - the question is purely which wrong guess treats the viewer better:
 *
 *   - Guessing `free` shows no lock, then dead-ends a non-entitled viewer in
 *     the generic "video unavailable" state when the backend refuses the
 *     stream. It is also a fail-OPEN access default, which is precisely the
 *     shape of bug this field was introduced to remove.
 *   - Guessing `premium` routes that viewer into the existing, designed
 *     upsell instead. An entitled viewer is unaffected either way: the gate
 *     is `accessType === 'premium' && !isPremium`, so a premium subscriber
 *     passes straight through.
 *
 * The cost is that one malformed row may show a paywall on content that was
 * actually free - visible, recoverable, and strictly better than silently
 * under-reporting a paywall. It is never a silent default to `free`.
 */
/**
 * The fallback category for a row whose `category` the client does not
 * recognise. `Drama` is the app's own generic bucket, and category is a
 * display/filter label only - it gates no access and no playback.
 */
const FALLBACK_CATEGORY: VideoCategory = 'Drama';

/**
 * Reads the category, degrading rather than throwing in production - the same
 * policy `resolveContentKind` above applies, and for a stronger reason.
 *
 * This used to be a bare `assertField`, which throws unconditionally. Because
 * `getVideoFeed` maps the whole page in one pass, ONE row carrying a category
 * the client has never heard of took down the ENTIRE feed and left the viewer
 * on the error state - and the way that row comes to exist is somebody adding
 * a category on the backend, which is an ordinary, additive content operation
 * that nobody would expect to break every installed app.
 *
 * Degrading costs one row a slightly wrong filter label, which is visible and
 * recoverable. The dev-time throw is kept so the drift is still caught at the
 * boundary by whoever can fix it.
 */
function resolveCategory(dto: BackendVideoDto): VideoCategory {
  const value = typeof dto.category === 'string' ? normalizeCategory(dto.category) : undefined;

  if (value !== undefined) {
    return value;
  }

  assertField(!__DEV__, 'category', dto);

  return FALLBACK_CATEGORY;
}

function resolveAccessTier(dto: BackendVideoDto): VideoAccessTier {
  const value = dto.accessTier;

  if (typeof value === 'string' && (ACCESS_TIERS as readonly string[]).includes(value)) {
    return value as VideoAccessTier;
  }

  assertField(!__DEV__, 'accessTier', dto);

  return 'premium';
}

export function mapBackendVideoToVideo(dto: BackendVideoDto): Video {
  assertField(typeof dto.id === 'string' && dto.id.length > 0, 'id', dto);
  assertField(typeof dto.seriesId === 'string' && dto.seriesId.length > 0, 'seriesId', dto);
  assertField(typeof dto.title === 'string' && dto.title.length > 0, 'title', dto);
  assertField(typeof dto.episodeNumber === 'number', 'episodeNumber', dto);
  assertField(typeof dto.channelName === 'string', 'channelName', dto);
  assertField(typeof dto.caption === 'string', 'caption', dto);
  const normalizedCategory = resolveCategory(dto);
  assertField(typeof dto.storageKey === 'string', 'storageKey', dto);
  assertField(
    typeof dto.playbackUrl === 'string' && dto.playbackUrl.length > 0,
    'playbackUrl',
    dto
  );
  assertField(typeof dto.sourceLanguage === 'string', 'sourceLanguage', dto);
  assertField(
    typeof dto.hasEmbeddedIndonesianSubtitle === 'boolean',
    'hasEmbeddedIndonesianSubtitle',
    dto
  );
  assertField(typeof dto.likeCount === 'number', 'likeCount', dto);
  const contentKind = resolveContentKind(dto);
  const accessTier = resolveAccessTier(dto);

  return {
    id: dto.id,
    seriesId: dto.seriesId,
    storageKey: dto.storageKey,
    playbackUrl: dto.playbackUrl,
    thumbnailUrl: dto.thumbnailUrl ?? '',
    width: dto.width,
    height: dto.height,
    title: dto.title,
    episodeNumber: dto.episodeNumber,
    channelName: dto.channelName,
    category: normalizedCategory,
    sourceLanguage: dto.sourceLanguage,
    hasEmbeddedIndonesianSubtitle: dto.hasEmbeddedIndonesianSubtitle,
    // The feed only returns playable videos, so treat every backend-fetched
    // video as completed; the backend does not include processing status here.
    processingStatus: 'completed',
    caption: dto.caption,
    likeCount: dto.likeCount,
    contentKind,
    accessTier,
    // Save state is tracked locally by useVideoInteractions, not the backend.
    isSaved: false,
  };
}
