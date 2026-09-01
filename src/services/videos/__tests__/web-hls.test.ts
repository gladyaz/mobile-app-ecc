// Records whether the hls.js module was ever actually evaluated. A jest.mock
// factory is LAZY - it runs only if something really requires the module - so
// this stays false unless the native half pulls hls.js in.
const mockHlsModuleWasLoaded = jest.fn();
jest.mock('hls.js', () => {
  mockHlsModuleWasLoaded();
  return { __esModule: true, default: {} };
});

import {
  attachWebHlsEngine,
  canPlayHlsInThisRuntime,
} from '@/services/videos/web-hls';

/**
 * Work unit "HLS WEB PLAYBACK".
 *
 * `jest-expo` resolves the NATIVE half of the platform split here (there is
 * no `.web.ts` resolution in this project's default test environment), which
 * is exactly the half worth pinning: the product ships to Android, and the
 * safety property that matters is that adding a browser HLS engine changed
 * nothing whatsoever for native playback.
 *
 * The web half's real behaviour is not unit-tested against a fake DOM - a
 * mocked `hls.js` attached to a mocked `<video>` would assert that the mock
 * was called, not that HLS plays. It is verified where it can actually be
 * observed: a real Chrome, against the real deployed gateway, playing a real
 * transcoded episode (see `docs/HLS_PIPELINE.md`, "Web playback evidence").
 */
describe('web-hls (native half of the platform split)', () => {
  it('reports HLS as playable - iOS AVPlayer and Android Media3 both play m3u8 natively', () => {
    expect(canPlayHlsInThisRuntime()).toBe(true);
  });

  it('never attaches anything, so no native playback path is altered', () => {
    const onFatalError = jest.fn();

    expect(
      attachWebHlsEngine({}, 'https://gateway.example.com/t/tok/master.m3u8', onFatalError)
    ).toBeNull();
    expect(onFatalError).not.toHaveBeenCalled();
  });

  it('inspects none of its arguments - a null container is as inert as a real one', () => {
    const onFatalError = jest.fn();

    expect(attachWebHlsEngine(null, '', onFatalError)).toBeNull();
    expect(onFatalError).not.toHaveBeenCalled();
  });

  it('does not pull hls.js into the native module graph', () => {
    // The whole point of the `.web.ts` split. If the native half ever starts
    // importing hls.js, the iOS/Android bundles grow a browser-only
    // MediaSource library they can never use - and this is what catches it.
    // Calling into the module first proves the check is not vacuous: even
    // after exercising both exports, hls.js was never evaluated.
    canPlayHlsInThisRuntime();
    attachWebHlsEngine({}, 'https://example.test/master.m3u8', jest.fn());

    expect(mockHlsModuleWasLoaded).not.toHaveBeenCalled();
  });
});
