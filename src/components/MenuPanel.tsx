import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, type GestureResponderEvent } from 'react-native';
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
  arrangeMenuRows, hubEntryRoute, hubSubtitle, menuDestinations, menuRowKey, menuSearchTerms,
  recentMenuDestinations, searchMenu, switchedOffMatches, toggleMenuHidden, toggleMenuPin, visibleMenuRows, TAB_SLOT_COUNT,
  type NavDestination, type NavHub, type NavMenuRow, type NavSearchResult,
} from '../utils/navHubs';
import { currentTabName } from '../navigation/navigationRef';
import { tipsFor } from '../utils/tips';
import { hiddenResultsNote } from '../utils/simpleMode';
import { useFilterField } from '../hooks/useFilterField';
import { useNavMenuOptions } from '../hooks/useNavMenuOptions';
import { useSyncStore } from '../store/useSyncStore';
import { searchableSettingsEntries } from '../utils/settingsActiveRows';
import { settingsGroup } from '../utils/settingsIndex';
import { searchElsewhere, type ElsewhereResult } from '../utils/searchElsewhere';
import { useActionMenu } from '../hooks/useActionMenu';
import type { ActionMenuAction } from './ActionMenu';
import type { CardAnchor } from './CardSheet';
import { haptics } from '../utils/haptics';

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
  /** Opens one settings row a search found, where it lives. Omit to search screens only. */
  onOpenSettingsEntry?: (entryId: string) => void;
  /** Hands the query to the Search screen, for everything else it might mean. */
  onSearchEverything?: (query: string) => void;
}

/** How many settings rows the find field lists under the screens it found. */
const SETTINGS_RESULT_LIMIT = 4;

/**
 * What the side menu holds: the find field, the Recent row, the rows and hubs
 * from `navHubs.ts`, and Settings. One component, so the drawer on a phone and
 * the sidebar on a wide window can't drift apart (a row added to one and not
 * the other is the drift `SheetHeaderButton` exists to undo). What goes where
 * is `navHubs.ts`. The frosted background and the slide are the drawer's, and
 * the surface and the column are the sidebar's, so this draws on no background
 * of its own.
 */
export function MenuPanel({ variant, onScreen, activeTab, onNavigate, onOpenSettings, onOpenSettingsEntry, onSearchEverything }: Props) {
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
  // Recent skips whatever has a tab button right now, which is the user's choice.
  const tabRoutes = useSettingsStore(s => s.tabRoutes);
  // The rows as the user arranged them: pinned first, hidden set apart, and
  // (in the drawer) a screen that's already a tab left out. The sidebar
  // replaces the tab bar, so it leaves nothing out for one.
  const menuArrangement = useSettingsStore(s => s.menuArrangement);
  const { shown: menuRows, hidden: hiddenRows } = useMemo(
    () => arrangeMenuRows(visibleMenuRows(menuOptions), menuArrangement, variant === 'drawer' ? tabRoutes : []),
    [menuOptions, menuArrangement, variant, tabRoutes],
  );
  const [showHidden, setShowHidden] = useState(false);
  const arrangeMenu = useActionMenu();
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
  // An area switched off takes its screens out of the index too, so a search
  // for one says the area is off rather than that nothing matched.
  const offAreas = useMemo(
    () => (onOpenSettingsEntry ? switchedOffMatches(menuOptions, terms) : []),
    [onOpenSettingsEntry, menuOptions, terms],
  );
  // Settings rows the query names, under the screens: "dark mode", "vacation"
  // or "backup" are settings, and the field used to answer them with "No
  // screen matches that." The same rows and order quick search offers.
  const settingResults = useMemo(() => {
    if (!onOpenSettingsEntry || terms.length === 0) return [];
    return searchElsewhere({
      destinations: [],
      settingsEntries: searchableSettingsEntries(Platform.OS, useSettingsStore.getState(), useSyncStore.getState()),
      settingsGroupTitle: id => settingsGroup(id)?.title ?? 'Settings',
      people: [],
      recipes: [],
      groceryItems: [],
      onListIds: new Set(),
      now: new Date(),
    }, query).goTo.filter((r): r is Extract<ElsewhereResult, { kind: 'setting' }> => r.kind === 'setting')
      .filter(r => !offAreas.some(a => a.settingId === r.entry.id))
      .slice(0, SETTINGS_RESULT_LIMIT);
  }, [onOpenSettingsEntry, terms, query, offAreas]);

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
    setShowHidden(false);
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

  const tabLabel = (route: string) => menuDestinations(menuOptions).find(d => d.route === route)?.label ?? route;

  /**
   * Holding a row: pin it to the top, hide it, or (a screen, in the drawer)
   * give it a tab. A full tab bar offers the tabs to swap it in for rather
   * than saying no. All of it is undone from the same menu.
   */
  const openArrange = (row: NavMenuRow, anchor: CardAnchor | null) => {
    haptics.impactMedium();
    const key = menuRowKey(row);
    const store = useSettingsStore.getState();
    const arrangement = store.menuArrangement;
    const hidden = arrangement.hidden.includes(key);
    const pinned = arrangement.pinned.includes(key);
    const actions: ActionMenuAction[] = [];
    if (!hidden) {
      actions.push({
        key: 'pin',
        label: pinned ? 'Unpin' : 'Pin to top',
        icon: pinned ? 'arrow-down-outline' : 'arrow-up-outline',
        onPress: () => useSettingsStore.getState().setMenuArrangement(toggleMenuPin(useSettingsStore.getState().menuArrangement, key)),
      });
    }
    if (row.kind === 'screen' && variant === 'drawer' && !tabRoutes.includes(row.destination.route)) {
      const route = row.destination.route;
      actions.push(tabRoutes.length < TAB_SLOT_COUNT
        ? {
            key: 'tab',
            label: 'Add to tab bar',
            icon: 'albums-outline',
            onPress: () => useSettingsStore.getState().setTabSlot(tabRoutes.length, route),
          }
        : {
            key: 'tab',
            label: 'Add to tab bar',
            icon: 'albums-outline',
            choices: tabRoutes.map((tab, slot) => ({
              key: tab,
              label: `In place of ${tabLabel(tab)}`,
              onPress: () => useSettingsStore.getState().setTabSlot(slot, route),
            })),
          });
    }
    actions.push({
      key: 'hide',
      label: hidden ? 'Show in menu' : 'Hide from menu',
      icon: hidden ? 'eye-outline' : 'eye-off-outline',
      onPress: () => useSettingsStore.getState().setMenuArrangement(toggleMenuHidden(useSettingsStore.getState().menuArrangement, key)),
    });
    arrangeMenu.open({
      title: row.kind === 'screen' ? row.destination.label : row.hub.label,
      actions,
      anchor,
    });
  };

  const renderRow = (row: NavMenuRow, index: number) => {
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
            onLongPress={anchor => openArrange(row, anchor)}
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
          onLongPress={e => openArrange(row, touchAnchor(e))}
          delayLongPress={interaction.delayLongPress}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityState={{ selected: isActive }}
          accessibilityLabel={label}
          accessibilityActions={[{ name: 'longpress', label: 'Arrange' }]}
          onAccessibilityAction={ev => {
            if (ev.nativeEvent.actionName === 'longpress') openArrange(row, null);
          }}
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
  };

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
          placeholder="Find a screen or setting"
          style={styles.search}
          accessibilityLabel="Find a screen or setting"
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
              {menuRows.map(renderRow)}
              {/* Rows the user hid. Set apart rather than gone, so holding
                  one can bring it back. */}
              {hiddenRows.length > 0 && (
                <TouchableOpacity
                  style={styles.hiddenToggle}
                  onPress={() => { haptics.tap(); setShowHidden(v => !v); }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showHidden }}
                  accessibilityLabel={`${hiddenRows.length} hidden ${hiddenRows.length === 1 ? 'row' : 'rows'}`}
                >
                  <Text style={[styles.hiddenToggleLabel, { color: colors.textSecondary }]}>
                    {hiddenRows.length} hidden
                  </Text>
                  <Text style={[styles.hiddenToggleAction, { color: colors.accent }]}>
                    {showHidden ? 'Hide' : 'Show'}
                  </Text>
                </TouchableOpacity>
              )}
              {showHidden && hiddenRows.map((row, index) => renderRow(row, menuRows.length + index))}
            </>
          )}
        {searching && offAreas.map(area => (
          <TouchableOpacity
            key={area.settingId}
            style={rowStyle(compact, false, colors)}
            onPress={() => onOpenSettingsEntry?.(area.settingId)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`${area.label} is off. Turn it on in Feature areas settings`}
          >
            <View style={iconWrapStyle(compact, false, colors)}>
              <Ionicons name="eye-off-outline" size={compact ? COMPACT_ICON : 18} color={colors.textSecondary} />
            </View>
            <View style={styles.itemBody}>
              <Text style={[styles.itemLabel, { color: colors.text }]}>{area.label} is off</Text>
              <Text style={[styles.itemSubtitle, { color: colors.textSecondary }]}>Turn it on in Feature areas</Text>
            </View>
          </TouchableOpacity>
        ))}
        {searching && settingResults.length > 0 && (
          <>
            <Text style={[styles.resultsCaption, { color: colors.textSecondary }]}>Settings</Text>
            {settingResults.map(result => (
              <TouchableOpacity
                key={result.key}
                style={rowStyle(compact, false, colors)}
                onPress={() => onOpenSettingsEntry?.(result.entry.id)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`${result.entry.label}, in ${result.groupTitle} settings`}
              >
                <View style={iconWrapStyle(compact, false, colors)}>
                  <Ionicons name="settings-outline" size={compact ? COMPACT_ICON : 18} color={colors.textSecondary} />
                </View>
                <View style={styles.itemBody}>
                  <Text style={[styles.itemLabel, { color: colors.text }]}>{result.entry.label}</Text>
                  <Text style={[styles.itemSubtitle, { color: colors.textSecondary }]}>in {result.groupTitle}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}
        {searching && results.length === 0 && settingResults.length === 0 && offAreas.length === 0 && (
          <Text style={[styles.noResults, { color: colors.textSecondary }]}>
            {onOpenSettingsEntry ? 'No screen or setting matches that.' : 'No screen matches that.'}
            {hiddenNote ? `\n\n${hiddenNote}` : ''}
          </Text>
        )}
        {/* Whatever else the words might be (a task, a person, a recipe) is
            Search's to find, so the field hands the query over rather than
            stopping at screens and settings. */}
        {searching && onSearchEverything && (
          <TouchableOpacity
            style={rowStyle(compact, false, colors)}
            onPress={() => onSearchEverything(query.trim())}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`Search everything for ${query.trim()}`}
          >
            <View style={iconWrapStyle(compact, false, colors)}>
              <Ionicons name="search" size={compact ? COMPACT_ICON : 18} color={colors.accent} />
            </View>
            <View style={styles.itemBody}>
              <Text style={[styles.itemLabel, { color: colors.accent }]} numberOfLines={2}>
                Search everything for “{query.trim()}”
              </Text>
            </View>
          </TouchableOpacity>
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
      {/* Inside the drawer's own Modal when this is the drawer, so the menu
          presents from it rather than beside it. */}
      {arrangeMenu.element}
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
  hub, active, compact, currentRoute, recentScreens, groceryCount, colors, onNavigate, onLongPress,
}: {
  hub: NavHub;
  active: boolean;
  compact: boolean;
  currentRoute: string | null;
  recentScreens: readonly string[];
  groceryCount: number;
  colors: ReturnType<typeof useColors>;
  onNavigate: (route: string) => void;
  /** Holding the row, to arrange it. Null as the anchor when VoiceOver asks, which centers the menu. */
  onLongPress: (anchor: CardAnchor | null) => void;
}) {
  const entry = hubEntryRoute(hub, recentScreens);
  const entryLabel = hub.members.find(m => m.route === entry)?.label ?? hub.label;
  return (
    <View style={rowStyle(compact, active, colors)}>
      <TouchableOpacity
        onPress={() => onNavigate(entry)}
        onLongPress={e => onLongPress(touchAnchor(e))}
        delayLongPress={interaction.delayLongPress}
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
          onLongPress={e => onLongPress(touchAnchor(e))}
          delayLongPress={interaction.delayLongPress}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          accessibilityLabel={`${hub.label}. Holds ${hubSubtitle(hub)}`}
          accessibilityHint={`Opens ${entryLabel}`}
          accessibilityActions={[{ name: 'longpress', label: 'Arrange' }]}
          onAccessibilityAction={ev => { if (ev.nativeEvent.actionName === 'longpress') onLongPress(null); }}
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

const touchAnchor = (e: GestureResponderEvent): CardAnchor => ({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });

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
  hiddenToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  hiddenToggleLabel: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  hiddenToggleAction: {
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
  noResults: {
    fontSize: font.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  resultsCaption: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
});
