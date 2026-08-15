// Auto clear display on idle: how long the feed chrome stays up with no
// interaction before it steps aside on its own. There was no pre-existing
// approved idle duration anywhere in the product when this was added
// (audited 2026-08-15), so this is THE one centralized value - nothing else
// may re-declare it as a literal.
export const AUTO_CLEAR_DISPLAY_DELAY_MS = 3000;

/**
 * Why the current clear-display state is what it is.
 *
 * - 'manual': the viewer asked for it (single tap, pinch, or the Playback
 *   Settings switch). Manual clear display persists across swipes - the
 *   baseline product decision ("someone who cleared the screen expects it to
 *   stay cleared") is unchanged.
 * - 'auto': the idle timer hid the chrome on the viewer's behalf. An
 *   auto-hidden display is a passive convenience, not an expressed intent,
 *   so it does NOT survive an active-video change: a swipe is an
 *   interaction, and the next video starts with its chrome visible and its
 *   own fresh idle countdown.
 */
export type ClearDisplayOrigin = 'manual' | 'auto';
