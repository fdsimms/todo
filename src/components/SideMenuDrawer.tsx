import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../theme/ThemeContext';
import { font, radius, spacing } from '../theme';

const DRAWER_WIDTH = Math.round(Dimensions.get('window').width * 0.72);

interface MenuItem {
  name: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
}

const MENU_ITEMS: MenuItem[] = [
  { name: 'Later', icon: 'time-outline', label: 'Later' },
  { name: 'Someday', icon: 'moon-outline', label: 'Someday' },
  { name: 'Tags', icon: 'pricetag-outline', label: 'Tags' },
  { name: 'Logbook', icon: 'book-outline', label: 'Logbook' },
  { name: 'Stats', icon: 'bar-chart-outline', label: 'Stats' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onNavigate: (tabName: string) => void;
  activeTab: string;
}

export function SideMenuDrawer({ visible, onClose, onNavigate, activeTab }: Props) {
  const colors = useColors();
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [isRendered, setIsRendered] = useState(false);

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
        Animated.timing(translateX, {
          toValue: -DRAWER_WIDTH,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start(() => setIsRendered(false));
    }
  }, [visible]);

  const handleNavigate = (tabName: string) => {
    onClose();
    onNavigate(tabName);
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
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}
          pointerEvents="none"
        >
          <View style={[StyleSheet.absoluteFill, styles.backdrop]} />
        </Animated.View>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <Animated.View
          style={[
            styles.drawer,
            {
              backgroundColor: colors.bgSecondary,
              borderRightColor: colors.separator,
              transform: [{ translateX }],
            },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.separator }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Menu</Text>
          </View>

          <View style={styles.items}>
            {MENU_ITEMS.map((item) => {
              const isActive = activeTab === item.name;
              return (
                <TouchableOpacity
                  key={item.name}
                  style={[
                    styles.item,
                    isActive && { backgroundColor: colors.accent + '18' },
                  ]}
                  onPress={() => handleNavigate(item.name)}
                  activeOpacity={0.65}
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
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
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
  },
  header: {
    paddingTop: 64,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: font.xxl,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  items: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
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
    fontWeight: '500',
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});
