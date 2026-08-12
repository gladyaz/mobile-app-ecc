import { qaFixtureVideos, shouldIncludeQaFixtures } from '@/data/qa-fixture-videos';

const QA_FIXTURE_ID = 'qa-fixture-16x9-fullscreen';

/**
 * Requires a FRESH copy of the mock catalog with the QA-fixtures flag set to
 * the given value. `mockDramaVideos` is computed at module load, so the flag
 * has to be in place before the module is (re-)evaluated - which is exactly
 * what `jest.isolateModules` provides. Static `process.env` member access
 * throughout - `expo/no-dynamic-env-var` (correctly) forbids the dynamic
 * form, since Metro inlines env reads by their literal name.
 */
function loadMockCatalogWithFlag(flagValue: string | undefined) {
  const previousValue = process.env.EXPO_PUBLIC_INCLUDE_QA_FIXTURES;
  let catalog: readonly { id: string; seriesId: string }[] = [];

  if (flagValue === undefined) {
    delete process.env.EXPO_PUBLIC_INCLUDE_QA_FIXTURES;
  } else {
    process.env.EXPO_PUBLIC_INCLUDE_QA_FIXTURES = flagValue;
  }

  try {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      catalog = (require('@/data/mock-drama-videos') as typeof import('@/data/mock-drama-videos'))
        .mockDramaVideos;
    });
  } finally {
    if (previousValue === undefined) {
      delete process.env.EXPO_PUBLIC_INCLUDE_QA_FIXTURES;
    } else {
      process.env.EXPO_PUBLIC_INCLUDE_QA_FIXTURES = previousValue;
    }
  }

  return catalog;
}

describe('qa-fixture-videos', () => {
  it('ships exactly one 16:9 fixture, recognized as horizontal', () => {
    expect(qaFixtureVideos).toHaveLength(1);

    const [fixture] = qaFixtureVideos;

    // `width > height` is the exact condition the feed item uses to decide
    // a video is horizontal - and therefore to render the fullscreen
    // control (see drama-feed-item.tsx).
    expect(fixture.width).toBe(1280);
    expect(fixture.height).toBe(720);
    expect(fixture.width! > fixture.height!).toBe(true);
  });

  it('is unmistakably a QA fixture, never presentable as production content', () => {
    const [fixture] = qaFixtureVideos;

    expect(fixture.id).toBe(QA_FIXTURE_ID);
    expect(fixture.title).toContain('QA');
    expect(fixture.storageKey.startsWith('qa-fixtures/')).toBe(true);
    expect(fixture.channelName).toBe('QA Fixtures');
  });

  it('stays OUT of the mock catalog by default (flag unset or false)', () => {
    const unsetCatalog = loadMockCatalogWithFlag(undefined);
    const falseCatalog = loadMockCatalogWithFlag('false');

    expect(unsetCatalog.some((video) => video.id === QA_FIXTURE_ID)).toBe(false);
    expect(falseCatalog.some((video) => video.id === QA_FIXTURE_ID)).toBe(false);
    expect(shouldIncludeQaFixtures()).toBe(false);
  });

  it('joins the mock catalog only when EXPO_PUBLIC_INCLUDE_QA_FIXTURES=true', () => {
    const catalog = loadMockCatalogWithFlag('true');

    expect(catalog.some((video) => video.id === QA_FIXTURE_ID)).toBe(true);
    // The real bundled series are still all present - the fixture is
    // appended, never a replacement.
    expect(catalog.filter((video) => video.seriesId === 'series-pewaris')).toHaveLength(5);
    expect(catalog.filter((video) => video.seriesId === 'series-nona-shen')).toHaveLength(5);
  });
});
