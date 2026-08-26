import React, { useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  PanResponder,
  Animated,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { RecipeSortOption } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, animation, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useScrollEdgeFade } from '../hooks/useScrollEdgeFade';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';
import { ScrollEdgeFade } from './ScrollEdgeFade';
import { SheetScrim } from './SheetScrim';

interface Props {
  visible: boolean;
  onClose: () => void;
  sort: RecipeSortOption;
  onSortChange: (s: RecipeSortOption) => void;
  lovedOnly: boolean;
  onLovedOnlyChange: (lovedOnly: boolean) => void;
}

const SORT_OPTIONS: { value: RecipeSortOption; label: string; icon: string }[] = [
  { value: 'default', label: 'Loved first', icon: 'thumbs-up' },
  { value: 'name', label: 'Name (A–Z)', icon: 'text' },
  { value: 'cooked-recent', label: 'Recently cooked', icon: 'time' },
  { value: 'cooked-oldest', label: 'Not cooked in a while', icon: 'hourglass' },
  { value: 'ingredients-asc', label: 'Fewest ingredients', icon: 'remove-circle-outline' },
  { value: 'ingredients-desc', label: 'Most ingredients', icon: 'add-circle-outline' },
];

/**
 * The recipe box's sort & filter — RecipesScreen's counterpart to
 * SortFilterSheet for tasks, same chrome and the same controlled-component
 * shape (no internal sort/filter state, just the open/close animation).
 *
 * Filtering is a single "Loved only" toggle, not a chip grid like
 * priority/effort on the task sheet: category and meal-type filters (#1086,
 * #1104) aren't built yet, and one boolean doesn't need PillGroup's
 * open-vocabulary treatment or SortFilterSheet's multi-select chips. A future
 * dimension slots in as another `chips` group beside this one.
 */
export function RecipeSortFilterSheet({
  visible, onClose, sort, onSortChange, lovedOnly, onLovedOnlyChange,
}: Props) {
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
        Animated.spring(translateY, {
          toValue: 0,
          ...animation.spring.smooth,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: hiddenY,
        ...animation.spring.sheetDismiss,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
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
        if (dy > 60 || vy > 1) {
          dismiss();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            ...animation.spring.snappy,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const activeCount = (sort !== 'default' ? 1 : 0) + (lovedOnly ? 1 : 0);

  const reset = () => {
    onSortChange('default');
    onLovedOnlyChange(false);
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={dismiss}
    >
      <View style={styles.modalRoot}>
        <Animated.View style={[styles.overlay, { opacity: backdropOpacity }]}>
          <SheetScrim onPress={dismiss} />
        </Animated.View>
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.handleArea} {...panResponder.panHandlers}>
            <View style={styles.handle} />
          </View>

          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Sort & filter</Text>
            <View style={styles.headerRight}>
              {activeCount > 0 && (
                <TouchableOpacity onPress={reset} style={styles.resetBtn}>
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
            <Text style={styles.groupLabel}>Sort by</Text>
            {SORT_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.sortRow, sort === opt.value && styles.sortRowActive]}
                onPress={() => {
                  haptics.tap();
                  onSortChange(opt.value);
                }}
                activeOpacity={interaction.activeOpacity}
              >
                <Ionicons
                  name={opt.icon as never}
                  size={18}
                  color={sort === opt.value ? colors.accent : colors.textSecondary}
                />
                <Text style={[styles.sortLabel, sort === opt.value && styles.sortLabelActive]}>
                  {opt.label}
                </Text>
                {sort === opt.value && (
                  <Ionicons name="checkmark" size={16} color={colors.accent} />
                )}
              </TouchableOpacity>
            ))}

            <Text style={[styles.groupLabel, { marginTop: spacing.lg }]}>Filter</Text>
            <View style={styles.chips}>
              <TouchableOpacity
                style={[styles.chip, lovedOnly && styles.chipActive]}
                onPress={() => {
                  haptics.tap();
                  onLovedOnlyChange(!lovedOnly);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: lovedOnly }}
              >
                <Ionicons
                  name="thumbs-up"
                  size={13}
                  color={lovedOnly ? colors.onAccent : colors.orange}
                />
                <Text style={[styles.chipText, lovedOnly && styles.chipTextActive]}>
                  Loved only
                </Text>
              </TouchableOpacity>
            </View>
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
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.bgQuaternary,
  },
  handleArea: {
    paddingVertical: spacing.md, alignItems: 'center',
  },
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
  // Sits on the sheet's bottom *padding* edge, not its border box: Yoga
  // positions an absolute child from the border box when an inset is
  // given, so `bottom: 0` would park the band in the 40pt of bare sheet
  // below the list rather than over the last of its rows.
  scrollFade: { bottom: 40 },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm,
  },
  sortRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: 12, paddingHorizontal: spacing.sm,
    borderRadius: radius.md, marginBottom: 2,
  },
  sortRowActive: { backgroundColor: colors.bgTertiary },
  sortLabel: { flex: 1, color: colors.textSecondary, fontSize: font.md },
  sortLabelActive: { color: colors.text, fontWeight: fontWeight.medium },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  chipTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
});
