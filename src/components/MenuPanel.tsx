import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScrollEdgeFade } from './ScrollEdgeFade';
import { SearchField } from './SearchField';
import Ionicons from '@expo/vector-icons/Ionicons';
import { NamedIcon } from './CoinIcon';
import { useColors } from '../theme/ThemeContext';
import { animation, font, fontWeight, interaction, radius, spacing } from '../theme';
import { useScrollEdgeFade } from '../hooks/useScrollEdgeFade';
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
import { hiddenResultsNote } from '../utils/simpleMode';
import { useFilterField } from '../hooks/useFilterField';
import { useNavMenuOptions } from '../hooks/useNavMenuOptions';

interface Props {
  /**
   * Where it is drawn. The drawer is a sheet that opens over the app and
   * cascades its rows in; the sidebar is always there, so it sits still and
   * has no title (the screen's own header already names where you are).
   */
  variant: 'drawer' | 'sidebar';
  /** Whether it is on screen. The sidebar passes true; the drawer, whether it is open. */
  onScreen: boolean;
  activeTab: string;
  /** Called with the route a row or a result opens. The caller owns the haptic and any closing. */
  onNavigate: (route: string) => void;
  onOpenSettings: () => void;
}

/**
 * What the side menu holds: the find field, the Recent row, the rows and hubs
 * from `navHubs.ts`, and Settings. One component, so the drawer on a phone and
 * the sidebar on a wide window can't drift apart (a row added to one and not
 * the other is the drift `SheetHeaderButton` exists to undo). What goes where
 * is `navHubs.ts`. The frosted background and the slide are the drawer's, and
 * the surface and the column are the sidebar's, so this draws on no background
 * of its own.
 */
export function MenuPanel({ variant, onScreen, activeTab, onNavigate, onOpenSettings }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const animate = variant === 'drawer';
  const compact = variant === 'sidebar';
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
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const hiddenNote = hiddenResultsNote({ simpleMode, kitchenEnabled }, 'screens');

  // The screen actually on show, read as the drawer opens. `activeTab` alone
  // isn't it: a hub's own pill row and a link both switch screens without
  // going through the menu, and the highlight (and now the lit chip) would
  // stay on wherever the menu last sent you.
  const currentRoute = useMemo(
    () => (onScreen ? currentTabName() ?? activeTab : activeTab),
    [onScreen, activeTab],
  );

  const searchFilter = useFilterField();
  const query = searchFilter.query;
  // Shared with the pull-down quick search, which searches the same screens.
  const menuOptions = useNavMenuOptions();
  const menuRows = useMemo(() => visibleMenuRows(menuOptions), [menuOptions]);
  // Recent skips whatever has a tab button right now, which is the user's choice.
  const tabRoutes = useSettingsStore(s => s.tabRoutes);
  const recentDestinations = useMemo(
    () => recentMenuDestinations(recentScreens, menuOptions, currentRoute, tabRoutes),
    [recentScreens, menuOptions, currentRoute, tabRoutes],
  );
  const terms = useMemo(() => menuSearchTerms(query), [query]);
  const results = useMemo(
    () => (terms.length === 0 ? [] : searchMenu(menuDestinations(menuOptions), terms)),
    [menuOptions, terms],
  );
  const searching = terms.length > 0;

  // Eleven rows and a footer fit on every phone this runs on, so the fade and
  // the flashed scrollbar are no longer load-bearing — they stay because the
  // *search results* can be longer than the list they replace, and because a
  // large accessibility text size can push even eleven rows past the fold.
  const listRef = useRef<ScrollView>(null);
  const fade = useScrollEdgeFade();

  useEffect(() => {
    if (!onScreen) return;
    // A query handed back on the next open is a filtered menu with no visible
    // reason why — the same rule the task editor's field search follows.
    searchFilter.clear();
    if (variant !== 'drawer') return;
    // After the slide-in, not during it: the indicator is drawn against the
    // drawer's own right edge, which is still crossing the screen. Cleared by
    // this effect's own teardown, which is also what cancels a flash still
    // pending when the drawer is closed straight back out.
    const flash = setTimeout(() => listRef.current?.flashScrollIndicators(), 260);
    return () => clearTimeout(flash);
  }, [onScreen]);

  /** A row is lit for its own screen, and a hub row for any screen inside it. */
  const isRowActive = (row: NavMenuRow) =>
    row.kind === 'screen'
      ? currentRoute === row.destination.route
      : row.hub.members.some(m => m.route === currentRoute);

  // A hub's counts ride on its chips (see MenuChip), so only a plain row has one here.
  const badgeFor = (row: NavMenuRow): number =>
    row.kind === 'screen' && row.destination.route === 'Tips' ? unreadTipCount : 0;

  const handleNavigate = onNavigate;

  return (
    <>
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.separator },
          variant === 'sidebar' && styles.headerSidebar,
          variant === 'sidebar' && { paddingTop: insets.top + spacing.md },
        ]}
      >
        {variant === 'drawer' && (
          <Text style={[styles.headerTitle, { color: colors.text }]}>Menu</Text>
        )}
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
              <ItemAppear animate={animate} key={`r:${result.route}`} index={index}>
                <ResultRow
                  result={result}
                  active={currentRoute === result.route}
                  compact={compact}
                  colors={colors}
                  onPress={() => handleNavigate(result.route)}
                />
              </ItemAppear>
            ))
          : (
            <>
              {/* Where you were a moment ago, a tap away rather than a
                  hub and a pill away. Leaves out the screen you're on and
                  the tab bar's own screens (see recentMenuDestinations). */}
              {recentDestinations.length > 0 && (
                <ItemAppear animate={animate} index={0}>
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
                </ItemAppear>
              )}
              {menuRows.map((row, index) => {
                const isActive = isRowActive(row);
                if (row.kind === 'hub') {
                  return (
                    <ItemAppear animate={animate} key={row.hub.label} index={index + 1}>
                      <HubRow
                        hub={row.hub}
                        active={isActive}
                        compact={compact}
                        currentRoute={currentRoute}
                        recentScreens={recentScreens}
                        groceryCount={groceryCount}
                        colors={colors}
                        onNavigate={handleNavigate}
                      />
                    </ItemAppear>
                  );
                }
                const badge = badgeFor(row);
                const { label, icon, route } = row.destination;
                return (
                  <ItemAppear animate={animate} key={label} index={index + 1}>
                    <TouchableOpacity
                      style={rowStyle(compact, isActive, colors)}
                      onPress={() => handleNavigate(route)}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive }}
                      accessibilityLabel={label}
                    >
                      <View style={iconWrapStyle(compact, isActive, colors)}>
                        <NamedIcon
                          name={icon}
                          size={compact ? COMPACT_ICON : 20}
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
                  </ItemAppear>
                );
              })}
            </>
          )}
        {searching && results.length === 0 && (
          <Text style={[styles.noResults, { color: colors.textSecondary }]}>
            No screen matches that.
            {hiddenNote ? `\n\n${hiddenNote}` : ''}
          </Text>
        )}
      </ScrollView>
      {/* Fades into the drawer's own frosted surface rather than to an
          opaque strip: `blurFallback` is `bgSecondary` at 85%, so the band
          stops just short of solid and the blur still reads through it. */}
      <ScrollEdgeFade
        edge="bottom"
        opacity={fade.bottomOpacity}
        color={variant === 'drawer' ? colors.bgSecondary : colors.bgSunken}
        maxOpacity={0.92}
      />
      </View>

      <View style={[styles.footer, { borderTopColor: colors.separator, paddingBottom: spacing.md + insets.bottom }]}>
        <ItemAppear animate={animate} index={menuRows.length}>
          <TouchableOpacity
            style={rowStyle(compact, false, colors)}
            onPress={onOpenSettings}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <View style={iconWrapStyle(compact, false, colors)}>
              <Ionicons name="settings-outline" size={compact ? COMPACT_ICON : 20} color={colors.textSecondary} />
            </View>
            <Text style={[styles.itemLabel, { color: colors.text }]}>Settings</Text>
          </TouchableOpacity>
        </ItemAppear>
      </View>
    </>
  );
}

/**
 * A search hit. It names the hub it lives in rather than the hub row's icon,
 * because the useful thing to know about a result is where it will put you —
 * and the hub is also the answer to "why did this match", when the match came
 * off a keyword rather than the label.
 */
function ResultRow({
  result, active, compact, colors, onPress,
}: {
  result: NavSearchResult;
  active: boolean;
  compact: boolean;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={rowStyle(compact, active, colors)}
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={result.hubLabel ? `${result.label}, in ${result.hubLabel}` : result.label}
    >
      <View style={iconWrapStyle(compact, active, colors)}>
        <Ionicons
          name="arrow-forward"
          size={compact ? COMPACT_ICON : 18}
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
      <NamedIcon
        name={destination.icon}
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
  hub, active, compact, currentRoute, recentScreens, groceryCount, colors, onNavigate,
}: {
  hub: NavHub;
  active: boolean;
  compact: boolean;
  currentRoute: string | null;
  recentScreens: readonly string[];
  groceryCount: number;
  colors: ReturnType<typeof useColors>;
  onNavigate: (route: string) => void;
}) {
  const entry = hubEntryRoute(hub, recentScreens);
  const entryLabel = hub.members.find(m => m.route === entry)?.label ?? hub.label;
  return (
    <View style={rowStyle(compact, active, colors)}>
      <TouchableOpacity
        onPress={() => onNavigate(entry)}
        activeOpacity={interaction.activeOpacity}
        accessible={false}
        importantForAccessibility="no"
      >
        <View style={iconWrapStyle(compact, active, colors)}>
          <NamedIcon
            name={hub.icon}
            size={compact ? COMPACT_ICON : 20}
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

// The sidebar's rows are the drawer's, drawn tighter: a drawer is a sheet with
// the whole height to itself and a phone's width, a sidebar is a 236pt strip
// beside the work, where the full-size rows leave one chip per line and push
// half the menu below the fold.
const COMPACT_ICON = 18;

function rowStyle(compact: boolean, active: boolean, colors: ReturnType<typeof useColors>) {
  return [
    styles.item,
    compact && styles.itemCompact,
    // A drawer row is lit with a tint; the sidebar's with the card surface, which
    // is opaque like every selected row in a list.
    active && { backgroundColor: compact ? colors.bgSecondary : colors.accent + '18' },
  ];
}

function iconWrapStyle(compact: boolean, active: boolean, colors: ReturnType<typeof useColors>) {
  return [
    styles.iconWrap,
    compact
      ? styles.iconWrapCompact
      : { backgroundColor: active ? colors.accent + '22' : colors.bgTertiary },
  ];
}

// Menu rows cascade in as the drawer opens: each fades and slides from the
// left with a small per-row delay. The drawer unmounts when closed, so the
// mount animation replays on every open. The sidebar is always there, so its
// rows are drawn as they are (`animate` off).
function ItemAppear({ animate, index, children }: { animate: boolean; index: number; children: React.ReactNode }) {
  if (!animate) return <>{children}</>;
  return <AnimatedItemAppear index={index}>{children}</AnimatedItemAppear>;
}

function AnimatedItemAppear({ index, children }: { index: number; children: React.ReactNode }) {
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
  header: {
    paddingTop: 64,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // No title and no rule under the find field: the sidebar is a column, not a sheet.
  headerSidebar: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 0,
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
  // Aligned to the top so a hub's icon sits beside its name, not beside its chips.
  itemCompact: {
    alignItems: 'flex-start',
    gap: spacing.smd - 2,
    paddingVertical: spacing.xsm,
    paddingHorizontal: spacing.sm + 2,
    marginVertical: 1,
    borderRadius: radius.sm,
  },
  iconWrapCompact: {
    width: 22,
    height: 22,
    borderRadius: 0,
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
