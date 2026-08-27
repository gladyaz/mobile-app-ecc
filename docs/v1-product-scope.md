# Red Panda V1 — product scope, and what the mobile app does about it

Decision date: 2026-08-26. This document is the reference for why the premium
surfaces are absent from a V1 build without being absent from the repository,
and for the two backend contracts V1 was waiting on - both now defined and wired.

## The scope

| In V1 | Not in V1 |
|---|---|
| Free drama content | Premium paywall |
| Ads monetization | Subscription |
| Rewards (coins, daily check-in, watch + social missions) | Payment / Midtrans checkout |
| Google Login | Buy coins |
| WhatsApp Login | |
| HLS Auto / manual quality | |

> **Contract regression layer:** `docs/v1-contract-lock.md` describes the
> deterministic tests that pin this scope against the backend's own V1
> release contract, so a mobile change that contradicts it fails a test here
> instead of shipping.

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

## Backend contracts — now defined, and wired

Both surfaces below were open when this document was written. **Both are now
specified, implemented on the backend, and wired on this side against the real
contracts** rather than against a proposal. What is left in each case is named
at the end of its section, and in both cases it is external configuration —
not code.

### 1. WhatsApp Login — wired to the canonical contract

Source of truth: the backend's `docs/auth-identity-api-contract.md` (§3.3, §4,
§5) and `docs/WHATSAPP_LOGIN_SETUP.md`.

`startWhatsAppOtp` → `verifyWhatsAppOtp` → session, against
`POST /auth/whatsapp/otp/request` and `POST /auth/whatsapp/otp/verify`, bodies
`{ phone }` and `{ phone, code }`. **The phone number is the challenge handle;
there is no `challengeId` and there will not be one** — at most one challenge is
live per number, enforced by a database `UNIQUE` index, so a second lookup key
for the same row would make it addressable after it stopped being the live one.

What the four earlier questions were answered with:

1. **Shapes confirmed**, and the response gained `resendAvailableInSeconds` —
   the backend adopted the mobile side's argument that a client must not infer
   resend timing. Both timing fields are validated at the boundary.
2. **Rate limits confirmed**: 60s per-number cooldown, 5 requests per hour per
   number, 5 guesses per challenge, and per-IP throttles of 3/10min on request
   and 5/min on verify. The per-IP one carries `HTTP_ERROR`, not
   `OTP_RESEND_COOLDOWN`, so the client branches on **status before code**.
3. **Anti-enumeration holds.** `otp/request` answers identically for a
   registered and an unregistered number, asserted deep-equal in the backend's
   e2e suite. The screen has no branch that could reveal the difference.
4. **`INVALID_OTP` stays one code** for wrong / expired / attempts-exhausted /
   already-used / no-such-challenge. Splitting it would report whether an
   attacker's guessing is making progress, and would turn verify into a
   phone-number enumeration oracle. The client shows one message for all five.

One code was **added** to the client since: `503
WHATSAPP_PROVIDER_UNAVAILABLE`, which means delivery definitively failed for a
reason unrelated to which number was targeted. It gets its own message because
the advice differs — **no challenge survives it**, so no cooldown was spent and
retrying immediately is honest. The resend control deliberately stays enabled
for it; only a `429` re-locks the countdown.

Phone normalization now also accepts the `00` international access prefix,
which the backend accepts and this client used to reject.

**Still needed, and it is not code:** a Meta developer account, a WhatsApp
Business Account, a verified sender number, a System User token and an
approved AUTHENTICATION-category template. **No real WhatsApp message has ever
been sent by either side.** One end-to-end OTP to a handset someone controls is
the remaining proof.

### 2. Rewards — wired to the V1 earn-and-spend contract

Source of truth: the backend's `docs/rewards-api-contract.md`.

The four earlier questions, answered:

1. **Paths and payloads confirmed**, and the mission surface arrived:
   `POST /rewards/missions/:id/open` and `POST /rewards/missions/:id/claim`,
   both taking **no body** — the amount, the reward day and the idempotency key
   are all server-derived from the mission id in the path.
2. **No verifiable signal exists for a social follow, and none is claimed.**
   Instagram, TikTok and YouTube expose no API that answers "did user X follow
   page Y". V1 pays a once-per-account reward for a **user-confirmed external
   action**: the server hands out a destination URL at a recorded instant and
   the account comes back and confirms at a later one. The wire says so
   (`verification: "USER_CONFIRMED"`), the ledger says so
   (`EXTERNAL_SOCIAL_ACTION`), and the UI says so — a test fails if the word
   "verified" appears in that copy in any of the three shipped languages.
3. **The V1 coin utility is ad perks**, exactly the `grantsDays: 0` shape this
   document predicted: `redeem_skip_next_ad` (one interstitial skip, 24h shelf
   life) and `redeem_ad_pass_2h` (no interstitials for two hours). Both are
   `kind: "AD_PERK"`. Premium-granting offers stay filtered out of V1 on both
   sides — the backend withholds them under `CONTENT_ACCESS_MODE=free`, and the
   client filters on `kind` with `grantsDays` beside it as the fail-closed half.
4. **`watchTime` is still `null`, and that is an answer.** The backend has no
   trustworthy duration signal — its only duration-shaped data is a resume
   position that *decreases* on a rewatch. The V1 watch mission counts a
   different, provable quantity: **distinct episodes the server authorised
   within a reward day**, served as a new `WATCH_EPISODES` task with a
   server-computed `{ current, required }`. It is a new task type rather than a
   reuse of `WATCH_TIME` precisely because the unit is different.

**Unknown task types are dropped, not rendered and not crashed on** — the
backend adds them server-side and expects installed clients to keep working.

**Ad perks reach the ad gate as server state**, mirrored into the ads store the
same way `isPremium` already is, never persisted, and cleared on sign-out and on
an account switch. A skip is spent only on a transition where an interstitial
would genuinely have been shown, and the spend is reported once via
`POST /rewards/perks/:id/consume`. A rewards outage grants nothing: the store's
defaults suppress no ad, so the existing ad policy runs unchanged.

**Still needed, and it is not code:** the economics remain **product-unapproved**
(check-in curve, social reward value, watch milestone thresholds, ad-perk prices
and durations, point expiry, the service timezone). They live in one backend
file and changing them is an edit there, not a mobile release. The four
`REWARDS_SOCIAL_*_URL` values are deployment configuration and must point at the
real Red Panda profiles — the backend's preflight blocks a release whose URL
still contains a template segment such as `your-handle`.

