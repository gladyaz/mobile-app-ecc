import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { openExternalUrl } from '@/services/links/open-external-url';

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));

const mockOpenBrowserAsync = WebBrowser.openBrowserAsync as jest.MockedFunction<
  typeof WebBrowser.openBrowserAsync
>;

/**
 * THE app's single cross-platform external-link mechanism.
 *
 * Two behaviours matter and are easy to break by accident:
 *
 *  1. An https page opens in the IN-APP browser sheet, so the viewer can dismiss
 *     back to where they were. Only if that is impossible does it fall back to
 *     the system handler, because discarding the rejection would turn a
 *     legally-required link into a row that silently does nothing.
 *  2. A `mailto:` NEVER goes to the in-app browser. A browser tab cannot render
 *     one - it throws or opens blank on native, and on web it would navigate
 *     the page away from the app - so those go straight to `Linking`.
 */
describe('openExternalUrl', () => {
  beforeEach(() => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  it('opens an https page in the in-app browser, not the system browser', async () => {
    mockOpenBrowserAsync.mockResolvedValue({ type: 'opened' } as never);

    await expect(openExternalUrl('https://redpandadrama.online/support')).resolves.toBe(true);

    expect(mockOpenBrowserAsync).toHaveBeenCalledWith('https://redpandadrama.online/support');
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('falls back to the system handler when no in-app browser exists', async () => {
    // Stripped OEM images, managed profiles, a viewer who disabled Chrome.
    mockOpenBrowserAsync.mockRejectedValue(new Error('No matching activity'));

    await expect(openExternalUrl('https://redpandadrama.online/support')).resolves.toBe(true);

    expect(Linking.openURL).toHaveBeenCalledWith('https://redpandadrama.online/support');
  });

  it('sends a mailto: straight to the system handler', async () => {
    await expect(openExternalUrl('mailto:support@redpandadrama.invalid')).resolves.toBe(true);

    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
    expect(Linking.openURL).toHaveBeenCalledWith('mailto:support@redpandadrama.invalid');
  });

  it('treats a wa.me link as an ordinary https page', async () => {
    // Which is why WhatsApp needs no platform branching: Android hands off to
    // the installed app, and everywhere else it is the click-to-chat page.
    mockOpenBrowserAsync.mockResolvedValue({ type: 'opened' } as never);

    await expect(openExternalUrl('https://wa.me/6281234567890')).resolves.toBe(true);

    expect(mockOpenBrowserAsync).toHaveBeenCalledWith('https://wa.me/6281234567890');
  });

  it('reports failure rather than throwing when nothing can open the link', async () => {
    // A dead link must not take a screen down with it.
    mockOpenBrowserAsync.mockRejectedValue(new Error('no browser'));
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));

    await expect(openExternalUrl('https://redpandadrama.online/support')).resolves.toBe(false);
  });
});
