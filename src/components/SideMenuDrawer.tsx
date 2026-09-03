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
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { usePersonStore } from '../store/usePersonStore';
import { useMoodStore } from '../store/useMoodStore';
import {
  hubSubtitle, menuDestinations, menuSearchTerms, rowEntryRoute, searchMenu, visibleMenuRows,
  type NavMenuRow, type NavSearchResult,
} from '../utils/navHubs';
import { tipsFor } from '../utils/tips';

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
 * without making any of it easier to reach. Eight rows fit, and four of them
 * are hubs standing in for thirteen destinations. What goes where, and why,
 * is `navHubs.ts`; this file is the drawing.
 *
 * Two things carry the weight of the collapse:
 *
 * - **A hub row names its members underneath it.** "Organize" on its own is a
 *   guess; "Categories, Tags, People, Stacks, Templates" is an answer, and it
 *   stays honest under simplified mode because the subtitle is built from the
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
  const { isDark } = useTheme();
  // A scalar, so it's referentially stable and needs no useShallow. Counts
  // what's still to buy — items already in the trolley aren't a reason to go.
  const groceryCount = useGroceryStore(s => listRemainingCount(s.listEntries, s.activeListId));
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  // A scalar for the same reason groceryCount is one. TIPS is a module-level
  // constant, so the only thing that can move this is a dismissal.
  // Counted over `tipsFor`, not `TIPS`: the badge has to agree with the list
  // behind it, and simplified mode can take thirty tips out of that list.
  const unreadTipCount = useSettingsStore(s =>
    tipsFor(s.simpleMode).filter(tip => !s.seenTips.includes(tip.id)).length);
  // Counted, not listed, for the same reason: a scalar selector is
  // referentially stable, so the drawer doesn't re-render every time a stack
  // or template is edited.
  const stackCount = useTaskGroupStore(s => s.groups.length);
  const templateCount = useTemplateStore(s => s.templates.length);
  const peopleCount = usePersonStore(s => s.people.length);
  const moodCount = useMoodStore(s => s.logs.length);

  const [query, setQuery] = useState('');
  const menuOptions = useMemo(() => ({
    kitchenEnabled,
    simpleMode,
    counts: { stacks: stackCount, templates: templateCount, people: peopleCount, mood: moodCount },
  }), [kitchenEnabled, simpleMode, stackCount, templateCount, peopleCount, moodCount]);
  const menuRows = useMemo(() => visibleMenuRows(menuOptions), [menuOptions]);
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
  // Eight rows and a footer fit on every phone this runs on, so the fade and
  // the flashed scrollbar are no longer load-bearing — they stay because the
  // *search results* can be longer than the list they replace, and because a
  // large accessibility text size can push even eight rows past the fold.
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
      // A query handed back on the next open is a filtered menu with no visible
      // reason why — the same rule the task editor's field search follows.
      setQuery('');
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

  /** A row is lit for its own screen, and a hub row for any screen inside it. */
  const isRowActive = (row: NavMenuRow) =>
    row.kind === 'screen'
      ? activeTab === row.destination.route
      : row.hub.members.some(m => m.route === activeTab);

  const badgeFor = (row: NavMenuRow): number => {
    if (row.kind === 'hub') return row.hub.id === 'kitchen' ? groceryCount : 0;
    return row.destination.route === 'Tips' ? unreadTipCount : 0;
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
              value={query}
              onChangeText={setQuery}
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
                      active={activeTab === result.route}
                      colors={colors}
                      onPress={() => handleNavigate(result.route)}
                    />
                  </DrawerItemAppear>
                ))
              : menuRows.map((row, index) => {
                  const isActive = isRowActive(row);
                  const badge = badgeFor(row);
                  const label = row.kind === 'screen' ? row.destination.label : row.hub.label;
                  const icon = row.kind === 'screen' ? row.icon : row.hub.icon;
                  const subtitle = row.kind === 'hub' ? hubSubtitle(row.hub) : null;
                  return (
                    <DrawerItemAppear key={label} index={index}>
                      <TouchableOpacity
                        style={[
                          styles.item,
                          isActive && { backgroundColor: colors.accent + '18' },
                        ]}
                        onPress={() => handleNavigate(rowEntryRoute(row))}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isActive }}
                        accessibilityLabel={subtitle ? `${label}. Holds ${subtitle}` : label}
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
                          {subtitle && (
                            // Wraps rather than truncating: a list of members
                            // cut off after three is a row that names some of
                            // what it holds and hides the rest, which is the
                            // problem the subtitle exists to solve.
                            <Text style={[styles.itemSubtitle, { color: colors.textSecondary }]}>
                              {subtitle}
                            </Text>
                          )}
                        </View>
                        {badge > 0 && (
                          <View style={[styles.badge, { backgroundColor: colors.accentSubtle }]}>
                            <Text style={[styles.badgeText, { color: colors.accent }]}>{badge}</Text>
                          </View>
                        )}
                        {subtitle && (
                          <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
                        )}
                      </TouchableOpacity>
                    </DrawerItemAppear>
                  );
                })}
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
    </Modal>
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
    shadowColor: '#000',
    shadowOffset: { width: 6, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 20,
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
  itemBody: { flex: 1, minWidth: 0 },
  itemLabel: {
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  itemSubtitle: {
    fontSize: font.xs,
    lineHeight: 16,
    marginTop: 2,
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
  noResults: {
    fontSize: font.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
});
