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
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, animation, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

export interface LogbookFilterOption {
  key: string;
  label: string;
  /** Per-item accent color (a tag's color). Omit for options with no color of their own. */
  color?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  categories: LogbookFilterOption[];
  tags: LogbookFilterOption[];
  selectedCategory: string | null;
  onSelectCategory: (key: string | null) => void;
  selectedTag: string | null;
  onSelectTag: (key: string | null) => void;
}

/**
 * Bottom sheet holding the Logbook's category and tag filters. They used to be
 * two horizontal chip rows pinned under the search bar, which cost ~90pt of the
 * list and hid every option past the third one off the right edge; here the
 * chips wrap, so the whole set is visible at once.
 */
export function LogbookFilterSheet({
  visible, onClose, categories, tags, selectedCategory, onSelectCategory, selectedTag, onSelectTag,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const translateY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(600);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 700, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      translateY.setValue(600);
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
          Animated.spring(translateY, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  const activeCount = (selectedCategory ? 1 : 0) + (selectedTag ? 1 : 0);

  const clearAll = () => {
    haptics.tap();
    onSelectCategory(null);
    onSelectTag(null);
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <View style={styles.modalRoot}>
        <Animated.View style={[styles.overlay, { opacity: backdropOpacity }]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={dismiss} />
        </Animated.View>
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.handleArea} {...panResponder.panHandlers}>
            <View style={styles.handle} />
          </View>

          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Filter</Text>
            <View style={styles.headerRight}>
              {activeCount > 0 && (
                <TouchableOpacity onPress={clearAll} style={styles.resetBtn} accessibilityRole="button">
                  <Text style={styles.resetText}>Clear all ({activeCount})</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={dismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {categories.length > 0 && (
              <FilterGroup
                label="Category"
                options={categories}
                selected={selectedCategory}
                onSelect={onSelectCategory}
                styles={styles}
                colors={colors}
              />
            )}
            {tags.length > 0 && (
              <FilterGroup
                label="Tag"
                options={tags}
                selected={selectedTag}
                onSelect={onSelectTag}
                showDot
                style={categories.length > 0 ? { marginTop: spacing.lg } : undefined}
                styles={styles}
                colors={colors}
              />
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function FilterGroup({
  label, options, selected, onSelect, showDot, style, styles, colors,
}: {
  label: string;
  options: LogbookFilterOption[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  showDot?: boolean;
  style?: object;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const chips: (LogbookFilterOption & { value: string | null })[] = [
    { key: '__all__', label: 'All', value: null },
    ...options.map(o => ({ ...o, value: o.key })),
  ];
  return (
    <View style={style}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.chips}>
        {chips.map(chip => {
          const active = selected === chip.value;
          const color = chip.color ?? colors.accent;
          return (
            <TouchableOpacity
              key={chip.key}
              style={[styles.chip, active && { backgroundColor: color }]}
              onPress={() => {
                haptics.tap();
                onSelect(active ? null : chip.value);
              }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              {showDot && !active && chip.color && (
                <View style={[styles.chipDot, { backgroundColor: chip.color }]} />
              )}
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{chip.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.backdrop },
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
  chipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  chipTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
});
