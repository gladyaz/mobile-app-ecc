import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Whether an assistive technology this app can detect is currently active:
 * VoiceOver/TalkBack (live-updating via `screenReaderChanged`), plus - on
 * Android - any enabled accessibility service (switch access and friends,
 * via `isAccessibilityServiceEnabled`; query-only, RN exposes no change
 * event for it, so it is sampled at mount).
 *
 * The feed's auto clear display gates on this: a passive timer that removes
 * the control an assistive user is focused on is a WCAG-class trap, and
 * "focus is inside the chrome" cannot be observed reliably from JS - so the
 * simplest architecture-compatible safeguard is to not run the passive
 * countdown at all while assistive tech is detected. Manual clear display
 * (tap, pinch, and the labeled Playback Settings switch) remains fully
 * available.
 *
 * KNOWN LIMITATION (documented, accepted for this slice): iOS Switch
 * Control is not detectable from React Native, and there is no user-facing
 * "keep controls visible" setting yet - adding one would broaden Clear
 * Display into a settings surface, which this slice explicitly must not do.
 *
 * Defaults to false until the initial async queries answer - the same
 * "unknown is not restricted" stance `useAppForeground` takes. The worst
 * case of that default is one auto-hide that a just-started assistive
 * session would have suppressed, and a single tap brings the chrome back.
 */
export function useAssistiveTechEnabled(): boolean {
  const [isScreenReaderEnabled, setIsScreenReaderEnabled] = useState(false);
  const [isAccessibilityServiceEnabled, setIsAccessibilityServiceEnabled] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // Subscribe-then-query, in that order, so an enable event landing
    // between the two cannot be missed; the query result only ever fills in
    // the initial value.
    const subscription = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      setIsScreenReaderEnabled
    );

    void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (isMounted) {
        setIsScreenReaderEnabled(enabled);
      }
    });

    if (Platform.OS === 'android') {
      AccessibilityInfo.isAccessibilityServiceEnabled()
        .then((enabled) => {
          if (isMounted) {
            setIsAccessibilityServiceEnabled(enabled);
          }
        })
        .catch(() => {
          // Treated the same as "unknown": not restricted.
        });
    }

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  return isScreenReaderEnabled || isAccessibilityServiceEnabled;
}
