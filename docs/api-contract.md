# Mobile API Contract

This contract describes the future backend API for the AI Short Drama Mobile App. The current app uses mock data through `src/services/videos/video-service.ts`; these endpoints are not connected yet.

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
  "title": "Kontrak Cinta CEO Dingin",
  "episodeNumber": 1,
  "channelName": "Mandarin Drama ID",
  "category": "CEO",
  "caption": "Pertemuan pertama yang mengubah hidup Lin Yue.",
  "storageKey": "processed-videos/drama-china/series-a/ep-01-id-sub.mp4",
  "playbackUrl": "https://media.example.com/videos/video_001.mp4",
  "thumbnailUrl": "https://cdn.example.com/videos/video_001.jpg",
  "subtitleTrackUrl": "https://cdn.example.com/subtitles/video_001-id.srt",
  "sourceLanguage": "Mandarin",
  "subtitleLanguage": "Indonesian",
  "processingStatus": "completed",
  "durationSeconds": 72,
  "mandarinSubtitlePreview": "Original Mandarin subtitle preview",
  "indonesianSubtitlePreview": "Sebenarnya apa yang kamu inginkan?",
  "likeCount": 12800,
  "viewCount": 245000,
  "isLiked": false,
  "isSaved": false,
  "createdAt": "2026-07-10T00:00:00.000Z",
  "updatedAt": "2026-07-10T00:00:00.000Z"
}
```

The mobile app uses `playbackUrl` for video playback. `storageKey` and raw internal storage paths are backend-only values and must not be treated as mobile-readable file paths.

### Subtitle

```json
{
  "id": "subtitle_001",
  "videoId": "video_001",
  "language": "id",
  "sourceLanguage": "zh",
  "startTimeSeconds": 0,
  "endTimeSeconds": 3,
  "text": "Sebenarnya apa yang kamu inginkan?",
  "isGenerated": true,
  "confidence": 0.94
}
```

Indonesian (`id`) is the default target subtitle language for the mobile app.

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

### POST /auth/login

- Purpose: Authenticate a user and return session tokens plus the current user.
- Method and path: `POST /auth/login`
- Auth required: No
- Request body:

```json
{
  "email": "gladyaz@example.com",
  "password": "password"
}
```

- Example response:

```json
{
  "success": true,
  "data": {
    "accessToken": "jwt_access_token",
    "refreshToken": "jwt_refresh_token",
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

- Mobile screen: Login, Profile
- MVP priority: P0
- Backend notes: Use password hashing, rate limiting, and generic invalid-credential messages.

### POST /auth/logout

- Purpose: Invalidate the current session or refresh token.
- Method and path: `POST /auth/logout`
- Auth required: Yes
- Request body:

```json
{
  "refreshToken": "jwt_refresh_token"
}
```

- Example response:

```json
{
  "success": true,
  "data": {
    "loggedOut": true
  },
  "error": null,
  "meta": null
}
```

- Mobile screen: Profile
- MVP priority: P0
- Backend notes: Support idempotent logout so repeated requests are safe.

### GET /auth/me

- Purpose: Return the authenticated session user.
- Method and path: `GET /auth/me`
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
      "email": "gladyaz@example.com"
    }
  },
  "error": null,
  "meta": null
}
```

- Mobile screen: Profile, app bootstrap
- MVP priority: P0
- Backend notes: Use this endpoint to restore auth state after app launch.

### GET /videos/feed

- Purpose: Return the vertical short-drama feed.
- Method and path: `GET /videos/feed`
- Auth required: Optional for MVP; authenticated users get `isLiked` and `isSaved`.
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
        "title": "Kontrak Cinta CEO Dingin",
        "episodeNumber": 1,
        "channelName": "Mandarin Drama ID",
        "category": "CEO",
        "storageKey": "processed-videos/drama-china/series-a/ep-01-id-sub.mp4",
        "playbackUrl": "https://media.example.com/videos/video_001.mp4",
        "thumbnailUrl": "https://media.example.com/thumbnails/video_001.jpg",
        "subtitleTrackUrl": "https://media.example.com/subtitles/video_001-id.srt",
        "sourceLanguage": "Mandarin",
        "subtitleLanguage": "Indonesian",
        "processingStatus": "completed",
        "indonesianSubtitlePreview": "Sebenarnya apa yang kamu inginkan?",
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
      "title": "Kontrak Cinta CEO Dingin",
      "episodeNumber": 1,
      "channelName": "Mandarin Drama ID",
      "category": "CEO",
      "caption": "Pertemuan pertama yang mengubah hidup Lin Yue.",
      "storageKey": "processed-videos/drama-china/series-a/ep-01-id-sub.mp4",
      "playbackUrl": "https://media.example.com/videos/video_001.mp4",
      "thumbnailUrl": "https://media.example.com/thumbnails/video_001.jpg",
      "subtitleTrackUrl": "https://media.example.com/subtitles/video_001-id.srt",
      "sourceLanguage": "Mandarin",
      "subtitleLanguage": "Indonesian",
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

### GET /videos/:id/subtitles

- Purpose: Return all subtitle tracks for a video.
- Method and path: `GET /videos/:id/subtitles`
- Auth required: No
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
    "subtitles": [
      {
        "id": "subtitle_001",
        "videoId": "video_001",
        "language": "id",
        "startTimeSeconds": 0,
        "endTimeSeconds": 3,
        "text": "Sebenarnya apa yang kamu inginkan?"
      }
    ]
  },
  "error": null,
  "meta": null
}
```

- Mobile screen: Home
- MVP priority: P0
- Backend notes: Return Indonesian subtitles by default when available.

### GET /videos/:id/subtitles/:language

- Purpose: Return subtitles for one language.
- Method and path: `GET /videos/:id/subtitles/:language`
- Auth required: No
- Request path params:

```json
{
  "id": "video_001",
  "language": "id"
}
```

- Example response:

```json
{
  "success": true,
  "data": {
    "language": "id",
    "subtitles": [
      {
        "id": "subtitle_001",
        "startTimeSeconds": 0,
        "endTimeSeconds": 3,
        "text": "Sebenarnya apa yang kamu inginkan?"
      }
    ]
  },
  "error": null,
  "meta": null
}
```

- Mobile screen: Home
- MVP priority: P0
- Backend notes: Use ISO language codes; Indonesian (`id`) is the primary target.

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
        "subtitleTrackUrl": "https://media.example.com/subtitles/video_001-id.srt",
        "sourceLanguage": "Mandarin",
        "subtitleLanguage": "Indonesian",
        "processingStatus": "completed",
        "indonesianSubtitlePreview": "Sebenarnya apa yang kamu inginkan?",
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
        "subtitleTrackUrl": "https://media.example.com/subtitles/video_001-id.srt",
        "sourceLanguage": "Mandarin",
        "subtitleLanguage": "Indonesian",
        "processingStatus": "completed",
        "indonesianSubtitlePreview": "Sebenarnya apa yang kamu inginkan?",
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
- Backend notes: Search title, caption, channel, category, and subtitle previews.

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
        "subtitleTrackUrl": "https://media.example.com/subtitles/video_001-id.srt",
        "sourceLanguage": "Mandarin",
        "subtitleLanguage": "Indonesian",
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
