import React, { Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigationState, useRoute } from '@react-navigation/native';
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
 * It is `react-freeze`'s mechanism written out (a Suspense boundary whose child
 * throws a thenable that never resolves). React hides a suspended subtree
 * rather than unmounting it, so state and refs survive, store updates are
 * applied when it unfreezes, and nothing renders in between. Layout effects
 * clean up on freeze and run again on unfreeze.
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
const never = { then() {} };

function Hold({ frozen, children }: { frozen: boolean; children: React.ReactNode }) {
  if (frozen) throw never;
  return <>{children}</>;
}

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
    // A thaw is one render that has to un-suspend a boundary whose child threw a
    // thenable that never resolves. When that render lands in the same batch as
    // the navigation that focused the tab (a widget or link tap), the reveal can
    // be missed and the focused tab stays blank until another tab switch. Once the
    // thaw has committed, render the boundary once more so React retries it.
    const [, setThawNonce] = useState(0);
    const wasFrozen = useRef(false);
    useEffect(() => {
      const frozenNow = wantFrozen && settled;
      if (wasFrozen.current && !frozenNow) setThawNonce(n => n + 1);
      wasFrozen.current = frozenNow;
    }, [wantFrozen, settled]);
    // The same element while the props are, so this wrapper re-rendering on a
    // sheet opening somewhere does not re-render the screen inside it.
    const screen = useMemo(() => <Screen {...props} />, [props]);
    return (
      <Suspense fallback={null}>
        <Hold frozen={wantFrozen && settled}>{screen}</Hold>
      </Suspense>
    );
  }
  FreezeWhenBlurred.displayName = `FreezeWhenBlurred(${Screen.displayName ?? Screen.name ?? 'Screen'})`;

  wrapped.set(Screen, FreezeWhenBlurred);
  return FreezeWhenBlurred;
}
