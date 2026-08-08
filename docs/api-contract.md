# Mobile API Contract

This contract describes the backend API for the AI Short Drama Mobile App. `GET /videos/feed` and `GET /videos/:id` are wired up today (`src/services/videos/video-service.ts` calls the typed client in `src/services/api/client.ts`), gated by `EXPO_PUBLIC_USE_MOCK_DATA`: when that flag is `true` the app resolves the bundled mock data from `src/data/mock-drama-videos.ts` instead of calling the backend. As of Phase 8, `/auth/register`, `/auth/login`, `/auth/refresh`, and `/auth/logout` are also wired up for real: `src/services/auth/auth-service.ts` calls the backend through the same typed client, `src/stores/auth.tsx` drives login/logout with real tokens (persisted via `src/services/storage/local-storage.ts`), and `src/services/api/client.ts` has a refresh-on-401 interceptor. As of Phase 9, like/save (`/videos/:id/like`, `/videos/:id/save`, `GET /users/me/interactions`) and watch progress (`PUT /series/:id/progress`, `GET /users/me/progress`) are also wired up for real, through an explicit sync-queue architecture described below the relevant endpoints. As of Phase 12 (work unit 12B-M1), the Account Security screen (`src/app/account-security.tsx`) wires up `/auth/change-password`, `/auth/logout-all`, `GET /auth/sessions`, and `DELETE /auth/sessions/:id` for real, via `src/services/auth/account-security-service.ts`; the unauthenticated password-reset endpoints (`/auth/password-reset/request`/`confirm`) remain deliberately NOT connected on mobile — see those endpoints' own notes below for why. As of Phase 15 (slice 15A-S1), `GET /config/ads` is also wired up for real, via `src/services/ads/ads-config-service.ts`, backing the counter-based interstitial ad gate. Every other endpoint documented below is still not connected — view tracking, search, category browsing, the user profile, and analytics remain client-side only (local React Context stores backed by AsyncStorage, plus in-memory filtering of the already-fetched feed), with no HTTP call to the backend. See the per-endpoint "Connected" notes below for specifics.

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

**Phase 11 update — DB-backed access tier (server-side source-of-truth change only, no mobile-visible behavior change):** the backend now stores each episode's access tier explicitly in the database (`Video.accessTierOverride`, a nullable column that was backfilled for every pre-existing row to the exact value the free/premium rule above already derived for it, and is set explicitly at admin-create time for any new row going forward) instead of deriving the tier purely from `episodeNumber` at request time. `GET /videos/:id/stream`'s premium guard now reads that DB-backed value as the authoritative source (`EntitlementsService.resolveEpisodePremium`), falling back to the `episodeNumber > FREE_EPISODE_LIMIT` rule above only if a row's override is unset. For every episode that exists today the outcome is byte-for-byte identical to before this change: a premium episode still returns `403 ENTITLEMENT_REQUIRED` without an active entitlement, and free episodes still stream exactly as before. **No payment, subscription, or entitlement-activation flow was added by this change**, and it does not touch `Entitlement`/`EntitlementsService`'s per-user premium status (`GET /users/me/entitlement` below is unaffected). The mobile app consumes nothing new here — `accessTierOverride` is exposed only on the backend's admin-facing DTO, never on the `VideoResponseDto` shape `/videos/feed` and `/videos/:id` return, and no mobile code changed as part of this.

**Phase 11 admin-only content-management API (out of scope for mobile):** the backend also gained an admin-only surface (`/admin/media`, `/admin/series` — series/episode metadata CRUD, lifecycle transitions such as publish/unpublish, and the `PATCH /admin/media/:id/access-tier` endpoint that sets the DB-backed tier described above), guarded by `JwtAuthGuard` plus an admin-role check (`AdminGuard`). This surface exists for the separate admin dashboard, not for this mobile app: nothing in `mobile-app-ecc` calls it, this contract does not document its request/response shapes, and it must not be treated as "Connected" for mobile anywhere in this document. See the backend's `docs/admin-api-contract.md` for the authoritative reference on that surface.

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

### POST /auth/change-password

- Purpose: Change the current user's password from the Account Security screen.
- Method and path: `POST /auth/change-password`
- Auth required: Yes
- Request body (from `changePassword()` in `src/services/auth/account-security-service.ts`):

```json
{
  "currentPassword": "old-password",
  "newPassword": "new-password-123",
  "refreshToken": "jwt_refresh_token"
}
```

`refreshToken` identifies which of the caller's sessions is "the current one" being rotated — the access-token payload alone carries no session identity.

- Example response (`AuthResponse`, `src/types/auth.ts` — same shape as `/auth/login`/`/auth/refresh`):

```json
{
  "accessToken": "new_jwt_access_token",
  "refreshToken": "new_jwt_refresh_token",
  "user": { "id": "user_001", "email": "gladyaz@example.com", "displayName": "Gladyaz" }
}
```

- Mobile screen: Account Security (`src/app/account-security.tsx`)
- MVP priority: P0 (Phase 12, work unit 12B-B1/12B-M1)
- Backend notes: **CRITICAL side effect** — on success, the backend ROTATES the current session's access/refresh token pair and revokes every OTHER session for the account. Throws `ApiError` with code `INVALID_CREDENTIALS` (status 401) for a wrong `currentPassword` (the same generic code `login()` uses, not a distinct code), or `INVALID_REFRESH_TOKEN` (status 401) if `refreshToken` doesn't identify a usable session for this account. `newPassword` policy: 8–128 characters (`MIN_PASSWORD_LENGTH`/`MAX_PASSWORD_LENGTH`, same source of truth as `/auth/register`'s password policy); `currentPassword` has no length check (verified against the stored hash only).
- Connected: Yes. `changePassword()` in `src/services/auth/account-security-service.ts` calls `request('auth/change-password', ...)` with `{ requiresAuth: true }`. `src/app/account-security.tsx`'s change-password form calls it directly (not through `stores/auth.tsx`), then persists the rotated token pair via `tokenStore.setTokensAndNotify(...)` — the same path `services/api/client.ts`'s refresh-on-401 interceptor uses — so `stores/auth.tsx`'s existing subscription re-persists the new tokens to `AsyncStorage` without any change to that store.

### POST /auth/logout-all

- Purpose: Log out of every session for the account, from the Account Security screen's "danger zone".
- Method and path: `POST /auth/logout-all`
- Auth required: Yes
- Request body: None (no `refreshToken` — the whole point of this endpoint is that no session is excluded, unlike `/auth/change-password`/`/auth/refresh`/`/auth/logout`).
- Example response: `{ "success": true }`, discarded by the mobile client (return type is `void`).
- Mobile screen: Account Security (`src/app/account-security.tsx`)
- MVP priority: P0 (Phase 12, work unit 12B-B2/12B-M1)
- Backend notes: **FROZEN SEMANTIC** — revokes EVERY session for the account, INCLUDING the one that made this very request. Every outstanding refresh token stops working immediately; the access token this request was authenticated with remains cryptographically valid until it naturally expires (~15 min, stateless JWT) — this is a pre-existing property of the whole auth system, not unique to this endpoint.
- Connected: Yes. `logoutAll()` in `src/services/auth/account-security-service.ts` calls `request('auth/logout-all', ...)` with `{ requiresAuth: true }`. Because this device's own session is revoked too, `src/app/account-security.tsx` always follows a successful call with a full local sign-out via `useAuth().logout()` (the same client-side clear `stores/auth.tsx`'s existing Profile-screen logout button uses) and then navigates to `/login`. The UI never presents this as "log out other devices" — the confirm step explicitly says every session including the current device.

### GET /auth/sessions

- Purpose: List the current user's own active sessions, for the Account Security screen's session-management list.
- Method and path: `GET /auth/sessions`
- Auth required: Yes
- Request params/body: None.
- Example response (`readonly SessionSummary[]`, `src/types/auth.ts` — raw array, no envelope):

```json
[
  {
    "id": "session_001",
    "userAgent": "iPhone App/1.0",
    "lastUsedAt": "2026-07-20T10:00:00.000Z",
    "createdAt": "2026-07-01T09:00:00.000Z",
    "expiresAt": "2026-08-01T09:00:00.000Z"
  }
]
```

`userAgent`/`lastUsedAt` are nullable (a session created before this work unit, or without request-context info, has neither). Never a token hash, IP hash, or `userId`.

- Mobile screen: Account Security (`src/app/account-security.tsx`)
- MVP priority: P0 (Phase 12, work unit 12B-B2/12B-M1)
- Backend notes: Throws `ApiError` with code `INVALID_ACCESS_TOKEN` (status 401) if unauthenticated. Only ever returns the caller's own sessions.
- Connected: Yes. `listSessions()` in `src/services/auth/account-security-service.ts` calls `request('auth/sessions', ...)` with `{ requiresAuth: true }`, fetched on mount by `src/app/account-security.tsx` with loading/error+retry states.

### DELETE /auth/sessions/:id

- Purpose: Revoke one of the current user's own sessions (e.g. "sign out this device") from the Account Security screen.
- Method and path: `DELETE /auth/sessions/:id`
- Auth required: Yes
- Request path params: `{ "id": "session_001" }`
- Example response: `204 No Content` (no body) on success.
- Mobile screen: Account Security (`src/app/account-security.tsx`)
- MVP priority: P0 (Phase 12, work unit 12B-B2/12B-M1)
- Backend notes: Throws `ApiError` with code `SESSION_NOT_FOUND` (status 404) both for a nonexistent id and for another account's id — the identical response either way, so this can never be used to probe which session ids exist for other accounts.
- Connected: Yes. `revokeSession(sessionId)` in `src/services/auth/account-security-service.ts` calls `request('auth/sessions/${sessionId}', { method: 'DELETE' }, { requiresAuth: true })`. `src/app/account-security.tsx` requires an explicit confirm step before calling this (a destructive action), and removes the session from the locally-rendered list on success. **Client note:** a `204 No Content` response has no body; `services/api/client.ts`'s `request()` now special-cases `response.status === 204` and resolves with `undefined` instead of attempting (and failing) to parse an empty body as JSON — see that file's `HTTP_NO_CONTENT` constant.

### POST /auth/password-reset/request / POST /auth/password-reset/confirm

- Purpose: Unauthenticated "forgot password" flow — request a reset token for an email, then consume it to set a new password.
- Auth required: No (both routes).
- Backend notes: `POST /auth/password-reset/request` always responds `202 { success: true, devToken? }` (anti-enumeration; never reveals whether the email resolved to an account). `devToken` (the raw, one-time reset token) is present ONLY when the backend runs with `DEV_TOOLS_ENABLED=true && NODE_ENV != production`. `POST /auth/password-reset/confirm` responds `200 { success: true }`, consumes a single-use token, sets the new password, and revokes ALL sessions for that account.
- Mobile screen: None.
- MVP priority: P2 (deferred)
- Connected: **No, deliberately, as of Phase 12 work unit 12B-M1.** This flow is for a user who is logged out and cannot authenticate at all — it doesn't fit the authenticated Account Security screen this work unit built, and the runbook's hard requirement ("no dev-token control compiled into or reachable from a production build") is safer satisfied by not building a partial version of this surface than by half-building it. Nothing in the mobile app calls either route, reads `devToken`, or references it anywhere — there is no dev-only control to gate because there is no reset-password UI at all yet. A future work unit that adds this screen must keep `devToken` behind `__DEV__` and never render/log/persist it in a production build.

### POST /users/me/deletion

- Purpose: Permanently delete the current user's account, from the "Data & Privasi" screen's danger zone.
- Method and path: `POST /users/me/deletion`
- Auth required: Yes
- Request body (from `deleteMyAccount()` in `src/services/auth/account-deletion-service.ts`):

```json
{
  "currentPassword": "current-password",
  "confirmDeletion": true
}
```

`confirmDeletion` must be the LITERAL boolean `true` — the backend rejects the string `"true"` and any other value with a `400`. `deleteMyAccount()` has no parameter for this field and always sends the literal `true`; there is no code path in this client that can send anything else.

- Example response: `200 { "success": true }`.
- Mobile screen: Data & Privasi (`src/app/account-data.tsx`)
- MVP priority: P0 (Phase 12, work unit 12C-B1/12C-M1)
- Backend notes: **IMMEDIATE and IRREVERSIBLE** — no grace period, no cancellation endpoint. On success, every session for the account (including this device's own current session) is revoked and the `User` row itself is deleted in the same transaction; related rows cascade-delete (sessions, like/save interactions, watch progress, entitlements, password-reset tokens, lockouts) while `AnalyticsEvent`/`AuthAuditEvent` rows survive anonymized (`userId` set to `null`). Throws `ApiError` with code `INVALID_CREDENTIALS` (status 401) for a wrong `currentPassword` on an account that still exists — the same generic code `login()`/`changePassword()` use. Throws code `INVALID_ACCESS_TOKEN` (status 401) — NOT `INVALID_CREDENTIALS` — if the user no longer exists, including a repeated call on an already-deleted account (no distinct "already deleted" oracle, by design): this reuses the same generic "vanished user" code `GET /users/me/export` throws for the identical condition (see that endpoint's notes below), rather than collapsing it into the wrong-password code. Verified against backend source: `src/auth/auth.service.ts`'s `deleteAccount` throws `AppErrorCode.INVALID_ACCESS_TOKEN` when `this.prisma.user.findUnique` returns null, pinned by `src/auth/account-deletion.service.spec.ts`'s "is idempotent: a second call for an already-deleted account gets the same clean INVALID_ACCESS_TOKEN 401 every other 'user vanished' path already uses" test. Throws code `ACCOUNT_DELETION_FORBIDDEN` (status 403) if the account's role is not a plain `user` (e.g. admin/operator) — self-service deletion is not available for those roles this phase. Throws status 429 (generic `HTTP_ERROR` code — the backend's throttler does not emit an endpoint-specific error code, so `error.status`, not `error.code`, is the only reliable signal for this case) once the dedicated 5-calls-per-15-minutes rate limit is exceeded.
- Connected: Yes. `deleteMyAccount(currentPassword)` in `src/services/auth/account-deletion-service.ts` calls `request('users/me/deletion', ...)` with `{ requiresAuth: true }`. `src/app/account-data.tsx` requires an explicit, unmissable "this is permanent and cannot be undone" confirmation (via the shared `ConfirmDialog`) plus the current password before ever calling this. On success, the screen purges the just-deleted identity's own cached per-user data — `clearPersistedInteractionsForIdentity`/`clearPersistedProgressForIdentity` (new exports added to `src/stores/video-interactions.tsx`/`src/stores/series-progress.tsx` for this work unit) — BEFORE calling `useAuth().logout()` and redirecting to `/login`. This extra purge is deliberately more aggressive than what `logout()` alone does: an ordinary logout leaves a signed-out identity's own like/save/watch-progress data cached in `AsyncStorage` on purpose, so the same device can resume it if that same account logs back in later (see those two stores' identity-scoped hydration effects). Account deletion has no "later login as this account" to ever resume for, so this work unit added a dedicated, more aggressive purge path for exactly this case rather than changing `logout()`'s own (intentional, unrelated) behavior for every other caller.

### GET /users/me/export

- Purpose: Let the current user view a synchronous JSON export of their own data, from the "Data & Privasi" screen.
- Method and path: `GET /users/me/export`
- Auth required: Yes
- Request params/body: None.
- Example response (`UserExport`, `src/types/export.ts`):

```json
{
  "exportedAt": "2026-07-29T10:00:00.000Z",
  "profile": {
    "email": "jane@example.com",
    "displayName": "Jane",
    "memberSince": "2026-01-01T00:00:00.000Z"
  },
  "interactions": [
    { "videoId": "video_001", "videoTitle": "Episode 1", "isLiked": true, "isSaved": false, "updatedAt": "2026-07-01T00:00:00.000Z" }
  ],
  "watchProgress": [
    { "seriesId": "series_001", "videoId": "video_001", "videoTitle": "Episode 1", "episodeNumber": 1, "positionSeconds": 42, "durationSeconds": 120, "updatedAt": "2026-07-02T00:00:00.000Z" }
  ],
  "entitlements": [
    { "tier": "premium", "source": "dev_grant", "grantedAt": "2026-01-05T00:00:00.000Z", "expiresAt": null, "revokedAt": null }
  ]
}
```

- Mobile screen: Data & Privasi (`src/app/account-data.tsx`)
- MVP priority: P0 (Phase 12, work unit 12C-B2/12C-M1)
- Backend notes: Read-only, no side effect on the account. Deliberately excludes every internal database id, storage path/key, role, password hash, and session/security-metadata field — only catalog ids (`videoId`/`seriesId`, already client-visible via `/videos/feed`) are kept, paired with a resolved `videoTitle` so entries are meaningful. Throws status 429 (generic `HTTP_ERROR` code, same caveat as `/users/me/deletion` above — only `error.status` is reliable) once the dedicated 10-calls-per-5-minutes export rate limit is exceeded.
- Connected: Yes. `exportMyData()` in `src/services/export/export-service.ts` calls `request('users/me/export', ...)` with `{ requiresAuth: true }`. `src/app/account-data.tsx` renders the returned JSON in-app (pretty-printed, in a `selectable` `<Text>` the user can long-press to manually copy) — it is deliberately **never** written to disk or handed to an OS share sheet. Personal data leaving this screen under the app's own control (a file on disk, a share-sheet target the user didn't explicitly choose) would mean the app itself relinquishes control over where a sensitive personal-data export ends up; rendering it in-app, with the OS's own built-in text-selection/copy affordance available if the user wants to move it elsewhere themselves, needs no new dependency (`expo-file-system`/`expo-sharing` are not in `package.json` — only transitively installed by `expo` itself — and were deliberately not added for this).

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
- **`playbackUrl` (Phase 10, work unit 10-B3/10-M2; superseded for actual playback by Slice 11M — see `GET /videos/:id/playback` below):** the video stream endpoint (`GET {playbackUrl}`, i.e. `GET /videos/:id/stream` on the backend) requires `Authorization: Bearer <accessToken>`. This field is still returned on every feed item and is still what `src/app/(tabs)/index.tsx`'s Share action links to, but as of Slice 11M `src/components/drama-feed-item.tsx` no longer plays it directly — R2-backed media has an empty local `storageKey`, so this URL 404s for those rows. The feed item instead requests a playable URL from `GET /videos/:id/playback` for the active item only; see that endpoint's entry below for the full contract. Episodes past `FREE_EPISODE_LIMIT` require an active entitlement — see `GET /users/me/entitlement` below. (Phase 11: the free/premium decision behind that guard is sourced from a DB-backed per-episode tier rather than pure `episodeNumber` math, with the existing outcome preserved for every episode — see the Phase 11 note under "Series and Episode" above.)

### GET /videos/:id/playback

- Purpose: Return short-lived authorization to play one video, for either storage kind the backend holds it in (Slice 11M; see the control workspace `DECISIONS.md`, "Slice 11M approved; playback contract decided (Option A, dedicated endpoint)", 2026-08-08).
- Method and path: `GET /videos/:id/playback`
- Auth required: Yes (same Bearer auth as the rest of the API)
- Request path params: `{ "id": "video_001" }`
- Example response (`PlaybackAuthorization`, `src/types/playback.ts` — raw DTO, no envelope):

```json
{
  "playbackUrl": "https://media.example.com/videos/video_001/stream",
  "expiresAt": "2026-08-08T10:15:00.000Z",
  "requiresAuthHeader": true
}
```

For an R2-backed video the same shape instead carries a short-lived (15
minute) presigned GET URL straight to the storage provider:

```json
{
  "playbackUrl": "https://r2.example.com/bucket/video_002.mp4?X-Amz-Signature=...",
  "expiresAt": "2026-08-08T10:15:00.000Z",
  "requiresAuthHeader": false
}
```

- Mobile screen: Home (the feed item's active-item player source)
- MVP priority: P0 (Phase 11, Slice 11M)
- Backend notes: Answers for BOTH storage kinds so the mobile app keeps one code path and learns nothing about R2 — local-backed media gets the existing `/videos/:id/stream` URL with `requiresAuthHeader: true`; R2-backed media gets a presigned GET with `requiresAuthHeader: false`. The object key is always read from the media row server-side; no key, bucket, or endpoint is ever accepted from the client. Applies the same premium-entitlement gate `/videos/:id/stream` already enforces. Throws `ApiError` with: 404 (not found / not published), 401 `INVALID_ACCESS_TOKEN` (unauthenticated), 403 `ENTITLEMENT_REQUIRED` (premium episode, no entitlement), 409 `MEDIA_PLAYBACK_SOURCE_UNAVAILABLE` (row has no usable storage).
- **Client note (load-bearing):** a presigned R2 URL rejects a request that also carries an `Authorization` header ("only one auth mechanism") — the mobile client MUST attach `Authorization: Bearer <accessToken>` only when `requiresAuthHeader` is `true`, never unconditionally.
- Connected: Yes. `getPlaybackAuthorization(videoId)` in `src/services/videos/video-service.ts` calls `request('videos/${videoId}/playback', { method: 'GET' }, { requiresAuth: true })`. `src/components/drama-feed-item.tsx` requests this ONLY for the item that is currently active — never for off-screen mounted items — and feeds the resolved `playbackUrl`/conditional header to `useVideoPlayer`'s source. The response is held in component state only (never persisted to `AsyncStorage` or any store) and is re-requested once `expiresAt` has passed and the item is active again. A response that arrives after the item is no longer active, or after a newer request for the same item, is discarded. Every failure mode (including 403) folds into the existing "video unavailable" error state — there is no separate mobile-visible error UI per status code. When `EXPO_PUBLIC_USE_MOCK_DATA=true` (or in a demo build), this call is bypassed and an authorization is synthesized from the matching bundled/mock video's own `playbackUrl`, mirroring `getVideoFeed()`/`getVideoById()` above; `requiresAuthHeader` is `false` in a demo build (nothing to authorize for a bundled clip) and `true` otherwise.

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

- Purpose: Batch-ingest mobile analytics and JS-error events (Phase 11).
- Method and path: `POST /analytics/events`
- Auth required: Yes (JWT — the backend rejects anonymous ingestion by recorded decision; the mobile queue silently drops events while logged out for the same reason)
- Request body (from `postAnalyticsEvents()` in `src/services/analytics/analytics-service.ts`; max 50 events per batch):

```json
{
  "events": [
    {
      "eventName": "video_play",
      "properties": { "videoId": "video-104-01", "seriesId": "series-104", "episodeNumber": 1 },
      "clientTimestamp": "2026-07-24T10:00:00.000Z",
      "platform": "ios"
    }
  ]
}
```

- Example response (raw DTO, no envelope):

```json
{ "accepted": 1 }
```

- Event names and their allowed properties are a server-enforced allowlist
  (unknown event names → 400; unknown property keys are stripped
  server-side): `feed_view`, `video_play`, `video_like`, `video_save`,
  `episode_navigate`, `premium_gate_hit`, `app_error` — see the backend's
  `src/analytics/analytics.types.ts` for the authoritative schema.
- Mobile screen: Home (`feed_view`/`video_play`/`video_like`/`video_save`),
  feed next-episode button and Series Detail (`episode_navigate`/
  `premium_gate_hit`), global error handlers (`app_error`).
- MVP priority: P1
- Backend notes: never blocks UI — the mobile side buffers in memory
  (`src/services/analytics/analytics-queue.ts`), flushes every 10s or at 20
  events, and drops batches silently on any failure. No persistence and no
  retries, by recorded design (telemetry, not user data). `anonymousId` from
  the old draft of this section does not exist — the server attaches the
  authenticated `userId` itself and nulls it on account deletion.
- Connected: Yes. `trackEvent()` (`src/services/analytics/analytics-queue.ts`)
  is called from `src/app/(tabs)/index.tsx`, `src/components/drama-feed-item.tsx`,
  and `src/app/series/[id].tsx`; fatal JS errors/unhandled rejections are
  reported as `app_error` via `src/services/analytics/error-reporting.ts`,
  installed once in `src/app/_layout.tsx`.

### GET /config/ads

- Purpose: Return the counter-based interstitial ad pacing config (Phase 15,
  slice 15A-S1). Drives when the mobile app is allowed to show an
  interstitial between feed videos.
- Method and path: `GET /config/ads`
- Auth required: No (top-level JSON, no envelope, no auth guard — frozen by
  the 15A-S1 approval).
- Request params/body: None.
- Example response (`AdsConfig`, `src/services/ads/ad-gate.ts` — raw DTO, no envelope):

```json
{
  "enabled": true,
  "minVideosBetweenAds": 3,
  "maxVideosBetweenAds": 6,
  "minSecondsBetweenAds": 120,
  "graceVideos": 5
}
```

- Mobile screen: Home (drives `src/hooks/use-interstitial-ad.ts` via the ads
  store), fetched once on app start.
- MVP priority: P1 (Phase 15)
- Backend notes: Defaults shown above (`enabled=true, min=3, max=6,
  seconds=120, grace=5`). Backend-side env parsing/fallback behavior is out
  of scope for this mobile-only contract entry.
- Connected: Yes. `fetchAdsConfig()` in
  `src/services/ads/ads-config-service.ts` calls
  `request<unknown>('config/ads')` (no `requiresAuth`), validates all five
  fields are present with the correct type, and falls back to
  `DEFAULT_ADS_CONFIG` (matching the response shape above) on ANY failure —
  network error, non-2xx, or a malformed/incomplete payload — logging via
  `console.warn` gated by `__DEV__`. Fetched once on mount by `AdsBridge`
  (`src/components/ads-bridge.tsx`, mounted in `src/app/_layout.tsx`) and
  stored in `src/stores/ads-store.ts`.

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
