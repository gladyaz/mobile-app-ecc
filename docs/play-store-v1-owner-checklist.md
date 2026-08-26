# Red Panda — Play Store V1 owner checklist

Everything here needs an account, a credential, or a published page. None of it
can be done from the repository, and none of it was guessed at.

Identity is settled and applied: **`com.spark.redpanda`**, display name
**Red Panda**. Verify progress at any point with `npm run release:preflight`.

Do not build a release AAB until that command exits 0.

---

## 1. Deploy the backend  → clears blocker 1

**Status: nothing to prepare in this repository.** The NestJS backend is a
different repository and is not part of this project (README.md:56). There is no
Dockerfile, compose file, Railway/Render/Fly/Cloud Run/Vercel/Cloudflare config
or environment template here, so there is no deployment target to safely
prepare from this side.

**Required action:** deploy the backend repository to a public **HTTPS** origin
with a valid TLS certificate, then set `EXPO_PUBLIC_API_BASE_URL` on the build
machine. HTTP will not work — Android 9+ refuses cleartext, and the LAN
exemption plugin is scoped to the internal demo only.

### What the backend must serve

**Guest-critical — the app cannot open and play anything without these:**

| Endpoint | Auth | Used for |
|---|---|---|
| `GET /videos/feed` | none | the Home feed catalog |
| `GET /videos/:id/playback` | **optional** | playback authorization; anonymous requests are valid and the backend's own gate decides free vs premium |
| `GET /series`, `GET /series/:id` | none | Discover and Series detail |
| `GET /config/ads` | none | ad pacing config; falls back to a safe default on a transient error, and fails **closed** (ads off) when the base URL is missing |

**Signed-in features — degrade honestly without them, but the feature is dead:**
`/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`,
`/auth/change-password`, `/auth/sessions`, `/auth/identities`,
`/users/me/entitlement`, `/users/me/interactions`, `/users/me/progress`,
`/users/me/export`, `/users/me/deletion`, `/videos/:id/like`, `/videos/:id/save`,
`/series/:id/progress`, `/rewards/snapshot`, `/rewards/check-in`,
`/rewards/ledger`, `/rewards/redeem`, `/analytics/events`.

**Deployment flags that change what users see:**
- `REWARDS_ENABLED=true` plus at least one redeemable VIP offer, or the Rewards
  tab has nothing to spend points on — and the premium gate's "redeem it with
  points" promise becomes false.
- `GOOGLE_AUTH_ENABLED=true` with the web client id in `GOOGLE_OAUTH_CLIENT_IDS`,
  or Google sign-in answers `503` (see §5).
- WhatsApp **cannot** be enabled in production — only a `fake` driver exists and
  the process refuses to boot with it enabled outside development/test.

---

## 2. Publish the privacy policy  → clears blocker 2

Set `EXPO_PUBLIC_PRIVACY_POLICY_URL` (absolute https).

The page must truthfully disclose what the app actually does. Verified against
the code, this is that list — **do not add categories the app does not collect,
and do not omit these**:

**Account data**, when a user registers or signs in: email address, an optional
display name, account creation date. A Google-linked account additionally stores
the Google account identifier; a WhatsApp-linked one stores a phone number.

**Activity data**, tied to the account: liked and saved videos, watch progress
(series, episode number, playback position), rewards points balance and the
full transaction ledger, premium entitlement status, and product analytics
events (`POST /analytics/events`).

**On-device storage**, which is not transmitted by itself: authentication
tokens, the same likes/saves/progress cached for offline use, and the chosen
language. Stored per account under `@mobile-app-ecc/*` keys in app-private
storage. Android auto-backup is **disabled** (`allowBackup="false"` — verified
in the merged release manifest), so this is not copied to Google Drive.

**Advertising.** The app serves Google AdMob interstitials and the merged
manifest carries `com.google.android.gms.permission.AD_ID`, so the **Advertising
ID is collected** and must be declared in the Play Data safety form. The app
gathers consent through Google's User Messaging Platform where required, and
exposes an "Ad Privacy Options" control in Profile for regions where Google
reports it is required.

**Not collected:** location, contacts, camera, microphone, files, or SMS. The
app requests none of those permissions — the merged release manifest contains
only `INTERNET`, `ACCESS_NETWORK_STATE`, `VIBRATE`, `WAKE_LOCK`,
`FOREGROUND_SERVICE`, `AD_ID` and the AdServices set.

The page should also carry a **support contact address**, because the in-app
copy for a passwordless account points there.

> Legal wording is the owner's and their counsel's responsibility. The list
> above is a factual inventory of app behaviour, not legal advice.

---

## 3. Publish the account-deletion page  → clears blocker 3

Set `EXPO_PUBLIC_ACCOUNT_DELETION_URL` (absolute https).

**Deletion works three ways, and the page must be honest about which:**

1. **In-app, for an account with a password.** Profile → Data & Privasi → danger
   zone. Requires the current password, calls `POST /users/me/deletion`, and is
   **immediate and irreversible** — every session is revoked and the user row is
   deleted in one transaction, with likes/saves/progress/entitlements cascading.
   The app purges the deleted identity's local caches before signing out.
2. **Backend endpoint.** `POST /users/me/deletion`, the same path the app uses.
3. **Web page — the only route for an account with no password.** A Google-only
   or WhatsApp-only account cannot use path 1: the backend requires the current
   password and fails closed. The app already refuses to offer a password form
   to such an account and says so instead. **This page is therefore not just a
   Play formality; it is the sole deletion route for those users.**

Google Play requires the URL to be reachable **without installing the app** and
declared in the Data safety form. The page must state what is deleted, what is
retained (analytics/audit rows survive anonymised, with `userId` set to null),
and how long it takes.

---

## 4. Create the AdMob app and unit  → clears blockers 4 and 6

Register an AdMob app against **`com.spark.redpanda`**, create one **interstitial**
ad unit, then set both:

```
EXPO_PUBLIC_ADMOB_ANDROID_APP_ID=ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY
EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID=ca-app-pub-XXXXXXXXXXXXXXXX/ZZZZZZZZZZ
```

Set them **together**. A build with one and not the other cannot serve a real ad.

Also publish, under AdMob → Privacy & messaging, a **GDPR/EEA message** and a
**US states message**. Until they exist, `AdsConsent.requestInfoUpdate()` reports
`isConsentFormAvailable: false`, no form is ever shown, and an EEA/UK viewer
never reaches `canRequestAds: true` — the app then requests no ad at all, because
the consent gate fails closed by design.

---

## 5. Google OAuth  → clears warning 2 (optional for V1)

Google sign-in is **hidden** in a release build while
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is unset, so shipping without it is safe and
honest. To enable it, create in Google Cloud, in one project:

- a **Web** OAuth client — its id is the load-bearing one on every platform,
  because Google mints the ID token against the web client and the backend
  verifies that audience. This is the value the variable takes.
- an **Android** OAuth client bound to package `com.spark.redpanda`.

**Register every fingerprint that will ever sign the app, or sign-in breaks for
whoever is running the build you forgot:**

| Certificate | SHA-1 | When it applies |
|---|---|---|
| Shared Android debug | `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` | local `expo run:android` / debug-signed internal APKs. Not secret — ships with every Android SDK. |
| Your **upload** key | not yet created — see §6 | sideloaded release-variant builds, and what you upload to Play |
| **Play App Signing** key | issued by Google after the first upload | **every install from Google Play, including Internal Testing.** Read it from Play Console → Release → Setup → App signing. |

Missing the third row is the classic failure: sign-in works when you sideload
and fails for every tester who installs from Play.

Any OAuth client tied to the old `com.anonymous.mobileappecc` package is invalid
and must not be reused — Google matches on package **and** fingerprint.

---

## 6. Create the upload keystore  → clears blocker 7

**Recommended model: Google Play App Signing**, which is the default and is
required for new apps. Two different keys are involved and conflating them is
the usual mistake:

- **Upload key** — you generate it, you keep it, you sign the AAB with it. If it
  is ever lost or compromised, Google can reset it.
- **App signing key** — Google generates and holds it, and re-signs what users
  actually install. It can never be changed for the life of the app.

### This has NOT been generated here, deliberately

An upload keystore *can* be created locally with no account access, but creating
one requires choosing a password — and any password chosen in this session would
be written into the transcript, which compromises the key before it is ever
used. The procedure is prepared; the owner runs it.

```bash
# Run from the repository root. Choose a strong password when prompted; store it
# in a password manager, NOT in this repo and NOT in a shell that logs history.
keytool -genkeypair -v \
  -keystore upload-keystore.jks \
  -alias redpanda-upload \
  -keyalg RSA -keysize 4096 -validity 10000

# Then create keystore.properties at the repository root (already gitignored):
cat > keystore.properties <<'EOF'
storeFile=upload-keystore.jks
storePassword=<the password you chose>
keyAlias=redpanda-upload
keyPassword=<the key password you chose>
EOF

# Read the fingerprint you must register in Google Cloud (see §5):
keytool -list -v -keystore upload-keystore.jks -alias redpanda-upload | grep SHA1
```

`plugins/with-android-release-signing.js` picks these up and wires a real
`signingConfig` that survives `expo prebuild`. It reads the file **in Gradle**,
never in JavaScript, so no password passes through Node or appears in any
message the build prints. `ANDROID_RELEASE_STORE_FILE` /
`_STORE_PASSWORD` / `_KEY_ALIAS` / `_KEY_PASSWORD` work as an alternative for CI.

Already verified: `.gitignore` covers `*.jks`, `*.keystore`, `keystore.properties`,
`upload-keystore.properties`, `*.p12`, `*.key`, and nothing signing-shaped is
tracked in git.

**Back the keystore up off this machine.** Losing it before the first upload
means starting over; losing it after means an upload-key reset request.

---

## 7. Physical-device QA

**No device is connected as of 2026-08-26, and no RELEASE build has ever run on
one.** Everything verified so far is source analysis, Jest, a real production
export, and a real merged release manifest.

One narrow exception: a debug build against the LAN backend ran on a handset on
2026-08-25 (`25078RA3EY`, Android 15) to verify **Auto / adaptive** HLS
switching. That session requested `auto` throughout, so it establishes nothing
about manual rendition selection — see
[`playback-quality.md` §5](./playback-quality.md).

### MUST PASS BEFORE the first Internal Testing upload

Run on one mid/low-end Android handset. These are the failures that make an
upload worthless or unshippable.

| # | Check | Why it is in this list |
|---|---|---|
| 1 | Installs, and the launcher shows **Red Panda** with the right icon | first proof the identity change is real on a device |
| 2 | Cold launch to the feed without a crash | `MobileAdsInitProvider` runs before any JS; a bad AdMob app id crashes here |
| 3 | Guest entry: feed loads and a free episode **plays** | the whole product; also proves the production HTTPS backend is reachable from a phone, not just from the build machine |
| 4 | Swipe next/previous — audio never doubles | the runtime single-player ownership fix has never run on hardware |
| 5 | Discover → Series detail → pick an episode → it plays that episode | episode alignment is only test-verified |
| 6 | Register, sign in, kill the app, relaunch — still signed in | token persistence and the rewritten refresh path |
| 7 | Sign out, sign in as a second account — no data from the first appears | the cross-account sync fixes, unverified on hardware |
| 8 | An interstitial appears at a natural break, and dismissing it returns to playback | the `adVisible`/`showInFlight` wedge fixes gate playback |
| 9 | EEA/test-region: consent form appears before any ad | required once the AdMob messages are published |
| 10 | Delete a **disposable** test account end to end | irreversible; must be a throwaway account |
| 11 | `mobileappecc://_sitemap` and `mobileappecc://processing` are unreachable | internal surfaces, proven closed only at config/source level |
| 12 | Airplane mode: honest error states with Retry, no infinite spinner | the 20s timeout has never been exercised on a real radio |
| 13 | Playback Settings → pick **720p** on an HLS episode: the decoder holds 720&times;1280 and does not drift, and the position/speed/pause state survive the switch | the one claim of the quality feature that no test can make — a variant playlist really constraining a real decoder. Read it off the `__DEV__` `[PlaybackDecision]` / video-track log in a debug build |

### CAN VERIFY DURING Internal Testing

Background/foreground during playback · fullscreen and rotation · playback speed
· clear-display idle · Saved and Likes across sessions · Rewards daily check-in
and ledger paging · redemption · poor-network (throttled, not offline) recovery ·
app update over a previous install · install size and cold-start time on a 2 GB
device · long-session ad pacing against the 8-per-session cap · ID/EN/ZH
switching.

---

## 8. Execution order

1. Deploy the backend → `EXPO_PUBLIC_API_BASE_URL`
2. Publish privacy + deletion pages → their two variables
3. AdMob app + interstitial unit → two variables; publish consent messages
4. `keytool` upload keystore → `keystore.properties`
5. *(optional)* Google Cloud OAuth clients → `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
6. `npm run release:preflight` → **must exit 0**
7. `npx expo prebuild --platform android --clean`
8. **Clear the bundler cache**, then build — see §9 below, this one bites
9. Upload to Internal Testing; read the Play App Signing SHA-1 and add it to the
   Android OAuth client (§5)
10. Run the MUST-PASS device matrix on the installed build

---

## 9. THE TRAP THAT WILL SHIP YOUR DEV BACKEND

**Changing an `EXPO_PUBLIC_*` value does not, by itself, change what the build
inlines.** Expo folds these into the JavaScript bundle at build time, and the
Metro bundler caches the transformed output. A build run after editing `.env`
can silently reuse the OLD inlined values.

Measured in this repository, on this machine:

| Command | What landed in the bundle |
|---|---|
| `EXPO_PUBLIC_API_BASE_URL=https://...` + `expo export` | the **stale LAN host** `http://MacBook-Pro-Gladyaz.local:3000` |
| the same, with `expo export --clear` | the supplied origin; LAN host **absent** |

The shell variable was correct in both runs - `@expo/env` does not override an
already-set variable, verified directly. The stale value came from the cache.

**`npm run release:preflight` cannot catch this.** It reads the environment, not
the built artifact, so it will happily report 0 blockers for a bundle that
contains last week's LAN URL.

### So the build step is

    # 1. clear the JS bundler cache
    npx expo export --platform android --clear --output-dir /tmp/redpanda-verify

    # 2. VERIFY THE ARTIFACT, do not trust the environment
    strings -a /tmp/redpanda-verify/_expo/static/js/android/*.hbc \
      | grep -oE "https?://[a-zA-Z0-9._-]+(:[0-9]+)?" | sort -u
    #    -> must show your production origin
    #    -> must NOT show any .local, 192.168., 10.0.2.2 or MacBook host
    #       (http://localhost:8081 is React Native's own asset base, and is inert)

    # 3. only then produce the AAB. Delete android/app/build first: .env is not
    #    a Gradle input either, so the bundle task will not re-run on its own.
    cd android && ./gradlew bundleRelease

See release-readiness-android.md §4 for the JAVA_HOME / ANDROID_HOME exports a
non-interactive shell lacks.
