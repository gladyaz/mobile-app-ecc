import { renderHook } from '@testing-library/react-native';

import { useAutoClearDisplayIdle } from '@/hooks/use-auto-clear-display-idle';

/**
 * Pure timer-mechanics coverage for the idle hook, under fake timers with no
 * other timers in the environment - which is what makes the exact
 * pending-timer-count assertions here meaningful (the component-level suite
 * cannot count timers this precisely because playback effects own timers of
 * their own).
 */
describe('useAutoClearDisplayIdle', () => {
  const DELAY_MS = 3000;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function renderIdleHook(
    initial: Partial<{ isEligible: boolean; interactionNonce: number; onAutoHide: () => void }> = {}
  ) {
    const onAutoHide = initial.onAutoHide ?? jest.fn();
    // `renderHook` is async in this testing-library version - it must be
    // awaited BEFORE destructuring, or rerender/unmount are undefined and
    // the hook never even mounts.
    const view = await renderHook(
      (props: { isEligible: boolean; interactionNonce: number; onAutoHide: () => void }) =>
        useAutoClearDisplayIdle({
          isEligible: props.isEligible,
          delayMs: DELAY_MS,
          interactionNonce: props.interactionNonce,
          onAutoHide: props.onAutoHide,
        }),
      {
        initialProps: {
          isEligible: initial.isEligible ?? true,
          interactionNonce: initial.interactionNonce ?? 0,
          onAutoHide,
        },
      }
    );

    return { ...view, onAutoHide };
  }

  it('fires exactly once at the threshold while eligible', async () => {
    const { onAutoHide } = await renderIdleHook();

    jest.advanceTimersByTime(DELAY_MS - 1);
    expect(onAutoHide).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onAutoHide).toHaveBeenCalledTimes(1);

    // After firing there is nothing left pending: no re-arm, no churn.
    jest.advanceTimersByTime(DELAY_MS * 10);
    expect(onAutoHide).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('never arms a timer while ineligible', async () => {
    // "One timer, cancelled everywhere" is asserted behaviorally throughout
    // this file rather than via jest.getTimerCount() deltas: React's own
    // scheduler arms background timers across act() boundaries, so raw
    // pending-timer counts are not attributable to this hook. The
    // structural guarantee is the hook's single setTimeout call site; the
    // behavioral guarantee is "callback never fires outside its window."
    const { rerender, onAutoHide } = await renderIdleHook({ isEligible: false });

    jest.advanceTimersByTime(DELAY_MS * 10);
    expect(onAutoHide).not.toHaveBeenCalled();

    // Becoming eligible arms a real countdown from zero.
    await rerender({ isEligible: true, interactionNonce: 0, onAutoHide });
    jest.advanceTimersByTime(DELAY_MS);
    expect(onAutoHide).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending timer the moment eligibility collapses', async () => {
    const { rerender, onAutoHide } = await renderIdleHook();

    jest.advanceTimersByTime(DELAY_MS - 1);
    await rerender({ isEligible: false, interactionNonce: 0, onAutoHide });

    jest.advanceTimersByTime(DELAY_MS * 10);
    expect(onAutoHide).not.toHaveBeenCalled();
  });

  it('starts a FRESH full countdown when eligibility returns - never the old remainder', async () => {
    const { rerender, onAutoHide } = await renderIdleHook();

    // 2.9s of the first countdown elapse, then eligibility drops and comes
    // back (e.g. pause -> resume).
    jest.advanceTimersByTime(DELAY_MS - 100);
    await rerender({ isEligible: false, interactionNonce: 0, onAutoHide });
    await rerender({ isEligible: true, interactionNonce: 0, onAutoHide });

    // The old timer had only 100ms left; a fresh one must need the FULL
    // delay again.
    jest.advanceTimersByTime(DELAY_MS - 1);
    expect(onAutoHide).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onAutoHide).toHaveBeenCalledTimes(1);
  });

  it('an interaction-nonce bump cancels and restarts the full countdown', async () => {
    const { rerender, onAutoHide } = await renderIdleHook();

    jest.advanceTimersByTime(DELAY_MS - 100);
    await rerender({ isEligible: true, interactionNonce: 1, onAutoHide });

    jest.advanceTimersByTime(DELAY_MS - 1);
    expect(onAutoHide).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onAutoHide).toHaveBeenCalledTimes(1);
  });

  it('a re-render with an unchanged eligibility/nonce does NOT restart the countdown', async () => {
    // The feed item re-renders every ~250ms from timeUpdate while playing;
    // if each re-render re-armed the timer, the chrome would never hide.
    const { rerender, onAutoHide } = await renderIdleHook();

    jest.advanceTimersByTime(DELAY_MS - 100);
    // Fresh closure identity for onAutoHide, same values otherwise - the
    // exact shape of a routine re-render.
    await rerender({ isEligible: true, interactionNonce: 0, onAutoHide: () => onAutoHide() });

    jest.advanceTimersByTime(100);
    expect(onAutoHide).toHaveBeenCalledTimes(1);
  });

  it('the latest onAutoHide closure is the one invoked at fire time', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = await renderIdleHook({ onAutoHide: first });

    await rerender({ isEligible: true, interactionNonce: 0, onAutoHide: second });
    jest.advanceTimersByTime(DELAY_MS);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('unmount clears the pending timer - no callback, no leak, no late state update', async () => {
    const { unmount, onAutoHide } = await renderIdleHook();

    jest.advanceTimersByTime(DELAY_MS - 100);
    await unmount();

    jest.advanceTimersByTime(DELAY_MS * 10);
    expect(onAutoHide).not.toHaveBeenCalled();
  });
});
