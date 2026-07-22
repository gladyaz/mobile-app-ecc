# Mobile API Contract

This contract describes the backend API for the AI Short Drama Mobile App. `GET /videos/feed` and `GET /videos/:id` are wired up today (`src/services/videos/video-service.ts` calls the typed client in `src/services/api/client.ts`), gated by `EXPO_PUBLIC_USE_MOCK_DATA`: when that flag is `true` the app resolves the bundled mock data from `src/data/mock-drama-videos.ts` instead of calling the backend. As of Phase 8, `/auth/register`, `/auth/login`, `/auth/refresh`, and `/auth/logout` are also wired up for real: `src/services/auth/auth-service.ts` calls the backend through the same typed client, `src/stores/auth.tsx` drives login/logout with real tokens (persisted via `src/services/storage/local-storage.ts`), and `src/services/api/client.ts` has a refresh-on-401 interceptor. Every other endpoint documented below is still not connected — like/save, view tracking, search, category browsing, saved videos, the user profile, and analytics remain client-side only (local React Context stores backed by AsyncStorage, plus in-memory filtering of the already-fetched feed), with no HTTP call to the backend. See the per-endpoint "Connected" notes below for specifics.

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

Access rule: episodes 1-5 are `"free"`, episode 6 onward is `"premium"` (`FREE_EPISODE_LIMIT = 5`). This is a display/UX rule only — **no payment, subscription, credit balance, or purchase flow is implemented**. Premium episodes are blocked client-side with a preview modal; there is nothing on the backend enforcing this yet.

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

- Example response:

```json
{
  "success": true,
  "data": {
    "videoId": "video_001",
    "isLiked": true,
    "likeCount": 12801
  },
  "error": null,
  "meta": null
}
```

- Mobile screen: Home, Discover
- MVP priority: P0
- Backend notes: Make this idempotent if the video is already liked.
- Connected: No. `toggleLike()` in `src/stores/video-interactions.tsx` flips like state in a local `AsyncStorage`-backed React Context; no HTTP request is made and there is no server-side like count.

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

- Example response:

```json
{
  "success": true,
  "data": {
    "videoId": "video_001",
    "isLiked": false,
    "likeCount": 12800
  },
  "error": null,
  "meta": null
}
```

- Mobile screen: Home, Discover
- MVP priority: P0
- Backend notes: Make this idempotent if the video is not liked.
- Connected: No. The same local `toggleLike()` in `src/stores/video-interactions.tsx` handles both liking and unliking; no HTTP request is made.

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

- Example response:

```json
{
  "success": true,
  "data": {
    "videoId": "video_001",
    "isSaved": true
  },
  "error": null,
  "meta": null
}
```

- Mobile screen: Home, Saved
- MVP priority: P0
- Backend notes: Store saves by user id and video id with a unique constraint.
- Connected: No. `toggleSave()` in `src/stores/video-interactions.tsx` flips save state in a local `AsyncStorage`-backed React Context; no HTTP request is made.

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

- Example response:

```json
{
  "success": true,
  "data": {
    "videoId": "video_001",
    "isSaved": false
  },
  "error": null,
  "meta": null
}
```

- Mobile screen: Home, Saved
- MVP priority: P0
- Backend notes: Make unsave idempotent.
- Connected: No. The same local `toggleSave()` in `src/stores/video-interactions.tsx` handles both saving and unsaving; no HTTP request is made.

### GET /users/me/saved-videos

- Purpose: Return the authenticated user's saved videos.
- Method and path: `GET /users/me/saved-videos`
- Auth required: Yes
- Request query params:

```json
{
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
        "channelName": "Mandarin Drama ID",
        "category": "CEO",
        "storageKey": "processed-videos/drama-china/series-a/ep-01-id-sub.mp4",
        "playbackUrl": "https://media.example.com/videos/video_001.mp4",
        "thumbnailUrl": "https://media.example.com/thumbnails/video_001.jpg",
        "sourceLanguage": "Mandarin",
        "hasEmbeddedIndonesianSubtitle": true,
        "processingStatus": "completed",
        "likeCount": 12800,
        "isSaved": true
      }
    ]
  },
  "error": null,
  "meta": {
    "nextCursor": null
  }
}
```

- Mobile screen: Saved, Profile
- MVP priority: P0
- Backend notes: Sort by save time descending.
- Connected: No. The Saved screen (`src/app/(tabs)/saved.tsx`) derives this list locally with `getSavedVideos(videos, savedVideoIds)` (`src/services/videos/video-service.ts`), which filters the already-fetched `/videos/feed` result against the locally persisted `savedVideoIds` from `src/stores/video-interactions.tsx`. No dedicated saved-videos request is made, and there is no server-side save-time ordering — order simply follows the feed.

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
- Should like/save require login immediately, or can anonymous local state sync after login?
- What analytics events are required for product decisions in the first release?
- What pagination style should the backend standardize on: cursor, offset, or time-based?
