import {
  __resetConsentGateForTests,
  ensureAdsConsent,
  isAdPrivacyOptionsRequired,
  showAdPrivacyOptionsForm,
} from '@/services/ads/consent-gate';

/**
 * The one place in this codebase that stubs `react-native-google-mobile-ads`
 * rather than tripwiring it (`interstitial-adapter.web.test.ts` does the
 * opposite, on purpose). The UMP sequence IS the unit under test here, so
 * there is nothing left to assert if the SDK is not stood in for.
 *
 * The stub is deliberately shallow - four functions and the one enum the
 * gate branches on - so it cannot drift into re-implementing the SDK. The
 * real API shape it stands in for is pinned in
 * `node_modules/react-native-google-mobile-ads/src/specs/modules/NativeConsentModule.ts`.
 */
const mockRequestInfoUpdate = jest.fn();
const mockLoadAndShowConsentFormIfRequired = jest.fn();
const mockInitialize = jest.fn();
const mockShowPrivacyOptionsForm = jest.fn();

jest.mock('react-native-google-mobile-ads', () => ({
  AdsConsent: {
    requestInfoUpdate: (...args: unknown[]) => mockRequestInfoUpdate(...args),
    loadAndShowConsentFormIfRequired: (...args: unknown[]) =>
      mockLoadAndShowConsentFormIfRequired(...args),
    showPrivacyOptionsForm: (...args: unknown[]) => mockShowPrivacyOptionsForm(...args),
  },
  AdsConsentStatus: {
    UNKNOWN: 'UNKNOWN',
    REQUIRED: 'REQUIRED',
    NOT_REQUIRED: 'NOT_REQUIRED',
    OBTAINED: 'OBTAINED',
  },
  MobileAds: () => ({
    initialize: (...args: unknown[]) => mockInitialize(...args),
  }),
}));

type ConsentInfoOverrides = {
  readonly status?: string;
  readonly canRequestAds?: boolean;
  readonly isConsentFormAvailable?: boolean;
  readonly privacyOptionsRequirementStatus?: string;
};

function buildConsentInfo(overrides: ConsentInfoOverrides = {}) {
  return {
    status: 'NOT_REQUIRED',
    canRequestAds: true,
    isConsentFormAvailable: false,
    privacyOptionsRequirementStatus: 'NOT_REQUIRED',
    ...overrides,
  };
}

beforeEach(() => {
  __resetConsentGateForTests();
  mockInitialize.mockResolvedValue([]);
  mockShowPrivacyOptionsForm.mockResolvedValue(buildConsentInfo());
});

describe('ensureAdsConsent — the sequence', () => {
  it('requests a consent info update, then initializes the SDK, then allows ads', async () => {
    mockRequestInfoUpdate.mockResolvedValue(buildConsentInfo());

    await expect(ensureAdsConsent()).resolves.toBe(true);

    expect(mockRequestInfoUpdate).toHaveBeenCalledTimes(1);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    // No form was available and none was required, so none may be forced on
    // a viewer whose region does not call for one.
    expect(mockLoadAndShowConsentFormIfRequired).not.toHaveBeenCalled();
  });

  it('shows the consent form when it is REQUIRED and available, before initializing', async () => {
    mockRequestInfoUpdate.mockResolvedValue(
      buildConsentInfo({ status: 'REQUIRED', canRequestAds: false, isConsentFormAvailable: true })
    );
    mockLoadAndShowConsentFormIfRequired.mockResolvedValue(
      buildConsentInfo({ status: 'OBTAINED', canRequestAds: true })
    );

    await expect(ensureAdsConsent()).resolves.toBe(true);

    expect(mockLoadAndShowConsentFormIfRequired).toHaveBeenCalledTimes(1);
    // The `canRequestAds` decision must be read off the POST-form info: the
    // pre-form answer was false, and honouring that would have thrown away
    // the consent the viewer just gave.
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it('shows the form for an UNKNOWN status too, not only REQUIRED', async () => {
    mockRequestInfoUpdate.mockResolvedValue(
      buildConsentInfo({ status: 'UNKNOWN', canRequestAds: false, isConsentFormAvailable: true })
    );
    mockLoadAndShowConsentFormIfRequired.mockResolvedValue(
      buildConsentInfo({ status: 'OBTAINED', canRequestAds: true })
    );

    await expect(ensureAdsConsent()).resolves.toBe(true);

    expect(mockLoadAndShowConsentFormIfRequired).toHaveBeenCalledTimes(1);
  });
});

describe('ensureAdsConsent — failing closed', () => {
  it('refuses ads when consent is required but no form has been published yet', async () => {
    // The external blocker made concrete: until a consent message is
    // PUBLISHED in the AdMob console, `isConsentFormAvailable` is false and
    // an EEA/UK user can never reach `canRequestAds: true`.
    mockRequestInfoUpdate.mockResolvedValue(
      buildConsentInfo({ status: 'REQUIRED', canRequestAds: false, isConsentFormAvailable: false })
    );

    await expect(ensureAdsConsent()).resolves.toBe(false);

    expect(mockLoadAndShowConsentFormIfRequired).not.toHaveBeenCalled();
    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it('refuses ads when the viewer declines on the form', async () => {
    mockRequestInfoUpdate.mockResolvedValue(
      buildConsentInfo({ status: 'REQUIRED', canRequestAds: false, isConsentFormAvailable: true })
    );
    mockLoadAndShowConsentFormIfRequired.mockResolvedValue(
      buildConsentInfo({ status: 'REQUIRED', canRequestAds: false })
    );

    await expect(ensureAdsConsent()).resolves.toBe(false);

    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it('refuses ads - rather than throwing - when the UMP call rejects', async () => {
    mockRequestInfoUpdate.mockRejectedValue(new Error('no network'));

    await expect(ensureAdsConsent()).resolves.toBe(false);

    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it('refuses ads when the SDK itself fails to initialize', async () => {
    mockRequestInfoUpdate.mockResolvedValue(buildConsentInfo());
    mockInitialize.mockRejectedValue(new Error('init failed'));

    await expect(ensureAdsConsent()).resolves.toBe(false);
  });
});

describe('ensureAdsConsent — memoization', () => {
  it('runs the sequence once for concurrent callers', async () => {
    mockRequestInfoUpdate.mockResolvedValue(buildConsentInfo());

    const results = await Promise.all([ensureAdsConsent(), ensureAdsConsent(), ensureAdsConsent()]);

    expect(results).toEqual([true, true, true]);
    expect(mockRequestInfoUpdate).toHaveBeenCalledTimes(1);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it('never re-runs the flow once it has settled successfully', async () => {
    mockRequestInfoUpdate.mockResolvedValue(buildConsentInfo());

    await ensureAdsConsent();
    await ensureAdsConsent();

    expect(mockRequestInfoUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not re-drive the whole flow on every call after a failure', async () => {
    // A viewer with no connectivity at launch must not re-run UMP several
    // times a minute for the rest of the session.
    mockRequestInfoUpdate.mockRejectedValue(new Error('no network'));

    await expect(ensureAdsConsent()).resolves.toBe(false);
    await expect(ensureAdsConsent()).resolves.toBe(false);

    expect(mockRequestInfoUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('ad privacy options', () => {
  it('reports the control as not required until the sequence has run', () => {
    // Nothing is known before `requestInfoUpdate`, and a Profile row that
    // opens a form Google has not asked for is worse than no row.
    expect(isAdPrivacyOptionsRequired()).toBe(false);
  });

  it('reports the control as required when Google says the region needs one', async () => {
    // UMP's requirement is not only "show a form once": where
    // privacyOptionsRequirementStatus is REQUIRED - the whole EEA and UK - the
    // app must expose a persistent way to reopen it, or a viewer's first-launch
    // choice is permanent.
    mockRequestInfoUpdate.mockResolvedValue(
      buildConsentInfo({ privacyOptionsRequirementStatus: 'REQUIRED' })
    );

    await ensureAdsConsent();

    expect(isAdPrivacyOptionsRequired()).toBe(true);
  });

  it('reports the control as not required elsewhere', async () => {
    mockRequestInfoUpdate.mockResolvedValue(
      buildConsentInfo({ privacyOptionsRequirementStatus: 'NOT_REQUIRED' })
    );

    await ensureAdsConsent();

    expect(isAdPrivacyOptionsRequired()).toBe(false);
  });

  it('reports failure rather than throwing when the form cannot be shown', async () => {
    mockShowPrivacyOptionsForm.mockRejectedValue(new Error('no form published'));

    await expect(showAdPrivacyOptionsForm()).resolves.toBe(false);
  });

  it('reports success when the form is shown', async () => {
    mockShowPrivacyOptionsForm.mockResolvedValue(buildConsentInfo());

    await expect(showAdPrivacyOptionsForm()).resolves.toBe(true);
  });
});
