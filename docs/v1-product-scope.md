# Red Panda V1 — product scope, and what the mobile app does about it

Decision date: 2026-08-26. This document is the reference for why the premium
surfaces are absent from a V1 build without being absent from the repository,
and for the two backend contracts V1 is still waiting on.

## The scope

| In V1 | Not in V1 |
|---|---|
| Free drama content | Premium paywall |
| Ads monetization | Subscription |
| Rewards (coins, daily check-in, watch + social missions) | Payment / Midtrans checkout |
| Google Login | Buy coins |
| WhatsApp Login | |
| HLS Auto / manual quality | |

## How the premium experience is switched off

One module: `src/services/config/v1-scope.ts`, exposing
`isPremiumExperienceEnabled()`. It reads
`EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED` and defaults **off**.
`npm run release:preflight` **blocks** a release build that sets it to `true`.

It gates six surfaces, and nothing else:

| Surface | File |
|---|---|
| Discover "Premium" poster badge | `src/features/discover/discover-catalog.ts` |
| Per-episode access chip | `src/components/series-episode-row.tsx` |
| Series Detail episode lock + modal | `src/app/series/[id].tsx` |
| Feed next-episode lock + modal | `src/components/drama-feed-item.tsx` |
| "Activate Premium" playback gate + Rewards CTA | `src/components/drama-feed-item.tsx` |
| Premium-granting reward redemptions | `src/features/rewards/rewards-mapper.ts` |

### What was deliberately NOT done

Nothing was deleted. The entitlement store, `accessTier` parsing, the
entitlement service, the redemption catalog, `PremiumPreviewModal` and every
gate that consumes them are intact and tested — the V1.1/V2 behaviour of each
gated surface is pinned by a test that turns the flag on. Restoring the premium
experience is a configuration change and a rebuild.

The redemption filter is keyed on the **grant** (`grantsDays > 0`), not on an
offer-id blocklist, so the first genuinely non-premium offer the backend adds —
a Skip Next Ad perk, say — reaches the Redeem panel with no client change.

### What a V1 viewer meets on an entitlement refusal

With `CONTENT_ACCESS_MODE=free` on the backend, a `403 ENTITLEMENT_REQUIRED`
should never arrive. If it does, it is a server misconfiguration, and the app
says the episode cannot be played and offers nothing — no premium tier it
cannot sell, no Rewards route that cannot help, and no "check your connection"
for a request the server actually answered. A **guest** is still offered sign-in:
that costs nothing and is not a paywall.

## Ads ↔ rewards perk boundary

Already present, and preserved rather than rebuilt.
`evaluateTransition(state, cfg, opts)` in `src/services/ads/ad-gate.ts` is the
single place that answers "show the next interstitial?", and it reports which
input said no via `AdGateHoldReason`. A future **Skip Next Ad** reward is an
added flag on `AdGateTransitionOptions` plus a matching hold reason, decided in
that pure function and nowhere else.

The flag must be derived from state the **server** granted, mirrored the way
`isPremium` already is (`components/ads-bridge.tsx` → ads store, never
persisted, re-derived from auth each launch). A locally-set "I have a skip"
boolean would be the client granting itself a paid perk.

**V1 ships no such perk**, and no V1 redemption grants one.

## Open backend contracts

V1 mobile work is complete against both of the surfaces below **as currently
documented**. What remains is confirmation from the parallel backend sessions.

### 1. WhatsApp Login

**Mobile state: complete and real.** `startWhatsAppOtp` → `verifyWhatsAppOtp` →
session, against the canonical endpoints in `docs/api-contract.md`. Payloads are
validated at the boundary, `ApiError` is propagated untouched, and no build
hardcodes an OTP or mints a session the server did not grant.

**The button is visible by default** — it is a confirmed V1 feature and is not
withdrawn while its backend is built. `EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED=false`
is the kill switch, and the release preflight **warns** so each build makes the
choice deliberately.

**Until the backend lands**, `docs/api-contract.md` ("Provider activation
status") records that a deployed server answers `503 WHATSAPP_AUTH_DISABLED`.
The client maps that to its own specific message — "Login WhatsApp belum aktif
di server ini" — rather than a generic failure. An honest "not active yet" was
accepted over hiding a V1 feature.

**Needed from the WhatsApp backend session:**

1. Confirmation that `POST /auth/whatsapp/otp/request` and
   `POST /auth/whatsapp/otp/verify` keep their current request/response shapes
   (`{ phone }` / `{ phone, code }`; `{ success, expiresInSeconds,
   resendAvailableInSeconds }` / the ordinary `AuthResponse`).
2. The real rate-limit values, if they differ from the documented per-number
   cooldown, per-hour budget and per-IP throttles.
3. Confirmation that the anti-enumeration guarantee holds with a real provider:
   the response must stay identical for a registered and an unregistered number.
4. Whether `INVALID_OTP` remains one code for wrong / expired /
   attempts-exhausted / already-used / no-such-challenge. The client shows one
   message for all five deliberately; splitting it would need a product call.

If any of (1) changes, the only file that moves is
`src/services/auth/provider-auth-service.ts` — the screens, the countdown, the
error mapping and the toast copy all sit above it.

### 2. Rewards

**Mobile state: complete against `docs/rewards-domain-contract.md`.** The UI has
room for coin balance, daily check-in, watch missions, social missions
(Instagram / TikTok / YouTube, with Facebook already carried) and coin
redemption. Every task's claimability is **server-owned** (`isClaimSupported`),
and no client path grants points or an entitlement.

**Needed from the Rewards backend session:**

1. The real request paths and payloads for claiming a task, if they differ from
   the documented shapes.
2. What verifiable signal, if any, will back a social mission — until one
   exists, `isClaimSupported: false` is the honest answer and the UI states it
   on the button itself.
3. The redemption catalog V1 should serve. Every offer today grants premium days
   and is filtered out of V1, so the Redeem panel currently renders its empty
   state. A coin utility that does **not** grant premium (an ad-skip perk, a
   cosmetic, an entry) needs `grantsDays: 0` and will render with no client
   change.
4. Whether watch-time missions get a trustworthy backend signal. `watchTime` is
   `null` today and maps straight through to the section's empty state; the
   device's own resume position decreases on a rewatch and is not a substitute.
