import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

/**
 * THE app's one way of opening a public web page or an external contact link.
 *
 * Extracted verbatim from the behaviour Profile's legal rows already had, so
 * that Profile, About and Help share one implementation instead of three
 * copies that drift. The order matters and is not arbitrary:
 *
 * 1. `openBrowserAsync` keeps the viewer INSIDE the app, in a system browser
 *    sheet they can dismiss back to where they were, rather than handing them
 *    off to a separate browser app and losing the session's place.
 * 2. It REJECTS on a device with no browser exposing a Custom Tabs service, or
 *    none matching the https VIEW intent - stripped OEM images, managed
 *    profiles, a viewer who disabled Chrome. Discarding that rejection would
 *    turn a legally-required link into a row that silently does nothing when
 *    tapped, so the system browser is tried next.
 * 3. Only when both fail is failure admitted, through the caller's own toast.
 *
 * NON-WEB SCHEMES SKIP STEP 1. An in-app browser tab cannot render `mailto:`
 * (or `tel:`): handing one to `openBrowserAsync` either throws or opens a blank
 * tab, and on web it would navigate the page away from the app. Those go
 * straight to `Linking.openURL`, which is what actually resolves them to the
 * mail client on Android and to the OS handler on web.
 *
 * WhatsApp is deliberately NOT such a case - `getSupportWhatsAppUrl` returns an
 * https `wa.me` link, which hands off to the installed app on Android and
 * degrades to the click-to-chat page everywhere else, so it needs no scheme
 * special-casing and cannot dead-end on a device with no WhatsApp installed.
 *
 * Returns whether the link was opened, so the caller decides what to say. It
 * never throws: a dead link must not take a screen down with it.
 */
function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);

    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export async function openExternalUrl(url: string): Promise<boolean> {
  if (isWebUrl(url)) {
    try {
      await WebBrowser.openBrowserAsync(url);

      return true;
    } catch {
      // Fall through to the system handler below.
    }
  }

  try {
    await Linking.openURL(url);

    return true;
  } catch {
    return false;
  }
}
