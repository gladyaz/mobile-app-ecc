import { LANGUAGES, translations } from '@/services/i18n/translations';

type CopyKey = keyof (typeof translations)['id'];

/**
 * PREMIUM ENTITLEMENT ERROR UX (2026-08-22): the feed's playback ACCESS
 * gates - the guest sign-in gate and the signed-in premium gate - are the
 * only copy in the app that explains why an episode will not play. Copy that
 * exists in one language and falls back to a raw key (or to Indonesian) in
 * another turns a truthful explanation back into a confusing one, which is
 * the exact defect this work unit fixes.
 */
const ACCESS_GATE_KEYS = [
  'feed.signInToPlay',
  'feed.signInToPlayHint',
  'feed.signIn',
  'feed.premiumRequired',
  'feed.premiumRequiredHint',
  'feed.openRewards',
  'feed.premiumRequiredActionHint',
] as const satisfies readonly CopyKey[];

describe('feed access-gate localization', () => {
  it('defines every access-gate key in Indonesian, English and Chinese', () => {
    for (const language of LANGUAGES) {
      for (const key of ACCESS_GATE_KEYS) {
        expect(translations[language][key]).toBeDefined();
        expect(translations[language][key].trim()).not.toBe('');
      }
    }
  });

  it('does not leak Indonesian wording into the English premium gate', () => {
    // The specific failure this pins is a hardcoded Indonesian string
    // reaching an English-speaking viewer, which is how the premium gate
    // would most plausibly regress: it is easier to type the ID copy inline
    // than to add three entries.
    const indonesianOnly = ['Aktifkan', 'Buka ', 'menonton', 'Poin kamu'];

    for (const key of ACCESS_GATE_KEYS) {
      for (const token of indonesianOnly) {
        expect(`en ${key}: ${translations.en[key]}`).not.toContain(token);
      }
    }
  });

  it('keeps the premium gate free of sign-in wording in every language', () => {
    // The two gates must never converge: telling a signed-in viewer to sign
    // in is the original defect, and copy is where it would come back.
    const signInWording: Record<(typeof LANGUAGES)[number], readonly string[]> = {
      id: ['Masuk'],
      en: ['Sign in', 'Sign In'],
      zh: ['登录'],
    };

    for (const language of LANGUAGES) {
      const premiumCopy = [
        translations[language]['feed.premiumRequired'],
        translations[language]['feed.premiumRequiredHint'],
        translations[language]['feed.openRewards'],
        translations[language]['feed.premiumRequiredActionHint'],
      ].join(' | ');

      for (const token of signInWording[language]) {
        expect(`${language}: ${premiumCopy}`).not.toContain(token);
      }
    }
  });

  it('never blames the media server in the premium gate', () => {
    // The other half of the same defect: an entitlement refusal presented as
    // a media/network failure.
    const mediaFailureWording = ['media server', 'server media', '媒体服务器', 'unavailable'];

    for (const language of LANGUAGES) {
      const premiumCopy = [
        translations[language]['feed.premiumRequired'],
        translations[language]['feed.premiumRequiredHint'],
      ]
        .join(' | ')
        .toLowerCase();

      for (const token of mediaFailureWording) {
        expect(`${language}: ${premiumCopy}`).not.toContain(token);
      }
    }
  });
});
