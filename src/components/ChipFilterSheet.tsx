import React, { useEffect, useMemo, useRef } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, PanResponder, Animated,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, animation, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useScrollEdgeFade } from '../hooks/useScrollEdgeFade';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';
import { ScrollEdgeFade } from './ScrollEdgeFade';
import { SheetScrim } from './SheetScrim';

export interface ChipFilterOption {
  key: string;
  label: string;
  /** Per-item accent colour, for a set that carries its own (a tag's colour). */
  color?: string;
}

export interface ChipFilterGroup {
  label: string;
  options: ChipFilterOption[];
  /** The keys currently picked. One entry for a single-select group. */
  selected: string[];
  onToggle: (key: string) => void;
  /**
   * Adds an "All" chip that clears the group, for a set where picking nothing
   * is a state worth naming rather than merely the absence of a choice.
   */
  showAllChip?: boolean;
  onClear?: () => void;
}

/**
 * The bottom sheet a list is filtered from: wrapping chips, one group per
 * dimension.
 *
 * CLAUDE.md's rule, made into a component. Filtering by a set the user builds
 * themselves is a sheet of wrapping chips and never a horizontal scroll row,
 * because a vocabulary with no ceiling has no phone-width row that fits it —
 * and the sheet chrome that rule implies (the pan-to-dismiss handle, the scrim,
 * the hidden offset, the edge fade, the clear-all) is 150 lines that were
 * getting written again per filter. `LogbookFilterSheet` and
 * `RecipeTagFilterSheet` are the two that predate this and still hold their own
 * copies.
 *
 * Multi-select is the default and single-select is a group whose `selected`
 * holds at most one key — the difference lives in the caller's toggle rather
 * than in a mode here, since it is one line there and a branch through every
 * chip here.
 */
export function ChipFilterSheet({ visible, onClose, title = 'Filter', groups, onClearAll }: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  groups: ChipFilterGroup[];
  /** Omit to hide the clear-all button even when something is picked. */
  onClearAll?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const fade = useScrollEdgeFade();
  const hiddenY = useSheetHiddenOffset();

  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(hiddenY);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      onClose();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 10,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 60 || vy > 1) dismiss();
        else Animated.spring(translateY, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }).start();
      },
    })
  ).current;

  const activeCount = groups.reduce((n, g) => n + g.selected.length, 0);

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <View style={styles.modalRoot}>
        <Animated.View style={[styles.overlay, { opacity: backdropOpacity }]}>
          <SheetScrim onPress={dismiss} />
        </Animated.View>
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.handleArea} {...panResponder.panHandlers}>
            <View style={styles.handle} />
          </View>

          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <View style={styles.headerRight}>
              {activeCount > 0 && onClearAll && (
                <TouchableOpacity
                  onPress={() => { haptics.tap(); onClearAll(); }}
                  style={styles.resetBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.resetText}>Clear all ({activeCount})</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={dismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
            {...fade.scrollProps}
          >
            {groups.filter(g => g.options.length > 0).map((group, index) => (
              <View key={group.label} style={index > 0 ? { marginTop: spacing.lg } : undefined}>
                <Text style={styles.groupLabel}>{group.label}</Text>
                <View style={styles.chips}>
                  {group.showAllChip && (
                    <TouchableOpacity
                      style={[styles.chip, group.selected.length === 0 && { backgroundColor: colors.accent }]}
                      onPress={() => { haptics.tap(); group.onClear?.(); }}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityState={{ selected: group.selected.length === 0 }}
                    >
                      <Text style={[
                        styles.chipText,
                        group.selected.length === 0 && styles.chipTextActive,
                      ]}>All</Text>
                    </TouchableOpacity>
                  )}
                  {group.options.map(option => {
                    const active = group.selected.includes(option.key);
                    const color = option.color ?? colors.accent;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        style={[styles.chip, active && { backgroundColor: color }]}
                        onPress={() => { haptics.tap(); group.onToggle(option.key); }}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        {!active && option.color && (
                          <View style={[styles.chipDot, { backgroundColor: option.color }]} />
                        )}
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
          <ScrollEdgeFade
            edge="bottom"
            opacity={fade.bottomOpacity}
            color={colors.bgSecondary}
            style={styles.scrollFade}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '80%',
    paddingBottom: 40,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.bgQuaternary },
  handleArea: { paddingVertical: spacing.md, alignItems: 'center' },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  sheetTitle: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  resetBtn: {
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.sm, backgroundColor: colors.bgTertiary,
  },
  resetText: { color: colors.accent, fontSize: font.sm },
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md },
  // Sits on the sheet's bottom *padding* edge, not its border box — see the
  // same note in LogbookFilterSheet.
  scrollFade: { bottom: 40 },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  chipDot: { width: 6, height: 6, borderRadius: radius.full },
  chipText: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
  chipTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
});
