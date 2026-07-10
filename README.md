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
- Indonesian subtitle overlay on video.
- Local like, save, and share interactions.
- Saved tab with saved videos and empty state.
- Discover tab with local search, category chips, and result cards.
- Video service layer that currently reads mock data.

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

## Folder Structure

- `src/app` - Expo Router routes, layouts, tabs, and screens.
- `src/components` - Reusable UI components such as feed items and subtitle overlays.
- `src/data` - Mock drama video data used by the service layer.
- `src/features` - Feature-specific hooks and future feature modules.
- `src/services` - API client placeholder and domain services for future backend integration.
- `src/stores` - Local React context stores for auth and video interactions.
- `src/types` - Shared TypeScript models for videos and subtitles.
- `docs` - Project documentation, including the mobile API contract.

## Current Limitations

- Backend is not connected yet.
- Auth is dummy/local and not persisted.
- Video data is mock data.
- Like/save state is local only.
- Subtitle overlay uses mock Indonesian subtitle text.
- Video URLs are sample public MP4 URLs.
- No real upload, processing, or CDN integration exists yet.

## API Contract

Future backend endpoint contracts are documented in [docs/api-contract.md](docs/api-contract.md). The app currently uses `src/services/videos/video-service.ts` as the boundary between screens and mock data.

## Internal Storage

Real company videos should live in backend/internal storage, not inside this mobile app project. The mobile app should receive backend-provided `playbackUrl`, `thumbnailUrl`, and `subtitleTrackUrl` values. See [docs/internal-storage.md](docs/internal-storage.md).

## Next Planned Tasks

- Real backend integration.
- Real auth/JWT support.
- Real subtitle API.
- Video feed API.
- Processing history.
- Uploaded videos list.
- Production video storage/CDN.
