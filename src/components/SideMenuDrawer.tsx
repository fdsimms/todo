import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SheetModal } from './SheetModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeBlurView } from './SafeBlurView';
import { ScrollEdgeFade } from './ScrollEdgeFade';
import { SearchField } from './SearchField';
import { SheetScrim } from './SheetScrim';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { animation, font, fontWeight, iconSize, interaction, radius, spacing } from '../theme';
import { useScrollEdgeFade } from '../hooks/useScrollEdgeFade';
import { haptics } from '../utils/haptics';
import { useReduceMotion } from '../utils/useReduceMotion';
import { listRemainingCount } from '../utils/groceryLists';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  hubEntryRoute, hubSubtitle, menuDestinations, menuSearchTerms, recentMenuDestinations, searchMenu,
  visibleMenuRows, type NavDestination, type NavHub, type NavMenuRow, type NavSearchResult,
} from '../utils/navHubs';
import { currentTabName } from '../navigation/navigationRef';
import { tipsFor } from '../utils/tips';
import { useFilterField } from '../hooks/useFilterField';
import { useNavMenuOptions } from '../hooks/useNavMenuOptions';

// 85% rather than the 72% this used to be. The drawer is the only thing on
// screen while it's open — everything behind it is blurred and dimmed and
// exists to be tapped through — so the strip it left showing was 28% of the
// display doing no work, and it was the same 28% a hub row's subtitle needed
// to name what it holds without truncating.
const DRAWER_WIDTH = Math.round(Dimensions.get('window').width * 0.85);

interface Props {
  visible: boolean;
  onClose: () => void;
  onNavigate: (tabName: string) => void;
  onOpenSettings: () => void;
  activeTab: string;
}

/**
 * The side menu.
 *
 * It held eighteen flat rows, which is about twice what a phone fits, so half
 * of it lived under a fold nothing announced and the fix for that was a
 * scroll-edge fade and a flashed scrollbar — both of which say "there is more"
 * without making any of it easier to reach. Eleven rows fit, and three of them
 * are hubs standing in for sixteen destinations. What goes where, and why,
 * is `navHubs.ts`; this file is the drawing.
 *
 * Two things carry the weight of the collapse:
 *
 * - **A hub row names its members underneath it, as chips.** "Organize" on
 *   its own is a guess; "Categories, Tags, People, Stacks, Templates" is an
 *   answer, and each name is also the way to that screen (see HubRow). It
 *   stays honest under simplified mode because the chips are built from the
 *   members that survived rather than written out.
 * - **The find field reaches the members directly.** A hub hides four or five
 *   destinations behind one label, so without this, consolidating the menu
 *   would have made "Drift" strictly harder to find than it was as a row.
 *   Typing filters to real destinations and a tap goes straight there, past
 *   the hub. Same call `settingsIndex.ts` makes for the same reason.
 */
export function SideMenuDrawer({ visible, onClose, onNavigate, onOpenSettings, activeTab }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isDark, shadows } = useTheme();
  // A scalar, so it's referentially stable and needs no useShallow. Counts
  // what's still to buy — items already in the trolley aren't a reason to go.
  const groceryCount = useGroceryStore(s => listRemainingCount(s.listEntries, s.activeListId));
  // A scalar for the same reason groceryCount is one. TIPS is a module-level
  // constant, so the only thing that can move this is a dismissal.
  // Counted over `tipsFor`, not `TIPS`: the badge has to agree with the list
  // behind it, and simplified mode can take thirty tips out of that list.
  const unreadTipCount = useSettingsStore(s =>
    tipsFor(s.simpleMode).filter(tip => !s.seenTips.includes(tip.id)).length);

  // Its own array until a visit changes it, so it needs no useShallow.
  const recentScreens = useSettingsStore(s => s.recentScreens);

  // The screen actually on show, read as the drawer opens. `activeTab` alone
  // isn't it: a hub's own pill row and a link both switch screens without
  // going through the menu, and the highlight (and now the lit chip) would
  // stay on wherever the menu last sent you.
  const currentRoute = useMemo(
    () => (visible ? currentTabName() ?? activeTab : activeTab),
    [visible, activeTab],
  );

  const searchFilter = useFilterField();
  const query = searchFilter.query;
  // Shared with the pull-down quick search, which searches the same screens.
  const menuOptions = useNavMenuOptions();
  const menuRows = useMemo(() => visibleMenuRows(menuOptions), [menuOptions]);
  const recentDestinations = useMemo(
    () => recentMenuDestinations(recentScreens, menuOptions, currentRoute),
    [recentScreens, menuOptions, currentRoute],
  );
  const terms = useMemo(() => menuSearchTerms(query), [query]);
  const results = useMemo(
    () => (terms.length === 0 ? [] : searchMenu(menuDestinations(menuOptions), terms)),
    [menuOptions, terms],
  );
  const searching = terms.length > 0;

  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const dragOffsetX = useRef(new Animated.Value(0)).current;
  const [isRendered, setIsRendered] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);
  // Eleven rows and a footer fit on every phone this runs on, so the fade and
  // the flashed scrollbar are no longer load-bearing — they stay because the
  // *search results* can be longer than the list they replace, and because a
  // large accessibility text size can push even eleven rows past the fold.
  const listRef = useRef<ScrollView>(null);
  const fade = useScrollEdgeFade();
  // Settings navigates to a whole new screen, so the drawer's own close
  // animation is invisible to the user anyway — closing it with a quick
  // timing (instead of the spring used for a plain swipe/backdrop close)
  // gets the Settings push started sooner without reintroducing the
  // two-Modal-at-once glitch the deferred navigate below guards against.
  const fastCloseRef = useRef(false);

  const swipePanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, gs) =>
        Math.abs(gs.dx) > 8 && Math.abs(gs.dx) > Math.abs(gs.dy) && gs.dx < 0,
      onPanResponderMove: (_e, gs) => {
        if (gs.dx < 0) dragOffsetX.setValue(gs.dx);
      },
      onPanResponderRelease: (_e, gs) => {
        if (gs.dx < -DRAWER_WIDTH * 0.3 || gs.vx < -0.5) {
          Animated.timing(dragOffsetX, { toValue: 0, duration: 0, useNativeDriver: true }).start();
          onClose();
        } else {
          Animated.spring(dragOffsetX, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragOffsetX, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }).start();
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      fastCloseRef.current = false;
      setIsRendered(true);
      // A query handed back on the next open is a filtered menu with no visible
      // reason why — the same rule the task editor's field search follows.
      searchFilter.clear();
      // After the slide-in, not during it: the indicator is drawn against the
      // drawer's own right edge, which is still crossing the screen.
      const flash = setTimeout(() => listRef.current?.flashScrollIndicators(), 260);
      Animated.parallel([
        Animated.spring(translateX, {
          toValue: 0,
          ...animation.spring.smooth,
          useNativeDriver: true,
        }),
        // `sheetBackdropOut`'s value, not `sheetBackdropIn`'s: a drawer
        // sliding in reads faster than a bottom sheet rising, so it opens at
        // the same pace the other sheets close at instead of their slower one.
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: animation.duration.sheetBackdropOut,
          useNativeDriver: true,
        }),
      ]).start();
      // Cleared by this effect's own teardown, which is also what cancels a
      // flash still pending when the drawer is closed straight back out.
      return () => clearTimeout(flash);
    } else {
      const closeAnimations = fastCloseRef.current
        ? [
            Animated.timing(translateX, {
              toValue: -DRAWER_WIDTH,
              duration: animation.duration.fast,
              useNativeDriver: true,
            }),
            Animated.timing(backdropOpacity, {
              toValue: 0,
              duration: animation.duration.fast,
              useNativeDriver: true,
            }),
          ]
        : [
            Animated.spring(translateX, {
              toValue: -DRAWER_WIDTH,
              ...animation.spring.snappy,
              useNativeDriver: true,
            }),
            Animated.timing(backdropOpacity, {
              toValue: 0,
              duration: animation.duration.sheetBackdropOut,
              useNativeDriver: true,
            }),
          ];
      Animated.parallel(closeAnimations).start(() => {
        setIsRendered(false);
        // Let the native Modal fully unmount before presenting another one —
        // two RN Modals visible at once on iOS can leave touches inert.
        pendingActionRef.current?.();
        pendingActionRef.current = null;
      });
    }
  }, [visible]);

  const handleNavigate = (tabName: string) => {
    haptics.tap();
    onClose();
    onNavigate(tabName);
  };

  const handleSettings = () => {
    haptics.tap();
    fastCloseRef.current = true;
    pendingActionRef.current = onOpenSettings;
    onClose();
  };

  /** A row is lit for its own screen, and a hub row for any screen inside it. */
  const isRowActive = (row: NavMenuRow) =>
    row.kind === 'screen'
      ? currentRoute === row.destination.route
      : row.hub.members.some(m => m.route === currentRoute);

  // A hub's counts ride on its chips (see MenuChip), so only a plain row has one here.
  const badgeFor = (row: NavMenuRow): number =>
    row.kind === 'screen' && row.destination.route === 'Tips' ? unreadTipCount : 0;

  if (!isRendered) return null;

  return (
    <SheetModal
      visible={isRendered}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={StyleSheet.absoluteFill}>
        {/* Blur + dim backdrop */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}
          pointerEvents="none"
        >
          <SafeBlurView
            intensity={isDark ? 25 : 20}
            tint="dark"
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }]} />
        </Animated.View>
        <SheetScrim onPress={onClose} label="Close the menu" />

        <Animated.View
          style={[
            styles.drawer,
            shadows.drawer,
            {
              width: DRAWER_WIDTH,
              borderRightColor: colors.separator,
              transform: [{ translateX: Animated.add(translateX, dragOffsetX) }],
            },
          ]}
          {...swipePanResponder.panHandlers}
        >
          {/* Frosted glass drawer background */}
          <SafeBlurView
            intensity={isDark ? 70 : 80}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.blurFallback }]} />

          <View style={[styles.header, { borderBottomColor: colors.separator }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Menu</Text>
            <SearchField
              field={searchFilter}
              placeholder="Find a screen"
              style={styles.search}
              accessibilityLabel="Find a screen"
            />
          </View>

          <View style={styles.itemsWrap}>
          <ScrollView
            ref={listRef}
            style={styles.items}
            contentContainerStyle={styles.itemsContent}
            keyboardShouldPersistTaps="handled"
            {...fade.scrollProps}
          >
            {searching
              ? results.map((result, index) => (
                  <DrawerItemAppear key={`r:${result.route}`} index={index}>
                    <ResultRow
                      result={result}
                      active={currentRoute === result.route}
                      colors={colors}
                      onPress={() => handleNavigate(result.route)}
                    />
                  </DrawerItemAppear>
                ))
              : (
                <>
                  {/* Where you were a moment ago, a tap away rather than a
                      hub and a pill away. Leaves out the screen you're on and
                      the tab bar's own screens (see recentMenuDestinations). */}
                  {recentDestinations.length > 0 && (
                    <DrawerItemAppear index={0}>
                      <View style={styles.recent}>
                        <Text style={[styles.recentLabel, { color: colors.textSecondary }]}>Recent</Text>
                        <View style={styles.chips}>
                          {recentDestinations.map(destination => (
                            <MenuChip
                              key={destination.route}
                              destination={destination}
                              active={false}
                              size="recent"
                              colors={colors}
                              onPress={() => handleNavigate(destination.route)}
                            />
                          ))}
                        </View>
                      </View>
                    </DrawerItemAppear>
                  )}
                  {menuRows.map((row, index) => {
                    const isActive = isRowActive(row);
                    if (row.kind === 'hub') {
                      return (
                        <DrawerItemAppear key={row.hub.label} index={index + 1}>
                          <HubRow
                            hub={row.hub}
                            active={isActive}
                            currentRoute={currentRoute}
                            recentScreens={recentScreens}
                            groceryCount={groceryCount}
                            colors={colors}
                            onNavigate={handleNavigate}
                          />
                        </DrawerItemAppear>
                      );
                    }
                    const badge = badgeFor(row);
                    const { label, icon, route } = row.destination;
                    return (
                      <DrawerItemAppear key={label} index={index + 1}>
                        <TouchableOpacity
                          style={[
                            styles.item,
                            isActive && { backgroundColor: colors.accent + '18' },
                          ]}
                          onPress={() => handleNavigate(route)}
                          activeOpacity={interaction.activeOpacity}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isActive }}
                          accessibilityLabel={label}
                        >
                          <View
                            style={[
                              styles.iconWrap,
                              { backgroundColor: isActive ? colors.accent + '22' : colors.bgTertiary },
                            ]}
                          >
                            <Ionicons
                              name={icon as React.ComponentProps<typeof Ionicons>['name']}
                              size={20}
                              color={isActive ? colors.accent : colors.textSecondary}
                            />
                          </View>
                          <View style={styles.itemBody}>
                            <Text
                              style={[
                                styles.itemLabel,
                                { color: isActive ? colors.accent : colors.text },
                              ]}
                            >
                              {label}
                            </Text>
                          </View>
                          {badge > 0 && (
                            <View style={[styles.badge, { backgroundColor: colors.accentSubtle }]}>
                              <Text style={[styles.badgeText, { color: colors.accent }]}>{badge}</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      </DrawerItemAppear>
                    );
                  })}
                </>
              )}
            {searching && results.length === 0 && (
              <Text style={[styles.noResults, { color: colors.textSecondary }]}>
                No screen matches that.
              </Text>
            )}
          </ScrollView>
          {/* Fades into the drawer's own frosted surface rather than to an
              opaque strip: `blurFallback` is `bgSecondary` at 85%, so the band
              stops just short of solid and the blur still reads through it. */}
          <ScrollEdgeFade
            edge="bottom"
            opacity={fade.bottomOpacity}
            color={colors.bgSecondary}
            maxOpacity={0.92}
          />
          </View>

          <View style={[styles.footer, { borderTopColor: colors.separator, paddingBottom: spacing.md + insets.bottom }]}>
            <DrawerItemAppear index={menuRows.length}>
              <TouchableOpacity
                style={styles.item}
                onPress={handleSettings}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Settings"
              >
                <View style={[styles.iconWrap, { backgroundColor: colors.bgTertiary }]}>
                  <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />
                </View>
                <Text style={[styles.itemLabel, { color: colors.text }]}>Settings</Text>
              </TouchableOpacity>
            </DrawerItemAppear>
          </View>
        </Animated.View>
      </View>
    </SheetModal>
  );
}

/**
 * A search hit. It names the hub it lives in rather than the hub row's icon,
 * because the useful thing to know about a result is where it will put you —
 * and the hub is also the answer to "why did this match", when the match came
 * off a keyword rather than the label.
 */
function ResultRow({
  result, active, colors, onPress,
}: {
  result: NavSearchResult;
  active: boolean;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.item, active && { backgroundColor: colors.accent + '18' }]}
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={result.hubLabel ? `${result.label}, in ${result.hubLabel}` : result.label}
    >
      <View style={[styles.iconWrap, { backgroundColor: active ? colors.accent + '22' : colors.bgTertiary }]}>
        <Ionicons
          name="arrow-forward"
          size={18}
          color={active ? colors.accent : colors.textSecondary}
        />
      </View>
      <View style={styles.itemBody}>
        <Text style={[styles.itemLabel, { color: active ? colors.accent : colors.text }]}>
          {result.label}
        </Text>
        {result.hubLabel && (
          <Text style={[styles.itemSubtitle, { color: colors.textSecondary }]}>
            in {result.hubLabel}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

/**
 * One screen inside a hub, or one recent screen: a small pill that goes
 * straight there. The current screen's is lit the way the row itself is.
 *
 * `count` is the badge a screen carries (what's left to buy, on Groceries).
 * It sits on the chip rather than at the row's end, because a hub row is now
 * several destinations and the count belongs to one of them.
 */
function MenuChip({
  destination, active, count, size, colors, onPress,
}: {
  destination: NavDestination;
  active: boolean;
  count?: number;
  size: 'hub' | 'recent';
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  const tint = active ? colors.accent : size === 'recent' ? colors.text : colors.textSecondary;
  return (
    <TouchableOpacity
      style={[
        styles.chip,
        size === 'recent' && styles.chipRecent,
        { backgroundColor: active ? colors.accentSubtle : colors.bgTertiary },
      ]}
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={count ? `${destination.label}, ${count}` : destination.label}
    >
      <Ionicons
        name={destination.icon as React.ComponentProps<typeof Ionicons>['name']}
        size={size === 'recent' ? 13 : 12}
        color={active ? colors.accent : colors.textSecondary}
      />
      <Text
        style={[
          styles.chipText,
          size === 'recent' && styles.chipTextRecent,
          { color: tint },
          active && styles.chipTextActive,
        ]}
      >
        {destination.label}
      </Text>
      {count !== undefined && count > 0 && (
        <View style={[styles.chipCount, { backgroundColor: colors.accentSubtle }]}>
          <Text style={[styles.chipCountText, { color: colors.accent }]}>{count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

/**
 * A hub row: its name, and every screen it holds as a chip underneath.
 *
 * The chips used to be a line of text naming the members, which answered
 * "what's in Organize" and then made you tap the row, land on its first
 * screen, and tap a pill to get to the one you meant. Each name is now the
 * way there. The name itself opens the screen you used last in the hub
 * (`hubEntryRoute`), so a hub you always use for one screen opens on it.
 *
 * Not one touchable wrapping the chips: a TouchableOpacity is `accessible` by
 * default, which would fold every chip into the row's single element and hide
 * them from VoiceOver. The icon and the name are their own touchables instead.
 */
function HubRow({
  hub, active, currentRoute, recentScreens, groceryCount, colors, onNavigate,
}: {
  hub: NavHub;
  active: boolean;
  currentRoute: string | null;
  recentScreens: readonly string[];
  groceryCount: number;
  colors: ReturnType<typeof useColors>;
  onNavigate: (route: string) => void;
}) {
  const entry = hubEntryRoute(hub, recentScreens);
  const entryLabel = hub.members.find(m => m.route === entry)?.label ?? hub.label;
  return (
    <View style={[styles.item, active && { backgroundColor: colors.accent + '18' }]}>
      <TouchableOpacity
        onPress={() => onNavigate(entry)}
        activeOpacity={interaction.activeOpacity}
        accessible={false}
        importantForAccessibility="no"
      >
        <View style={[styles.iconWrap, { backgroundColor: active ? colors.accent + '22' : colors.bgTertiary }]}>
          <Ionicons
            name={hub.icon as React.ComponentProps<typeof Ionicons>['name']}
            size={20}
            color={active ? colors.accent : colors.textSecondary}
          />
        </View>
      </TouchableOpacity>
      <View style={styles.itemBody}>
        <TouchableOpacity
          onPress={() => onNavigate(entry)}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          accessibilityLabel={`${hub.label}. Holds ${hubSubtitle(hub)}`}
          accessibilityHint={`Opens ${entryLabel}`}
        >
          <Text style={[styles.itemLabel, { color: active ? colors.accent : colors.text }]}>{hub.label}</Text>
        </TouchableOpacity>
        <View style={styles.chips}>
          {hub.members.map(member => (
            <MenuChip
              key={member.route}
              destination={member}
              active={member.route === currentRoute}
              count={member.route === 'Groceries' ? groceryCount : undefined}
              size="hub"
              colors={colors}
              onPress={() => onNavigate(member.route)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

// Menu rows cascade in as the drawer opens: each fades and slides from the
// left with a small per-row delay. The drawer unmounts when closed, so the
// mount animation replays on every open.
function DrawerItemAppear({ index, children }: { index: number; children: React.ReactNode }) {
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Reduce Motion: skip the staggered slide-in.
    if (reduceMotion) {
      anim.setValue(1);
      return;
    }
    Animated.timing(anim, {
      toValue: 1,
      duration: animation.duration.normal,
      delay: 60 + index * 35,
      useNativeDriver: true,
    }).start();
  }, [anim, index, reduceMotion]);
  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  drawer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  header: {
    paddingTop: 64,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: font.xxl,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.5,
  },
  search: {
    marginTop: spacing.sm,
  },
  itemsWrap: {
    flex: 1,
  },
  items: {
    flex: 1,
  },
  itemsContent: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  footer: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 11,
    marginVertical: spacing.xxs,
    borderRadius: radius.md,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemBody: { flex: 1, minWidth: 0 },
  itemLabel: {
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  itemSubtitle: {
    fontSize: font.xs,
    lineHeight: 16,
    marginTop: spacing.xxs,
  },
  badge: {
    minWidth: 22,
    paddingHorizontal: spacing.xsm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  // A hub's screens, and the Recent row's, as pills that wrap. `font.xs` with
  // a 4pt pad keeps a hub's chips to two lines in the drawer's width.
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xsm,
    marginTop: spacing.xsm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
  },
  chipRecent: {
    paddingVertical: spacing.xsm,
    paddingHorizontal: 10,
  },
  chipText: {
    fontSize: font.xs,
  },
  chipTextRecent: {
    fontSize: font.sm,
  },
  chipTextActive: {
    fontWeight: fontWeight.semibold,
  },
  chipCount: {
    minWidth: 18,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  chipCountText: {
    fontSize: font.xxs,
    fontWeight: fontWeight.semibold,
  },
  recent: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.smd,
  },
  recentLabel: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  noResults: {
    fontSize: font.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
});
