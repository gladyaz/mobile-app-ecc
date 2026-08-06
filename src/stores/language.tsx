import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { PropsWithChildren } from 'react';

import {
  DEFAULT_LANGUAGE,
  translations,
  type Language,
  type TranslationKey,
} from '@/services/i18n/translations';
import { getItem, setItem, STORAGE_KEYS } from '@/services/storage/local-storage';

const LANGUAGE_STORAGE_VERSION = 1;

export type Translate = (
  key: TranslationKey,
  params?: Readonly<Record<string, string | number>>
) => string;

type LanguageContextValue = {
  readonly language: Language;
  readonly setLanguage: (next: Language) => void;
  readonly t: Translate;
};

function buildTranslate(language: Language): Translate {
  return (key, params) => {
    const copy = translations[language][key];

    if (!params) {
      return copy;
    }

    return Object.entries(params).reduce(
      (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
      copy
    );
  };
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * Falls back to the default language instead of throwing when no provider is
 * mounted. That is deliberate: it lets a component be rendered on its own -
 * in a test, or in isolation - and still produce the copy it always produced,
 * rather than forcing every such caller to wrap itself in a provider.
 */
const FALLBACK: LanguageContextValue = {
  language: DEFAULT_LANGUAGE,
  setLanguage: () => {},
  t: buildTranslate(DEFAULT_LANGUAGE),
};

export function LanguageProvider({ children }: PropsWithChildren) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  useEffect(() => {
    void getItem<Language>(STORAGE_KEYS.language, LANGUAGE_STORAGE_VERSION).then((stored) => {
      if (stored && stored in translations) {
        setLanguageState(stored);
      }
    });
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    // Best-effort: a failed write only means the choice is not remembered
    // next launch, which is not worth interrupting the viewer over.
    void setItem<Language>(STORAGE_KEYS.language, LANGUAGE_STORAGE_VERSION, next);
  }, []);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t: buildTranslate(language) }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation(): LanguageContextValue {
  return useContext(LanguageContext) ?? FALLBACK;
}
