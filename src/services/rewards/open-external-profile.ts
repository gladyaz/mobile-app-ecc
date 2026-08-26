import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

/**
 * Hands the viewer off to a Red Panda social profile.
 *
 * `Linking.openURL` FIRST, which is the opposite order from the legal links
 * in `app/(tabs)/profile.tsx`, and the reason is the task: those rows only
 * need a page rendered, so an in-app browser sheet that keeps the viewer's
 * place is better. This one needs the viewer to FOLLOW an account, and a
 * Custom Tab cannot hand off to the installed Instagram/TikTok/YouTube app
 * or carry its login. Opening the real app is what makes the action the
 * mission describes actually possible; a logged-out web view is a dead end
 * that the viewer would then be asked to confirm they completed.
 *
 * `openBrowserAsync` is the fallback for a device with no app registered for
 * the URL, and the boolean result is the last resort: a mission the app
 * cannot start must say so, because the next screen state asks the viewer to
 * confirm they did something they were never taken to.
 *
 * THE URL IS ALWAYS THE SERVER'S. This function is called only with the
 * `destinationUrl` that `POST /rewards/missions/:id/open` just returned - it
 * is validated at the backend's boot to be an https URL on that platform's
 * own domain, and no client-held or user-typed value ever reaches here. A
 * caller that passed its own URL would be opening an external browser at an
 * address of someone else's choosing with Red Panda's branding around it.
 */
export async function openExternalProfile(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);

    return true;
  } catch {
    // Falls through rather than reporting failure: no app claimed the URL,
    // which is ordinary on a device without the platform installed.
  }

  try {
    await WebBrowser.openBrowserAsync(url);

    return true;
  } catch {
    return false;
  }
}
