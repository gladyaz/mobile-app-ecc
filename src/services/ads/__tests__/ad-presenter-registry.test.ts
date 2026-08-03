import {
  __resetPresenterRegistryForTests,
  getPresenter,
  registerPresenter,
  unregisterPresenter,
  type Presenter,
} from '@/services/ads/ad-presenter-registry';

function buildPresenter(): Presenter {
  return { isReady: jest.fn(), show: jest.fn(), loadIfNeeded: jest.fn() };
}

beforeEach(() => {
  __resetPresenterRegistryForTests();
});

describe('ad-presenter-registry', () => {
  it('returns null when nothing is registered', () => {
    expect(getPresenter()).toBeNull();
  });

  it('returns whatever was last registered', () => {
    const presenter = buildPresenter();

    registerPresenter(presenter);

    expect(getPresenter()).toBe(presenter);
  });

  it('unregisters the currently registered presenter', () => {
    const presenter = buildPresenter();
    registerPresenter(presenter);

    unregisterPresenter(presenter);

    expect(getPresenter()).toBeNull();
  });

  it('no-ops when unregistering a presenter that is not the currently registered one', () => {
    const first = buildPresenter();
    const second = buildPresenter();
    registerPresenter(first);
    registerPresenter(second);

    // An out-of-order unmount (e.g. a stale cleanup from an earlier
    // presenter firing after a newer one has already registered) must
    // never clobber the current registration.
    unregisterPresenter(first);

    expect(getPresenter()).toBe(second);
  });
});
