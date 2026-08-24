/**
 * Whether this build may present INTERNAL, non-product screens.
 *
 * There is exactly one today: `/processing` ("Processing History", labelled
 * INTERNAL in Profile). It is not a product surface and never has been - it
 * renders `src/data/mock-processing-jobs.ts` verbatim, with no backend behind
 * it and no flag in front of it, so every row it shows is fabricated: invented
 * job ids, invented progress percentages, and internal server storage paths
 * (`storage/raw-videos/...`, `storage/subtitles/...`) presented as fact.
 *
 * Until now it was hidden only from DEMO builds (`!isDemoMode()` in
 * profile.tsx). That is exactly backwards for external distribution: the demo
 * APK - handed to a known founder or partner - could not see it, while a
 * PRODUCTION release APK installed by an ordinary user could, and would be
 * shown made-up processing history plus the backend's internal storage layout.
 *
 * `__DEV__` is the gate because it is the one signal that is structurally
 * false in every shippable artifact: `expo export`, `assembleRelease`, and any
 * EAS build all produce `__DEV__ === false`, while `expo start` and a debug
 * build produce true. Nothing has to be remembered or unset before a release,
 * which is the same reason `services/debug/playback-invariant.ts` gates on it
 * rather than on an env flag.
 *
 * CONSEQUENCE, STATED PLAINLY: internal RELEASE builds (including the LAN demo
 * APK in docs/android-local-demo.md, which is `assembleRelease`) no longer show
 * this screen either. That is intended - fabricated job rows demonstrate
 * nothing about the product - but it is a behaviour change, not a no-op. If the
 * screen is ever wanted in a release artifact again, give it a real backend or
 * an explicit `EXPO_PUBLIC_*` opt-in; do not widen this gate back to
 * "everything except demo builds".
 */
export function isInternalScreenEnabled(): boolean {
  return __DEV__;
}
