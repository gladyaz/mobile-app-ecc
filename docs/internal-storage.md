# Internal Storage Contract

This document describes how real company Mandarin drama videos should be organized in backend/internal storage. The mobile app must not store production video files inside the app project and must not read raw internal storage paths directly.

## Purpose

Internal storage keeps source videos, processed videos, subtitle files, and thumbnails in a predictable backend-owned structure. The backend is responsible for reading these internal files and returning mobile-safe URLs such as `playbackUrl`, `thumbnailUrl`, and `subtitleTrackUrl`.

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
- `processed-videos/` stores videos prepared for mobile playback, including Indonesian subtitle versions when the product chooses burned-in subtitle output.
- `subtitles/` stores subtitle sidecar files such as `.srt` files.
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
  "subtitleTrackUrl": "https://media.example.com/subtitles/video_001-id.srt"
}
```

`storageKey` may be useful for backend debugging and admin tools, but mobile playback should use `playbackUrl`. The URL may be public, CDN-backed, or signed depending on the backend security model.

## Backend Responsibilities

- Store the original Mandarin source video under `raw-videos/`.
- Run subtitle processing against the raw video.
- Store processed playback output under `processed-videos/`.
- Store generated Indonesian `.srt` files under `subtitles/`.
- Store generated or selected thumbnails under `thumbnails/`.
- Return `playbackUrl`, `thumbnailUrl`, and `subtitleTrackUrl` to the mobile app.
- Avoid exposing raw storage paths as playable mobile URLs.

## Future CDN Option

The backend can start by serving files through a media/static endpoint. Later, the same contract can point `playbackUrl`, `thumbnailUrl`, and `subtitleTrackUrl` to CDN URLs without changing the mobile app data model.
