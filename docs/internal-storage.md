# Internal Storage Contract

This document describes how real company Mandarin drama videos should be organized in backend/internal storage. The mobile app must not store production video files inside the app project and must not read raw internal storage paths directly.

## Purpose

Internal storage keeps source videos, processed videos, subtitle files, and thumbnails in a predictable backend-owned structure. The backend is responsible for reading these internal files and returning mobile-safe URLs such as `playbackUrl` and `thumbnailUrl`. Indonesian subtitles are embedded (burned in) directly into the processed video; the mobile app does not receive or render a separate subtitle track.

## Recommended Folder Structure

```text
storage/
  raw-videos/
  processed-videos/
  subtitles/
  thumbnails/
```

## Folder Meaning

- `raw-videos/` stores original Mandarin videos exactly as uploaded by the company.
- `processed-videos/` stores final MP4 files prepared for mobile playback, with Indonesian subtitles burned directly into the video.
- `subtitles/` stores optional `.srt` sidecar files retained internally for editing and QA; these are not sent to or consumed by the mobile app.
- `thumbnails/` stores preview images used by lists, search results, and future detail pages.

## Example Paths

```text
storage/raw-videos/drama-china/series-a/ep-01.mp4
storage/processed-videos/drama-china/series-a/ep-01-id-sub.mp4
storage/subtitles/drama-china/series-a/ep-01-id.srt
storage/thumbnails/drama-china/series-a/ep-01.jpg
```

## Mobile App Boundary

The mobile app should never request or display these internal paths directly. Internal paths such as `storage/raw-videos/...` and `storage/processed-videos/...` are backend-only implementation details.

The backend should translate internal storage records into mobile-safe response fields:

```json
{
  "id": "video_001",
  "storageKey": "processed-videos/drama-china/series-a/ep-01-id-sub.mp4",
  "playbackUrl": "https://media.example.com/videos/video_001.mp4",
  "thumbnailUrl": "https://media.example.com/thumbnails/video_001.jpg",
  "hasEmbeddedIndonesianSubtitle": true
}
```

`storageKey` may be useful for backend debugging and admin tools, but mobile playback should use `playbackUrl`. The URL may be public, CDN-backed, or signed depending on the backend security model.

## Backend Responsibilities

- Store the original Mandarin source video under `raw-videos/`.
- Run subtitle processing against the raw video.
- Store processed playback output under `processed-videos/`.
- Store generated Indonesian `.srt` files under `subtitles/`.
- Store generated or selected thumbnails under `thumbnails/`.
- Return `playbackUrl` and `thumbnailUrl` to the mobile app. Do not return subtitle track URLs; Indonesian subtitles must already be embedded in the processed video.
- Avoid exposing raw storage paths as playable mobile URLs.

## Future CDN Option

The backend can start by serving files through a media/static endpoint. Later, the same contract can point `playbackUrl` and `thumbnailUrl` to CDN URLs without changing the mobile app data model.

## Playback authorization (Slice 11M)

The CDN option above is now partially real: some media lives in Cloudflare R2 rather than local disk, with an empty local `storageKey`. `playbackUrl` on `/videos/feed`/`/videos/:id` still exists (and is what the feed item's Share action links to), but it is no longer what the mobile app actually plays — it always points at `/videos/:id/stream`, which 404s for an R2-backed row.

Instead, the mobile app requests a playable URL from a dedicated `GET /videos/:id/playback` endpoint (see `docs/api-contract.md`) for whichever video is currently active. That endpoint answers for both storage kinds behind one shape — `{ playbackUrl, expiresAt, requiresAuthHeader }` — so the mobile app never has to know whether a given video is R2- or local-backed: it attaches `Authorization: Bearer <accessToken>` only when `requiresAuthHeader` is true, and always treats the URL as short-lived (never persisted, re-requested once `expiresAt` has passed). The bucket itself remains private; a presigned R2 URL is the only thing that ever reaches the client, and the mobile app never receives an R2 key, bucket name, or endpoint directly.
