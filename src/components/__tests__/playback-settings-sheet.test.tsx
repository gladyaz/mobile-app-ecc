import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { PlaybackSettingsSheet } from '@/components/playback-settings-sheet';
import {
  AUTO_PLAYBACK_QUALITY,
  type PlaybackQuality,
  type PlaybackQualityOption,
} from '@/constants/playback-quality';
import { LANGUAGES, translations, type Language } from '@/services/i18n/translations';

/**
 * The Playback Settings sheet on its own, away from `DramaFeedItem`.
 *
 * `drama-feed-item.test.tsx` already covers what a quality choice DOES to the
 * player (the source swap, the reseek, ownership). What it cannot cover
 * cheaply is what the sheet PRESENTS: the pre-authorization contract, the
 * accessibility surface of the controls, and the three locales the app ships.
 * Rendering the sheet directly makes those deterministic - no player, no
 * authorization round trip, no timers.
 *
 * Locale handling mirrors `features/discover/__tests__/discover-locale-rendering.test.tsx`:
 * without a provider `useTranslation()` resolves to DEFAULT_LANGUAGE, which
 * would leave English and Chinese rendering unexercised.
 */
let mockLanguage: Language = 'id';
// `mock`-prefixed so the jest factory may close over it; only read when the
// component actually calls t(), which is long after module init.
const mockCopy = translations;

jest.mock('@/stores/language', () => ({
  useTranslation: () => ({
    language: mockLanguage,
    setLanguage: jest.fn(),
    t: (key: string, params?: Record<string, string | number>) =>
      Object.entries(params ?? {}).reduce(
        (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
        mockCopy[mockLanguage][key as keyof (typeof mockCopy)['id']]
      ),
  }),
}));

afterEach(() => {
  mockLanguage = 'id';
});

function copy(key: keyof (typeof translations)['id']) {
  return translations[mockLanguage][key];
}

/** The backend's portrait ladder, named by SHORT side, ordered high-to-low. */
function option(shortSide: number): PlaybackQualityOption {
  return {
    quality: `${shortSide}p`,
    shortSide,
    isHighDefinition: shortSide >= 1080,
  };
}

const LADDER = [option(1080), option(720), option(540), option(360)];

type SheetOverrides = Partial<React.ComponentProps<typeof PlaybackSettingsSheet>>;

function renderSheet(overrides: SheetOverrides = {}) {
  return render(
    <PlaybackSettingsSheet
      isClearDisplay={false}
      onClose={jest.fn()}
      onSelectPlaybackQuality={jest.fn()}
      onSelectPlaybackSpeed={jest.fn()}
      onToggleClearDisplay={jest.fn()}
      playbackQuality={AUTO_PLAYBACK_QUALITY}
      playbackSpeed={1}
      qualityOptions={LADDER}
      visible
      {...overrides}
    />
  );
}

describe('PlaybackSettingsSheet', () => {
  describe('quality section visibility (the pre-authorization contract)', () => {
    /**
     * The decision this pins: before `GET /videos/:id/playback` answers, the
     * app does not know whether this video has an HLS ladder at all - the
     * same `null` authorization precedes an MP4-backed video (one fixed
     * stream, no ladder ever) and a four-rung HLS one. So the sheet shows
     * NOTHING rather than a placeholder, because a "Quality - available after
     * the video loads" row would be a promise the app cannot keep for the
     * MP4 case, and inventing a quality menu before the backend has named a
     * single rendition is exactly what this feature exists not to do.
     */
    it('omits the entire Quality section when no real renditions exist', async () => {
      const { queryByText, queryByTestId } = await renderSheet({ qualityOptions: [] });

      expect(queryByText(copy('feed.quality'))).toBeNull();
      expect(queryByTestId('playback-settings-quality-auto')).toBeNull();
    });

    it('offers no placeholder, disabled, or "loading" quality affordance in its place', async () => {
      // Asserted by absence so a well-meaning future change cannot quietly
      // reintroduce a control that implies renditions nobody has returned.
      const { queryByLabelText, queryByTestId } = await renderSheet({ qualityOptions: [] });

      expect(queryByLabelText(copy('feed.qualityAuto'))).toBeNull();
      for (const rung of LADDER) {
        expect(queryByTestId(`playback-settings-quality-${rung.quality}`)).toBeNull();
      }
    });

    it('still renders Speed, Clear Display and Fullscreen, so the sheet is never empty', async () => {
      // The absent Quality section must not take the rest of the sheet with
      // it: a viewer who opens the kebab early still gets every control that
      // does not depend on an authorization.
      const { getByLabelText, getByTestId } = await renderSheet({
        onEnterFullscreen: jest.fn(),
        qualityOptions: [],
      });

      expect(
        getByLabelText(translations.id['feed.speedOption'].replace('{rate}', '1'))
      ).toBeTruthy();
      expect(getByTestId('playback-settings-clear-display-row')).toBeTruthy();
      expect(getByTestId('playback-settings-fullscreen')).toBeTruthy();
    });

    it('appears as soon as the authorization names real renditions', async () => {
      const { getByText, getByTestId } = await renderSheet();

      expect(getByText(copy('feed.quality'))).toBeTruthy();
      expect(getByTestId('playback-settings-quality-auto')).toBeTruthy();
    });

    it('renders exactly the renditions it was given, and never a rung the backend omitted', async () => {
      // A source too small to produce a 1080p rung simply has no 1080p entry.
      const { getByTestId, queryByTestId } = await renderSheet({
        qualityOptions: [option(720), option(540), option(360)],
      });

      expect(getByTestId('playback-settings-quality-720p')).toBeTruthy();
      expect(queryByTestId('playback-settings-quality-1080p')).toBeNull();
    });
  });

  describe('selection emits a semantic quality, never a URL', () => {
    it('reports Auto as the adaptive mode', async () => {
      const onSelectPlaybackQuality = jest.fn();
      const { getByTestId } = await renderSheet({ onSelectPlaybackQuality });

      fireEvent.press(getByTestId('playback-settings-quality-auto'));

      expect(onSelectPlaybackQuality).toHaveBeenCalledWith({ mode: 'auto' });
    });

    it('reports a manual pick by its rendition NAME - the stable identity across refreshes', async () => {
      // The load-bearing assertion of the whole feature: a tokened variant
      // URL held in state would die at `expiresAt`. The name re-resolves
      // against whatever authorization is current. See constants/playback-quality.ts.
      const onSelectPlaybackQuality = jest.fn();
      const { getByTestId } = await renderSheet({ onSelectPlaybackQuality });

      fireEvent.press(getByTestId('playback-settings-quality-720p'));

      expect(onSelectPlaybackQuality).toHaveBeenCalledWith({ mode: 'manual', quality: '720p' });

      const payload = onSelectPlaybackQuality.mock.calls[0][0] as PlaybackQuality;

      expect(JSON.stringify(payload)).not.toMatch(/https?:|\.m3u8/);
    });
  });

  describe('accessibility', () => {
    it('gives Auto a role, a label, a selected state and a hint explaining what it does', async () => {
      const { getByTestId } = await renderSheet();
      const auto = getByTestId('playback-settings-quality-auto');

      expect(auto.props.accessibilityRole).toBe('button');
      expect(auto.props.accessibilityLabel).toBe(copy('feed.qualityAuto'));
      expect(auto.props.accessibilityHint).toBe(copy('feed.qualityAutoOption'));
      expect(auto.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    });

    it('names each rendition in its label rather than leaving a screen reader to read a bare number', async () => {
      const { getByTestId } = await renderSheet();
      const hd = getByTestId('playback-settings-quality-1080p');
      const sd = getByTestId('playback-settings-quality-360p');

      expect(hd.props.accessibilityRole).toBe('button');
      expect(hd.props.accessibilityLabel).toBe(
        translations.id['feed.qualityOption'].replace('{label}', `1080p ${copy('feed.qualityHd')}`)
      );
      expect(sd.props.accessibilityLabel).toBe(
        translations.id['feed.qualityOption'].replace('{label}', '360p')
      );
    });

    it('marks exactly one option selected, and moves that state with the choice', async () => {
      const { getByTestId } = await renderSheet({
        playbackQuality: { mode: 'manual', quality: '540p' },
      });

      const selected = ['auto', '1080p', '720p', '540p', '360p'].filter(
        (id) =>
          getByTestId(`playback-settings-quality-${id}`).props.accessibilityState?.selected === true
      );

      expect(selected).toEqual(['540p']);
    });

    it('keeps every quality control at or above the 48dp minimum touch target', async () => {
      const { getByTestId } = await renderSheet();

      for (const id of ['auto', '1080p', '360p']) {
        const style = StyleSheet.flatten(
          getByTestId(`playback-settings-quality-${id}`).props.style
        );

        expect(style.minHeight).toBeGreaterThanOrEqual(48);
      }
    });
  });

  describe('localization', () => {
    it.each(LANGUAGES)('renders the section label and Auto in %s', async (language) => {
      mockLanguage = language;

      const { getByText, getByTestId } = await renderSheet();

      expect(getByText(translations[language]['feed.quality'])).toBeTruthy();
      expect(getByTestId('playback-settings-quality-auto').props.accessibilityLabel).toBe(
        translations[language]['feed.qualityAuto']
      );
    });

    it.each(LANGUAGES)(
      'localizes the HD marker in %s while leaving the rendition token untranslated',
      async (language) => {
        mockLanguage = language;

        const { getByText } = await renderSheet();

        // "1080p 高清" in zh: the marker is copy, the rung name is the
        // backend's own token and reads identically in every locale.
        expect(getByText(`1080p ${translations[language]['feed.qualityHd']}`)).toBeTruthy();
        expect(getByText('360p')).toBeTruthy();
      }
    );

    it.each(LANGUAGES)('interpolates the rendition into the %s option label', async (language) => {
      mockLanguage = language;

      const { getByTestId } = await renderSheet();
      const label = getByTestId('playback-settings-quality-720p').props.accessibilityLabel;

      expect(label).toBe(translations[language]['feed.qualityOption'].replace('{label}', '720p'));
      expect(label).not.toContain('{label}');
    });
  });
});
