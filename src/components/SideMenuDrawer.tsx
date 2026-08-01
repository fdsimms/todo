import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
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

const DRAWER_WIDTH = Math.round(Dimensions.get('window').width * 0.72);

interface MenuItem {
  name: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
}

const MENU_ITEMS: MenuItem[] = [
  { name: 'Today', icon: 'checkbox-outline', label: 'Tasks' },
  { name: 'Categories', icon: 'folder-outline', label: 'Categories' },
  { name: 'Tags', icon: 'pricetag-outline', label: 'Tags' },
  { name: 'Templates', icon: 'copy-outline', label: 'Templates' },
  { name: 'Logbook', icon: 'book-outline', label: 'Logbook' },
  { name: 'Stats', icon: 'bar-chart-outline', label: 'Stats' },
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
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const dragOffsetX = useRef(new Animated.Value(0)).current;
  const [isRendered, setIsRendered] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

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
      Animated.parallel([
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
      ]).start(() => {
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

          <View style={styles.items}>
            {MENU_ITEMS.map((item, index) => {
              const isActive = activeTab === item.name;
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
                  {isActive && (
                    <View style={[styles.activeDot, { backgroundColor: colors.accent }]} />
                  )}
                </TouchableOpacity>
                </DrawerItemAppear>
              );
            })}
          </View>

          <View style={[styles.footer, { borderTopColor: colors.separator, paddingBottom: spacing.md + insets.bottom }]}>
            <DrawerItemAppear index={MENU_ITEMS.length}>
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
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});
