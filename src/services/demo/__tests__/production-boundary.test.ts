/**
 * Pins the PRODUCTION side of every switch that can make this app serve
 * fabricated data.
 *
 * The suite already pins the demo direction thoroughly - what demo mode turns
 * on, and where. Almost nothing pinned the other direction: that a build which
 * sets none of these flags gets none of these behaviours. That asymmetry is
 * what lets a boundary rot silently, because the tests that would notice only
 * ever run with the flag ON.
 *
 * Every case below is written as "the flag is absent" rather than
 * "the flag is 'false'", because absent is what a release build actually has:
 * `babel-preset-expo`'s inline-env-vars plugin replaces each
 * `process.env.EXPO_PUBLIC_*` read with the literal value at bundle time, and
 * an unset variable inlines as `undefined`.
 */
import { isDemoMode } from '@/services/demo/demo-mode';

const DEMO_FLAGS = [
  'EXPO_PUBLIC_DEMO_MODE',
  'EXPO_PUBLIC_USE_MOCK_DATA',
  'EXPO_PUBLIC_INCLUDE_QA_FIXTURES',
] as const;

function withoutDemoFlags(run: () => void): void {
  const saved = DEMO_FLAGS.map((key) => [key, process.env[key]] as const);

  for (const [key] of saved) {
    delete process.env[key];
  }

  try {
    run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('production demo/mock boundary', () => {
  it('is not a demo build when EXPO_PUBLIC_DEMO_MODE is absent', () => {
    withoutDemoFlags(() => {
      expect(isDemoMode()).toBe(false);
    });
  });

  it.each(['false', 'FALSE', '0', '1', 'yes', 'True', ''])(
    'is not a demo build for the near-miss value %p',
    (value) => {
      withoutDemoFlags(() => {
        process.env.EXPO_PUBLIC_DEMO_MODE = value;

        expect(isDemoMode()).toBe(false);
      });
    }
  );

  it('serves the real catalog when no mock flag is set', () => {
    withoutDemoFlags(() => {
      // Required inside the callback: `shouldUseMockData` reads the
      // environment at call time, but `jest.isolateModules` is what guarantees
      // no earlier import cached a decision made under a different env.
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { shouldUseMockData } = require('@/services/videos/video-service');

        expect(shouldUseMockData()).toBe(false);
      });
    });
  });

  it('excludes the synthetic QA fixture card when no fixture flag is set', () => {
    withoutDemoFlags(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { shouldIncludeQaFixtures } = require('@/data/qa-fixture-videos');

        expect(shouldIncludeQaFixtures()).toBe(false);
      });
    });
  });

  it('keeps the QA fixture out of the catalog even when mock data is on', () => {
    withoutDemoFlags(() => {
      process.env.EXPO_PUBLIC_USE_MOCK_DATA = 'true';

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { mockDramaVideos } = require('@/data/mock-drama-videos');

        expect(
          (mockDramaVideos as { id: string }[]).some((video) => video.id.startsWith('qa-'))
        ).toBe(false);
      });
    });
  });

});

describe('bundled demo media is excluded from a production build', () => {
  // The guarantee this pins used to be a PROCEDURE - the release preflight told
  // a human to go move two folders - and it failed exactly the way procedures
  // do: on a clean checkout the media was absent and the build was clean, while
  // on the machine that had produced the showcase APK the identical command
  // bundled ~61 MB of drama clips and the synthetic QA test card into a store
  // artifact. metro.config.js now keys the exclusion on what the BUILD is for,
  // so the outcome no longer depends on the state of somebody's disk.
  const POLICY_PATH = '../../../../metro/bundled-demo-media';

  type PolicyModule = {
    shouldStubBundledDemoMedia: (
      hasMedia?: boolean,
      env?: Record<string, string | undefined>
    ) => boolean;
    isBundledDemoMediaRequest: (
      context: { originModulePath: string },
      moduleName: string
    ) => boolean;
  };

  function loadPolicy(): PolicyModule {
    let loaded: PolicyModule | undefined;

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = require(POLICY_PATH) as PolicyModule;
    });

    return loaded as PolicyModule;
  }

  const policy = loadPolicy();

  /** Reads as the build's declared intent, which is what the policy keys on. */
  const PRODUCTION = {};
  const SHOWCASE = { EXPO_PUBLIC_DEMO_MODE: 'true' };
  const MOCK_DATA = { EXPO_PUBLIC_USE_MOCK_DATA: 'true' };

  it('stubs the demo media for a build that declares no bundled catalog', () => {
    // The load-bearing case: the media IS on disk (`hasMedia: true`) and the
    // build still carries none of it.
    expect(policy.shouldStubBundledDemoMedia(true, PRODUCTION)).toBe(true);
  });

  it.each(['false', '0', 'FALSE', ''])(
    'stubs it for the near-miss flag value %p too',
    (value) => {
      expect(
        policy.shouldStubBundledDemoMedia(true, {
          EXPO_PUBLIC_DEMO_MODE: value,
          EXPO_PUBLIC_USE_MOCK_DATA: value,
        })
      ).toBe(true);
    }
  );

  it('keeps the media for the offline showcase build, which needs it to play anything', () => {
    expect(policy.shouldStubBundledDemoMedia(true, SHOWCASE)).toBe(false);
  });

  it('keeps the media for a mock-data build', () => {
    expect(policy.shouldStubBundledDemoMedia(true, MOCK_DATA)).toBe(false);
  });

  it('still stubs a demo build whose media was never generated, rather than failing to resolve', () => {
    // app.config.js refuses this combination at config time with an
    // explanation, so it is a safety net under an unreachable case - but the
    // net has to exist, or Metro throws "Unable to resolve module" instead.
    expect(policy.shouldStubBundledDemoMedia(false, SHOWCASE)).toBe(true);
  });

  it('targets the demo directories precisely, and nothing that merely looks like them', () => {
    const { isBundledDemoMediaRequest: isDemoMedia } = policy;
    const fromDataDir = { originModulePath: `${process.cwd()}/src/data/mock-drama-videos.ts` };
    const fromRoot = { originModulePath: `${process.cwd()}/app.config.js` };

    expect(isDemoMedia(fromDataDir, '../../assets/videos/pewaris-ep-1.mp4')).toBe(true);
    expect(isDemoMedia(fromDataDir, '../../assets/videos/qa-16x9-fullscreen.mp4')).toBe(true);
    expect(isDemoMedia(fromDataDir, '../../assets/thumbnails/pewaris-ep-1.jpg')).toBe(true);

    // The app's own artwork, a lookalike directory, and a package specifier
    // must all resolve normally - stubbing any of them would blank the UI.
    expect(isDemoMedia(fromRoot, './assets/images/icon.png')).toBe(false);
    expect(isDemoMedia(fromDataDir, '../../assets/videos-extra/x.mp4')).toBe(false);
    expect(isDemoMedia(fromDataDir, 'react-native')).toBe(false);
  });
});
