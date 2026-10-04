import React, { createContext, useCallback, useContext, useMemo, useEffect, useRef } from 'react';
import { Animated, type ScrollView, type View } from 'react-native';
import { settingsFocusScrollTarget } from '../../utils/settingsFocusScroll';
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

/** The raw focus context, for a section that has to decide what to mount from it. */
export function useSettingsFocus(): SettingsFocusValue {
  return useContext(SettingsFocusContext);
}

/**
 * The scrolling half of "search takes you to the row", for a screen that hosts
 * settings rows: refs for the scroll view and its content, the layout callbacks
 * the clamp needs, and the `reportRow` to hand `SettingsFocusProvider`.
 *
 * Shared by `SettingsGroupScreen` and `AutomationsScreen`, which host the same
 * kind of rows and are both opened onto one of them by a search.
 *
 * `focusKey` re-arms the one-shot scroll. A pushed group screen is mounted
 * fresh for every search and never needs it; a tab screen stays mounted, so a
 * second search has to say it is a new request.
 */
export function useSettingsFocusScroll(focusKey?: unknown) {
  const scrollRef = useRef<ScrollView>(null);
  // measureLayout needs an ancestor to measure against, and the ScrollView's
  // own ref is the wrong one — it measures the viewport, not the content. This
  // wraps the content so a row's `y` comes back as a content-Y, which is the
  // coordinate scrollTo speaks.
  const contentRef = useRef<View>(null);
  const contentHeight = useRef<number | undefined>(undefined);
  const viewportHeight = useRef<number | undefined>(undefined);
  const scrolledRef = useRef(false);
  const lastKey = useRef(focusKey);
  if (lastKey.current !== focusKey) {
    lastKey.current = focusKey;
    scrolledRef.current = false;
  }

  const reportRow = useCallback((_id: string, node: MeasurableRow | null) => {
    // Once only: a row that re-lays out (its pills unfolding, a hint appearing)
    // would otherwise drag the list back under a finger that had moved on.
    if (!node || scrolledRef.current || typeof node.measureLayout !== 'function') return;
    const container = contentRef.current;
    if (!container) return;
    scrolledRef.current = true;
    try {
      node.measureLayout(
        container,
        (_x, y) => {
          scrollRef.current?.scrollTo({
            y: settingsFocusScrollTarget(y, contentHeight.current, viewportHeight.current),
            animated: true,
          });
        },
        // A row that can't be measured keeps its highlight and simply doesn't
        // scroll, which is the behaviour this whole feature replaces rather
        // than a new failure.
        () => {},
      );
    } catch {
      // Same: measuring is the optimisation, the highlight is the answer.
    }
  }, []);

  const scrollProps = useMemo(() => ({
    onLayout: (e: { nativeEvent: { layout: { height: number } } }) => {
      viewportHeight.current = e.nativeEvent.layout.height;
    },
    onContentSizeChange: (_w: number, h: number) => { contentHeight.current = h; },
  }), []);

  return { scrollRef, contentRef, reportRow, scrollProps };
}
