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
- Video catalog fetched once from the NestJS backend and shared across Home, Discover, and Saved via `VideoCatalogProvider` (falls back to bundled mock data only when `EXPO_PUBLIC_USE_MOCK_DATA=true`).
- Home and Discover show loading, error-with-retry, and empty states for the video feed; a failed backend call never silently falls back to mock data.
- Processing service layer that currently reads mock data.

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

## Mobile-to-Backend Setup

Video metadata (title, `playbackUrl`, etc.) comes from a NestJS backend that runs separately from this mobile app. This section covers connecting the two for local development. The backend itself is a different repository and is not part of this project.

### Architecture

```
NestJS backend (GET /health, /videos/feed, /videos/:id, /videos/:id/stream)
  -> src/services/api/client.ts       (typed fetch wrapper, throws ApiError)
  -> src/services/videos/video-mapper.ts + video-service.ts
       (maps backend DTOs to the mobile Video model, fails loudly on bad shape)
  -> VideoCatalogProvider             (fetches the feed once, shares it app-wide)
  -> Home, Discover, Saved screens
```

### Required Environment Variables

Set these in a local `.env` file (copied from `.env.example`, gitignored):

```bash
EXPO_PUBLIC_API_BASE_URL=http://YOUR_MAC_IP:3000
EXPO_PUBLIC_USE_MOCK_DATA=false
```

- `EXPO_PUBLIC_API_BASE_URL` - base URL of the NestJS backend.
- `EXPO_PUBLIC_USE_MOCK_DATA` - set to `true` to force the app to use the bundled mock data instead of the backend, even if the backend URL is set. Useful for UI-only work without the backend running.

### Running Backend and Mobile Together

1. Start the NestJS backend separately (see that repo's own instructions).
2. Confirm it's reachable:

   ```
   http://YOUR_MAC_IP:3000/health
   ```

3. Confirm the feed endpoint returns real video metadata:

   ```
   http://YOUR_MAC_IP:3000/videos/feed
   ```

4. Set `EXPO_PUBLIC_API_BASE_URL` in your local `.env` to that same address.
5. Restart Expo with a clean cache after any environment variable change (Expo only reads `.env` at startup):

   ```bash
   npx expo start -c
   ```

### Web / iOS Simulator vs Physical Device

- Web and the iOS Simulator running on the same Mac as the backend can use `http://localhost:3000`.
- A physical phone cannot reach `localhost` on your Mac — use the Mac's LAN IP instead (`ipconfig getifaddr en0`).
- The Mac and the physical device must be on the same network.
- Whatever address the mobile app uses for `EXPO_PUBLIC_API_BASE_URL`, the backend's own base URL (e.g. `PUBLIC_BASE_URL`) must also be an address reachable by the client — a `playbackUrl` pointing at `localhost` will fail to load on a physical phone even if the API call itself succeeds.

### Mock Data Fallback

Set `EXPO_PUBLIC_USE_MOCK_DATA=true` to develop the UI without a running backend. This is an explicit, visible switch — the app never silently falls back to mock data after a real API error. If the backend is misconfigured or unreachable while this flag is `false`, Home and Discover show a "Video gagal dimuat." error with a Retry button instead of quietly showing stale mock content.

### Common Errors

| Symptom | Likely cause |
|---|---|
| "Network request failed" | Backend not running, wrong IP/port, or the device isn't on the same network as the Mac |
| CORS error on web | The backend needs to allow the Expo web dev origin (backend-side config, outside this repo) |
| Video plays on web but not on a physical phone | The backend's `playbackUrl` points at `localhost` instead of a LAN-reachable address |
| `GET /health` won't connect | Start the backend first, or double-check `EXPO_PUBLIC_API_BASE_URL` |
| One video shows "Video unavailable" but the rest of the feed works | That video's stream returned 404 or errored — playback errors are isolated per item, they don't affect the rest of the feed |

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

- Auth is dummy/local and not persisted.
- Like/save state is local only; not synced to the backend.
- Processing History still reads local mock data (not backend-connected in this phase).
- Video playback in development requires the backend's `playbackUrl` to resolve to a reachable server — see "Local Company Video Playback" below if you're serving raw files locally rather than through the backend.
- No real upload or production video storage/CDN integration exists yet.

## API Contract

Future backend endpoint contracts are documented in [docs/api-contract.md](docs/api-contract.md). The app currently uses `src/services/videos/video-service.ts` as the boundary between screens and mock data.

## Internal Storage

Real company videos should live in backend/internal storage, not inside this mobile app project. The mobile app should receive backend-provided `playbackUrl` and `thumbnailUrl` values. Indonesian subtitles are embedded directly in the final video, so the mobile app does not receive a separate subtitle track. See [docs/internal-storage.md](docs/internal-storage.md).

## Next Planned Tasks

- Real auth/JWT support.
- Connect likes/saves to the backend.
- Connect Processing History to the backend.
- Uploaded videos list.
- Production video storage/CDN.
