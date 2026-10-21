import React, { useEffect, useRef, useState } from 'react';
import { Animated, useWindowDimensions, PanResponder, StyleSheet, View } from 'react-native';
import { SheetModal } from './SheetModal';
import { SafeBlurView } from './SafeBlurView';
import { SheetScrim } from './SheetScrim';
import { MenuPanel } from './MenuPanel';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { animation } from '../theme';
import { haptics } from '../utils/haptics';
import { drawerWidthFor } from '../utils/frameWidth';

// 85% of a phone rather than the 72% this used to be. The drawer is the only
// thing on screen while it's open — everything behind it is blurred and dimmed
// and exists to be tapped through — so the strip it left showing was 28% of the
// display doing no work, and it was the same 28% a hub row's subtitle needed
// to name what it holds without truncating. On a wider window it stops at a
// fixed strip (`drawerWidthFor`), read per render because a Mac window resizes.

interface Props {
  visible: boolean;
  onClose: () => void;
  onNavigate: (tabName: string) => void;
  onOpenSettings: () => void;
  onOpenSettingsEntry?: (entryId: string) => void;
  onSearchEverything?: (query: string) => void;
  activeTab: string;
}

/**
 * The side menu.
 *
 * It held eighteen flat rows, which is about twice what a phone fits, so half
 * of it lived under a fold nothing announced and the fix for that was a
 * scroll-edge fade and a flashed scrollbar — both of which say "there is more"
 * without making any of it easier to reach. Eleven rows fit, and three of them
 * are hubs standing in for sixteen destinations. What goes where, and why,
 * is `navHubs.ts`; this file is the drawing.
 *
 * Two things carry the weight of the collapse:
 *
 * - **A hub row names its members underneath it, as chips.** "Organize" on
 *   its own is a guess; "Categories, Tags, People, Stacks, Templates" is an
 *   answer, and each name is also the way to that screen (see HubRow). It
 *   stays honest under simplified mode because the chips are built from the
 *   members that survived rather than written out.
 * - **The find field reaches the members directly.** A hub hides four or five
 *   destinations behind one label, so without this, consolidating the menu
 *   would have made "Drift" strictly harder to find than it was as a row.
 *   Typing filters to real destinations and a tap goes straight there, past
 *   the hub. Same call `settingsIndex.ts` makes for the same reason.
 */
export function SideMenuDrawer({ visible, onClose, onNavigate, onOpenSettings, onOpenSettingsEntry, onSearchEverything, activeTab }: Props) {
  const colors = useColors();
  const { isDark, shadows } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const drawerWidth = drawerWidthFor(windowWidth);
  // The responder and the close animations are built once, so they read the
  // width as it is when they run rather than as it was when they were made.
  const drawerWidthRef = useRef(drawerWidth);
  drawerWidthRef.current = drawerWidth;
  const translateX = useRef(new Animated.Value(-drawerWidth)).current;
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
        if (gs.dx < -drawerWidthRef.current * 0.3 || gs.vx < -0.5) {
          Animated.timing(dragOffsetX, { toValue: 0, duration: 0, useNativeDriver: true }).start();
          onClose();
        } else {
          Animated.spring(dragOffsetX, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragOffsetX, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }).start();
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      fastCloseRef.current = false;
      // Fully closed means parked at the old width's edge, which a resized
      // window has moved: park at the current one so it slides in from off
      // screen. Skipped mid-close, where jumping would be seen.
      if (!isRendered) translateX.setValue(-drawerWidthRef.current);
      setIsRendered(true);
      Animated.parallel([
        Animated.spring(translateX, {
          toValue: 0,
          ...animation.spring.smooth,
          useNativeDriver: true,
        }),
        // `sheetBackdropOut`'s value, not `sheetBackdropIn`'s: a drawer
        // sliding in reads faster than a bottom sheet rising, so it opens at
        // the same pace the other sheets close at instead of their slower one.
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: animation.duration.sheetBackdropOut,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      const closeAnimations = fastCloseRef.current
        ? [
            Animated.timing(translateX, {
              toValue: -drawerWidthRef.current,
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
            // A timed curve, not a spring: a spring only reports done once it
            // has fully settled, and this callback is what unmounts the Modal.
            // Until then the (invisible) Modal swallows every touch, so the tab
            // bar was dead for a second or two after the menu looked closed.
            // Same reasoning as `useSheetMotion`'s exit.
            Animated.timing(translateX, {
              toValue: -drawerWidthRef.current,
              duration: animation.duration.sheetExit,
              useNativeDriver: true,
            }),
            Animated.timing(backdropOpacity, {
              toValue: 0,
              duration: animation.duration.sheetBackdropOut,
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

  // Same order as Settings: the drawer is gone before the row's screen opens.
  const handleSettingsEntry = (entryId: string) => {
    haptics.tap();
    fastCloseRef.current = true;
    pendingActionRef.current = () => onOpenSettingsEntry?.(entryId);
    onClose();
  };
  const handleSearchEverything = (query: string) => {
    haptics.tap();
    onClose();
    onSearchEverything?.(query);
  };

  if (!isRendered) return null;

  return (
    <SheetModal
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
        <SheetScrim onPress={onClose} label="Close menu" />

        <Animated.View
          style={[
            styles.drawer,
            shadows.drawer,
            {
              width: drawerWidth,
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

          <MenuPanel
            variant="drawer"
            onScreen={visible}
            activeTab={activeTab}
            onNavigate={handleNavigate}
            onOpenSettings={handleSettings}
            onOpenSettingsEntry={onOpenSettingsEntry ? handleSettingsEntry : undefined}
            onSearchEverything={onSearchEverything ? handleSearchEverything : undefined}
          />
        </Animated.View>
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  drawer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});
