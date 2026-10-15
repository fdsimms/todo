import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { Animated, Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors, useTheme } from '../theme/ThemeContext';
import { animation, font, iconSize, interaction, radius, spacing } from '../theme';
import { haptics } from '../utils/haptics';
import { hubForRoute, type NavMenuOptions } from '../utils/navHubs';
import {
  HUB_MENU_ARROW_SIZE, HUB_MENU_PADDING, HUB_MENU_ROW_HEIGHT, hubMenuItems, type ButtonFrame,
} from '../utils/tabHubMenu';
import { useTabHubMenuStore, type TabHubMenu } from '../store/useTabHubMenuStore';
import { currentTabName, navigateToTab } from '../navigation/navigationRef';

/**
 * Long press a tab that belongs to a hub (Groceries, Recipes, Meal plan, ...)
 * and a card opens above it listing the hub's other screens; drag to one and
 * lift to open it. Where the card goes and which row a finger is over is
 * `src/utils/tabHubMenu.ts`; this file is the gesture and the drawing.
 *
 * The card is drawn by `TabHubMenuOverlay`, mounted once in `AppNavigator`,
 * and not here: it has to cover the whole screen, and the tab bar clips
 * neither the drawing nor the touches of a button's own children. The button
 * and the overlay talk through `useTabHubMenuStore`.
 */

/** Long enough that a plain tap or a slow tap never opens it. */
const LONG_PRESS_MS = 350;

/** The menu rules the tab buttons read, supplied once by the navigator that draws them. */
const HubMenuOptionsContext = createContext<NavMenuOptions | null>(null);
export const HubMenuOptionsProvider = HubMenuOptionsContext.Provider;

function HubTabButton({
  route, children, style, onPress, onLongPress, accessibilityLabel, accessibilityState, accessibilityRole, testID,
}: BottomTabBarButtonProps & { route: string }) {
  const options = useContext(HubMenuOptionsContext);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const viewRef = useRef<View>(null);
  const frameRef = useRef<ButtonFrame | null>(null);
  // Set when the card opens, so the lift that follows isn't also read as a tap
  // on this tab by the Pressable underneath. Cleared a moment after the
  // gesture ends, because that press can land just after it does.
  const swallowPress = useRef(false);

  const gesture = useMemo(() => Gesture.Pan()
    .activateAfterLongPress(LONG_PRESS_MS)
    .runOnJS(true)
    // Measured on touch-down, so the frame is there by the time the card opens.
    .onBegin(() => {
      viewRef.current?.measureInWindow((x, y, width, height) => {
        frameRef.current = { x, y, width, height };
      });
    })
    .onStart(e => {
      const frame = frameRef.current;
      const menuOptions = optionsRef.current;
      if (!frame || !menuOptions) return;
      const items = hubMenuItems(route, menuOptions);
      if (!items) return;
      swallowPress.current = true;
      haptics.impactMedium();
      const store = useTabHubMenuStore.getState();
      store.open({ items, frame, screenWidth: Dimensions.get('window').width, current: currentTabName() });
      store.point(e.absoluteX, e.absoluteY);
    })
    .onUpdate(e => {
      if (useTabHubMenuStore.getState().point(e.absoluteX, e.absoluteY)) haptics.dragTick();
    })
    .onEnd(e => {
      const outcome = useTabHubMenuStore.getState().release(e.absoluteX, e.absoluteY);
      if (outcome.kind === 'open') {
        haptics.tap();
        navigateToTab(outcome.route);
      }
    })
    .onFinalize(() => {
      // A gesture that ended some other way (cancelled by the system) leaves
      // the card up with nothing driving it; one waiting for a tap stays.
      const { menu, close } = useTabHubMenuStore.getState();
      if (menu && !menu.sticky) close();
      if (swallowPress.current) setTimeout(() => { swallowPress.current = false; }, 400);
    }), [route]);

  return (
    <GestureDetector gesture={gesture}>
      <View ref={viewRef} collapsable={false} style={styles.buttonSlot}>
        <Pressable
          style={({ pressed }) => [style, pressed && { opacity: interaction.activeOpacity }]}
          onPress={e => { if (!swallowPress.current) onPress?.(e); }}
          onLongPress={onLongPress}
          accessibilityRole={accessibilityRole}
          accessibilityLabel={accessibilityLabel}
          accessibilityState={accessibilityState}
          testID={testID}
        >
          {children}
        </Pressable>
      </View>
    </GestureDetector>
  );
}

// One component per route, made once. `tabBarButton` takes a render function,
// and a fresh one each render would remount the button, and the gesture on it.
const buttonByRoute = new Map<string, (props: BottomTabBarButtonProps) => React.ReactElement>();

/**
 * The `tabBarButton` option for a route, or undefined for one that is in no
 * hub (the library's own button is right for those). A hub tab whose hub has
 * run down to a single screen keeps this button, which then opens nothing.
 */
export function hubTabButtonFor(route: string): ((props: BottomTabBarButtonProps) => React.ReactElement) | undefined {
  if (!hubForRoute(route)) return undefined;
  let button = buttonByRoute.get(route);
  if (!button) {
    button = props => <HubTabButton {...props} route={route} />;
    buttonByRoute.set(route, button);
  }
  return button;
}

/** Draws the open card. Mounted once, above everything the navigator draws. */
export function TabHubMenuOverlay() {
  const menu = useTabHubMenuStore(s => s.menu);
  if (!menu) return null;
  return <HubMenuCard menu={menu} />;
}

function HubMenuCard({ menu }: { menu: TabHubMenu }) {
  const colors = useColors();
  const { shadows } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;
  const { layout, items, hotIndex, sticky, current } = menu;

  useEffect(() => {
    Animated.spring(progress, { toValue: 1, useNativeDriver: true, ...animation.spring.snappy }).start();
  }, [progress]);

  const close = () => useTabHubMenuStore.getState().close();

  return (
    // While a finger is down the gesture on the button owns the touch, so
    // nothing here takes one; once the card is waiting for a tap it does.
    <View style={StyleSheet.absoluteFill} pointerEvents={sticky ? 'auto' : 'none'} accessibilityViewIsModal={sticky}>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }]}
        onPress={close}
        accessibilityLabel="Close menu"
      />
      <Animated.View
        style={[
          styles.card,
          shadows.card,
          {
            left: layout.left,
            top: layout.top,
            width: layout.width,
            height: layout.height,
            backgroundColor: colors.bgSecondary,
            opacity: progress,
            // Grows out of the arrow's point, so it reads as coming from the button.
            transformOrigin: `${layout.arrowLeft}px ${layout.height + HUB_MENU_ARROW_SIZE / 2}px`,
            transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
          },
        ]}
      >
        {/* Centred on the card's bottom edge, so half of it points at the button. */}
        <View
          style={[
            styles.arrow,
            { left: layout.arrowLeft - HUB_MENU_ARROW_SIZE / 2, backgroundColor: colors.bgSecondary },
          ]}
        />
        {items.map((item, index) => {
          const hot = index === hotIndex;
          const isCurrent = item.route === current;
          const ink = hot ? colors.onAccent : colors.text;
          return (
            <Pressable
              key={item.route}
              style={[styles.row, hot && { backgroundColor: colors.accentFill }]}
              onPress={() => {
                haptics.tap();
                close();
                navigateToTab(item.route);
              }}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: isCurrent }}
            >
              <Ionicons
                name={item.icon as React.ComponentProps<typeof Ionicons>['name']}
                size={iconSize.md}
                color={hot ? colors.onAccent : colors.textSecondary}
              />
              <Text
                style={[styles.label, { color: ink }]}
                numberOfLines={1}
                // The rows are a fixed height because the drag's hit-testing is arithmetic on it.
                maxFontSizeMultiplier={1.2}
              >
                {item.label}
              </Text>
              {isCurrent && <View style={[styles.currentDot, { backgroundColor: hot ? colors.onAccent : colors.accent }]} />}
            </Pressable>
          );
        })}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  buttonSlot: { flex: 1 },
  card: {
    position: 'absolute',
    borderRadius: radius.lg,
    padding: HUB_MENU_PADDING,
  },
  arrow: {
    position: 'absolute',
    bottom: -HUB_MENU_ARROW_SIZE / 2,
    width: HUB_MENU_ARROW_SIZE,
    height: HUB_MENU_ARROW_SIZE,
    transform: [{ rotate: '45deg' }],
  },
  row: {
    height: HUB_MENU_ROW_HEIGHT,
    borderRadius: radius.md - 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    paddingHorizontal: spacing.smd,
  },
  label: { flex: 1, fontSize: font.lg },
  currentDot: { width: 8, height: 8, borderRadius: 4 },
});
