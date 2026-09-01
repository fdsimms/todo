import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeBlurView } from './SafeBlurView';
import { ScrollEdgeFade } from './ScrollEdgeFade';
import { SheetScrim } from './SheetScrim';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { animation, font, fontWeight, interaction, radius, spacing } from '../theme';
import { useScrollEdgeFade } from '../hooks/useScrollEdgeFade';
import { haptics } from '../utils/haptics';
import { useReduceMotion } from '../utils/useReduceMotion';
import { listRemainingCount } from '../utils/groceryLists';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { usePersonStore } from '../store/usePersonStore';
import { screenShown } from '../utils/simpleMode';
import { tipsFor } from '../utils/tips';

const DRAWER_WIDTH = Math.round(Dimensions.get('window').width * 0.72);

interface MenuItem {
  name: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  /** Other tab names this row should also read as "active" for — the
   *  Groceries/Recipes/Meal plan/Kitchen quartet now shares one row and a
   *  `GroceriesHubPills` switcher inside each screen, so the row must stay
   *  highlighted across all four. */
  alsoActiveFor?: string[];
}

// Groceries, Recipes, Meal plan and Kitchen share one row: four screens
// tightly coupled around a single kitchen workflow, switched via the pill row
// each of them renders under its header (`GroceriesHubPills`) rather than
// four separate drawer taps. The row always opens Groceries; the pills handle
// getting to the other three once you're in.
const GROCERIES_HUB_TABS = ['Groceries', 'Recipes', 'MealPlan', 'Kitchen'];

interface MenuItemWithGate extends MenuItem {
  /** Dropped from the menu while `kitchenEnabled` is off. */
  kitchen?: boolean;
}

/**
 * Which rows simplified mode drops is decided by `screenShown` rather than a
 * flag here, because two of them are conditional: Stacks and Templates hold
 * objects reachable from nowhere else, so they stay for as long as they hold
 * any. See `src/utils/simpleMode.ts`.
 */

const MENU_ITEMS: MenuItemWithGate[] = [
  { name: 'Today', icon: 'checkbox-outline', label: 'Tasks' },
  // Search moved out of the bottom tab bar to make room for Groceries there.
  // It keeps its pull-to-refresh gesture on Today/Later/Unscheduled/Inbox
  // (opens QuickSearchModal) — this row is the way to the full Search screen.
  { name: 'Search', icon: 'search-outline', label: 'Search' },
  // Sits with Tasks rather than down among Logbook/Archived: it's a peer
  // surface you go to on purpose, not somewhere things end up.
  { name: 'Groceries', icon: 'cart-outline', label: 'Groceries & Meals', alsoActiveFor: GROCERIES_HUB_TABS, kitchen: true },
  // Right under the hub row it's a shelf for, rather than off with
  // Categories/Tags: it groups recipes, not tasks.
  { name: 'Cookbooks', icon: 'library-outline', label: 'Cookbooks', kitchen: true },
  // Sits directly under Tasks: it's another way of reading the same tasks,
  // where everything below it groups them by something other than a date.
  { name: 'Calendar', icon: 'calendar-outline', label: 'Calendar' },
  { name: 'Categories', icon: 'folder-outline', label: 'Categories' },
  { name: 'Tags', icon: 'pricetag-outline', label: 'Tags' },
  // With the other ways of grouping the same tasks, rather than down among
  // Logbook/Archived: a person is something a task can belong to, the same as
  // a category or a stack, not somewhere tasks end up.
  { name: 'People', icon: 'people-outline', label: 'People' },
  { name: 'Stacks', icon: 'layers-outline', label: 'Stacks' },
  { name: 'Templates', icon: 'copy-outline', label: 'Templates' },
  { name: 'Logbook', icon: 'book-outline', label: 'Logbook' },
  { name: 'Stats', icon: 'bar-chart-outline', label: 'Stats' },
  // Beside Stats rather than up with the task surfaces: it is a history read in
  // aggregate, and half of what it shows is that history crossed with the task
  // one. Somebody who has come here to look at numbers about themselves is in
  // the right neighbourhood.
  { name: 'Mood', icon: 'happy-outline', label: 'Mood' },
  // A maintenance tool for the fields already on every task, not a new
  // surface over new data — sits with Stats rather than up with Tasks.
  { name: 'Backfill', icon: 'flash-outline', label: 'Backfill' },
  { name: 'Waiting', icon: 'hourglass-outline', label: 'Waiting' },
  // Sits with Waiting rather than up with Tasks: both are "held out of the
  // daily list for a reason", and both are somewhere you go to clear a backlog
  // rather than somewhere you work.
  { name: 'Drift', icon: 'trending-down-outline', label: 'Drift' },
  { name: 'Archived', icon: 'archive-outline', label: 'Archived' },
  // Last, next to Settings in the footer below rather than up among the
  // working surfaces: it's reference material, not somewhere you go to do
  // anything. The unread count on the row is the only thing that says the
  // screen exists, which is the same problem the tips themselves are for.
  { name: 'Tips', icon: 'bulb-outline', label: 'Tips' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onNavigate: (tabName: string) => void;
  onOpenSettings: () => void;
  activeTab: string;
}

export function SideMenuDrawer({ visible, onClose, onNavigate, onOpenSettings, activeTab }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  // A scalar, so it's referentially stable and needs no useShallow. Counts
  // what's still to buy — items already in the trolley aren't a reason to go.
  const groceryCount = useGroceryStore(s => listRemainingCount(s.listEntries, s.activeListId));
  // The one row this can remove, so the filter runs on every render rather
  // than being hoisted — it's a ten-item array and the setting is a scalar.
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  // A scalar for the same reason groceryCount is one. TIPS is a module-level
  // constant, so the only thing that can move this is a dismissal.
  // Counted over `tipsFor`, not `TIPS`: the badge has to agree with the list
  // behind it, and simplified mode can take thirty tips out of that list. That
  // costs the O(1) subtraction this used to be, but the walk is 70 records on
  // settings-store writes only, and it still returns a scalar.
  const unreadTipCount = useSettingsStore(s =>
    tipsFor(s.simpleMode).filter(tip => !s.seenTips.includes(tip.id)).length);
  // Counted, not listed, for the same reason: a scalar selector is
  // referentially stable, so the drawer doesn't re-render every time a stack
  // or template is edited.
  const stackCount = useTaskGroupStore(s => s.groups.length);
  const templateCount = useTemplateStore(s => s.templates.length);
  const peopleCount = usePersonStore(s => s.people.length);
  const menuItems = useMemo(() => {
    const counts = { stacks: stackCount, templates: templateCount, people: peopleCount };
    return MENU_ITEMS.filter(i =>
      (kitchenEnabled || !i.kitchen) && screenShown(i.name, simpleMode, counts));
  }, [kitchenEnabled, simpleMode, stackCount, templateCount, peopleCount]);
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const dragOffsetX = useRef(new Animated.Value(0)).current;
  const [isRendered, setIsRendered] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);
  // The menu is taller than any phone — sixteen rows before Settings — and it
  // is bounded by the footer's hairline rather than by the screen, so the last
  // row above that line looked like the last row there was. Both halves of the
  // answer are here: the band that dissolves the content into the footer, and
  // the scroll indicator, flashed as the drawer opens so the thumb's length
  // says how much more there is before anyone has touched it.
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
          Animated.spring(dragOffsetX, { toValue: 0, damping: 20, stiffness: 200, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragOffsetX, { toValue: 0, damping: 20, stiffness: 200, useNativeDriver: true }).start();
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      fastCloseRef.current = false;
      setIsRendered(true);
      // After the slide-in, not during it: the indicator is drawn against the
      // drawer's own right edge, which is still crossing the screen.
      const flash = setTimeout(() => listRef.current?.flashScrollIndicators(), 260);
      Animated.parallel([
        Animated.spring(translateX, {
          toValue: 0,
          damping: 28,
          stiffness: 220,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 180,
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
              damping: 30,
              stiffness: 280,
              useNativeDriver: true,
            }),
            Animated.timing(backdropOpacity, {
              toValue: 0,
              duration: 180,
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

  if (!isRendered) return null;

  return (
    <Modal
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
            {
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
          </View>

          <View style={styles.itemsWrap}>
          <ScrollView
            ref={listRef}
            style={styles.items}
            contentContainerStyle={styles.itemsContent}
            {...fade.scrollProps}
          >
            {menuItems.map((item, index) => {
              const isActive = activeTab === item.name || item.alsoActiveFor?.includes(activeTab) === true;
              return (
                <DrawerItemAppear key={item.name} index={index}>
                <TouchableOpacity
                  style={[
                    styles.item,
                    isActive && { backgroundColor: colors.accent + '18' },
                  ]}
                  onPress={() => handleNavigate(item.name)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={item.label}
                >
                  <View
                    style={[
                      styles.iconWrap,
                      { backgroundColor: isActive ? colors.accent + '22' : colors.bgTertiary },
                    ]}
                  >
                    <Ionicons
                      name={item.icon}
                      size={20}
                      color={isActive ? colors.accent : colors.textSecondary}
                    />
                  </View>
                  <Text
                    style={[
                      styles.itemLabel,
                      { color: isActive ? colors.accent : colors.text },
                    ]}
                  >
                    {item.label}
                  </Text>
                  {item.name === 'Groceries' && groceryCount > 0 && (
                    <View style={[styles.badge, { backgroundColor: colors.accentSubtle }]}>
                      <Text style={[styles.badgeText, { color: colors.accent }]}>{groceryCount}</Text>
                    </View>
                  )}
                  {item.name === 'Tips' && unreadTipCount > 0 && (
                    <View style={[styles.badge, { backgroundColor: colors.accentSubtle }]}>
                      <Text style={[styles.badgeText, { color: colors.accent }]}>{unreadTipCount}</Text>
                    </View>
                  )}
                </TouchableOpacity>
                </DrawerItemAppear>
              );
            })}
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
            <DrawerItemAppear index={menuItems.length}>
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
    </Modal>
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
    width: DRAWER_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 6, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 20,
    overflow: 'hidden',
  },
  header: {
    paddingTop: 64,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: font.xxl,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.5,
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
    marginVertical: 2,
    borderRadius: radius.md,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemLabel: {
    flex: 1,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  badge: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
});
