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
import { CategoriesScreen } from '../screens/CategoriesScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { ProjectsScreen } from '../screens/ProjectsScreen';
import { LogbookScreen } from '../screens/LogbookScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { ArchivedScreen } from '../screens/ArchivedScreen';
import { TemplatesScreen } from '../screens/TemplatesScreen';
import { TemplateDetailScreen } from '../screens/TemplateDetailScreen';
import { ProjectDetailScreen } from '../screens/ProjectDetailScreen';
import { CategoryDetailScreen } from '../screens/CategoryDetailScreen';
import { SideMenuDrawer } from '../components/SideMenuDrawer';
import { SettingsScreen } from '../screens/SettingsScreen';
import { DemoScreen } from '../screens/DemoScreen';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { border } from '../theme';
import { haptics } from '../utils/haptics';

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();
const EDGE_WIDTH = 20;

// Screens only reachable via the drawer — hidden from the tab bar.
const HIDDEN = { tabBarButton: () => null };

const DRAWER_TABS = new Set(['Tags', 'Categories', 'Templates', 'Logbook', 'Stats', 'Archived']);

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
});

interface MainTabsProps {
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
  screenOptions, tabPressHaptic, menuOpen, accentColor, onOpenMenu,
}: MainTabsProps) {
  return (
    <Tab.Navigator screenOptions={screenOptions}>
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
        name="Search"
        component={SearchScreen}
        listeners={tabPressHaptic}
        options={{
          tabBarAccessibilityLabel: 'Search',
          tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />,
        }}
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
          tabBarAccessibilityLabel: 'More, opens menu',
          tabBarIcon: ({ color }) => (
            <Ionicons name="menu" size={24} color={menuOpen ? accentColor : color} />
          ),
        }}
      />

      {/* Drawer-only screens — not visible in the tab bar */}
      <Tab.Screen name="Categories" component={CategoriesScreen} options={HIDDEN} />
      <Tab.Screen name="Tags" component={TagsScreen} options={HIDDEN} />
      <Tab.Screen name="Templates" component={TemplatesScreen} options={HIDDEN} />
      <Tab.Screen name="Logbook" component={LogbookScreen} options={HIDDEN} />
      <Tab.Screen name="Stats" component={StatsScreen} options={HIDDEN} />
      <Tab.Screen name="Archived" component={ArchivedScreen} options={HIDDEN} />
    </Tab.Navigator>
  );
});

export default function AppNavigator() {
  const colors = useColors();
  const { isDark } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('Today');
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
    if (currentName && !DRAWER_TABS.has(currentName) && currentName !== 'More'
      && currentName !== 'Settings' && currentName !== 'Demo'
      && currentName !== 'TemplateDetail' && currentName !== 'ProjectDetail' && currentName !== 'CategoryDetail') {
      setActiveTab(currentName);
    }
  }, []);

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
            name="Demo"
            component={DemoScreen}
            options={{ presentation: 'fullScreenModal' }}
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
    </>
  );
}
