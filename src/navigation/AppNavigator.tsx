import React, { useCallback, useMemo, useRef, useState } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { TodayScreen } from '../screens/TodayScreen';
import { LaterScreen } from '../screens/LaterScreen';
import { TagsScreen } from '../screens/TagsScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { SomedayScreen } from '../screens/SomedayScreen';
import { LogbookScreen } from '../screens/LogbookScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { SideMenuDrawer } from '../components/SideMenuDrawer';
import { useColors } from '../theme/ThemeContext';
import { font } from '../theme';

const Tab = createBottomTabNavigator();

// Screens only reachable via the drawer — hidden from the tab bar.
const HIDDEN = { tabBarButton: () => null };

const DRAWER_TABS = new Set(['Later', 'Someday', 'Tags', 'Logbook', 'Stats']);

function MorePlaceholder() {
  return null;
}

export default function AppNavigator() {
  const colors = useColors();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('Today');
  const navRef = useRef<NavigationContainerRef<any>>(null);

  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const handleDrawerNavigate = useCallback((tabName: string) => {
    setActiveTab(tabName);
    navRef.current?.navigate(tabName as never);
  }, []);

  const handleStateChange = useCallback(() => {
    const currentName = navRef.current?.getCurrentRoute()?.name;
    if (currentName && !DRAWER_TABS.has(currentName) && currentName !== 'More') {
      setActiveTab(currentName);
    }
  }, []);

  const screenOptions = useMemo(() => ({
    headerShown: false,
    tabBarStyle: {
      backgroundColor: colors.bgSecondary,
      borderTopColor: colors.separator,
      borderTopWidth: 0.5,
    },
    tabBarActiveTintColor: colors.accent,
    tabBarInactiveTintColor: colors.textTertiary,
    tabBarLabelStyle: { fontSize: font.xs, fontWeight: '600' as const, letterSpacing: 0.2 },
    tabBarItemStyle: { paddingVertical: 3 },
  }), [colors]);

  return (
    <>
      <NavigationContainer ref={navRef} onStateChange={handleStateChange}>
        <Tab.Navigator screenOptions={screenOptions}>
          <Tab.Screen
            name="Today"
            component={TodayScreen}
            options={{
              tabBarIcon: ({ color, size }) => <Ionicons name="sunny" size={size} color={color} />,
            }}
          />
          <Tab.Screen
            name="Search"
            component={SearchScreen}
            options={{
              tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />,
            }}
          />
          <Tab.Screen
            name="More"
            component={MorePlaceholder}
            listeners={{
              tabPress: (e) => {
                e.preventDefault();
                openMenu();
              },
            }}
            options={{
              tabBarIcon: ({ color }) => (
                <Ionicons name="menu" size={24} color={menuOpen ? colors.accent : color} />
              ),
              tabBarLabel: 'Menu',
            }}
          />

          {/* Drawer-only screens — not visible in the tab bar */}
          <Tab.Screen name="Later" component={LaterScreen} options={HIDDEN} />
          <Tab.Screen name="Someday" component={SomedayScreen} options={HIDDEN} />
          <Tab.Screen name="Tags" component={TagsScreen} options={HIDDEN} />
          <Tab.Screen name="Logbook" component={LogbookScreen} options={HIDDEN} />
          <Tab.Screen name="Stats" component={StatsScreen} options={HIDDEN} />
        </Tab.Navigator>
      </NavigationContainer>

      <SideMenuDrawer
        visible={menuOpen}
        onClose={closeMenu}
        onNavigate={handleDrawerNavigate}
        activeTab={activeTab}
      />
    </>
  );
}
