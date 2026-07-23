# Mobile API Contract

This contract describes the backend API for the AI Short Drama Mobile App. `GET /videos/feed` and `GET /videos/:id` are wired up today (`src/services/videos/video-service.ts` calls the typed client in `src/services/api/client.ts`), gated by `EXPO_PUBLIC_USE_MOCK_DATA`: when that flag is `true` the app resolves the bundled mock data from `src/data/mock-drama-videos.ts` instead of calling the backend. As of Phase 8, `/auth/register`, `/auth/login`, `/auth/refresh`, and `/auth/logout` are also wired up for real: `src/services/auth/auth-service.ts` calls the backend through the same typed client, `src/stores/auth.tsx` drives login/logout with real tokens (persisted via `src/services/storage/local-storage.ts`), and `src/services/api/client.ts` has a refresh-on-401 interceptor. As of Phase 9, like/save (`/videos/:id/like`, `/videos/:id/save`, `GET /users/me/interactions`) and watch progress (`PUT /series/:id/progress`, `GET /users/me/progress`) are also wired up for real, through an explicit sync-queue architecture described below the relevant endpoints. Every other endpoint documented below is still not connected — view tracking, search, category browsing, the user profile, and analytics remain client-side only (local React Context stores backed by AsyncStorage, plus in-memory filtering of the already-fetched feed), with no HTTP call to the backend. See the per-endpoint "Connected" notes below for specifics.

**Sync-queue architecture (like/save/progress, Phase 9):** `src/stores/video-interactions.tsx` and `src/stores/series-progress.tsx` both follow the same pattern. `toggleLike`/`toggleSave`/`recordProgress` update local state immediately (optimistic UI) and enqueue an explicit, `AsyncStorage`-persisted sync command, ordered per-entity (per `videoId` for interactions, per `seriesId` for progress) so an older command can never race ahead of a newer one for the same entity. A background drain loop (module-level, not a hook, so a scheduled retry survives across renders) pushes queued commands to the backend once the user is authenticated and the auth store has hydrated; a failed push retries with exponential backoff (capped) and sets a recoverable `hasSyncFailures` flag that callers can surface in the UI rather than losing the local change. First-login merge (reconciling whatever was recorded locally before the user authenticated against what the backend already has for that user) is a separate, one-time bootstrap step that calls the backend directly to converge state — it does not go through the sync queue and is never observed by the queue-drain logic.

Base path assumption: `/api/v1`

Auth model assumption: authenticated endpoints use `Authorization: Bearer <access_token>` after real auth is implemented. MVP responses should use a consistent envelope:

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": null
}
```

## Suggested Schemas

### Video

```json
{
  "id": "video_001",
  "seriesId": "series_ceo_dingin",
  "title": "Kontrak Cinta CEO Dingin",
  "episodeNumber": 1,
  "channelName": "Mandarin Drama ID",
  "category": "CEO",
  "caption": "Pertemuan pertama yang mengubah hidup Lin Yue.",
  "storageKey": "processed-videos/drama-china/series-a/ep-01-id-sub.mp4",
  "playbackUrl": "https://media.example.com/videos/video_001.mp4",
  "thumbnailUrl": "https://cdn.example.com/videos/video_001.jpg",
  "sourceLanguage": "Mandarin",
  "hasEmbeddedIndonesianSubtitle": true,
  "processingStatus": "completed",
  "durationSeconds": 72,
  "likeCount": 12800,
  "viewCount": 245000,
  "isLiked": false,
  "isSaved": false,
  "createdAt": "2026-07-10T00:00:00.000Z",
  "updatedAt": "2026-07-10T00:00:00.000Z"
}
```

The mobile app uses `playbackUrl` for the final processed video, which already has Indonesian subtitles burned in. `storageKey` and raw internal storage paths are backend-only values and must not be treated as mobile-readable file paths. The mobile app does not request or render separate subtitle tracks. `seriesId` groups episodes that belong to the same drama; it has been present on backend video responses since before Phase 6A but was previously dropped by the mobile mapper.

### Series and Episode (Phase 6A, client-derived — not a backend schema)

Phase 6A does not add a `/series` backend endpoint. Instead, the mobile app groups the existing `/videos/feed` response by `seriesId` at runtime (`src/services/videos/series-service.ts`). The shapes below describe that derived, in-memory model, not a wire format:

```json
{
  "id": "series_ceo_dingin",
  "title": "Kontrak Cinta CEO Dingin",
  "description": "Pertemuan pertama yang mengubah hidup Lin Yue.",
  "category": "CEO",
  "channelName": "Mandarin Drama ID",
  "coverUrl": "https://cdn.example.com/videos/video_001.jpg",
  "totalEpisodes": 7,
  "episodeCount": 7,
  "releaseStatus": "ongoing",
  "episodes": [
    {
      "videoId": "video_001",
      "seriesId": "series_ceo_dingin",
      "episodeNumber": 1,
      "title": "Kontrak Cinta CEO Dingin",
      "thumbnailUrl": "https://cdn.example.com/videos/video_001.jpg",
      "playbackUrl": "https://media.example.com/videos/video_001.mp4",
      "accessType": "free",
      "isAvailable": true,
      "hasEmbeddedIndonesianSubtitle": true
    }
  ]
}
```

Access rule: episodes 1-5 are `"free"`, episode 6 onward is `"premium"` (`FREE_EPISODE_LIMIT = 5`). **No payment, subscription, credit balance, or purchase flow is implemented.** As of Phase 10, this is no longer a display/UX-only rule: the backend enforces it too — `GET /videos/:id/stream` rejects premium episodes for non-entitled users with `403 ENTITLEMENT_REQUIRED` (see the `playbackUrl` note above and `GET /users/me/entitlement` below). The client-side preview modal remains as the UX layer in front of that enforcement, not a substitute for it.

### Recommended Future: Series Endpoints (not implemented)

If series metadata ever outgrows what a client-side group-by can support (e.g. per-series descriptions/covers distinct from any single episode, moderation state, release calendars), the smallest useful backend addition would be:

- `GET /series` — paginated list of series summaries
- `GET /series/:id` — one series with its episode list
- `GET /series/:id/episodes` — episode list only
- `GET /series/:id/episodes/:episodeNumber` — one episode's detail

None of these exist yet and Phase 6A does not require them: `seriesId` already round-trips through `/videos/feed`, so the mobile client groups locally. `playbackUrl` would continue to be backend-generated in all cases; internal storage paths remain backend-only. An unknown series or episode should return the standard error envelope with a `404`-equivalent `code` such as `SERIES_NOT_FOUND` / `EPISODE_NOT_FOUND`.

### User

```json
{
  "id": "user_001",
  "name": "Gladyaz",
  "username": "gladyaz",
  "email": "gladyaz@example.com",
  "avatarUrl": null,
  "savedVideoCount": 3,
  "createdAt": "2026-07-10T00:00:00.000Z",
  "updatedAt": "2026-07-10T00:00:00.000Z"
}
```

### Error Response

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email is required.",
    "details": {
      "field": "email"
    }
  },
  "meta": null
}
```

## Endpoints

### POST /auth/register

- Purpose: Create a new account and return session tokens plus the current user.
- Method and path: `POST /auth/register`
- Auth required: No
- Request body (from `register()` in `src/services/auth/auth-service.ts`):

```json
{
  "email": "gladyaz@example.com",
  "password": "password",
  "displayName": "Gladyaz"
}
```

`displayName` is omitted from the body entirely when not provided (not sent as `null`/empty string).

- Example response (`AuthResponse`, `src/types/auth.ts`):

```json
{
  "accessToken": "jwt_access_token",
  "refreshToken": "jwt_refresh_token",
  "user": {
    "id": "user_001",
    "email": "gladyaz@example.com",
    "displayName": "Gladyaz"
  }
}
```

`user.displayName` is optional; the mobile app falls back to the email's local-part for its own `name`/`username` display fields when absent (`deriveAuthUser()` in `src/stores/auth.tsx`).

- Mobile screen: Login (fallback path only — see the `/auth/login` Connected note below; there is no dedicated registration screen)
- MVP priority: P0
- Backend notes: Throws `ApiError` with code `EMAIL_ALREADY_REGISTERED` (status 409) if the email is already taken.
- Connected: Yes. `register()` in `src/services/auth/auth-service.ts` calls `request('auth/register', ...)`. It is invoked from `src/stores/auth.tsx`'s `login()` only as a fallback (see the login-or-register behavior documented under `/auth/login` below) — there is no standalone "create account" screen or button.

### POST /auth/login

- Purpose: Authenticate a user and return session tokens plus the current user.
- Method and path: `POST /auth/login`
- Auth required: No
- Request body (from `login()` in `src/services/auth/auth-service.ts`):

```json
{
  "email": "gladyaz@example.com",
  "password": "password"
}
```

- Example response (`AuthResponse`, `src/types/auth.ts`):

```json
{
  "accessToken": "jwt_access_token",
  "refreshToken": "jwt_refresh_token",
  "user": {
    "id": "user_001",
    "email": "gladyaz@example.com",
    "displayName": "Gladyaz"
  }
}
```

- Mobile screen: Login, Profile
- MVP priority: P0
- Backend notes: Use password hashing, rate limiting, and generic invalid-credential messages. `login()` throws `ApiError` with code `INVALID_CREDENTIALS` (status 401) for either a wrong password or a nonexistent email — the backend intentionally does not distinguish the two.
- Connected: Yes. `src/app/login.tsx` calls `useAuth().login(email, password)`, which is implemented in `src/stores/auth.tsx`. **Login-or-register fallback behavior:** `login()` first calls `loginRequest()` (`POST /auth/login`); if that throws an `ApiError` with code `INVALID_CREDENTIALS`, it calls `registerRequest()` (`POST /auth/register`) instead, so a not-yet-registered email transparently creates an account rather than failing. Any other error (network failure, a different error code, etc.) propagates without attempting registration. On success from either path, the store derives its own `AuthUser` shape (`{ id, name, username, email }`) from the backend's `{ id, email, displayName? }` via `deriveAuthUser()`, stores the returned tokens in `token-store.ts`, and persists both to `AsyncStorage`.

### POST /auth/refresh

- Purpose: Rotate an access/refresh token pair using a still-valid refresh token.
- Method and path: `POST /auth/refresh`
- Auth required: No (the refresh token itself is the credential)
- Request body (from `refresh()` in `src/services/auth/auth-service.ts`):

```json
{
  "refreshToken": "jwt_refresh_token"
}
```

- Example response (`AuthResponse`, `src/types/auth.ts`):

```json
{
  "accessToken": "new_jwt_access_token",
  "refreshToken": "new_jwt_refresh_token",
  "user": {
    "id": "user_001",
    "email": "gladyaz@example.com",
    "displayName": "Gladyaz"
  }
}
```

- Mobile screen: None directly — this is infrastructure invoked automatically by the HTTP client, not by any screen.
- MVP priority: P0
- Backend notes: Throws `ApiError` with code `INVALID_REFRESH_TOKEN` (status 401) on any failure; the previous refresh token becomes invalid once a call succeeds.
- Connected: Yes, as an interceptor rather than a direct per-screen call. `src/services/api/client.ts`'s `request()` accepts a `{ requiresAuth: true }` config that attaches `Authorization: Bearer <accessToken>` (read from `src/services/auth/token-store.ts`) to the request. On a `401` response with code `INVALID_ACCESS_TOKEN`, the client calls `POST /auth/refresh` exactly once (via its own internal `attemptTokenRefresh()`, not by importing `auth-service.ts`, to avoid a circular import) and, if that succeeds, retries the original request exactly once with the new access token. If the refresh itself fails, tokens are cleared, which forces a client-side logout through `token-store.ts`'s subscription (consumed by `src/stores/auth.tsx`), and the original `401` propagates. **As of this writing, no request in the codebase is made with `requiresAuth: true`** — `/videos/feed`, `/videos/:id`, and all `/auth/*` calls are unauthenticated or send their own explicit `Authorization` header (see `/auth/me` below) — so this interceptor is currently dormant infrastructure for future authenticated endpoints, not something that fires in normal use today. `auth-service.ts`'s own `refresh()` function (same request shape) is separate, unused code kept for parity/testability; the client's internal refresh path does not call it.

### POST /auth/logout

- Purpose: Invalidate the current session or refresh token.
- Method and path: `POST /auth/logout`
- Auth required: Yes
- Request body (from `logout()` in `src/services/auth/auth-service.ts`):

```json
{
  "refreshToken": "jwt_refresh_token"
}
```

- Example response: The mobile client discards the response body (`logout()` returns `void`); the backend's actual envelope is expected to follow the standard shape but is not asserted on.

- Mobile screen: Profile
- MVP priority: P0
- Backend notes: Support idempotent logout so repeated requests are safe — the backend is expected to always succeed, even for an unknown/already-revoked token.
- Connected: Yes. `src/stores/auth.tsx`'s `logout()` calls `logoutRequest(refreshToken)` (`POST /auth/logout`) when a refresh token is present, then unconditionally clears local state (`token-store.ts`, `AsyncStorage`) regardless of whether the request succeeds — a failed network logout is treated as best-effort and does not block the client-side logout.

### GET /auth/me

- Purpose: Return the authenticated session user.
- Method and path: `GET /auth/me`
- Auth required: Yes
- Request params/body: None; sends `Authorization: Bearer <accessToken>` explicitly (from `getCurrentUser()` in `src/services/auth/auth-service.ts`) rather than via the client's `requiresAuth` config.
- Example response (`AuthUser`, `src/types/auth.ts`):

```json
{
  "id": "user_001",
  "email": "gladyaz@example.com",
  "displayName": "Gladyaz"
}
```

- Mobile screen: None currently.
- MVP priority: P0
- Backend notes: Throws `ApiError` with code `INVALID_ACCESS_TOKEN` (status 401) on any failure (expired, revoked, or malformed token).
- Connected: Implemented but unused, similar to `getVideoById` (see the `/videos/:id` Connected note below). `getCurrentUser(accessToken)` in `src/services/auth/auth-service.ts` calls `request('auth/me', ...)` and is unit-tested, but nothing in the app currently calls it — app bootstrap instead rehydrates the persisted user/tokens directly from `AsyncStorage` in `src/stores/auth.tsx`'s hydration effect, without a round trip to the backend.

### GET /videos/feed

- Purpose: Return the vertical short-drama feed.
- Method and path: `GET /videos/feed`
- Auth required: Optional for MVP. Note: even when a `Bearer` token is eventually sent, the mobile app currently ignores any `isLiked`/`isSaved` fields on the response — like/save state is tracked entirely client-side (see Connected note below), so this contract's `isLiked`/`isSaved` fields are aspirational until the mobile mapper is updated to read them.
- Request query params:

```json
{
  "cursor": "optional_cursor",
  "limit": 10
}
```

- Example response:

```json
{
  "success": true,
  "data": {
    "videos": [
      {
        "id": "video_001",
        "seriesId": "series_ceo_dingin",
        "title": "Kontrak Cinta CEO Dingin",
        "episodeNumber": 1,
        "channelName": "Mandarin Drama ID",
        "category": "CEO",
        "storageKey": "processed-videos/drama-china/series-a/ep-01-id-sub.mp4",
        "playbackUrl": "https://media.example.com/videos/video_001.mp4",
        "thumbnailUrl": "https://media.example.com/thumbnails/video_001.jpg",
        "sourceLanguage": "Mandarin",
        "hasEmbeddedIndonesianSubtitle": true,
        "processingStatus": "completed",
        "likeCount": 12800,
        "isLiked": false,
        "isSaved": false
      }
    ]
  },
  "error": null,
  "meta": {
    "nextCursor": "next_cursor"
  }
}
```

- Mobile screen: Home
- MVP priority: P0
- Backend notes: Optimize for paginated mobile playback. Backend can serve processed videos through a media/static endpoint first, then later return CDN or signed URLs in `playbackUrl`.
- Connected: Yes. `getVideoFeed()` in `src/services/videos/video-service.ts` calls `request('videos/feed')` (the typed client in `src/services/api/client.ts`), and `VideoCatalogProvider` (`src/features/videos/video-catalog-provider.tsx`) fetches it on mount for the Home feed. `id`, `seriesId`, `title`, `episodeNumber`, `channelName`, `caption`, `category`, `storageKey`, `playbackUrl`, `sourceLanguage`, and `hasEmbeddedIndonesianSubtitle`, and `likeCount` are all validated as required by `mapBackendVideoToVideo` (`src/services/videos/video-mapper.ts`) and will throw if missing; `thumbnailUrl`, `width`, `height`, and `durationSeconds` are optional. The mapper always sets `isSaved: false` and drops any `isLiked` field entirely — save/like state comes only from the local `VideoInteractionsProvider` (`src/stores/video-interactions.tsx`), not this response. When `EXPO_PUBLIC_USE_MOCK_DATA=true`, this call is bypassed and bundled mock data is returned instead.
- **`playbackUrl` (Phase 10, work unit 10-B3/10-M2):** the video stream endpoint (`GET {playbackUrl}`, i.e. `GET /videos/:id/stream` on the backend) now requires `Authorization: Bearer <accessToken>` — previously unauthenticated. `src/components/drama-feed-item.tsx` attaches the current access token (read from `src/services/auth/token-store.ts`) via `expo-video`'s `VideoSource.headers` option, since `useVideoPlayer` is a native player call, not a `request()`-mediated fetch. Episodes past `FREE_EPISODE_LIMIT` additionally require an active entitlement — see `GET /users/me/entitlement` below.

### GET /videos/:id

- Purpose: Return detail data for one video.
- Method and path: `GET /videos/:id`
- Auth required: Optional for MVP
- Request path params:

```json
{
  "id": "video_001"
}
```

- Example response:

```json
{
  "success": true,
  "data": {
    "video": {
      "id": "video_001",
      "seriesId": "series_ceo_dingin",
      "title": "Kontrak Cinta CEO Dingin",
      "episodeNumber": 1,
      "channelName": "Mandarin Drama ID",
      "category": "CEO",
      "caption": "Pertemuan pertama yang mengubah hidup Lin Yue.",
      "storageKey": "processed-videos/drama-china/series-a/ep-01-id-sub.mp4",
      "playbackUrl": "https://media.example.com/videos/video_001.mp4",
      "thumbnailUrl": "https://media.example.com/thumbnails/video_001.jpg",
      "sourceLanguage": "Mandarin",
      "hasEmbeddedIndonesianSubtitle": true,
      "processingStatus": "completed",
      "likeCount": 12800,
      "isLiked": false,
      "isSaved": false
    }
  },
  "error": null,
  "meta": null
}
```

- Mobile screen: Future video detail, Home
- MVP priority: P1
- Backend notes: Return 404 with the standard error envelope when the video does not exist. `storageKey` should identify internal storage records, while `playbackUrl` should be the only field used for mobile playback.
- Connected: Yes, at the service layer. `getVideoById(id)` in `src/services/videos/video-service.ts` calls `request('videos/${id}')` and maps a `404` `ApiError` to `undefined` for callers. As of this writing there is no mobile screen that calls `getVideoById`; it exists and is unit-tested but is not yet wired into a route/component (Home and other screens currently read videos out of the already-fetched `/videos/feed` list). Like `/videos/feed`, `isLiked`/`isSaved` on the response are currently ignored by the mapper.

### POST /videos/:id/view

- Purpose: Record a video view event.
- Method and path: `POST /videos/:id/view`
- Auth required: Optional
- Request path/body:

```json
{
  "id": "video_001",
  "watchDurationSeconds": 18,
  "completed": false
}
```

- Example response:

```json
{
  "success": true,
  "data": {
    "recorded": true
  },
  "error": null,
  "meta": null
}
```

- Mobile screen: Home
- MVP priority: P1
- Backend notes: Deduplicate noisy events and avoid blocking playback on failures.
- Connected: No. No view-tracking call exists anywhere in the mobile codebase today.

### POST /videos/:id/like

- Purpose: Like a video for the authenticated user.
- Method and path: `POST /videos/:id/like`
- Auth required: Yes
- Request path params:

```json
{
  "id": "video_001"
}
```

- Example response (`LikeResponse`, `src/types/interaction.ts` — raw DTO, no `{success, data}` envelope, same pattern as `/auth/*`):

```json
{
  "videoId": "video_001",
  "isLiked": true,
  "likeCount": 12801
}
```

- Mobile screen: Home, Discover
- MVP priority: P0
- Backend notes: Make this idempotent if the video is already liked. Throws `ApiError` with code `VIDEO_NOT_FOUND` (status 404) if the video doesn't exist, or `INVALID_ACCESS_TOKEN` (status 401) if unauthenticated.
- Connected: Yes. `likeVideo(videoId)` in `src/services/interactions/interactions-service.ts` calls `request('videos/${videoId}/like', { method: 'POST' }, { requiresAuth: true })`. It is not called directly by the UI — `toggleLike()` in `src/stores/video-interactions.tsx` updates local state optimistically and enqueues a persisted sync command instead of calling this service inline; see the sync-queue architecture note above.

### DELETE /videos/:id/like

- Purpose: Unlike a video for the authenticated user.
- Method and path: `DELETE /videos/:id/like`
- Auth required: Yes
- Request path params:

```json
{
  "id": "video_001"
}
```

- Example response (`LikeResponse`, `src/types/interaction.ts` — raw DTO, no envelope):

```json
{
  "videoId": "video_001",
  "isLiked": false,
  "likeCount": 12800
}
```

- Mobile screen: Home, Discover
- MVP priority: P0
- Backend notes: Make this idempotent if the video is not liked. Same error codes as `POST /videos/:id/like`.
- Connected: Yes. `unlikeVideo(videoId)` in `src/services/interactions/interactions-service.ts` calls `request('videos/${videoId}/like', { method: 'DELETE' }, { requiresAuth: true })`. Same sync-queue indirection as `POST /videos/:id/like` above — `toggleLike()` in `src/stores/video-interactions.tsx` handles both liking and unliking via the queue, not a direct call.

### POST /videos/:id/save

- Purpose: Save a video to the authenticated user's list.
- Method and path: `POST /videos/:id/save`
- Auth required: Yes
- Request path params:

```json
{
  "id": "video_001"
}
```

- Example response (`SaveResponse`, `src/types/interaction.ts` — raw DTO, no envelope):

```json
{
  "videoId": "video_001",
  "isSaved": true
}
```

- Mobile screen: Home, Saved
- MVP priority: P0
- Backend notes: Store saves by user id and video id with a unique constraint. Same error codes as `POST /videos/:id/like`.
- Connected: Yes. `saveVideo(videoId)` in `src/services/interactions/interactions-service.ts` calls `request('videos/${videoId}/save', { method: 'POST' }, { requiresAuth: true })`. As with likes, `toggleSave()` in `src/stores/video-interactions.tsx` never calls this inline — it updates local state and enqueues a sync command; see the sync-queue architecture note above.

### DELETE /videos/:id/save

- Purpose: Remove a video from the authenticated user's saved list.
- Method and path: `DELETE /videos/:id/save`
- Auth required: Yes
- Request path params:

```json
{
  "id": "video_001"
}
```

- Example response (`SaveResponse`, `src/types/interaction.ts` — raw DTO, no envelope):

```json
{
  "videoId": "video_001",
  "isSaved": false
}
```

- Mobile screen: Home, Saved
- MVP priority: P0
- Backend notes: Make unsave idempotent. Same error codes as `POST /videos/:id/like`.
- Connected: Yes. `unsaveVideo(videoId)` in `src/services/interactions/interactions-service.ts` calls `request('videos/${videoId}/save', { method: 'DELETE' }, { requiresAuth: true })`. Same sync-queue indirection as `POST /videos/:id/save` above.

### GET /users/me/interactions

- Purpose: Return every like/save interaction the authenticated user has recorded, as a flat list keyed by `videoId`.
- Method and path: `GET /users/me/interactions`
- Auth required: Yes
- Request params/body: None.
- Example response (`readonly UserInteraction[]`, `src/types/interaction.ts` — raw array, no envelope):

```json
[
  {
    "videoId": "video_001",
    "isLiked": true,
    "isSaved": true
  }
]
```

- Mobile screen: Saved, Profile, Home, Discover (indirectly — hydrates `src/stores/video-interactions.tsx`, which every like/save UI reads from)
- MVP priority: P0
- Backend notes: Throws `ApiError` with code `INVALID_ACCESS_TOKEN` (status 401) if unauthenticated. Note the path is `/users/me/interactions`, not `/users/me/saved-videos` — an earlier draft of this contract used the latter, speculative path before the real backend endpoint existed.
- Connected: Yes. `getInteractions()` in `src/services/interactions/interactions-service.ts` calls `request('users/me/interactions', { method: 'GET' }, { requiresAuth: true })`. It is called once, directly (not through the sync queue), by the first-login merge bootstrap in `src/stores/video-interactions.tsx`, which reconciles this remote list against whatever was recorded locally before the user authenticated. The Saved screen (`src/app/(tabs)/saved.tsx`) itself still derives its displayed list locally with `getSavedVideos(videos, savedVideoIds)` (`src/services/videos/video-service.ts`), filtering the already-fetched `/videos/feed` result against the (now backend-synced) `savedVideoIds` in `src/stores/video-interactions.tsx` — there is no separate paginated saved-videos request or server-side save-time ordering; order follows the feed.

### PUT /series/:id/progress

- Purpose: Upsert the authenticated user's watch progress for one episode of a series.
- Method and path: `PUT /series/:id/progress`
- Auth required: Yes
- Request path params: `{ "id": "series_ceo_dingin" }`
- Request body (from `upsertProgress()` in `src/services/progress/progress-service.ts`):

```json
{
  "videoId": "video_001",
  "episodeNumber": 1,
  "positionSeconds": 42,
  "durationSeconds": 72
}
```

`durationSeconds` is omitted from the body entirely when not provided (not sent as `null`).

- Example response (`UserSeriesProgress`, `src/types/progress.ts` — raw DTO, no envelope):

```json
{
  "seriesId": "series_ceo_dingin",
  "videoId": "video_001",
  "episodeNumber": 1,
  "positionSeconds": 42,
  "durationSeconds": 72
}
```

- Mobile screen: Home, Series Detail (indirectly — driven by `src/stores/series-progress.tsx`, consumed by the video player and series progress UI)
- MVP priority: P0
- Backend notes: Throws `ApiError` with code `VIDEO_NOT_FOUND` (status 404) if `videoId` doesn't exist, or `INVALID_ACCESS_TOKEN` (status 401) if unauthenticated.
- Connected: Yes. `upsertProgress(seriesId, videoId, episodeNumber, positionSeconds, durationSeconds?)` in `src/services/progress/progress-service.ts` calls `request('series/${seriesId}/progress', { method: 'PUT' }, { requiresAuth: true })`. It is not called directly by the UI — `recordProgress()` in `src/stores/series-progress.tsx` updates local state optimistically and enqueues a persisted, per-`seriesId`-ordered sync command instead; see the sync-queue architecture note above.

### GET /users/me/progress

- Purpose: Return the authenticated user's watch progress across every series they've started, as a flat list keyed by `seriesId`.
- Method and path: `GET /users/me/progress`
- Auth required: Yes
- Request params/body: None.
- Example response (`readonly UserSeriesProgress[]`, `src/types/progress.ts` — raw array, no envelope):

```json
[
  {
    "seriesId": "series_ceo_dingin",
    "videoId": "video_001",
    "episodeNumber": 1,
    "positionSeconds": 42,
    "durationSeconds": 72
  }
]
```

- Mobile screen: Home, Series Detail (indirectly, via the first-login merge bootstrap)
- MVP priority: P0
- Backend notes: Throws `ApiError` with code `INVALID_ACCESS_TOKEN` (status 401) if unauthenticated.
- Connected: Yes. `getProgress()` in `src/services/progress/progress-service.ts` calls `request('users/me/progress', { method: 'GET' }, { requiresAuth: true })`. It is called once, directly (not through the sync queue), by the first-login merge bootstrap in `src/stores/series-progress.tsx`, which reconciles this remote list against whatever progress was recorded locally before the user authenticated.

### GET /users/me/entitlement

- Purpose: Return the authenticated user's premium entitlement status, backing the `GET /videos/:id/stream` guard (see the `playbackUrl` note above). Account-wide, single tier — no per-series/per-episode entitlement.
- Method and path: `GET /users/me/entitlement`
- Auth required: Yes
- Request params/body: None.
- Example response (`EntitlementStatus`, `src/types/entitlement.ts` — raw DTO, no envelope):

```json
{ "isPremium": false, "expiresAt": null }
```

`isPremium` is `false` for "never entitled," "expired," and "revoked" alike — deliberately no distinction in this contract.

- Mobile screen: Home (drives the premium gate in `drama-feed-item.tsx`), Series Detail
- MVP priority: P0 (Phase 10)
- Backend notes: Throws `ApiError` with code `INVALID_ACCESS_TOKEN` (status 401) if unauthenticated.
- Connected: Yes. `getMyEntitlement()` in `src/services/entitlement/entitlement-service.ts` calls `request('users/me/entitlement', { method: 'GET' }, { requiresAuth: true })`. Fetched by `EntitlementProvider` (`src/stores/entitlement.tsx`) whenever the authenticated identity changes (login, logout, account switch), and exposed via `useEntitlement()`. `handleSelectEpisode`/`handleNextEpisode` in `src/app/series/[id].tsx`/`src/components/drama-feed-item.tsx` now gate premium playback on `episode.accessType === 'premium' && !isPremium`, instead of `accessType === 'premium'` alone. Fails safe to `isPremium: false` while logged out, while auth is still hydrating, and on any fetch error.

### GET /videos/search

- Purpose: Search videos by text and optional filters.
- Method and path: `GET /videos/search`
- Auth required: Optional
- Request query params:

```json
{
  "q": "CEO",
  "category": "CEO",
  "limit": 20
}
```

- Example response:

```json
{
  "success": true,
  "data": {
    "videos": [
      {
        "id": "video_001",
        "title": "Kontrak Cinta CEO Dingin",
        "episodeNumber": 1,
        "channelName": "Mandarin Drama ID",
        "category": "CEO",
        "storageKey": "processed-videos/drama-china/series-a/ep-01-id-sub.mp4",
        "playbackUrl": "https://media.example.com/videos/video_001.mp4",
        "thumbnailUrl": "https://media.example.com/thumbnails/video_001.jpg",
        "sourceLanguage": "Mandarin",
        "hasEmbeddedIndonesianSubtitle": true,
        "processingStatus": "completed",
        "likeCount": 12800
      }
    ]
  },
  "error": null,
  "meta": {
    "count": 1
  }
}
```

- Mobile screen: Discover
- MVP priority: P0
- Backend notes: Search title, caption, channel, and category.
- Connected: No. The Discover screen (`src/app/(tabs)/discover.tsx`) calls `searchVideos(videos, searchQuery, selectedCategory)` (`src/services/videos/video-service.ts`), which filters the already-fetched `/videos/feed` result in memory by title/caption/channel/category. No dedicated search request is made.

### GET /videos/categories

- Purpose: Return browse categories.
- Method and path: `GET /videos/categories`
- Auth required: No
- Request params/body: None
- Example response:

```json
{
  "success": true,
  "data": {
    "categories": ["All", "Romance", "Revenge", "Family", "CEO", "Historical"]
  },
  "error": null,
  "meta": null
}
```

- Mobile screen: Discover
- MVP priority: P0
- Backend notes: Keep category labels stable for analytics and search indexing.
- Connected: No. `getCategories()` in `src/services/videos/video-service.ts` returns a hardcoded local constant array (`categoryFilters`); no HTTP request is made.

### GET /videos?category=

- Purpose: Browse videos by category.
- Method and path: `GET /videos?category=CEO`
- Auth required: Optional
- Request query params:

```json
{
  "category": "CEO",
  "cursor": "optional_cursor",
  "limit": 20
}
```

- Example response:

```json
{
  "success": true,
  "data": {
    "videos": [
      {
        "id": "video_001",
        "title": "Kontrak Cinta CEO Dingin",
        "episodeNumber": 1,
        "category": "CEO",
        "storageKey": "processed-videos/drama-china/series-a/ep-01-id-sub.mp4",
        "playbackUrl": "https://media.example.com/videos/video_001.mp4",
        "thumbnailUrl": "https://media.example.com/thumbnails/video_001.jpg",
        "sourceLanguage": "Mandarin",
        "hasEmbeddedIndonesianSubtitle": true,
        "processingStatus": "completed"
      }
    ]
  },
  "error": null,
  "meta": {
    "nextCursor": null
  }
}
```

- Mobile screen: Discover
- MVP priority: P1
- Backend notes: This may share implementation with `/videos/search`. Mobile should use `playbackUrl`; internal storage paths remain backend-only.
- Connected: No. The same `searchVideos(videos, searchQuery, selectedCategory)` used for text search (`src/services/videos/video-service.ts`) also handles category-only filtering client-side; there is no dedicated category-browse request.

### GET /users/me

- Purpose: Return the authenticated user's profile.
- Method and path: `GET /users/me`
- Auth required: Yes
- Request params/body: None
- Example response:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_001",
      "name": "Gladyaz",
      "username": "gladyaz",
      "email": "gladyaz@example.com",
      "savedVideoCount": 3
    }
  },
  "error": null,
  "meta": null
}
```

- Mobile screen: Profile
- MVP priority: P0
- Backend notes: Can mirror `/auth/me` or return richer profile fields.
- Connected: No. The Profile screen (`src/app/(tabs)/profile.tsx`) reads the dummy user from `src/stores/auth.tsx` and derives `savedVideoCount`/liked count locally from `useVideoInteractions()`; no HTTP request is made.

### PATCH /users/me

- Purpose: Update editable profile fields.
- Method and path: `PATCH /users/me`
- Auth required: Yes
- Request body:

```json
{
  "name": "Gladyaz",
  "username": "gladyaz"
}
```

- Example response:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_001",
      "name": "Gladyaz",
      "username": "gladyaz",
      "email": "gladyaz@example.com"
    }
  },
  "error": null,
  "meta": null
}
```

- Mobile screen: Future profile edit
- MVP priority: P2
- Backend notes: Validate username uniqueness and reserved words.
- Connected: No. There is no profile-edit screen or mutation function in the mobile codebase yet.

### POST /analytics/events

- Purpose: Record mobile analytics events.
- Method and path: `POST /analytics/events`
- Auth required: Optional
- Request body:

```json
{
  "eventName": "video_play",
  "anonymousId": "device_or_install_id",
  "userId": "user_001",
  "properties": {
    "videoId": "video_001",
    "screen": "Home"
  },
  "occurredAt": "2026-07-10T00:00:00.000Z"
}
```

- Example response:

```json
{
  "success": true,
  "data": {
    "accepted": true
  },
  "error": null,
  "meta": null
}
```

- Mobile screen: Home, Discover, Saved, Profile
- MVP priority: P1
- Backend notes: Accept batched events later; do not block UI on analytics failures.
- Connected: No. There is no analytics event emitter anywhere in the mobile codebase yet.

## Open Questions

- Should feed ranking be global, personalized, or category-specific for MVP?
- What video storage/CDN provider should host short drama files?
- Do we need signed video URLs, or are public CDN URLs acceptable for MVP?
- Which source languages besides Mandarin should the subtitle pipeline support?
- Should subtitles be generated on upload, on demand, or both?
- What moderation workflow is required before publishing uploaded videos?
- ~~Should like/save require login immediately, or can anonymous local state sync after login?~~ Resolved as of Phase 9: anonymous local like/save/progress state is allowed and reconciled against the backend via a one-time first-login merge bootstrap (see the sync-queue architecture note above the like/save/progress endpoints).
- What analytics events are required for product decisions in the first release?
- What pagination style should the backend standardize on: cursor, offset, or time-based?
