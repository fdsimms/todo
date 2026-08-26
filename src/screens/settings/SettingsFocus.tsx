import React, { createContext, useContext, useMemo, useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useColors } from '../../theme/ThemeContext';
import { animation } from '../../theme';

/**
 * How a row found by search gets itself on screen.
 *
 * Settings search used to rank a result and then navigate to the *group* it
 * lives in, dropping you at the top of a screen the row might be seven
 * screenfuls down. That was the half of the feature that was never built:
 * `searchSettings` has always known which row matched, and threw the answer
 * away at the last step.
 *
 * **Only the matched row measures.** The context carries one entry id, and a
 * row whose id isn't it does nothing at all — no ref, no layout callback, no
 * measurement. That is the reason this is a context rather than a registry
 * every row writes into on mount: a group holds forty rows and thirty-nine of
 * them have nothing to say.
 *
 * The measurement is `measureLayout` against the scroll content, the same
 * idiom (and for the same reason) as `ReorderableList.calibrateOverlayBase`:
 * `onLayout` reports a row's offset within its own card, and what a `scrollTo`
 * needs is its offset within the scroll content, which is three parents up.
 * `measureLayout` answers from the shadow tree in the layout tree's
 * coordinates, so `y` is directly a content-Y — see that function's own note.
 */

/** The subset of a host view's interface this needs. Both row branches expose it. */
export interface MeasurableRow {
  measureLayout?: (
    relativeTo: unknown,
    onSuccess: (x: number, y: number, width: number, height: number) => void,
    onFail?: () => void,
  ) => void;
}

interface SettingsFocusValue {
  /** The one row to scroll to and light up, or null for an ordinary visit. */
  focusedEntryId: string | null;
  /**
   * Called once by the focused row when its view is available. Passing null
   * (on unmount) is allowed and ignored.
   */
  reportRow: (entryId: string, node: MeasurableRow | null) => void;
}

const noop: SettingsFocusValue = { focusedEntryId: null, reportRow: () => {} };

const SettingsFocusContext = createContext<SettingsFocusValue>(noop);

export function SettingsFocusProvider({
  focusedEntryId, reportRow, children,
}: SettingsFocusValue & { children: React.ReactNode }) {
  // Memoized so the context value doesn't change identity on every render of
  // the group screen, which would re-render every row in it.
  const value = useMemo(
    () => ({ focusedEntryId, reportRow }),
    [focusedEntryId, reportRow]
  );
  return (
    <SettingsFocusContext.Provider value={value}>
      {children}
    </SettingsFocusContext.Provider>
  );
}

/**
 * Whether this row is the one search was looking for, and where to report to.
 *
 * `entryId` is optional throughout: a row with none — most of them — is never
 * focused and never reports, which is what keeps this free for the rows that
 * aren't involved.
 */
export function useSettingsRowFocus(entryId?: string): {
  focused: boolean;
  reportRow: (node: MeasurableRow | null) => void;
} {
  const { focusedEntryId, reportRow } = useContext(SettingsFocusContext);
  const focused = entryId !== undefined && entryId === focusedEntryId;
  return {
    focused,
    reportRow: (node: MeasurableRow | null) => {
      if (focused && entryId !== undefined) reportRow(entryId, node);
    },
  };
}

/**
 * How long a searched-for row stays fully lit before fading.
 *
 * Long enough to survive the scroll that brought it into view — the highlight
 * is what says "this one", and a fade that starts while the list is still
 * moving is a fade nobody sees.
 */
const FLASH_HOLD_MS = 1200;

/**
 * The whole of "this is the row you searched for": the ref to measure it by and
 * the tint that says so.
 *
 * Shared by `SettingsRow` and `SettingsSection` because a handful of settings
 * have no row to attach to — the theme and typeface pickers are a bare
 * segmented control under a section header — and landing at the top of the
 * group for those, having landed on the row for every other setting, is worse
 * than either behaviour applied consistently.
 */
export function useSettingsFocusFlash(entryId?: string): {
  focused: boolean;
  setFocusRef: (node: unknown) => void;
  highlight: Animated.AnimatedInterpolation<string>;
} {
  const colors = useColors();
  const { focused, reportRow } = useSettingsRowFocus(entryId);

  // Held at full tint long enough to be seen after the scroll settles, then
  // faded rather than switched off: a highlight that vanishes between frames
  // reads as a glitch, one that fades reads as an answer being handed over.
  // Driven on the JS thread because it animates backgroundColor, which is not
  // one of the properties the native driver can take.
  const flash = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!focused) return;
    flash.setValue(1);
    const timer = setTimeout(() => {
      Animated.timing(flash, {
        toValue: 0,
        duration: animation.duration.slow,
        useNativeDriver: false,
      }).start();
    }, FLASH_HOLD_MS);
    return () => clearTimeout(timer);
  }, [focused, flash]);

  const highlight = flash.interpolate({
    inputRange: [0, 1],
    outputRange: ['transparent', colors.accentSubtle],
  });

  return {
    focused,
    // `unknown` rather than the view type: `Animated.createAnimatedComponent`
    // widens its ref to a union React's own `Ref` helper can't narrow back, and
    // all this needs off the instance is `measureLayout`.
    setFocusRef: (node: unknown) => {
      if (focused) reportRow((node ?? null) as MeasurableRow | null);
    },
    highlight,
  };
}
