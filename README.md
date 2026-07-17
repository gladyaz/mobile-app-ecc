# AI Short Drama Mobile App

Mobile app for Mandarin/Chinese short drama videos with Indonesian subtitles. The current app is an Expo React Native prototype using mock data and local state, with a service layer prepared for future backend integration.

## Tech Stack

- React Native
- Expo
- Expo Router
- TypeScript
- `expo-video`
- Local state/context
- Mock data/service layer

## Current Features

- Expo Router navigation with Home, Discover, Saved, and Profile tabs.
- Login screen with dummy local auth state.
- Profile guest/login/logout flow.
- Vertical short-drama feed on Home.
- Real video playback with `expo-video`.
- Active feed item plays while inactive items pause.
- Manual play/pause per feed item.
- Local like, save, and share interactions.
- Saved tab with saved videos and empty state.
- Discover tab with local search, category chips, and result cards.
- Processing history screen with per-video processing status, linked from Profile.
- Video model aligned with backend playback fields (`playbackUrl`, `thumbnailUrl`, `storageKey`, `hasEmbeddedIndonesianSubtitle`). Indonesian subtitles are already burned into the final video, so the app does not render its own subtitle overlay.
- Video and processing service layers that currently read mock data.

## How To Run

Install dependencies:

```bash
npm install
```

Start Expo with a clean cache:

```bash
npx expo start -c
```

Then use the Expo terminal shortcuts:

- Press `i` for iOS Simulator.
- Press `w` for Web.

## Local Company Video Playback

The Home feed plays real company drama videos from a local HTTP media server during development, instead of public sample URLs (which are no longer accessible).

**A. Start the local media server** from the folder containing the company videos:

```bash
cd "/Users/gladyaz/VideoDracin"
python3 -m http.server 8000 --bind 0.0.0.0
```

Leave this running in its own terminal tab. It must stay up for playback to work.

**B. Find your Mac's local network IP:**

```bash
ipconfig getifaddr en0
```

**C. Create a local `.env` file** in the project root (copy `.env.example`) and set it to your Mac's IP:

```bash
EXPO_PUBLIC_MEDIA_BASE_URL=http://YOUR_MAC_IP:8000
```

**D. Restart Expo with a clean cache** after changing environment variables (Expo only reads `.env` at startup):

```bash
npx expo start -c
```

**E. Test one video URL directly in the browser** before opening the app, to confirm the server returns a playable MP4 and not an XML/HTML error page:

```
http://YOUR_MAC_IP:8000/path/to/episode-001.mp4
```

**F. Notes:**

- Web running on the same Mac can use `http://localhost:8000`.
- The iOS Simulator or a physical phone should generally use the Mac's LAN IP (from step B), not `localhost`.
- The Mac and any physical test device must be on the same network.
- The Python server must keep running whenever you test video playback.
- This is a development-only stand-in. Real production storage/CDN and the NestJS backend will replace this local server later; nothing about this setup depends on them.
- If `EXPO_PUBLIC_MEDIA_BASE_URL` is missing, `playbackUrl` values resolve to an empty string, a warning is logged once per video in development, and the Home feed shows a "Video unavailable" placeholder for that item instead of crashing.

## Folder Structure

- `src/app` - Expo Router routes, layouts, tabs, and screens.
- `src/components` - Reusable UI components such as feed items.
- `src/data` - Mock drama video data used by the service layer.
- `src/features` - Feature-specific hooks and future feature modules.
- `src/services` - API client placeholder, domain services, and the local media URL helper (`src/services/media`).
- `src/stores` - Local React context stores for auth and video interactions.
- `src/types` - Shared TypeScript models for videos and subtitles.
- `docs` - Project documentation, including the mobile API contract.

## Current Limitations

- Backend is not connected yet.
- Auth is dummy/local and not persisted.
- Video data is mock data.
- Like/save state is local only.
- Video playback in development requires a local media server (see "Local Company Video Playback" above); there is no production video CDN yet.
- No real upload, processing, or CDN integration exists yet.

## API Contract

Future backend endpoint contracts are documented in [docs/api-contract.md](docs/api-contract.md). The app currently uses `src/services/videos/video-service.ts` as the boundary between screens and mock data.

## Internal Storage

Real company videos should live in backend/internal storage, not inside this mobile app project. The mobile app should receive backend-provided `playbackUrl` and `thumbnailUrl` values. Indonesian subtitles are embedded directly in the final video, so the mobile app does not receive a separate subtitle track. See [docs/internal-storage.md](docs/internal-storage.md).

## Next Planned Tasks

- Real backend integration.
- Real auth/JWT support.
- Real subtitle API.
- Video feed API.
- Uploaded videos list.
- Production video storage/CDN.
