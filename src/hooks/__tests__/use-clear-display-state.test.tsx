import { act, renderHook } from '@testing-library/react-native';

import { useClearDisplayState } from '@/hooks/use-clear-display-state';

describe('useClearDisplayState', () => {
  function renderClearDisplayHook(initialActiveVideoId: string | undefined = 'video-1') {
    return renderHook(
      (props: { activeVideoId: string | undefined }) => useClearDisplayState(props.activeVideoId),
      {
        initialProps: { activeVideoId: initialActiveVideoId },
      }
    );
  }

  it('starts with the chrome visible', async () => {
    const { result } = await renderClearDisplayHook();

    expect(result.current.isClearDisplay).toBe(false);
  });

  it('a MANUAL clear persists across an active-video change (baseline product behavior)', async () => {
    const { result, rerender } = await renderClearDisplayHook();

    await act(async () => {
      result.current.setClearDisplay(true);
    });
    await rerender({ activeVideoId: 'video-2' });

    expect(result.current.isClearDisplay).toBe(true);
  });

  it('an AUTO clear un-clears when the active video changes', async () => {
    const { result, rerender } = await renderClearDisplayHook();

    await act(async () => {
      result.current.setClearDisplay(true, 'auto');
    });
    expect(result.current.isClearDisplay).toBe(true);

    await rerender({ activeVideoId: 'video-2' });

    expect(result.current.isClearDisplay).toBe(false);
  });

  it('an AUTO clear stays cleared while the active video does NOT change', async () => {
    const { result, rerender } = await renderClearDisplayHook();

    await act(async () => {
      result.current.setClearDisplay(true, 'auto');
    });
    await rerender({ activeVideoId: 'video-1' });

    expect(result.current.isClearDisplay).toBe(true);
  });

  it('restoring the chrome clears a stale auto origin - a later MANUAL clear persists again', async () => {
    const { result, rerender } = await renderClearDisplayHook();

    // Auto-hide, then the viewer taps the chrome back...
    await act(async () => {
      result.current.setClearDisplay(true, 'auto');
    });
    await act(async () => {
      result.current.setClearDisplay(false);
    });

    // ...and later clears MANUALLY. The old 'auto' marker must not leak
    // into this new clear: it persists across the next swipe.
    await act(async () => {
      result.current.setClearDisplay(true);
    });
    await rerender({ activeVideoId: 'video-3' });

    expect(result.current.isClearDisplay).toBe(true);
  });

  it('a MANUAL clear overriding an earlier AUTO clear persists across the next swipe', async () => {
    const { result, rerender } = await renderClearDisplayHook();

    await act(async () => {
      result.current.setClearDisplay(true, 'auto');
    });
    // The viewer re-affirms clear display manually (a direct manual set,
    // e.g. the sheet switch) - the standing origin must become manual.
    await act(async () => {
      result.current.setClearDisplay(true);
    });
    await rerender({ activeVideoId: 'video-2' });

    expect(result.current.isClearDisplay).toBe(true);
  });
});
