import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeBlurView } from './SafeBlurView';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { animation, font, fontWeight, interaction, radius, spacing } from '../theme';
import { haptics } from '../utils/haptics';
import { useReduceMotion } from '../utils/useReduceMotion';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';

const DRAWER_WIDTH = Math.round(Dimensions.get('window').width * 0.72);

interface MenuItem {
  name: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  /** Other tab names this row should also read as "active" for — the
   *  Groceries/Recipes/Meal plan trio now shares one row and a `GroceriesHubPills`
   *  switcher inside each screen, so the row must stay highlighted across all three. */
  alsoActiveFor?: string[];
}

// Groceries, Recipes and Meal plan share one row: three screens tightly
// coupled around a single kitchen workflow, switched via the pill row each
// of them renders under its header (`GroceriesHubPills`) rather than three
// separate drawer taps. The row always opens Groceries; the pills handle
// getting to the other two once you're in.
const GROCERIES_HUB_TABS = ['Groceries', 'Recipes', 'MealPlan'];

interface MenuItemWithGate extends MenuItem {
  /** Dropped from the menu while `kitchenEnabled` is off. */
  kitchen?: boolean;
}

const MENU_ITEMS: MenuItemWithGate[] = [
  { name: 'Today', icon: 'checkbox-outline', label: 'Tasks' },
  // Sits with Tasks rather than down among Logbook/Archived: it's a peer
  // surface you go to on purpose, not somewhere things end up.
  { name: 'Groceries', icon: 'cart-outline', label: 'Groceries & Meals', alsoActiveFor: GROCERIES_HUB_TABS, kitchen: true },
  { name: 'Categories', icon: 'folder-outline', label: 'Categories' },
  { name: 'Tags', icon: 'pricetag-outline', label: 'Tags' },
  { name: 'Stacks', icon: 'layers-outline', label: 'Stacks' },
  { name: 'Templates', icon: 'copy-outline', label: 'Templates' },
  { name: 'Logbook', icon: 'book-outline', label: 'Logbook' },
  { name: 'Stats', icon: 'bar-chart-outline', label: 'Stats' },
  { name: 'Waiting', icon: 'hourglass-outline', label: 'Waiting' },
  // Sits with Waiting rather than up with Tasks: both are "held out of the
  // daily list for a reason", and both are somewhere you go to clear a backlog
  // rather than somewhere you work.
  { name: 'Drift', icon: 'trending-down-outline', label: 'Drift' },
  { name: 'Archived', icon: 'archive-outline', label: 'Archived' },
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
  const groceryCount = useGroceryStore(s => s.items.filter(i => i.onList && !i.checked).length);
  // The one row this can remove, so the filter runs on every render rather
  // than being hoisted — it's a ten-item array and the setting is a scalar.
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const menuItems = kitchenEnabled ? MENU_ITEMS : MENU_ITEMS.filter(i => !i.kitchen);
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const dragOffsetX = useRef(new Animated.Value(0)).current;
  const [isRendered, setIsRendered] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);
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
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

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

          <ScrollView
            style={styles.items}
            contentContainerStyle={styles.itemsContent}
            showsVerticalScrollIndicator={false}
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
                </TouchableOpacity>
                </DrawerItemAppear>
              );
            })}
          </ScrollView>

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
