import { translations } from '@/services/i18n/translations';

const LANGUAGES = ['id', 'en', 'zh'] as const;

type CopyKey = keyof (typeof translations)['id'];

function discoverKeys(language: (typeof LANGUAGES)[number]): readonly string[] {
  return Object.keys(translations[language]).filter((key) => key.startsWith('discover.'));
}

describe('Discover localization', () => {
  it('defines every Discover key in Indonesian, English and Chinese', () => {
    const indonesianKeys = discoverKeys('id');

    expect(indonesianKeys.length).toBeGreaterThan(0);

    for (const language of LANGUAGES) {
      expect([...discoverKeys(language)].sort()).toEqual([...indonesianKeys].sort());
    }
  });

  it('leaves no Discover string empty in any language', () => {
    for (const language of LANGUAGES) {
      for (const key of discoverKeys(language)) {
        expect(translations[language][key as CopyKey].trim()).not.toBe('');
      }
    }
  });

  it('does not leak Indonesian-only wording into English or Chinese', () => {
    // Words that only ever appear in the Indonesian copy. Shared product
    // terms like "Discover" and "Home" are intentionally NOT in this list -
    // they are the same word in every locale by design. ("Premium" is not
    // shared: zh localizes it to 会员.)
    const indonesianOnly = [
      'Cari',
      'Katalog',
      'katalog',
      'Peringkat',
      'peringkat',
      'Muat ulang',
      'Tidak ada',
      'suka',
      'seri di',
      'Coba',
      'Tampilkan',
      'Hapus',
    ];

    for (const language of ['en', 'zh'] as const) {
      for (const key of discoverKeys(language)) {
        const value = translations[language][key as CopyKey];

        for (const token of indonesianOnly) {
          expect(`${language} ${key}: ${value}`).not.toContain(token);
        }
      }
    }
  });

  it('keeps the interpolation tokens identical across languages', () => {
    const tokenPattern = /\{[a-zA-Z]+\}/g;

    for (const key of discoverKeys('id')) {
      const typedKey = key as CopyKey;
      const indonesianTokens = (translations.id[typedKey].match(tokenPattern) ?? []).sort();

      for (const language of ['en', 'zh'] as const) {
        expect((translations[language][typedKey].match(tokenPattern) ?? []).sort()).toEqual(
          indonesianTokens
        );
      }
    }
  });


  it('has no translation entry for any backend-owned series title', () => {
    // Series titles arrive from /videos/feed and must render verbatim; a
    // translation key for one would mean the UI layer had started rewriting
    // backend content.
    const backendTitles = ['Balas Dendam Sang Pewaris', 'Pernikahan Kilat Nona Shen'];

    for (const language of LANGUAGES) {
      for (const value of Object.values(translations[language])) {
        expect(backendTitles).not.toContain(value);
      }
    }
  });
});
