# Discover Content Hub

Reference for the Discover experience: what each surface shows, which real
field backs it, and what is deliberately absent. Discover makes **no backend
changes** and adds **no new backend field** - it is a different presentation of
the `/videos/feed` response the app already fetches for Home.

## Layout

| | Before | After |
| --- | --- | --- |
| Header | `Discover` title, search field, category chip row | `Discover` title, search field, `Home / New / Rankings` sub-navigation |
| Body | one vertical list of **episode** rows (78x104 thumbnail + caption) | poster-first **series** catalog, per tab (below) |
| Cards | 7 rows for a 7-episode series | 1 poster per series |
| States | spinner / "Video gagal dimuat." / "Tidak ada hasil" inside `ListEmptyComponent` | poster skeleton, retryable error, empty-catalog, no-search-results |

Rewards and VIP entry points are intentionally **not** in this header. Rewards
is reached from the root bottom tab bar instead, which now carries five tabs -
Home, Discover, Saved, Rewards, Profile (`src/app/(tabs)/_layout.tsx`, added in
the Rewards integration slice). Discover's own header still carries no Rewards
or VIP entry point.

## Data sources per surface (Series API integration)

Discover and Series Detail now read the authoritative Series endpoints. Home
still reads the episode feed.

| Surface | Endpoint |
| --- | --- |
| Home | `GET /videos/feed` (unchanged) |
| Discover | `GET /series` -> `CatalogSeries[]` |
| Series Detail | `GET /series/:id` -> metadata + episodes |

`title`, `coverUrl`, `category`, `episodeCount`, `totalLikes` and
`hasPremiumEpisodes` are all backend-owned. Nothing on these two surfaces is
derived from a representative episode any more. `groupVideosIntoSeries` is
retained for exactly one purpose: the offline/demo path, where there is no
backend to ask.

**Two gaps this integration exposes and CANNOT close client-side:**

1. ~~**Per-episode premium tier is not on the wire.**~~ **CLOSED** (backend
   commit 2f285d1). `VideoResponseDto` now carries the resolved
   `accessTier: 'free' | 'premium'` on every episode, built by the same
   `resolveAccessTier` that backs `hasPremiumEpisodes` and the `/stream`
   guard. The client rule (`episodeNumber > FREE_EPISODE_LIMIT`) has been
   deleted; `toEpisode` copies `video.accessTier` instead. The series badge
   and the per-episode lock can no longer disagree, and an admin using
   `PATCH /admin/media/:id/access-tier` to make episode 2 premium or episode 8
   free is now reflected in both.
2. **The two mappers disagree on an unknown category.** `mapBackendSeries`
   resolves an unrecognised category to `null` by design; `mapBackendVideoToVideo`
   throws on the same value. A series whose category is outside the mobile
   union therefore renders fine in Discover and fails hard when opened. Fix:
   agree on one tolerance - either constrain the backend category, or relax the
   video mapper (which is on Home's path, so it is out of this slice's scope).

## Legacy: how Discover derived its cards before this integration

Everything below is derived from the already-fetched `/videos/feed` result via
`buildDiscoverCards` (`src/features/discover/discover-catalog.ts`), which reuses
the existing `groupVideosIntoSeries` (`src/services/videos/series-service.ts`).

| Surface | Source | Ordering |
| --- | --- | --- |
| Home | whole catalog, filterable by the existing `getCategories()` list | catalog order as returned by the backend |
| New | whole catalog | catalog order as returned by the backend (see limitation 1) |
| Rankings | whole catalog | like count, descending (see "Ranking metric") |
| Search | `searchVideos(videos, query, selectedCategory)` - the existing in-memory matcher, called exactly as before | catalog order |

Card fields: `title`, `posterUrl` (the representative episode's
`thumbnailUrl`), `category`, `channelName`, `episodeCount` (episodes for that
series present in the fetched catalog), `likeCount`, `hasPremiumEpisodes`,
`badges`. There is no rating, no view count, no release date, and no
"trending" score, because the mobile-visible contract has none.

## Ranking metric

**Rankings is ranked by total like count** - `likeCount` from `/videos/feed`,
**summed across the series' episodes** in the fetched catalog, read through
`useVideoInteractions().getLikeCount` so it includes the same optimistic local
like the rest of the app displays. Ties break deterministically: more episodes
first, then title, then `seriesId`, so the same catalog always ranks the same
way.

Because it is a sum, it is always labelled as one: `formatLikeTotal` renders
"98.6K suka total" on every featured card and ranked row, and the section
description says "Peringkat dihitung dari total suka semua episode pada katalog
ini, bukan jumlah tayangan". Two consequences worth knowing:

- A series with many episodes can outrank a series with higher per-episode
  likes. That is what "total" means, and it is why the word is in the label.
- The same series therefore shows a *per-episode* figure on the Home feed
  (e.g. `13.1K`) and a *total* here (e.g. `98.6K suka total`). Different
  numbers, different stated units.

`viewCount` exists only in the contract's *suggested* Video schema
(`docs/api-contract.md`); it is absent from `BackendVideoDto` and from the
`Video` model, so it is not used.

## Badges

Both badges are derived, not backend flags:

- **Hot** - the series is in the top `HOT_BADGE_LIMIT` (3) of the whole catalog
  by the like metric above **and** its total clears
  `max(median x HOT_BADGE_MEDIAN_MULTIPLIER, HOT_BADGE_MIN_LIKE_TOTAL)`, i.e. 2x
  the catalog median with an absolute floor of 100. Both gates earn their place:
  - Without the median gate, a top-3 rule alone badges 3 of the 5 bundled
    series - decoration, not signal.
  - Without the floor, a catalog with no likes yet has a median of 0, and a
    single like from the viewer would badge a series as Hot.
  - The median is the *lower* median on even-sized catalogs. Averaging the two
    middle values makes the gate unreachable for a two-series catalog (the mean
    of both values is their midpoint, so no leader can be twice it) and a 24x
    lead would go unbadged.

  Consequences worth knowing: on a catalog that slopes gently (6k/5k/4k/3k/2k)
  nothing is Hot, because nothing stands out - that is the intended answer, not
  a missing badge. Computed once over the full catalog, never over a filtered or
  searched subset, so the badge means the same thing everywhere.
- **Premium** - the series contains at least one premium episode, read from the
  backend's `hasPremiumEpisodes` aggregate. The reference direction
  called this "VIP", but "premium" is this app's own existing user-facing word
  (`premium-preview-modal.tsx`: "Episode ini termasuk konten premium."), and
  shipping "VIP" would invent a second name for one tier. Changing the label back
  is a one-line change in `DiscoverBadge`.

The badge describes the content, not the viewer: an entitled user still sees
`Premium` on a series that contains premium episodes.

**Badge budget (UI refinement slice).** Badges live on the media surface in
every variant, and `DiscoverPoster` decides how many of them fit:

| Surface | Overlays |
| --- | --- |
| Grid poster (unranked) | `Premium`, `Hot`, episode-count pill |
| Top Hits featured card | rank pill, `Premium` |
| Compact row (New, Rankings) | `Premium` |

`Premium` is access status and always survives. `Hot` yields when a stronger
signal or a narrower surface takes over: a ranked card already says "popular"
with its rank, and a 68pt row poster cannot carry a second chip without
wrapping it over the artwork. The accessibility label is built from this same
budget (`resolveVisibleBadges`), so it announces exactly the badges the card
draws - never a chip that is not on screen, and never a chip the sighted user
can see but the label omits.

Measured against the live catalog (2026-08-14): like totals are 716/714/714/714,
so the lower median is 714, the threshold is `max(1428, 100)`, and **no series
currently earns `Hot`**. That is the gate behaving as designed on a flat
catalog, not a bug - but it means the `Hot` overlay is unreachable in production
until the catalog develops a real leader.

## Artwork and its fallback

`posterUrl` is the representative episode's `thumbnailUrl`, which is
**optional** on `BackendVideoDto` and is mapped to `''` when the backend omits
it. `DiscoverPoster` therefore renders a branded fallback - the series initial
in the app's accent on an elevated surface, with an accent bar - whenever the
URL is empty, whitespace, or the image fails to load. The frame itself uses
`Palette.surface` with a hairline border rather than `Palette.backgroundElevated`,
so a card that is still loading reads as a card instead of a hole in the
screen.

The fallback invents no URL and adds no image provider. A series with no
artwork is a **backend data gap**, not a client bug; the client's only job is
to make that gap look deliberate. See "Backend follow-ups" below.

**Recovery after a failed load.** The failure is remembered against the artwork
URL that failed, so new artwork for a series retries while a URL that just
failed does not. Nothing sets state during render or from an effect, so there
is no timer to leak and no retry loop.

Keying on the *card object* instead was investigated and rejected. It would
self-clear and look like free recovery, but `cards` is rebuilt on a catalog
refetch **and** on every like or save anywhere in the app - and since Discover
has no pull-to-refresh, the like/save path is the one that actually fires.
Object-identity keying would therefore re-issue a request for every failed
poster in the render window on every unrelated tap, against a URL that just
failed, from a screen the user is not looking at.

**Known limit:** a transient failure holds the fallback until that cell remounts
(tab switch, or scrolling out of the render window). The failure direction is the
safe one - a branded tile, never a black rectangle. Clean recovery needs a
catalog-generation token threaded from the screen to the poster; that is a
follow-up, not something to bolt on.

There is **no `New` badge** - see limitation 1.

## Known limitations

1. **No publication date.** `BackendVideoDto`
   (`src/services/videos/video-mapper.ts`) has no `createdAt`/`publishedAt`, and
   `/videos/feed` documents no ordering guarantee. The New tab therefore shows
   the catalog in the exact order the backend returned it and says so in the UI
   ("Ditampilkan sesuai urutan katalog yang dikirim server. Katalog belum
   menyertakan tanggal tayang, jadi urutan ini bukan klaim tanggal rilis").
   Truthful newest-first ordering needs a backend change: expose `createdAt` (or
   a `publishedAt`) on the feed DTO and map it, then sort on it.
2. **Ranking is catalog-local and page-sensitive.** It ranks only the series
   present in the fetched feed page, not the whole library, and likes are a
   weaker popularity signal than views. Because the metric is a per-series sum,
   the pagination boundary also affects it: a page carrying 3 of a series'
   episodes gives that series a smaller total than a page carrying 7. A
   server-side ranking endpoint would replace `rankDiscoverCards`, not the UI.
3. **Card identity is page-scoped.** `episodeCount`, and also the card's title
   and poster, come from the episodes present in the fetched feed page -
   `buildSeries` picks the lowest-numbered episode in that page as the
   representative. A page containing only episodes 8+ of a series therefore
   yields a card titled and postered from episode 8. This is inherited from the
   existing `series-service.ts` grouping that the series detail screen already
   uses; Discover makes it the primary catalog identity. Related: nothing in the
   contract guarantees one category per series, so a series whose episode 1 is
   `CEO` and episode 2 is `Romance` shows `CEO` on its card while still matching
   the `Romance` chip during search (search filters on the episode's category,
   the card prints the representative episode's).
4. **Search is still client-side.** `GET /videos/search` remains unconnected;
   Discover filters the fetched catalog in memory with the same matcher and the
   same category argument the previous screen passed. One presentation change:
   matches are grouped onto their series card, so a 7-episode series produces one
   result instead of seven. Because a caption or non-first-episode hit therefore
   renders a card whose visible text does not contain the query, the results
   header states what search matches on ("Dicocokkan dengan judul, deskripsi
   episode, channel, dan kategori"). What is lost relative to the old screen is
   *which* episode matched - the old row showed `EP n` plus a caption preview.
5. **Search and the category chips interact, visibly.** The selected category
   still narrows the query (unchanged behavior), so the chip row stays mounted on
   the results view rather than leaving an invisible filter applied. Selecting a
   sub-tab clears the query, so the tab strip can never show a selected tab whose
   content is not on screen.

## Naming decisions worth revisiting

- **The tab is called "New" but shows catalog order.** The tab set
  (`Home / New / Rankings`) is specified by the product direction. A tab label is
  itself a claim, and this one is not backed by a publication date, so the
  disclosure sits at the top of the tab body where it cannot be missed. If the
  claim still reads as too strong, rename the tab to "Katalog" - it is one string
  in `DISCOVER_TABS` - or drop the tab until the backend exposes `publishedAt`.
- **"Home" appears twice on this screen**: the root bottom tab (the video feed)
  and the Discover sub-tab (the poster grid). Both names come from the product
  direction, so the collision is accepted rather than resolved unilaterally.
  Renaming the sub-tab to "Katalog"/"Semua" would remove it without touching
  the router; that is a product call, not a technical constraint.

## Performance and scope notes

- Poster grids are virtualized (`FlatList` with `numColumns`), keyed by
  `seriesId`, and re-keyed when the column count changes because `numColumns`
  cannot change in place.
- Column count is resolved from the available width
  (`resolvePosterColumns`): 2 columns on a 320pt phone, the preferred 3 from
  375pt up, more on tablet widths. Posters use `aspectRatio`, not fixed heights,
  so large accessibility font sizes do not clip the image. The poster's overlay
  pills (rank, badges, `N EP`) still scale with the user's text size but are
  capped at `OVERLAY_MAX_FONT_SCALE` (1.4x); the badge row is bounded on
  both sides and wraps, so a capped overlay cannot be clipped by the poster's
  `overflow: hidden`.
- Card accessibility labels carry every visible fact, including the episode
  count and the ranking metric, because `Pressable` is accessible by default and
  its label replaces the child text.
- The search result count is an Android live region
  (`accessibilityLiveRegion="polite"`). iOS VoiceOver ignores that prop, so an
  iOS user is not proactively told the result count changed - closing that gap
  needs `AccessibilityInfo.announceForAccessibility` with debouncing, which is
  not implemented here.
- Discover imports no `expo-video` code path. `formatCompactCount` follows the
  Home feed's `formatLikeCount` shape rather than importing it, because that
  module pulls in `expo-video`; it adds an `M` branch the feed's helper does not
  have, since Discover shows per-series totals.
- Rebuilding the cards depends on `getLikeCount`, whose identity changes when any
  like or save changes anywhere in the app. Discover therefore re-derives its
  cards on those events while mounted. That is deliberate - it keeps the like
  totals live - and is a linear pass over the fetched page.

## Backend follow-ups (not done in this slice, no backend change was made)

1. **Poster artwork per series — currently missing for 100% of rows.** Measured
   against the live local backend on 2026-08-14: `GET /videos/feed` returned 42
   rows and **not one carried a `thumbnailUrl` key at all**. `thumbnailUrl` is
   optional on the feed DTO, so the mapper coerces it to `''`, and every one of
   the four Discover series therefore renders the branded fallback rather than
   artwork. This is a backend data gap, not a client bug: Discover has no URL to
   render. It also means the "black card" symptom from simulator QA was total,
   not intermittent. `thumbnailUrl` is also episode-scoped; there is no
   series-level poster field. A
   `posterUrl` (or a guaranteed `thumbnailUrl`) on the series/video contract
   would remove the fallback from the happy path. Portrait key art would also
   fit the 2:3 frame better than a 16:9 episode still.
2. **Series-level title.** Every title in the live feed ends with an episode
   suffix (`"Malapetaka Datang: Benteng Bergerakku - Episode 1"`), because the
   card takes the representative episode's `title` - there is no series title on
   the contract. Discover shows it verbatim and MUST keep doing so: stripping a
   `/ - Episode \d+$/` suffix client-side is content rewriting, it would break
   search coherence (`videoMatchesSearch` matches the raw title, so a card could
   stop containing the query that matched it), and the pattern is not stable if
   the backend ever localizes it. The fix belongs on the contract: a series title
   distinct from the episode title.
3. **Publication date.** Still absent - see limitation 1 below.

## Category labels

The chip list is an app-owned constant (`getCategories()`), not backend copy,
so the chips, the card metadata line and the accessibility labels all render a
localized label via `translateCategory`. The underlying `VideoCategoryFilter`
values are untouched: the selected filter, `searchVideos`, and the catalog
derivations all still compare raw values. Because `searchVideos` matches the
raw English category, Discover additionally matches the localized label, so the
search hint's promise to match "kategori" holds in all three languages.

## Files

```
src/app/(tabs)/discover.tsx                     screen: state + which surface to show
src/features/discover/discover-catalog.ts       derivations: cards, ranking, badges, formatting
src/features/discover/discover-poster.tsx       media surface: artwork, fallback, all badge overlays
src/features/discover/use-discover-grid.ts      responsive column/poster sizing
src/features/discover/discover-header.tsx       search field + Home/New/Rankings sub-nav
src/features/discover/discover-cards.tsx        poster card, list row, virtualized grid
src/features/discover/discover-views.tsx        Home / New / Rankings / search-results views
src/features/discover/discover-states.tsx       skeleton, error, empty states
src/types/discover.ts                           DiscoverSeriesCard, DiscoverBadge, DiscoverTabKey
```
