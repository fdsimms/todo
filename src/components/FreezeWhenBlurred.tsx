import React, { Activity, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useNavigationState, useRoute } from '@react-navigation/native';
import { useColors } from '../theme/ThemeContext';
import { font, radius, spacing } from '../theme';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { PresentationLevelContext, subscribePresentation } from '../utils/sheetModal';
import { isTabFocused, shouldFreezeTab, TAB_FREEZE_DELAY_MS } from '../utils/tabFreeze';
import { currentTabName, navigationRef } from '../navigation/navigationRef';

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
function subscribeContainerState(onChange: () => void): () => void {
  return navigationRef.addListener('state', onChange);
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
    const navigatorFocused = useNavigationState(state => state.routes[state.index]?.key === route.key);
    // The container's answer, which a jump from outside the tab bar can't leave
    // stale (see `isTabFocused`).
    const containerTab = useSyncExternalStore(subscribeContainerState, currentTabName);
    const focused = isTabFocused({ routeName: route.name, containerTab, navigatorFocused });
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
    // another tab switch, under both the Suspense freeze and this Activity one,
    // and a readout drawn inside the tab didn't show either. So each wrapper
    // reports what it last rendered to `tabDiag`, and `BlankTabDiagnostic`
    // draws it from the app root, outside every tab. Two boxes are measured:
    // `outer` is the wrapper's own container (outside the Activity), `inner`
    // the screen inside it. Remove all of it once the cause is known.
    const navigation = useNavigation();
    const [outer, setOuter] = useState('?');
    const [inner, setInner] = useState('?');
    const onOuterLayout = useCallback((e: LayoutChangeEvent) => setOuter(sizeOf(e)), []);
    const onInnerLayout = useCallback((e: LayoutChangeEvent) => setInner(sizeOf(e)), []);
    const modeSince = useRef({ mode, at: Date.now() });
    if (modeSince.current.mode !== mode) modeSince.current = { mode, at: Date.now() };
    const renders = useRef(0);
    renders.current += 1;
    useEffect(() => {
      reportTabDiag(route.name, {
        focused,
        navFocused: navigation.isFocused(),
        sheet: sheetPresented,
        want: wantFrozen,
        settled,
        mode,
        modeAt: modeSince.current.at,
        outer,
        inner,
        renders: renders.current,
        committedAt: Date.now(),
      });
    });
    useEffect(() => {
      tabDiagMounts.set(route.name, (tabDiagMounts.get(route.name) ?? 0) + 1);
      return () => {
        tabDiag.delete(route.name);
        notifyTabDiag();
      };
    }, [route.name]);

    return (
      <View style={diagStyles.box} collapsable={false} onLayout={onOuterLayout}>
        <Activity mode={mode}>
          <View style={diagStyles.box} collapsable={false} onLayout={onInnerLayout}>
            {screen}
          </View>
        </Activity>
      </View>
    );
  }
  FreezeWhenBlurred.displayName = `FreezeWhenBlurred(${Screen.displayName ?? Screen.name ?? 'Screen'})`;

  wrapped.set(Screen, FreezeWhenBlurred);
  return FreezeWhenBlurred;
}

// ==== TEMPORARY blank-tab diagnostic: the shared record and its readout ====

type TabDiagEntry = {
  focused: boolean;
  navFocused: boolean;
  sheet: boolean;
  want: boolean;
  settled: boolean;
  mode: string;
  modeAt: number;
  outer: string;
  inner: string;
  renders: number;
  committedAt: number;
};

const tabDiag = new Map<string, TabDiagEntry>();
const tabDiagMounts = new Map<string, number>();
const tabDiagListeners = new Set<() => void>();

// Off unless switched on in Settings › About. Device-local: the key is not on
// the sync allowlist, so turning it on for one phone doesn't turn it on for both.
const TAB_DIAG_KEY = 'tabDiagEnabled';
let tabDiagEnabled: boolean | null = null;

export function isTabDiagEnabled(): boolean {
  if (tabDiagEnabled === null) tabDiagEnabled = dbGetSetting(TAB_DIAG_KEY) === 'true';
  return tabDiagEnabled;
}

export function setTabDiagEnabled(on: boolean) {
  dbSetSetting(TAB_DIAG_KEY, on ? 'true' : 'false');
  tabDiagEnabled = on;
  notifyTabDiag();
}

/** Re-renders the caller whenever the record or the switch changes. */
export function useTabDiagEnabled(): boolean {
  const [, tick] = useState(0);
  useEffect(() => {
    const listener = () => tick(n => n + 1);
    tabDiagListeners.add(listener);
    return () => {
      tabDiagListeners.delete(listener);
    };
  }, []);
  return isTabDiagEnabled();
}

function notifyTabDiag() {
  tabDiagListeners.forEach(l => l());
}

function reportTabDiag(name: string, entry: TabDiagEntry) {
  tabDiag.set(name, entry);
  notifyTabDiag();
}

function sizeOf(e: LayoutChangeEvent): string {
  const { width, height } = e.nativeEvent.layout;
  return `${Math.round(width)}x${Math.round(height)}`;
}

const flag = (b: boolean) => (b ? 1 : 0);
const ago = (at: number) => `${Math.round((Date.now() - at) / 1000)}s`;

/**
 * TEMPORARY. Draws the focused tab's last report from the app root, outside
 * every tab, so it shows even when the tab itself draws nothing. `tab` is the
 * tab navigator's focused route read off the navigation ref, independent of
 * what the wrapper thinks.
 */
export function BlankTabDiagnostic({ currentTab }: { currentTab: () => string | undefined }) {
  const enabled = useTabDiagEnabled();
  if (!enabled) return null;
  return <BlankTabReadout currentTab={currentTab} />;
}

function BlankTabReadout({ currentTab }: { currentTab: () => string | undefined }) {
  const colors = useColors();
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const tab = currentTab();
  const entry = tab ? tabDiag.get(tab) : undefined;
  const others = [...tabDiag.entries()]
    .filter(([name, e]) => name !== tab && (e.focused || e.mode === 'visible'))
    .map(([name, e]) => `${name}(f=${flag(e.focused)} ${e.mode})`)
    .join(' ');
  const text = !tab
    ? 'tab=?'
    : !entry
      ? `tab=${tab} NO REPORT mounts=${tabDiagMounts.get(tab) ?? 0}`
      : `tab=${tab} focused=${flag(entry.focused)} nav=${flag(entry.navFocused)} sheet=${flag(entry.sheet)} ` +
        `want=${flag(entry.want)} settled=${flag(entry.settled)} mode=${entry.mode} ${ago(entry.modeAt)} ` +
        `outer=${entry.outer} inner=${entry.inner} renders=${entry.renders} ` +
        `mounts=${tabDiagMounts.get(tab) ?? 0} commit=${ago(entry.committedAt)}` +
        (others ? ` | also ${others}` : '');
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
