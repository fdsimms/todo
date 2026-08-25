import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { navigationRef } from './navigationRef';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeBlurView } from '../components/SafeBlurView';
import { TodayScreen } from '../screens/TodayScreen';
import { TagsScreen } from '../screens/TagsScreen';
import { PeopleScreen } from '../screens/PeopleScreen';
import { CategoriesScreen } from '../screens/CategoriesScreen';
import { GroceryScreen } from '../screens/GroceryScreen';
import { StacksScreen } from '../screens/StacksScreen';
import { CalendarScreen } from '../screens/CalendarScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { ProjectsScreen } from '../screens/ProjectsScreen';
import { LogbookScreen } from '../screens/LogbookScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { ArchivedScreen } from '../screens/ArchivedScreen';
import { BackfillScreen } from '../screens/BackfillScreen';
import { WaitingScreen } from '../screens/WaitingScreen';
import { DriftScreen } from '../screens/DriftScreen';
import { TemplatesScreen } from '../screens/TemplatesScreen';
import { RecipesScreen } from '../screens/RecipesScreen';
import { RecipeDetailScreen } from '../screens/RecipeDetailScreen';
import { MealPlanScreen } from '../screens/MealPlanScreen';
import { KitchenScreen } from '../screens/KitchenScreen';
import { TemplateDetailScreen } from '../screens/TemplateDetailScreen';
import { ProjectDetailScreen } from '../screens/ProjectDetailScreen';
import { CategoryDetailScreen } from '../screens/CategoryDetailScreen';
import { PersonDetailScreen } from '../screens/PersonDetailScreen';
import { TipsScreen } from '../screens/TipsScreen';
import { SideMenuDrawer } from '../components/SideMenuDrawer';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SettingsGroupScreen } from '../screens/SettingsGroupScreen';
import { DemoBanner } from '../components/DemoBanner';
import { UndoBar } from '../components/UndoBar';
import { UseUpResolveSheet } from '../components/UseUpResolveSheet';
import { FinishLeftoverPrompt } from '../components/FinishLeftoverPrompt';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { border } from '../theme';
import { haptics } from '../utils/haptics';
import { useRecipeStore } from '../store/useRecipeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { hasRunningRecipeTimer } from '../utils/recipeTimer';
import { screenShown } from '../utils/simpleMode';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { usePersonStore } from '../store/usePersonStore';

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();
const EDGE_WIDTH = 20;

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

const DRAWER_TABS = new Set(['Search', 'Calendar', 'Tags', 'Categories', 'Stacks', 'Templates', 'Logbook', 'Stats', 'Backfill', 'Waiting', 'Drift', 'Archived', 'Recipes', 'MealPlan', 'Kitchen']);

// Every screen it's safe to reopen the app directly on: the visible bottom
// tabs plus every drawer screen, none of which take a route param. Excludes
// 'More' (not a real screen — its tabPress just opens the drawer) and every
// PUSHED_ROUTES entry below (RecipeDetail, ProjectDetail, … need an id the
// app can't invent on a cold launch). Backs the lastVisitedScreen setting
// (useSettingsStore) so the app reopens where it was left rather than always
// on Today — see initialRouteName below.
const RESTORABLE_SCREENS = new Set(['Today', 'Groceries', 'Projects', ...DRAWER_TABS]);

// The Groceries/Recipes/Meal plan/Kitchen hub (SideMenuDrawer's
// GROCERIES_HUB_TABS) drops out of the drawer entirely while kitchenEnabled is
// off, so reopening directly onto one would land somewhere the menu no longer
// offers a way back to. Checked only on the read side below — kitchenEnabled
// can't change out from under an *open* session onto one of these screens,
// since turning it off removes the only way to reach them.
const KITCHEN_SCREENS = new Set(['Groceries', 'Recipes', 'MealPlan', 'Kitchen']);

// RootStack cards, not tabs. Pushing one must leave the drawer's highlight on
// whichever tab you pushed it *from*, so these never become the active tab.
// A new pushed route missing from here highlights nothing and blanks the
// drawer's current selection.
const PUSHED_ROUTES = new Set([
  'Settings', 'SettingsGroup', 'TemplateDetail', 'ProjectDetail', 'CategoryDetail',
  'RecipeDetail', 'PersonDetail',
]);

function MorePlaceholder() {
  return null;
}

const styles = StyleSheet.create({
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

interface MainTabsProps {
  initialRouteName: string;
  screenOptions: any;
  tabPressHaptic: { tabPress: () => void };
  menuOpen: boolean;
  accentColor: string;
  onOpenMenu: () => void;
}

// Memoized so toggling unrelated screen-level state elsewhere in
// AppNavigator (e.g. opening Settings) doesn't force every tab screen to
// re-render and recompute its derived task lists — that recompute was
// blocking the settings modal's open animation.
const MainTabs = React.memo(function MainTabs({
  initialRouteName, screenOptions, tabPressHaptic, menuOpen, accentColor, onOpenMenu,
}: MainTabsProps) {
  const colors = useColors();
  // Recipes and meal plan live behind the drawer with no tab of their own, so
  // a cook/prep timer left running has nowhere to show once you've left the
  // recipe screen except here — see hasRunningRecipeTimer's doc comment.
  // Gated on kitchenEnabled: a timer can outlive the switch being turned off,
  // and a dot on the menu button pointing at a screen the menu no longer lists
  // is a notification with nowhere to go.
  const kitchenEnabled = useSettingsStore(state => state.kitchenEnabled);
  const anyTimerRunning = useRecipeStore(state => state.recipes.some(hasRunningRecipeTimer));
  const timerRunning = kitchenEnabled && anyTimerRunning;
  return (
    <Tab.Navigator initialRouteName={initialRouteName} screenOptions={screenOptions}>
      <Tab.Screen
        name="Today"
        component={TodayScreen}
        listeners={tabPressHaptic}
        options={{
          tabBarAccessibilityLabel: 'Today',
          tabBarIcon: ({ color, size }) => <Ionicons name="checkbox" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Groceries"
        component={GroceryScreen}
        listeners={tabPressHaptic}
        // Drops out of the tab bar (rather than losing its icon/label) while
        // kitchenEnabled is off, same gate SideMenuDrawer's "Groceries &
        // Meals" row uses — a tab pointing at a feature the user just turned
        // off in Settings would be a dead button.
        options={kitchenEnabled ? {
          tabBarAccessibilityLabel: 'Groceries',
          tabBarIcon: ({ color, size }) => <Ionicons name="cart" size={size} color={color} />,
        } : HIDDEN}
      />
      <Tab.Screen
        name="Projects"
        component={ProjectsScreen}
        listeners={tabPressHaptic}
        options={{
          tabBarAccessibilityLabel: 'Projects',
          tabBarIcon: ({ color, size }) => <Ionicons name="briefcase" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="More"
        component={MorePlaceholder}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            haptics.tap();
            onOpenMenu();
          },
        }}
        options={{
          tabBarAccessibilityLabel: timerRunning ? 'More, opens menu, a cook timer is running' : 'More, opens menu',
          tabBarIcon: ({ color }) => (
            <View>
              <Ionicons name="menu" size={24} color={menuOpen ? accentColor : color} />
              {timerRunning && <View style={[styles.timerDot, { backgroundColor: colors.orange }]} />}
            </View>
          ),
        }}
      />

      {/* Drawer-only screens — not visible in the tab bar */}
      <Tab.Screen name="Search" component={SearchScreen} options={HIDDEN} />
      <Tab.Screen name="Recipes" component={RecipesScreen} options={HIDDEN} />
      <Tab.Screen name="MealPlan" component={MealPlanScreen} options={HIDDEN} />
      <Tab.Screen name="Kitchen" component={KitchenScreen} options={HIDDEN} />
      <Tab.Screen name="Calendar" component={CalendarScreen} options={HIDDEN} />
      <Tab.Screen name="Categories" component={CategoriesScreen} options={HIDDEN} />
      <Tab.Screen name="Tags" component={TagsScreen} options={HIDDEN} />
      <Tab.Screen name="People" component={PeopleScreen} options={HIDDEN} />
      <Tab.Screen name="Stacks" component={StacksScreen} options={HIDDEN} />
      <Tab.Screen name="Templates" component={TemplatesScreen} options={HIDDEN} />
      <Tab.Screen name="Logbook" component={LogbookScreen} options={HIDDEN} />
      <Tab.Screen name="Stats" component={StatsScreen} options={HIDDEN} />
      <Tab.Screen name="Backfill" component={BackfillScreen} options={HIDDEN} />
      <Tab.Screen name="Waiting" component={WaitingScreen} options={HIDDEN} />
      <Tab.Screen name="Drift" component={DriftScreen} options={HIDDEN} />
      <Tab.Screen name="Archived" component={ArchivedScreen} options={HIDDEN} />
      <Tab.Screen name="Tips" component={TipsScreen} options={HIDDEN} />
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
  const { lastVisitedScreen, kitchenEnabled, simpleMode } = useSettingsStore.getState();
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
  })) return 'Today';
  // And Pantry, whose only route in is the hub pill row simplified mode
  // removes (see GroceriesHubPills). It isn't a `screenShown` case because it
  // isn't a menu row — the drawer never listed it.
  if (simpleMode && lastVisitedScreen === 'Kitchen') return 'Today';
  return lastVisitedScreen;
}

export default function AppNavigator() {
  const colors = useColors();
  const { isDark } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [initialRouteName] = useState(initialScreenFromSettings);
  const [activeTab, setActiveTab] = useState(() =>
    (initialRouteName === 'Today' || initialRouteName === 'Groceries' || initialRouteName === 'Projects')
      ? initialRouteName
      : 'Today'
  );
  // Stable function reference (Zustand actions never change identity), so
  // selecting only this doesn't subscribe AppNavigator to lastVisitedScreen
  // itself — see initialScreenFromSettings above.
  const setLastVisitedScreen = useSettingsStore(s => s.setLastVisitedScreen);
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
    setActiveTab(tabName);
    navRef.current?.navigate(tabName as never);
  }, []);

  const handleStateChange = useCallback(() => {
    const currentName = navRef.current?.getCurrentRoute()?.name;
    if (!currentName || currentName === 'More' || PUSHED_ROUTES.has(currentName)) return;
    // Remembered so the next cold launch reopens here instead of always on
    // Today — every non-pushed route name is a RESTORABLE_SCREENS member,
    // so no further check is needed on write.
    setLastVisitedScreen(currentName);
    if (!DRAWER_TABS.has(currentName)) {
      setActiveTab(currentName);
    }
  }, [setLastVisitedScreen]);

  const screenOptions = useMemo(() => ({
    headerShown: false,
    tabBarStyle: {
      position: 'absolute' as const,
      backgroundColor: 'transparent',
      borderTopWidth: 0,
      elevation: 0,
    },
    tabBarBackground: () => (
      <SafeBlurView
        intensity={isDark ? 60 : 80}
        tint={isDark ? 'dark' : 'light'}
        style={[StyleSheet.absoluteFill, {
          borderTopWidth: border.hairline,
          borderTopColor: colors.separator,
        }]}
      />
    ),
    tabBarActiveTintColor: colors.accent,
    tabBarInactiveTintColor: colors.textTertiary,
    tabBarShowLabel: false,
    tabBarItemStyle: { paddingVertical: 3 },
  }), [colors, isDark]);

  return (
    <>
      <NavigationContainer ref={navRef} onStateChange={handleStateChange}>
        <RootStack.Navigator screenOptions={{ headerShown: false }}>
          <RootStack.Screen name="MainTabs">
            {() => (
              <MainTabs
                initialRouteName={initialRouteName}
                screenOptions={screenOptions}
                tabPressHaptic={tabPressHaptic}
                menuOpen={menuOpen}
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
            name="PersonDetail"
            component={PersonDetailScreen}
            options={{ presentation: 'card' }}
          />
        </RootStack.Navigator>
      </NavigationContainer>

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
      {/* Same placement again, and for the same "not tied to a screen" reason:
          it renders nothing (FinishLeftoverPrompt) or a plain Modal
          (UseUpResolveSheet's LeftoverSheet), touching no navigation hooks,
          so neither needs NavigationContainer. See their own doc comments. */}
      <FinishLeftoverPrompt />
      <UseUpResolveSheet />
    </>
  );
}
