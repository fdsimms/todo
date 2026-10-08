import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { navigationRef, navigateToTab, resetToRecipeDetail, flushPendingNavigation, currentTabName } from './navigationRef';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CoinIcon } from '../components/CoinIcon';
import { COIN_ICON } from '../constants/coinIcon';
import { clearUnprovenScreen, markScreenUnproven, readUnprovenScreen, screenToRestore } from '../utils/launchGuard';
import { SafeBlurView } from '../components/SafeBlurView';
import { GlassLayer, glassSupported } from '../components/GlassLayer';
import { TodayScreen } from '../screens/TodayScreen';
import { TagsScreen } from '../screens/TagsScreen';
import { MetersScreen } from '../screens/MetersScreen';
import { PeopleScreen } from '../screens/PeopleScreen';
import { CategoriesScreen } from '../screens/CategoriesScreen';
import { GroceryScreen } from '../screens/GroceryScreen';
import { StacksScreen } from '../screens/StacksScreen';
import { CalendarScreen } from '../screens/CalendarScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { ProjectsScreen } from '../screens/ProjectsScreen';
import { LogbookScreen } from '../screens/LogbookScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { FoodLogScreen } from '../screens/FoodLogScreen';
import { MoodScreen } from '../screens/MoodScreen';
import { MedicationScreen } from '../screens/MedicationScreen';
import { useMedicationStore } from '../store/useMedicationStore';
import { useJournalStore } from '../store/useJournalStore';
import { WeightScreen } from '../screens/WeightScreen';
import { SleepScreen } from '../screens/SleepScreen';
import { JournalScreen, DreamsScreen } from '../screens/JournalScreen';
import { MoodHistoryScreen } from '../screens/MoodHistoryScreen';
import { MoodDayScreen } from '../screens/MoodDayScreen';
import { SymptomDetailScreen } from '../screens/SymptomDetailScreen';
import { ArchivedScreen } from '../screens/ArchivedScreen';
import { UnattendedLogScreen } from '../screens/UnattendedLogScreen';
import { AutomationsScreen } from '../screens/AutomationsScreen';
import { BackfillScreen } from '../screens/BackfillScreen';
import { StuckScreen } from '../screens/StuckScreen';
import { RewardsScreen } from '../screens/RewardsScreen';
import { SavedViewsScreen } from '../screens/SavedViewsScreen';
import { SavedViewDetailScreen } from '../screens/SavedViewDetailScreen';
import { RemindersScreen } from '../screens/RemindersScreen';
import { TemplatesScreen } from '../screens/TemplatesScreen';
import { RecipesScreen } from '../screens/RecipesScreen';
import { RecipeDetailScreen } from '../screens/RecipeDetailScreen';
import { CookbooksScreen } from '../screens/CookbooksScreen';
import { CookbookDetailScreen } from '../screens/CookbookDetailScreen';
import { MealPlanScreen } from '../screens/MealPlanScreen';
import { KitchenScreen } from '../screens/KitchenScreen';
import { TemplateDetailScreen } from '../screens/TemplateDetailScreen';
import { ProjectDetailScreen } from '../screens/ProjectDetailScreen';
import { CategoryDetailScreen } from '../screens/CategoryDetailScreen';
import { PersonDetailScreen } from '../screens/PersonDetailScreen';
import { TipsScreen } from '../screens/TipsScreen';
import { SideMenuDrawer } from '../components/SideMenuDrawer';
import { BlankTabDiagnostic, freezeWhenBlurred } from '../components/FreezeWhenBlurred';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SettingsGroupScreen } from '../screens/SettingsGroupScreen';
import { DemoBanner, TAB_BAR_HEIGHT } from '../components/DemoBanner';
import { UndoBar } from '../components/UndoBar';
import { CoinToast } from '../components/CoinToast';
import { EventCreatedToast } from '../components/EventCreatedToast';
import { ReadyOfferBar } from '../components/ReadyOfferBar';
import { TripDatePrompt } from '../components/TripDatePrompt';
import { UseUpResolveSheet } from '../components/UseUpResolveSheet';
import { FinishLeftoverPrompt } from '../components/FinishLeftoverPrompt';
import { LogMealPrompt } from '../components/LogMealPrompt';
import { HealthWriteRefusedNotice } from '../components/HealthWriteRefusedNotice';
import { LogMealEntrySheet } from '../components/LogMealEntrySheet';
import { CookRecap } from '../components/CookRecap';
import { CookingBar } from '../components/CookingBar';
import { FocusFloatingBar } from '../components/FocusBar';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { border, radius, spacing } from '../theme';
import { haptics } from '../utils/haptics';
import { useRecipeStore } from '../store/useRecipeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { hasRunningRecipeTimer, isCookTimerRunning } from '../utils/recipeTimer';
import { screenShown } from '../utils/simpleMode';
import { MENU_ROUTES, NAV_HUBS, NAV_MENU_ROWS, visibleTabRoutes, type NavDestination } from '../utils/navHubs';
import { useNavMenuOptions } from '../hooks/useNavMenuOptions';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { usePersonStore } from '../store/usePersonStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useMeterReadingStore } from '../store/useMeterReadingStore';
import { useMoodStore } from '../store/useMoodStore';

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();
const EDGE_WIDTH = 20;
// How long after a navigation its bookkeeping waits (see handleStateChange):
// long enough to land after the destination's first frames rather than among
// them, short enough that nothing reading it (the menu's Recent row, the
// screen a cold launch reopens) can be looked at first.
const SCREEN_BOOKKEEPING_DELAY_MS = 300;

// Screens only reachable via the drawer — hidden from the tab bar. There are
// seventeen of these against four visible tabs, so how they're hidden matters.
//
// `tabBarButton: () => null` alone was the whole of this under React Navigation
// v6, where `BottomTabItem` returned the button's own return value as the item
// — so null rendered nothing and occupied nothing. v7 wraps that return value
// in a `View` carrying `styles.bottomItem` (`flex: 1`), which renders whether
// or not the button does: on its own, `() => null` would leave seventeen empty
// but space-claiming flex slots, and the four real icons would each get 1/21 of
// the bar instead of 1/4. `tabBarItemStyle` lands on that same wrapper after
// `flex: 1` in the style array, so `display: 'none'` is what actually takes it
// out of the layout (and out of the accessibility tree with it). The null
// button stays because it's still the cheaper render — otherwise each hidden
// tab builds a default pressable and a `MissingIcon` to put inside a box
// nobody can see.
const HIDDEN = { tabBarButton: () => null, tabBarItemStyle: { display: 'none' as const } };

// Every screen it's safe to reopen the app directly on: every route the side
// menu reaches, which includes whichever of them are tabs right now. None of
// them take a route param. Excludes 'More' (not a real screen — its tabPress
// just opens the drawer) and every PUSHED_ROUTES entry below (RecipeDetail,
// ProjectDetail, … need an id the app can't invent on a cold launch). Backs
// the lastVisitedScreen setting (useSettingsStore) so the app reopens where it
// was left rather than always on Today — see initialRouteName below.
const RESTORABLE_SCREENS: ReadonlySet<string> = new Set(MENU_ROUTES);

// Every bottom-tab route and its screen, frozen while blurred. One table rather
// than a Tab.Screen written out per route, because which of them have a
// visible button (and in what order) is the user's choice now (`tabRoutes`).
// Cookbooks is reached only from Recipes and has no menu row, so it can never
// be a visible tab; it's here because it's still a tab route.
const TAB_SCREENS: Record<string, React.ComponentType<any>> = {
  Today: freezeWhenBlurred(TodayScreen),
  Groceries: freezeWhenBlurred(GroceryScreen),
  Projects: freezeWhenBlurred(ProjectsScreen),
  Search: freezeWhenBlurred(SearchScreen),
  Recipes: freezeWhenBlurred(RecipesScreen),
  Cookbooks: freezeWhenBlurred(CookbooksScreen),
  MealPlan: freezeWhenBlurred(MealPlanScreen),
  Kitchen: freezeWhenBlurred(KitchenScreen),
  Calendar: freezeWhenBlurred(CalendarScreen),
  Categories: freezeWhenBlurred(CategoriesScreen),
  Tags: freezeWhenBlurred(TagsScreen),
  Meters: freezeWhenBlurred(MetersScreen),
  People: freezeWhenBlurred(PeopleScreen),
  Stacks: freezeWhenBlurred(StacksScreen),
  Templates: freezeWhenBlurred(TemplatesScreen),
  Logbook: freezeWhenBlurred(LogbookScreen),
  Stats: freezeWhenBlurred(StatsScreen),
  Mood: freezeWhenBlurred(MoodScreen),
  Medications: freezeWhenBlurred(MedicationScreen),
  Weight: freezeWhenBlurred(WeightScreen),
  Sleep: freezeWhenBlurred(SleepScreen),
  Journal: freezeWhenBlurred(JournalScreen),
  Dreams: freezeWhenBlurred(DreamsScreen),
  FoodLog: freezeWhenBlurred(FoodLogScreen),
  Stuck: freezeWhenBlurred(StuckScreen),
  Backfill: freezeWhenBlurred(BackfillScreen),
  Reminders: freezeWhenBlurred(RemindersScreen),
  Automations: freezeWhenBlurred(AutomationsScreen),
  Archived: freezeWhenBlurred(ArchivedScreen),
  UnattendedLog: freezeWhenBlurred(UnattendedLogScreen),
  Rewards: freezeWhenBlurred(RewardsScreen),
  Tips: freezeWhenBlurred(TipsScreen),
};

const DESTINATION_BY_ROUTE: ReadonlyMap<string, NavDestination> = new Map(
  NAV_MENU_ROWS.flatMap(row => row.kind === 'screen' ? [row.destination] : row.hub.members)
    .map(d => [d.route, d] as const)
);

/**
 * A menu screen's icon as a tab: the filled glyph where Ionicons has one
 * ("cart" for the menu's "cart-outline"), which is what the tab bar has always
 * drawn. A glyph with no filled twin is used as it is.
 */
function tabIconFor(icon: string): React.ComponentProps<typeof Ionicons>['name'] {
  const filled = icon.replace(/-outline$/, '');
  return (filled in Ionicons.glyphMap ? filled : icon) as React.ComponentProps<typeof Ionicons>['name'];
}

// The Groceries/Recipes/Meal plan/Kitchen hub (SideMenuDrawer's
// GROCERIES_HUB_TABS) drops out of the drawer entirely while kitchenEnabled is
// off, so reopening directly onto one would land somewhere the menu no longer
// offers a way back to. Checked only on the read side below — kitchenEnabled
// can't change out from under an *open* session onto one of these screens,
// since turning it off removes the only way to reach them.
const KITCHEN_SCREENS: ReadonlySet<string> = new Set(
  (NAV_HUBS.find(h => h.id === 'kitchen')?.members ?? []).map(m => m.route)
);

// RootStack cards, not tabs. Pushing one must leave the drawer's highlight on
// whichever tab you pushed it *from*, so these never become the active tab.
// A new pushed route missing from here highlights nothing and blanks the
// drawer's current selection.
const PUSHED_ROUTES = new Set([
  'Settings', 'SettingsGroup', 'TemplateDetail', 'ProjectDetail', 'CategoryDetail',
  // Saved views has no menu row (see NAV_EXTRA_DESTINATIONS): it is opened
  // from Today's filter sheet, and from the drawer's find field, which is why
  // handleDrawerNavigate below has to leave the tab highlight alone for these.
  'SavedViews', 'SavedViewDetail',
  'RecipeDetail', 'PersonDetail', 'CookbookDetail',
  // Reached from the Mood screen rather than from the menu. Both are the mood
  // log read at a narrower grain — every entry there is, and one symptom —
  // which is a place you go *from* Mood rather than a destination of its own,
  // and neither would survive a cold-launch restore with nothing to say what
  // it was showing.
  'MoodHistory', 'MoodDay', 'SymptomDetail',
]);

function MorePlaceholder() {
  return null;
}

const styles = StyleSheet.create({
  // The buttons sit in the top 49pt of the bar (the rest is the home
  // indicator's inset), so the capsule wraps that band with 4pt around it.
  glassTabBarSlot: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    top: -4,
    height: TAB_BAR_HEIGHT + 8,
  },
  glassTabBar: { borderRadius: radius.full },
  // The current tab's plate. Drawn here because the library paints
  // `tabBarActiveBackgroundColor` on the button with its radius fixed at 0,
  // and `tabBarItemStyle` reaches only the wrapper around it. Every icon gets
  // the same box (transparent when not current) so the glyphs don't shift.
  tabIconPlate: {
    width: 56,
    height: 34,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  edgeZone: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: EDGE_WIDTH,
  },
  timerDot: {
    position: 'absolute',
    top: -1,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

// Whether the side menu is open, for the More button's tint and nothing else.
// A context rather than a prop on MainTabs: as a prop it broke that memo, so
// opening or closing the menu re-rendered the whole tab navigator and, through
// it, the screen on show, all while the drawer was animating.
const MenuOpenContext = React.createContext(false);

function MoreMenuGlyph({ color, accentColor }: { color: string; accentColor: string }) {
  const menuOpen = useContext(MenuOpenContext);
  return <Ionicons name="menu" size={24} color={menuOpen ? accentColor : color} />;
}

function TabIconPlate({ focused, children }: { focused: boolean; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={[styles.tabIconPlate, focused && { backgroundColor: colors.accentSubtle }]}>
      {children}
    </View>
  );
}

interface MainTabsProps {
  initialRouteName: string;
  screenOptions: any;
  tabPressHaptic: { tabPress: () => void };
  accentColor: string;
  onOpenMenu: () => void;
}

// Memoized so toggling unrelated screen-level state elsewhere in
// AppNavigator (e.g. opening Settings) doesn't force every tab screen to
// re-render and recompute its derived task lists — that recompute was
// blocking the settings modal's open animation.
const MainTabs = React.memo(function MainTabs({
  initialRouteName, screenOptions, tabPressHaptic, accentColor, onOpenMenu,
}: MainTabsProps) {
  const colors = useColors();
  // Recipes and meal plan live behind the drawer with no tab of their own, so
  // a cook/prep timer left running has nowhere to show once you've left the
  // recipe screen except here — see hasRunningRecipeTimer's doc comment.
  // Gated on kitchenEnabled: a timer can outlive the switch being turned off,
  // and a dot on the menu button pointing at a screen the menu no longer lists
  // is a notification with nowhere to go.
  const kitchenEnabled = useSettingsStore(state => state.kitchenEnabled);
  // Which screens get a button, through the same rule the menu uses, so a
  // tab whose screen the kitchen switch or simplified mode took away drops
  // out of the bar rather than pointing at something the menu no longer lists.
  const tabRoutes = useSettingsStore(state => state.tabRoutes);
  const menuOptions = useNavMenuOptions();
  const visibleTabs = useMemo(() => visibleTabRoutes(tabRoutes, menuOptions), [tabRoutes, menuOptions]);
  const anyTimerRunning = useRecipeStore(state => state.recipes.some(hasRunningRecipeTimer));
  const timerRunning = kitchenEnabled && anyTimerRunning;
  // Which recipe the dot means, when it means a *cook* specifically: tapping
  // More jumps straight into that recipe's Cook Mode instead of opening the
  // drawer, the same destination CookingBar's own tap goes to. A prep timer
  // alone still just opens the drawer as before — prep has no cook-mode
  // screen for a tap to land on, so the dot there is see-only.
  const runningCookRecipeId = useRecipeStore(state => state.recipes.find(isCookTimerRunning)?.id);
  const cookingRecipeId = kitchenEnabled ? runningCookRecipeId : undefined;
  return (
    <Tab.Navigator initialRouteName={initialRouteName} screenOptions={screenOptions}>
      {/* The chosen tabs, in the chosen order, then More, then every other
          route hidden. The bar draws its buttons in route order, so this
          order is the bar's. Tab.Screen children are keyed by name, so a
          reorder moves screens rather than remounting them. */}
      {visibleTabs.map(route => {
        const destination = DESTINATION_BY_ROUTE.get(route);
        return (
          <Tab.Screen
            key={route}
            name={route}
            component={TAB_SCREENS[route]}
            listeners={tabPressHaptic}
            options={{
              tabBarAccessibilityLabel: destination?.label ?? route,
              tabBarIcon: ({ color, size, focused }) => (
                <TabIconPlate focused={focused}>
                  {destination?.icon === COIN_ICON
                    ? <CoinIcon size={size} color={color} />
                    : <Ionicons name={tabIconFor(destination?.icon ?? 'ellipse-outline')} size={size} color={color} />}
                </TabIconPlate>
              ),
            }}
          />
        );
      })}
      <Tab.Screen
        name="More"
        component={MorePlaceholder}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            haptics.tap();
            if (cookingRecipeId) {
              resetToRecipeDetail(cookingRecipeId, { openCookMode: true });
            } else {
              onOpenMenu();
            }
          },
        }}
        options={{
          tabBarAccessibilityLabel: cookingRecipeId
            ? 'More, a cook timer is running, opens cook mode'
            : timerRunning
              ? 'More, opens menu, a prep timer is running'
              : 'More, opens menu',
          tabBarIcon: ({ color, focused }) => (
            <TabIconPlate focused={focused}>
              <View>
                <MoreMenuGlyph color={color} accentColor={accentColor} />
                {timerRunning && <View style={[styles.timerDot, { backgroundColor: colors.orange }]} />}
              </View>
            </TabIconPlate>
          ),
        }}
      />
      {/* Every other route: reachable from the menu, a link or a hub's pill
          row, with no button of its own. */}
      {Object.keys(TAB_SCREENS).filter(route => !visibleTabs.includes(route)).map(route => (
        <Tab.Screen key={route} name={route} component={TAB_SCREENS[route]} options={HIDDEN} />
      ))}
    </Tab.Navigator>
  );
});

// Read once, directly off the store rather than a reactive selector — this
// only has to answer "where did we leave off" for Tab.Navigator's
// initialRouteName, which React Navigation itself only honors on first
// mount. Subscribing here would re-render (and, being memoized on identity,
// re-render MainTabs) on every tab switch for the rest of the session, which
// is exactly what MainTabs's own React.memo exists to prevent.
function initialScreenFromSettings(): string {
  const { kitchenEnabled, simpleMode } = useSettingsStore.getState();
  // A screen the last launch never got past (see launchGuard.ts) is not
  // restored, or a screen that crashes on open would crash every cold start.
  const { screen: lastVisitedScreen, tripped } = screenToRestore(
    useSettingsStore.getState().lastVisitedScreen,
    readUnprovenScreen(),
  );
  if (tripped) {
    clearUnprovenScreen();
    useSettingsStore.getState().setLastVisitedScreen(null);
  }
  if (!lastVisitedScreen || !RESTORABLE_SCREENS.has(lastVisitedScreen)) return 'Today';
  if (KITCHEN_SCREENS.has(lastVisitedScreen) && !kitchenEnabled) return 'Today';
  // Same question the drawer asks, with the same counts — reopening onto a
  // screen the menu no longer lists would be the kitchen guard's problem all
  // over again. Safe to read the stores here: `useTaskStore.initialize()`
  // fans out to both of these, and AppGate runs it (and blocks on it) before
  // AppRoot and this navigator mount at all.
  if (!screenShown(lastVisitedScreen, simpleMode, {
    stacks: useTaskGroupStore.getState().groups.length,
    templates: useTemplateStore.getState().templates.length,
    people: usePersonStore.getState().people.length,
    mood: useMoodStore.getState().logs.length,
    medications: useMedicationStore.getState().logs.length,
    journal: useJournalStore.getState().entries.filter(e => e.kind === 'journal').length,
    dreams: useJournalStore.getState().entries.filter(e => e.kind === 'dream').length,
    foodLog: useFoodLogStore.getState().totalCount,
    meters: useMeterReadingStore.getState().readings.length,
  })) return 'Today';
  // Restored but unproven until it has stayed up (a restore to Today needs no guard).
  if (lastVisitedScreen !== 'Today') markScreenUnproven(lastVisitedScreen);
  return lastVisitedScreen;
}

export default function AppNavigator() {
  const colors = useColors();
  const { isDark } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [initialRouteName] = useState(initialScreenFromSettings);
  const [activeTab, setActiveTab] = useState(initialRouteName);
  // Today draws its own inline strip for a focus session; everywhere else,
  // pushed cards included, gets the floating one.
  const [onToday, setOnToday] = useState(initialRouteName === 'Today');
  // Stable function reference (Zustand actions never change identity), so
  // selecting only this doesn't subscribe AppNavigator to lastVisitedScreen
  // itself — see initialScreenFromSettings above.
  const setLastVisitedScreen = useSettingsStore(s => s.setLastVisitedScreen);
  const pushRecentScreen = useSettingsStore(s => s.pushRecentScreen);
  const navRef = navigationRef;


  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const openSettings = useCallback(() => {
    navRef.current?.navigate('Settings' as never);
  }, []);

  // Light selection tick on every tab switch, matching native tab bars.
  const tabPressHaptic = useMemo(() => ({
    tabPress: () => {
      haptics.tap();
    },
  }), []);

  const edgePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (e) => e.nativeEvent.pageX < EDGE_WIDTH,
      onMoveShouldSetPanResponder: (e, gs) =>
        e.nativeEvent.pageX < EDGE_WIDTH + 10 &&
        gs.dx > 8 &&
        Math.abs(gs.dx) > Math.abs(gs.dy),
      onPanResponderRelease: (_e, gs) => {
        if (gs.dx > 40 || gs.vx > 0.4) openMenu();
      },
    })
  ).current;

  const handleDrawerNavigate = useCallback((tabName: string) => {
    // The left-edge strip that opens the drawer sits over pushed cards too,
    // so a tab picked here may be under one — see navigateToTab.
    if (PUSHED_ROUTES.has(tabName)) {
      navRef.current?.navigate(tabName as never);
    } else {
      setActiveTab(tabName);
      navigateToTab(tabName);
    }
  }, []);

  // The bookkeeping a tab switch does, run just after it rather than inside
  // it. Each of these is a synchronous database write and a store write that
  // every settings subscriber on screen is asked about, plus a render of this
  // navigator and everything it overlays, and none of it is anything the
  // screen being switched to needs to draw. Queued in order and flushed
  // together, so a quick run of switches still records every screen.
  const pendingScreensRef = useRef<string[]>([]);
  const screenFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushScreenBookkeeping = useCallback(() => {
    screenFlushRef.current = null;
    const screens = pendingScreensRef.current;
    pendingScreensRef.current = [];
    if (screens.length === 0) return;
    const latest = screens[screens.length - 1];
    // Remembered so the next cold launch reopens here instead of always on
    // Today — every non-pushed route name is a RESTORABLE_SCREENS member,
    // so no further check is needed on write.
    setLastVisitedScreen(latest);
    // The side menu's Recent row, and which screen a hub row opens.
    screens.forEach(pushRecentScreen);
    setActiveTab(latest);
  }, [setLastVisitedScreen, pushRecentScreen]);
  useEffect(() => () => {
    if (screenFlushRef.current) clearTimeout(screenFlushRef.current);
  }, []);

  const handleStateChange = useCallback(() => {
    const currentName = navRef.current?.getCurrentRoute()?.name;
    if (currentName) setOnToday(currentName === 'Today');
    if (!currentName || currentName === 'More' || PUSHED_ROUTES.has(currentName)) return;
    // Not deferred with the rest: the launch guard has to hear about a screen
    // before anything slow it does can crash, and it only matters at all
    // alongside lastVisitedScreen, which a deferred write leaves pointing at
    // the screen before (so a crash in between restores that one instead).
    markScreenUnproven(currentName);
    pendingScreensRef.current.push(currentName);
    if (!screenFlushRef.current) {
      screenFlushRef.current = setTimeout(flushScreenBookkeeping, SCREEN_BOOKKEEPING_DELAY_MS);
    }
  }, [flushScreenBookkeeping]);

  const screenOptions = useMemo(() => ({
    headerShown: false,
    tabBarStyle: {
      position: 'absolute' as const,
      backgroundColor: 'transparent',
      borderTopWidth: 0,
      elevation: 0,
      // The capsule sits `spacing.md` in from each screen edge, and the
      // buttons divide the bar's full width, so the end icons landed almost
      // on the capsule's rim. This insets them from it (the glass slot is
      // absolutely positioned, so padding moves only the buttons).
      paddingHorizontal: spacing.md + spacing.lg,
    },
    // On iOS 26 the bar floats: a glass capsule inset from both side edges and
    // lifted off the bottom, around the buttons. The bar itself keeps its
    // height and flush bottom edge (transparent), because many screens and the
    // bars above it measure from that footprint, so none of them move. Older
    // iOS keeps the full-width blur.
    tabBarBackground: () => (
      glassSupported() ? (
        <View style={styles.glassTabBarSlot} pointerEvents="none">
          <GlassLayer style={styles.glassTabBar} />
        </View>
      ) : (
        <SafeBlurView
          intensity={isDark ? 60 : 80}
          tint={isDark ? 'dark' : 'light'}
          style={[StyleSheet.absoluteFill, {
            borderTopWidth: border.hairline,
            borderTopColor: colors.separator,
          }]}
        />
      )
    ),
    tabBarActiveTintColor: colors.accent,
    // Over the glass the pale accent and the grey inactive icons read as
    // near-equal brightness, so the current tab also gets a tinted plate,
    // drawn by `TabIconPlate` (see its style for why not the library's prop).
    tabBarInactiveTintColor: colors.textTertiary,
    tabBarShowLabel: false,
    // react-navigation's icon-only item is `justifyContent: 'flex-start'`, so
    // the icon hangs from the top of the band instead of sitting in the
    // middle of the capsule that wraps it. Centering the button in its slot
    // puts every glyph on the capsule's midline.
    tabBarItemStyle: { paddingVertical: 3, justifyContent: 'center' as const },
  }), [colors, isDark]);

  return (
    <>
      <MenuOpenContext.Provider value={menuOpen}>
      <NavigationContainer
        ref={navRef}
        onStateChange={handleStateChange}
        // Replays any resetTo*/openQuickAdd* call that arrived before the
        // container was ready — a widget tap or Home Screen quick action that
        // raced app startup — instead of leaving it silently dropped. See
        // navigationRef.ts's runWhenReady/flushPendingNavigation.
        onReady={flushPendingNavigation}
      >
        <RootStack.Navigator screenOptions={{ headerShown: false }}>
          <RootStack.Screen name="MainTabs">
            {() => (
              <MainTabs
                initialRouteName={initialRouteName}
                screenOptions={screenOptions}
                tabPressHaptic={tabPressHaptic}
                accentColor={colors.accent}
                onOpenMenu={openMenu}
              />
            )}
          </RootStack.Screen>
          <RootStack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ presentation: 'card' }}
          />
          <RootStack.Screen
            name="SettingsGroup"
            component={SettingsGroupScreen}
            options={{ presentation: 'card' }}
          />
          <RootStack.Screen
            name="RecipeDetail"
            component={RecipeDetailScreen}
            options={{ presentation: 'card' }}
          />
          <RootStack.Screen
            name="CookbookDetail"
            component={CookbookDetailScreen}
            options={{ presentation: 'card' }}
          />
          <RootStack.Screen
            name="TemplateDetail"
            component={TemplateDetailScreen}
            options={{ presentation: 'card' }}
          />
          <RootStack.Screen
            name="ProjectDetail"
            component={ProjectDetailScreen}
            options={{ presentation: 'card' }}
          />
          <RootStack.Screen
            name="CategoryDetail"
            component={CategoryDetailScreen}
            options={{ presentation: 'card' }}
          />
          <RootStack.Screen
            name="SavedViews"
            component={SavedViewsScreen}
            options={{ presentation: 'card' }}
          />
          <RootStack.Screen
            name="SavedViewDetail"
            component={SavedViewDetailScreen}
            options={{ presentation: 'card' }}
          />
          <RootStack.Screen
            name="MoodHistory"
            component={MoodHistoryScreen}
            options={{ presentation: 'card' }}
          />
          <RootStack.Screen
            name="MoodDay"
            component={MoodDayScreen}
            options={{ presentation: 'card' }}
          />
          <RootStack.Screen
            name="SymptomDetail"
            component={SymptomDetailScreen}
            options={{ presentation: 'card' }}
          />
          <RootStack.Screen
            name="PersonDetail"
            component={PersonDetailScreen}
            options={{ presentation: 'card' }}
          />
        </RootStack.Navigator>
        {/* Inside NavigationContainer, unlike its siblings below, because it
            renders FoodLogEntrySheet and (via ScanToLogFlow) ScanPortionSheet
            and BarcodeScanSheet, all of which use useKeyboardInsetScroll —
            which calls useIsFocused and so needs a navigation object. It's
            still a sibling of the Navigator rather than a screen, so it stays
            mounted across every screen exactly as before. */}
        <LogMealEntrySheet />
      </NavigationContainer>
      </MenuOpenContext.Provider>
      {/* TEMPORARY: the blank-tab diagnostic, drawn outside every tab. */}
      <BlankTabDiagnostic currentTab={currentTabName} />

      <SideMenuDrawer
        visible={menuOpen}
        onClose={closeMenu}
        onNavigate={handleDrawerNavigate}
        onOpenSettings={openSettings}
        activeTab={activeTab}
      />
      {!menuOpen && (
        <View
          style={styles.edgeZone}
          {...edgePanResponder.panHandlers}
        />
      )}
      {/* Outside the NavigationContainer so it stays put across every screen
          and modal — demo mode isn't a place you navigate to, it's a state
          the whole app is in. */}
      <DemoBanner />
      {/* Same placement again: a destructive action's undo window is a state
          the app is in for a few seconds, not a screen — see UndoBar's own
          doc comment for why it belongs beside DemoBanner. */}
      <UndoBar />
      {/* Beside it: the coins a tick just earned are a moment, not a screen.
          See CoinToast. */}
      <CoinToast />
      {/* And the event a person just added: a moment with one tap to see it
          in the system calendar. See EventCreatedToast. */}
      <EventCreatedToast />
      {/* Beside it, for the same reason: "X is ready" is a moment after a
          tap, not a screen. See ReadyOfferBar. */}
      <ReadyOfferBar />
      {/* "Pick dates" asking for Coming back, or offering to move Leaving:
          raised by an answer given anywhere. See TripDatePrompt. */}
      <TripDatePrompt />
      {/* Same placement again, and for the same "not tied to a screen" reason:
          each renders nothing (FinishLeftoverPrompt) or a plain Modal
          (UseUpResolveSheet's LeftoverSheet, CookRecap's sheet), touching no
          navigation hooks, so none needs NavigationContainer. See their own doc
          comments. (LogMealEntrySheet moved inside NavigationContainer above,
          for the reason noted there.) */}
      <FinishLeftoverPrompt />
      <LogMealPrompt />
      <HealthWriteRefusedNotice />
      <UseUpResolveSheet />
      {/* Mounted once here rather than on the two screens a meal is ticked off
          from, which is what the offers it replaced did. A banner rendered
          twice is invisible twice over — only the focused screen is on screen —
          but `enableScreens(false)` keeps a blurred tab mounted (see CLAUDE.md),
          so two copies of a *sheet* would each present a Modal for the same
          cooking. Same reason FinishLeftoverPrompt above is mounted once. */}
      <CookRecap />
      {/* Same "not a screen" placement, and floating rather than a sibling of
          a list the way ActiveTripBanner is — see CookingBar's own doc
          comment for why a cook timer needs the app-wide bar that shopping
          trip deliberately doesn't get. */}
      <CookingBar />
      {/* A minimized focus session's way back from every screen but Today,
          which has its own inline strip. See FocusFloatingBar. */}
      <FocusFloatingBar hidden={onToday} />
    </>
  );
}
