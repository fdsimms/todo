import React, { Activity, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useNavigationState, useRoute } from '@react-navigation/native';
import { useColors } from '../theme/ThemeContext';
import { font, radius, spacing } from '../theme';
import { PresentationLevelContext, subscribePresentation } from '../utils/sheetModal';
import { shouldFreezeTab, TAB_FREEZE_DELAY_MS } from '../utils/tabFreeze';

/**
 * Stops a blurred tab from rendering, which `freezeOnBlur` cannot do here.
 *
 * `enableScreens(false)` (App.tsx, a workaround for an iOS 26 crash) sends
 * `@react-navigation/bottom-tabs` down its plain-View branch, which forwards
 * nothing to react-native-screens. Every tab the user has visited therefore
 * stayed mounted and re-rendered on each store write: completing a task on
 * Today re-rendered Stats, Projects, Calendar, Search and the rest, none of
 * them on screen. Turning native screens back on is not the fix, because it
 * makes each tab a view controller and sheets would present from it rather
 * than from the root (docs/arch/app-lock.md, `sheetModal.ts`). This is the
 * JS half of what `freezeOnBlur` does, with no native change.
 *
 * It hides the tab in React's `<Activity mode="hidden">`. A hidden subtree is
 * not unmounted, so state and refs survive, but its effects are torn down
 * (which also drops its store subscriptions) and nothing re-renders it until
 * it is shown again, when it catches up on whatever changed. This replaced a
 * `react-freeze` style Suspense boundary whose child threw a thenable that
 * never resolves: that one could fail to reveal when the thaw landed in the
 * same batch as the navigation that focused the tab (a widget or link tap),
 * leaving the focused tab blank until another tab switch. A retry nudge after
 * the thaw did not cure it. Showing an Activity is an ordinary update with no
 * suspended state to get stuck in.
 *
 * The rule for when to freeze is `shouldFreezeTab`, and how long it waits is
 * `TAB_FREEZE_DELAY_MS`.
 *
 * **A frozen tab runs no effects**, so work the app needs while another tab is
 * focused cannot live in a screen. Everything audited when this was added
 * already sits in an app-level hook, or is reached by a navigation that focuses
 * the screen first (every widget, deep-link and notification handoff ends in a
 * `resetTo*`). The one that did not was the focus session's reconcile, now
 * `useFocusPlanReconcile` in App.tsx.
 */
// One wrapper per screen for the life of the app. The navigator takes a screen's
// identity as its component, so a wrapper built on each render would remount it.
const wrapped = new WeakMap<React.ComponentType<any>, React.ComponentType<any>>();

/** Wraps a tab screen so it stops rendering while another tab is focused. */
export function freezeWhenBlurred<P extends object>(Screen: React.ComponentType<P>): React.ComponentType<P> {
  const existing = wrapped.get(Screen);
  if (existing) return existing as React.ComponentType<P>;

  function FreezeWhenBlurred(props: P) {
    const route = useRoute();
    // The tab navigator's own state, not `useIsFocused`: that one is false for
    // a tab while a detail screen is pushed over it, and the native push needs
    // the tab underneath to stay drawn.
    const focused = useNavigationState(state => state.routes[state.index]?.key === route.key);
    const level = useContext(PresentationLevelContext);
    const sheetPresented = useSyncExternalStore(
      useCallback((onChange: () => void) => subscribePresentation(level, onChange), [level]),
      () => level.presented.size > 0,
    );
    const wantFrozen = shouldFreezeTab({ focused, sheetPresented });
    // Freezing waits out `TAB_FREEZE_DELAY_MS`; thawing does not, because
    // `wantFrozen && settled` is false in the very render that focused the tab.
    const [settled, setSettled] = useState(false);
    useEffect(() => {
      if (!wantFrozen) {
        setSettled(false);
        return;
      }
      const timer = setTimeout(() => setSettled(true), TAB_FREEZE_DELAY_MS);
      return () => clearTimeout(timer);
    }, [wantFrozen]);
    // The same element while the props are, so this wrapper re-rendering on a
    // sheet opening somewhere does not re-render the screen inside it.
    const screen = useMemo(() => <Screen {...props} />, [props]);
    const mode = wantFrozen && settled ? 'hidden' : 'visible';

    // ==== TEMPORARY blank-tab diagnostic ====
    // A focused tab sometimes comes up blank (only the tab bar drawn) until
    // another tab switch, under both the Suspense freeze and this Activity one.
    // This readout sits outside the Activity, so it still draws when the screen
    // inside doesn't, and a screenshot of a blank tab says which half failed:
    // the freeze's own inputs (focused/mode) or the native reveal (the box
    // inside the Activity still measuring 0x0 while mode is visible). Remove it,
    // and the box, once the cause is known.
    const navigation = useNavigation();
    const [box, setBox] = useState({ w: -1, h: -1, n: 0 });
    const onBoxLayout = useCallback((e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      setBox(b => ({ w: Math.round(width), h: Math.round(height), n: b.n + 1 }));
    }, []);
    const modeSince = useRef({ mode, at: Date.now() });
    if (modeSince.current.mode !== mode) modeSince.current = { mode, at: Date.now() };
    const [, tick] = useState(0);
    useEffect(() => {
      if (!focused) return;
      const timer = setInterval(() => tick(n => n + 1), 1000);
      return () => clearInterval(timer);
    }, [focused]);

    return (
      <>
        <Activity mode={mode}>
          <View style={diagStyles.box} collapsable={false} onLayout={onBoxLayout}>
            {screen}
          </View>
        </Activity>
        {focused && (
          <BlankTabReadout
            text={
              `${route.name} focused=${focused ? 1 : 0} navFocused=${navigation.isFocused() ? 1 : 0} ` +
              `sheet=${sheetPresented ? 1 : 0} want=${wantFrozen ? 1 : 0} settled=${settled ? 1 : 0} ` +
              `mode=${mode} ${Math.round((Date.now() - modeSince.current.at) / 1000)}s ` +
              `box=${box.w}x${box.h} #${box.n}`
            }
          />
        )}
      </>
    );
  }
  FreezeWhenBlurred.displayName = `FreezeWhenBlurred(${Screen.displayName ?? Screen.name ?? 'Screen'})`;

  wrapped.set(Screen, FreezeWhenBlurred);
  return FreezeWhenBlurred;
}

// TEMPORARY: part of the blank-tab diagnostic above.
function BlankTabReadout({ text }: { text: string }) {
  const colors = useColors();
  return (
    <View pointerEvents="none" style={diagStyles.readoutWrap}>
      <Text style={[diagStyles.readout, { color: colors.textSecondary, backgroundColor: colors.bgSecondary }]}>
        {text}
      </Text>
    </View>
  );
}

const diagStyles = StyleSheet.create({
  box: { flex: 1 },
  readoutWrap: { position: 'absolute', top: '45%', left: spacing.md, right: spacing.md, alignItems: 'center' },
  readout: {
    fontSize: font.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    overflow: 'hidden',
    opacity: 0.85,
  },
});
