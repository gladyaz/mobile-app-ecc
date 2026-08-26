# Video quality — Red Panda V1

What the quality control in the Playback Settings sheet actually does, what it
is allowed to claim, and what has and has not been confirmed on a handset.

Companion to [`release-readiness-android.md`](./release-readiness-android.md)
(release blockers, build steps, smoke test) and
[`play-store-v1-owner-checklist.md`](./play-store-v1-owner-checklist.md)
(what the owner must do outside this repository).

---

## 1. The product this ships inside

| | |
|---|---|
| **Display name** | Red Panda |
| **Android applicationId** | `com.spark.redpanda` |
| **V1 monetization** | Free app + ads (AdMob interstitials) |
| **Payments / subscriptions** | **Out of scope for V1.** No checkout, no purchase flow, no billing or IAP SDK anywhere in the app. |
| **Premium episodes** | Still exist as an **access tier the backend decides**. The only way a viewer obtains it today is redeeming reward points, debited and granted server-side. The premium gate's single call to action opens Rewards — there is no checkout to route to. |

Pinned by `src/services/entitlement/__tests__/v1-payment-boundary.test.ts`: a
payment dependency, a payment route, or a payment import fails that suite.

---

## 2. The quality model

### Auto and manual are different playlists, not different labels

- **Auto** plays the backend's **master playlist**. Adaptive bitrate is
  unrestricted; the player moves between renditions as the network allows.
- **Manual** plays **that rendition's own variant playlist**. A variant
  playlist advertises exactly one rendition, so the player can only fetch that
  rendition's segments. It is a real, spec-level constraint.

`GET /videos/:id/playback` already returns both: the adaptive `masterUrl` and
every produced rendition's variant URL in `renditions[].url`, all covered by
the same token and the same `expiresAt`.

### Why a source swap and not a player setting

`expo-video` 57.0.2 exposes `VideoPlayer.videoTrack` and
`availableVideoTracks` as **read-only** — `VideoModule.kt` registers
`Property("videoTrack").get {}` with no `.set {}`, unlike `subtitleTrack` and
`audioTrack`, which both have one. There is no `maxVideoSize`, no
`preferredPeakBitrate`, and no exposed `TrackSelectionParameters`. There is no
way to ask the installed player to pin a rendition in place, so playing the
variant playlist directly is the only truthful mechanism available without
native changes.

The cost is that a quality change replaces the source, and `expo-video` hands
back a new player. That is routed through the **existing** generation-swap
reseek in `drama-feed-item.tsx` (the DETECT/APPLY effect pair), not a second
competing position-restore mechanism.

### Manual state is a rendition NAME, never a URL

A manual choice stores `'720p'`. A variant URL carries a short-lived
path-embedded gateway token, so holding one in component state would pin a URL
that dies at `expiresAt`. Holding the name means the proactive pre-expiry
re-authorization re-resolves it against the **fresh** grant automatically.

### The labels

`Auto` · `360p` · `540p` · `720p` · `1080p HD`

- The `HD` marker is localized copy (zh: `高清`). The rendition token
  (`1080p`) deliberately is not — it is the backend's own rendition name and
  reads identically in every locale.
- Renditions are named by their **short side**. For a portrait source (every
  short drama here) the `1080p` rung of a 1080×1920 source is 1080 *wide* and
  1920 *tall*, so a label derived from `height` would read "1920p".

### Availability is per video, and derived from nothing but the authorization

| Situation | What the sheet shows |
|---|---|
| HLS grant with ≥2 renditions | Auto plus exactly those renditions, highest first |
| HLS grant with 1 rendition | **No quality section.** "Auto" and the single rung would be the same stream under two names |
| MP4-backed video | **No quality section.** One fixed stream; there is no ladder to pretend about |
| Authorization not yet arrived | **No quality section** — see §3 |
| Authorization failed | No sheet at all; the whole settings surface is withdrawn with the error |

A video whose source was too small to produce a 1080p rung simply has no 1080p
entry. **1080p is offered only when the backend's ladder for that video
contains it** — the app never advertises a rung it was not told about, even
though it supports one.

### What survives a quality change

Playback position, manual-pause intent, playback speed, active-player
ownership, and clear display. Only the resolved source changes.

### What happens when the ladder moves under a pinned choice

- **Rendition still present in the refreshed grant** → re-resolved to the new
  tokened variant URL; the old URL is never kept.
- **Rendition gone** (a re-transcode, a changed source) → the player degrades
  to the adaptive master, and `resolveEffectiveQuality` makes the menu agree by
  showing Auto. The checkmark can never sit on a rendition nothing is playing.
- **Ladder drops below two rungs** → the section disappears entirely.
- **New video** → resets to Auto. A rung pinned two clips ago must not follow
  the viewer down the feed, and the next video's ladder may not even contain
  it. Same scope rule, for the same reason, as playback speed.

---

## 3. Why there is no "Quality — available after the video loads" row

Before `GET /videos/:id/playback` answers, the app **does not know** whether
this video has an HLS ladder at all: the same `null` authorization precedes an
MP4-backed video (one fixed stream, no ladder ever) and a four-rung HLS one.

A placeholder row would therefore be a promise the app cannot keep for the MP4
case — the row would appear and then never resolve into anything. Showing
nothing is the only option that is true in both cases, and it is what ships.

The rest of the sheet (Speed, Clear Display, Fullscreen) renders throughout, so
opening the kebab early is never an empty sheet.

Pinned by `src/components/__tests__/playback-settings-sheet.test.tsx`.

---

## 4. Android network behaviour

### Debug / local backend

- The Metro dev server is reached over `adb reverse tcp:8081 tcp:8081`.
- `plugins/with-lan-cleartext-demo.js` writes a `network_security_config`
  permitting cleartext to the LAN backend host **and**, in the `debug` source
  set only, to `localhost` / `127.0.0.1`.
- The localhost entry is load-bearing: declaring
  `android:networkSecurityConfig` makes Android **ignore** the debug manifest's
  `usesCleartextTraffic="true"`, which otherwise blocks the JS bundle download
  and hangs the app on its splash with *"CLEARTEXT communication to localhost
  not permitted by network security policy"*.

### Production / HTTPS

- The plugin keys off the **scheme** of `EXPO_PUBLIC_API_BASE_URL`. Point a
  build at an `https://` backend (or at nothing) and it grants no exemption:
  no resource, no manifest attribute, no `usesCleartextTraffic`.
- It also **actively removes** a resource and manifest attribute left behind by
  an earlier LAN prebuild. `expo prebuild` without `--clean` regenerates
  `android/` in place, so a plugin that merely returned early would let the
  same working tree that built the internal demo produce a production APK still
  carrying a cleartext exemption for a private LAN address. Removal is narrow:
  a resource file is deleted only if it carries this plugin's own generated
  marker, and the manifest attribute is cleared only if it points at this
  plugin's own resource.
- The release config never contains a broad `base-config`, and
  `usesCleartextTraffic="true"` is never set application-wide.

Pinned by `plugins/__tests__/with-lan-cleartext-demo.test.js`.

---

## 5. Physical-device QA status

**A device is not connected as of 2026-08-26, and nothing in this section has
been re-run since.**

### Confirmed on a handset (2026-08-25, device `25078RA3EY`, Android 15)

Playing `video-101-01` with **`requested=auto`**, the decoder reported
360×640 @1045800 → 540×960 @1990800 → 720×1280 @3565800 → 360×640, matching the
live master manifest's `BANDWIDTH` values exactly, with zero
`PlaybackInvariantViolation` across the session.

That is evidence for **Auto / adaptive switching** and for the `__DEV__`
`reportVideoTrack` instrumentation that makes such a claim checkable at all.

### NOT confirmed on a handset

- **Manual rendition pinning.** The recorded session requested `auto`
  throughout. That selecting `720p` holds the decoder at 720×1280 — the central
  claim of the manual mode — has never been observed on a device. It is covered
  by deterministic tests at the source-resolution level only.
- Quality switching under a real mid-playback authorization refresh.
- The visual smoothness of a swap (rebuffer duration, any visible flash).
- Manual selection over a genuinely constrained mobile-data connection.

Everything else in this document is derived from source and from Jest.

---

## 6. External blockers

Quality selection adds **no** new external dependency: it uses the playback
authorization the app already requests. The V1 release blockers are unchanged
and are tracked in full in
[`release-readiness-android.md` §3](./release-readiness-android.md) and
[`play-store-v1-owner-checklist.md`](./play-store-v1-owner-checklist.md) —
production backend URL, privacy policy and account-deletion pages, AdMob app
and interstitial unit ids, the release keystore, the Google OAuth client, and
physical-device QA.

Run `npm run release:preflight` for the current, authoritative list.

---

## 7. Where the behaviour is pinned

| File | What it covers |
|---|---|
| `src/constants/__tests__/playback-quality.test.ts` | Option derivation, HD marking by short side, the ≥2-rung rule, effective-quality fallback |
| `src/services/videos/__tests__/video-service.test.ts` | `resolvePlaybackSource`: master vs variant, unknown rung degrading to adaptive, MP4 unaffected, the HLS kill switch outranking a quality choice |
| `src/components/__tests__/playback-settings-sheet.test.tsx` | The sheet in isolation: pre-authorization contract, semantic (never URL) selection payloads, accessibility, all three locales |
| `src/components/__tests__/drama-feed-item.test.tsx` | The integration: real source swaps, refreshed-token re-resolution, dropped and reduced ladders, failed authorization, speed/pause/position/ownership survival, rapid switching |
| `plugins/__tests__/with-lan-cleartext-demo.test.js` | Debug vs release cleartext scope, and the production removal branch |
