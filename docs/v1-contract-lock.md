# The V1 backend ↔ mobile contract lock

**What it is:** a deterministic regression layer that fails a test in this
repository when the Red Panda backend and this app stop agreeing about the
wire. It exists because API drift does not crash — it ships a dead login
button, an empty Rewards Center, a quality menu offering a rendition that
does not exist, or a session that silently signs itself out, while every
other signal stays green.

**Where it lives:** `src/services/contract/`. Nothing else in the app imports
it, and a test enforces that.

| File | Role |
|---|---|
| `v1-contract-manifest.ts` | The **policy**, as data: endpoints, required response fields, the auth error vocabulary and its handling class, the V1 feature posture. |
| `fixtures/provenance.ts` | Which backend commit everything was reconciled against, and the no-real-credentials rule. |
| `fixtures/auth-fixtures.ts` | Canonical `/auth/*` payloads — valid, drifted and future. |
| `fixtures/rewards-fixtures.ts` | Canonical `/rewards/*` payloads, with the real catalog numbers. |
| `fixtures/playback-fixtures.ts` | Canonical `GET /videos/:id/playback` payloads for both branches of the union. |
| `__tests__/*.test.ts` | Seven suites that run the fixtures through the **real** parsers and mappers. |

Reconciled against `short-drama-backend` `feat/v1-release-gate` @ **`01e8caa`**
on 2026-08-27.

---

## What "the V1 contract" actually is

Red Panda V1 is **free content + ads + rewards**, signed in with **Google** or
**WhatsApp**, played over **HLS** — and **no payment, no subscription, no
premium paywall, no coin purchase**.

`V1_FEATURE_POLICY` in the manifest states that as a table, and cites the
matching requirement id in the backend's own
`src/common/release-gate/v1-feature-contract.ts` wherever one exists
(`google-login`, `whatsapp-login`, `rewards`, `free-catalog`,
`payments-disabled`). The citation is a **reference for a human reading a
diff**, not an import — see "The one hard rule" below.

---

## What is hard-pinned

These fail a test the moment they change.

**Auth sessions.** `POST /auth/google`, `POST /auth/whatsapp/otp/verify` and
`POST /auth/refresh` all answer one `AuthResponseDto`, and all three must
carry a non-empty `accessToken`, a non-empty `refreshToken`, a `user.id`, and
an `email` **key** whose value is `string | null`. Validated by
`services/auth/auth-response-contract.ts#isValidAuthResponse`.

**The OTP challenge.** `success: true` plus two finite numbers
(`expiresInSeconds`, `resendAvailableInSeconds`). It must carry nothing that
could reveal whether a number has an account.

**The identity list.** Every entry needs `provider`, `identifier`
(`string | null`), `usable`, `canBeUnlinked`, `createdAt`, `verifiedAt`.
`canBeUnlinked` is the server's verdict and the client never re-derives it.

**The auth error vocabulary.** Fifteen codes, each classified `EXPLICIT` /
`GENERIC` / `TRANSPORT` with a stated reason. `INVALID_OTP` gets exactly one
message for all six causes it covers; both 429 limiters are matched by
**status**, never by code.

**Rewards.** All eight routes are authenticated. The snapshot must carry the
three V1 earn concepts (`DAILY_CHECK_IN` in its own block, `WATCH_EPISODES`,
`SOCIAL_FOLLOW`) and the three required platforms (Instagram, TikTok,
YouTube). Every economic value is copied, never recomputed. Social claims are
`USER_CONFIRMED` in every state, including a paid one.

**Perks.** Exactly two types. `skipNextInterstitial` and `adFreeUntil` are
**copied from the server**, never derived from `perks[]` — the pinned test
feeds a payload where the array and the boolean deliberately contradict each
other, and the boolean must win.

**Playback.** The discriminant is the **presence of a `type` field**, not a
value inside a shared envelope. An HLS-tagged response that also carries a
full legacy triple must be **refused**, not quietly played as MP4. Every
rendition needs `quality`, `width`, `height`, `url`; one malformed rung fails
the whole authorization rather than shortening the ladder. No rendition may
ever be fabricated.

**V1 posture.** No premium-granting offer reaches the rendered catalog, no
route matches `payment|checkout|subscription|billing|purchase`, and the
premium experience is off by default.

---

## What is intentionally flexible

**Unknown fields are always accepted.** The backend adds fields additively.
A client that refused an unknown key would break on the next server release,
so every parser tolerates extras at every level.

**Unknown enum members degrade, they do not crash.**

| Unknown value | What happens |
|---|---|
| A task **type** this build has no copy for | the tile is dropped — an unnamed reward is worse than none |
| A **social platform** on a known task type | the tile renders with generic copy; the reward is real either way |
| A **perk type** | dropped from the display list, but `skipNextInterstitial` / `adFreeUntil` still carry the benefit to the ad gate |
| An **offer id** | still rendered, named from `grantsDays` |
| A ledger **reason** | becomes `OTHER` and keeps its real amount — dropping it would leave a viewer reconciling against a balance that no longer adds up |
| An **auth provider** in the identity list | kept; dropping the payload would take out the identities the client *can* render |
| An **error code** | falls through to that surface's generic branch, which is always a real translation key |
| A **third playback kind** (`dash`, …) | refused — the app has no player for a format it has never heard of |

**`1080p` is optional.** The transcoder never adds a rung above the source, so
a 720-tall master produces no 1080p entry and the menu must offer none.

**Facebook is optional.** It is `requiredForV1: false` in the backend mission
catalog; a release is never held up for it.

**`devCode` is optional.** Present only on a dev-tools build; never required,
never surfaced.

**Copy and formatting are the client's.** The server sends no titles, no CTA
words, no formatted dates. Nothing in the lock asserts on Indonesian wording —
the test `t` returns its key.

---

## The one hard rule

**The mobile repo must stay usable with no backend checkout beside it.**

The fixtures are checked-in data, not a bridge. `contract-boundary.test.ts`
enforces both halves of that:

- no file under `src/services/contract/` reads a path in the backend repo;
- no production module imports anything under `src/services/contract/` —
  the manifest grades the app, and the moment it started *deciding* app
  behaviour it would become a second, silently divergent copy of the rules it
  exists to check.

It also greps every fixture for JWT-shaped strings, Google client ids and API
keys, private-key blocks, Meta access tokens, and unmasked `+62` numbers. A
fixture is in git forever; a credential pasted beside one is a leak no later
deletion undoes. Every fixture host is on a reserved `.invalid` domain, except
the social destinations, which must be real platform hosts because the
backend's own allowlist pins them.

---

## When the backend changes: how to update this

1. **Read the backend diff first.** Note the new/changed DTO field or error
   code and which route serves it.
2. **Update the fixture**, not the assertion. The fixture is the claim about
   what the server sends; assertions read from it. Bump
   `BACKEND_REFERENCE.commit` and `reconciledOn` in
   `fixtures/provenance.ts`.
3. **Let the type checker point at the mirror.** Fixtures are typed
   `satisfies` against `types/auth.ts`, `services/rewards/rewards-dto.ts` and
   the wire interfaces in `fixtures/playback-fixtures.ts`. A changed required
   field stops the fixture compiling, and the mirror is what you fix.
4. **Update the manifest only if the POLICY changed** — a new endpoint, a new
   error code, a changed V1 posture. A new optional field is not a policy
   change.
5. **Add a fixture for the drifted shape too.** Every "we would have shipped
   this silently" case in the current set exists because it was a real
   failure mode; a new field that a screen depends on deserves the same.
6. **Run `npx jest src/services/contract`,** then the full suite.

### Adding a new error code

Add it to `V1_AUTH_ERROR_CONTRACT` with its status, its handling class and a
rationale of real length (the suite enforces that a rationale had to say
something). If the app should *not* map it, put it in
`V1_UNHANDLED_BACKEND_AUTH_CODES` with the reason instead — the two lists are
asserted to be disjoint, so "considered and out of scope" stays
distinguishable from "overlooked".

### Adding a new required V1 feature

Add it to `V1_FEATURE_POLICY` with `posture: 'REQUIRED'`, the backend
requirement id if the release gate has one, and the consequence of shipping it
wrong. Then add the assertion that the capability is actually wired to
`v1-product-contract.test.ts`. Note that
`scripts/check-release-android.js` owns the **build-configuration** half of
the same question — put env-var and signing rules there, wire-shape rules
here, and never both.

---

## Why this shape, and not the alternatives

Four mechanisms were considered.

**Canonical fixtures + a compact manifest (chosen).** The fixtures are the
evidence — what the backend actually sends — and the manifest is the policy —
what V1 requires of it. Typing the fixtures `satisfies` the existing wire
mirrors makes `npm run typecheck` the *first* drift detector, before a single
test runs; running them through the real parsers makes the tests the second.
Neither needs the backend present.

**Generated from backend source.** Rejected. It would couple this repository
to a filesystem path, so the suite would pass on the author's machine and fail
in CI — the opposite of a regression layer.

**Shared constants only.** Rejected as insufficient on its own. Constants
cannot express a nested response shape, a discriminated union, or the
difference between "absent" and "null".

**Screenshot tests.** Rejected outright: brittle, and they would fail for a
hundred reasons that are not drift.

---

## Related

- `docs/api-contract.md` — the full endpoint reference this lock is derived from.
- `docs/rewards-domain-contract.md` — the rewards domain rules.
- `docs/v1-product-scope.md` — why the premium surfaces are absent from a build without being absent from the repo.
- `docs/release-readiness-android.md` — the build-configuration half of the release gate.
