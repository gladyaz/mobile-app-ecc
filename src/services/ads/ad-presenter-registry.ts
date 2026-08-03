/**
 * Slice 15A-S1: a tiny module-level registry decoupling `ad-controller.ts`
 * (which decides WHEN to show an ad) from whatever concretely presents one
 * (`interstitial-adapter.ts` in production, a fake in tests). Plain module,
 * no React - `ad-controller.ts`'s `onVideoTransition()` is called from
 * `(tabs)/index.tsx`'s deliberately-stable `handleViewableItemsChanged`
 * callback (see that file), so it must not depend on any hook or context.
 */
export type Presenter = {
  readonly isReady: () => boolean;
  readonly show: () => void;
  readonly loadIfNeeded: () => void;
};

let currentPresenter: Presenter | null = null;

export function registerPresenter(presenter: Presenter): void {
  currentPresenter = presenter;
}

/**
 * No-ops unless `presenter` is the currently registered one, so an
 * out-of-order unmount (e.g. a fast remount registering a new presenter
 * before the old one's cleanup runs) can never accidentally clear a newer,
 * still-active registration.
 */
export function unregisterPresenter(presenter: Presenter): void {
  if (currentPresenter === presenter) {
    currentPresenter = null;
  }
}

export function getPresenter(): Presenter | null {
  return currentPresenter;
}

export function __resetPresenterRegistryForTests(): void {
  currentPresenter = null;
}
