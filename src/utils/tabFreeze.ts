/**
 * Whether a tab screen that is not the focused tab should stop rendering.
 *
 * `enableScreens(false)` (App.tsx) leaves every visited tab mounted as a plain
 * View, so `freezeOnBlur` has nothing to act on and a blurred tab kept
 * re-rendering on every store write. `FreezeWhenBlurred` holds the tab's
 * subtree instead. This is the one rule it applies.
 *
 * **Only a tab blurred by another tab is frozen.** Focus is the tab
 * navigator's focused route (`isTabFocused`), not screen focus, so a detail
 * screen pushed over the tab does not count: the native push animates the screen underneath, and freezing it
 * would blank it for the length of the transition.
 *
 * **Never while a sheet is presented.** Freezing hides the subtree, and a
 * sheet must not be hidden or unmounted while it is on screen (see
 * `SheetModal`). A sheet that is up when the tab blurs (a notification tap
 * landing under an open editor) holds the freeze off until it closes, and the
 * freeze then lands on its own. The check is on the root presentation level,
 * so it is deliberately conservative: any open sheet, not only this tab's.
 */
export function shouldFreezeTab(opts: { focused: boolean; sheetPresented: boolean }): boolean {
  return !opts.focused && !opts.sheetPresented;
}

/**
 * Whether this tab is the focused one, given the container's answer and the
 * tab navigator's.
 *
 * **The container's root state wins whenever it has one.** A jump to a tab from
 * outside the tab bar (`navigateToTab`: the coins button, a widget tap, a link)
 * arrives as `screen` params on the tab navigator's own route. The tab
 * navigator draws the new tab from those params at once but only writes the
 * state back after commit, so its `getState()`, which `useNavigationState` and
 * `navigation.isFocused()` both read, still names the old tab while the screens
 * render. When the write lands, the navigator's rendered state doesn't change
 * (it was already showing the new tab), so neither hook is told again. The
 * freeze then hid the tab on screen and left it blank until the next
 * navigation. The container emits `state` once that write lands, so its answer
 * catches up. The navigator's answer is only for before the container is ready.
 */
export function isTabFocused(opts: {
  routeName: string;
  containerTab: string | undefined;
  navigatorFocused: boolean;
}): boolean {
  return opts.containerTab !== undefined ? opts.containerTab === opts.routeName : opts.navigatorFocused;
}

/**
 * How long a tab keeps rendering after the rule above first says to freeze it.
 *
 * Blurring is not always the end of what the tab has to do. A sheet closes in
 * two commits (`SheetModal` holds the real `Modal` open one more), a blur
 * listener clears state the row then reacts to (an inline title edit saved and
 * the keyboard dismissed), and a screen that navigates away as it closes a sheet
 * does both in one tick. A freeze that landed in the same batch would strand
 * the second half until the tab came back. The wait is longer than iOS's
 * sheet dismissal, and thawing is never delayed: a tab being returned to
 * renders in the commit that focused it.
 */
export const TAB_FREEZE_DELAY_MS = 600;
