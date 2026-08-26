import { isPremiumExperienceEnabled } from '@/services/config/v1-scope';

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED;

afterEach(() => {
  process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED = ORIGINAL_ENV;
});

/**
 * The V1 scope switch itself. The surfaces it gates are pinned where they
 * render - Discover badges, the episode chip, the two episode locks, the
 * playback gate and the redemption catalog each have their own test - so this
 * file only fixes the DEFAULT, which is the part a future build inherits
 * silently if it is wrong.
 */
describe('isPremiumExperienceEnabled (V1 product scope: free + ads)', () => {
  it('is OFF when the env var is unset, so a build inherits V1 scope by default', () => {
    delete process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED;

    expect(isPremiumExperienceEnabled()).toBe(false);
  });

  it('is enabled only by the exact string "true"', () => {
    process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED = 'true';

    expect(isPremiumExperienceEnabled()).toBe(true);
  });

  it.each(['false', 'True', 'TRUE', '1', 'yes', ''])(
    'stays off for any other value, e.g. %j - re-enabling premium must be deliberate',
    (value) => {
      process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED = value;

      expect(isPremiumExperienceEnabled()).toBe(false);
    }
  );
});
