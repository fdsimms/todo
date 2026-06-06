import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { TodayScreen } from '../screens/TodayScreen';
import { FocusScreen } from '../screens/FocusScreen';
import { LaterScreen } from '../screens/LaterScreen';
import { TagsScreen } from '../screens/TagsScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { useTaskStore } from '../store/useTaskStore';
import { colors, font } from '../theme';

const Tab = createBottomTabNavigator();

export default function AppNavigator() {
  const focusedCount = useTaskStore(s => s.focusedTasks().length);

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: colors.bgSecondary,
            borderTopColor: colors.separator,
            borderTopWidth: 0.5,
          },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textTertiary,
          tabBarLabelStyle: { fontSize: font.xs, fontWeight: '600', letterSpacing: 0.2 },
          tabBarItemStyle: { paddingVertical: 3 },
        }}
      >
        <Tab.Screen
          name="Today"
          options={{
            tabBarIcon: ({ color, size }) => <Ionicons name="sunny" size={size} color={color} />,
          }}
          component={TodayScreen}
        />
        <Tab.Screen
          name="Focus"
          options={{
            tabBarIcon: ({ color, size }) => <Ionicons name="star" size={size} color={color} />,
            tabBarBadge: focusedCount > 0 ? focusedCount : undefined,
            tabBarBadgeStyle: { backgroundColor: colors.orange, fontSize: 10 },
          }}
          component={FocusScreen}
        />
        <Tab.Screen
          name="Later"
          options={{
            tabBarIcon: ({ color, size }) => <Ionicons name="time" size={size} color={color} />,
          }}
          component={LaterScreen}
        />
        <Tab.Screen
          name="Tags"
          options={{
            tabBarIcon: ({ color, size }) => <Ionicons name="pricetag" size={size} color={color} />,
          }}
          component={TagsScreen}
        />
        <Tab.Screen
          name="Search"
          options={{
            tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />,
          }}
          component={SearchScreen}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
