# Canonical Red Panda V1 Mobile

The single mobile source of truth for continued development, handover, staging
builds and Play Store release preparation. This is a developer index — each
subsystem's real documentation is linked, not duplicated here.

## Where it lives

| | |
|---|---|
| Local path | `/Users/gladyaz/red-panda-mobile` |
| Branch | `integration/red-panda-v1-final` |
| Base | `feat/v1-provider-account-deletion` |
| Application id | `com.spark.redpanda` (Android + iOS) |
| Deep-link scheme | `mobileappecc` |

This branch is the union of every V1 mobile feature branch that landed. Fifteen
sibling worktrees under `~/coding-folder/` and `~/mobile-app-redpanda-*` hold
the historical branches; all of their shipped work is an ancestor of this HEAD
or was re-applied onto it, with the one exception recorded under
[Outstanding integration](#outstanding-integration).

Work here. Do not restart development in a sibling worktree.

## V1 product scope

Content is **free**, funded by **ads**. There is no payment, subscription, coin
purchase or premium tier a viewer can reach.

Required and enforced by the release preflight: **Google Login**, **WhatsApp
Login**, **Rewards**, **HLS playback**.
Blocked by the same preflight: premium experience, any payment/subscription
dependency, mock or demo release configuration, Google's sample AdMob ids,
unsafe API base URLs, and regressions in secure token storage.

The premium/entitlement architecture still exists behind
`EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED` — hidden, not deleted. See
[`v1-product-scope.md`](v1-product-scope.md).

## Subsystems

| Area | Where | Notes |
|---|---|---|
| Feed / playback | `src/app/(tabs)/index.tsx`, `src/components/drama-feed-item.tsx` | Immersive feed, single-player ownership enforced at runtime (`src/services/playback/`) |
| HLS quality | `src/constants/playback-quality.ts`, `src/services/videos/` | Auto + manual 360/540/720/1080 via variant-playlist source swap with position-preserving reseek — see [`playback-quality.md`](playback-quality.md) |
| Discover | `src/features/discover/` | Poster-first hub — see [`discover-content-hub.md`](discover-content-hub.md) |
| Saved / Profile | `src/app/(tabs)/saved.tsx`, `profile.tsx` | |
| Auth | `src/services/auth/`, `src/features/auth/` | Google + WhatsApp OTP; `provider-availability.ts` decides what is offered |
| Session storage | `src/services/auth/session-secret-store.ts`, `session-store.ts` | SecureStore behind the Android Keystore, with one-way migration of legacy plaintext sessions |
| Account deletion | `src/features/account-deletion/`, `src/services/auth/account-deletion-service.ts` | Password, Google and WhatsApp-OTP proofs; post-delete session + account-bound cache purge |
| Rewards | `src/features/rewards/`, `src/services/rewards/` | Daily check-in, watch missions, Instagram/TikTok/YouTube missions, coins — see [`rewards-domain-contract.md`](rewards-domain-contract.md) |
| Ad perks | `src/services/ads/` | UMP consent gate, Skip Next Interstitial, Temporary Ad-Free Pass |
| Backend wire contract | `docs/api-contract.md`, `docs/internal-storage.md` | Read before adding any media/file-backed field |
| Android hardening | `app.json`, `plugins/`, `scripts/check-release-android.js` | `allowBackup=false`, `dataExtractionRules`, debug-only cleartext isolation |

## Local setup

```bash
npm ci                 # required in a fresh worktree
cp .env.example .env   # then fill in the values below
npm start              # Expo dev server
```

`.env` drives the release contract. The values that gate a real build are
`EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, the two AdMob
ids, and the three legal URLs.

## Validation

```bash
npm run lint
npm run typecheck
npm test -- --runInBand
npm run release:preflight
```

Baseline on this HEAD: lint clean, typecheck clean, **122 suites / 1970 tests
passing**, preflight exits 1 on external blockers only.

## External release blockers

`npm run release:preflight` fails with 7 blockers. All 7 are credentials and
published pages that do not exist yet — none is a code defect, and none should
be worked around in code:

1. `EXPO_PUBLIC_API_BASE_URL` not set
2. `EXPO_PUBLIC_PRIVACY_POLICY_URL` not published
3. `EXPO_PUBLIC_ACCOUNT_DELETION_URL` not published (Play requires a web route
   that works without installing the app, independently of the in-app flow)
4. `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` not set
5. `EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID` not set
6. AdMob app id is still Google's public sample id
7. Release signing not configured — the build would be debug-signed

Two warnings: `EXPO_PUBLIC_TERMS_URL` unset, and WhatsApp login is offered but
**no real WhatsApp OTP has ever been delivered end to end** — one live send to a
handset you control is still owed.

Owner-side steps: [`play-store-v1-owner-checklist.md`](play-store-v1-owner-checklist.md).
Full readiness detail: [`release-readiness-android.md`](release-readiness-android.md).

## Outstanding integration

`feat/v1-backend-contract-lock` (`1e94179`) is completed, self-verified V1 work
that is **not** an ancestor of this branch. It and this HEAD are siblings, both
branched from `f9f36f8`. It adds `src/services/contract/` — a wire-contract
manifest, canonical fixtures and seven suites (165 cases) that pin the V1
backend contract so drift fails a test here — plus runtime validation of the
three auth session responses.

Integrating it needs one hand-resolved conflict in
`src/services/auth/provider-auth-service.ts`: this HEAD extracted the OTP
parser into `services/auth/otp-challenge.ts` and dropped the file-local
`invalidResponse` helper, which the contract-lock code calls. Keep this HEAD's
extraction and route the new `parseAuthResponse` through the shared helper.

## No production AAB yet

No Android App Bundle has been built from this branch, and none should be until
the seven blockers above are closed. Debug-signed internal demo APKs are a
different, deliberately supported path — see
[`android-local-demo.md`](android-local-demo.md) and
[`android-offline-demo-apk.md`](android-offline-demo-apk.md).
