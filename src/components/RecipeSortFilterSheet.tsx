import React, { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  PanResponder,
  Animated,
} from 'react-native';
import { SheetModal } from './SheetModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import { NamedIcon } from './CoinIcon';
import { ThumbIcon } from './ThumbIcon';
import type { RecipeSortOption } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, animation, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { tagColor } from '../utils/tagColor';
import { toggleRecipeTag } from '../utils/recipeTags';
import { useScrollEdgeFade } from '../hooks/useScrollEdgeFade';
import { useSheetMotion } from '../hooks/useSheetMotion';
import { ScrollEdgeFade } from './ScrollEdgeFade';
import { SheetScrim } from './SheetScrim';

interface Props {
  visible: boolean;
  onClose: () => void;
  sort: RecipeSortOption;
  onSortChange: (s: RecipeSortOption) => void;
  lovedOnly: boolean;
  onLovedOnlyChange: (lovedOnly: boolean) => void;
  /** The whole box's vocabulary, alphabetical (see allRecipeTags). */
  tags: readonly string[];
  /** How many recipes each tag is on (see recipeTagCounts). */
  tagCounts: ReadonlyMap<string, number>;
  selectedTags: readonly string[];
  /** The shelf, in its own order; the Cookbook group shows only when there is one. */
  cookbooks?: readonly { id: string; title: string }[];
  /** The one cookbook the box is narrowed to, or null for every recipe. */
  cookbookId?: string | null;
  onCookbookChange?: (id: string | null) => void;
  onTagsChange: (tags: string[]) => void;
}

/** A sort's label as the sheet shows it, for the screen's active-filter pill. */
export function recipeSortLabel(sort: RecipeSortOption): string {
  return SORT_OPTIONS.find(o => o.value === sort)?.label ?? '';
}

const SORT_OPTIONS: { value: RecipeSortOption; label: string; icon: string }[] = [
  { value: 'default', label: 'Loved first', icon: 'thumbs-up-outline' },
  { value: 'name', label: 'Name (A to Z)', icon: 'text' },
  { value: 'cooked-recent', label: 'Recently cooked', icon: 'time' },
  { value: 'cooked-oldest', label: 'Not cooked in a while', icon: 'hourglass' },
  { value: 'quickest', label: 'Quickest', icon: 'timer-outline' },
  { value: 'ingredients-asc', label: 'Fewest ingredients', icon: 'remove-circle-outline' },
  { value: 'ingredients-desc', label: 'Most ingredients', icon: 'add-circle-outline' },
];

/**
 * The recipe box's sort & filter — RecipesScreen's counterpart to
 * SortFilterSheet for tasks, same chrome and the same controlled-component
 * shape (no internal sort/filter state, just the open/close animation).
 *
 * Filtering is a "Loved only" toggle, the box's tags, and one cookbook, each
 * its own `chips` group: category and meal-type filters (#1086, #1104) aren't
 * built yet, and slot in as another group beside these.
 */
export function RecipeSortFilterSheet({
  visible, onClose, sort, onSortChange, lovedOnly, onLovedOnlyChange,
  tags, tagCounts, selectedTags, onTagsChange,
  cookbooks = [], cookbookId = null, onCookbookChange,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const fade = useScrollEdgeFade();

  const sheet = useSheetMotion(visible);
  const { translateY, backdropOpacity } = sheet;

  useEffect(() => {
    if (visible) {
      sheet.show();
    }
  }, [visible]);

  const dismiss = () => {
    sheet.hide(() => {
      // No re-arming setValue here — see useSheetMotion.
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

  const activeCount = (sort !== 'default' ? 1 : 0) + (lovedOnly ? 1 : 0) + selectedTags.length + (cookbookId ? 1 : 0);

  const reset = () => {
    onSortChange('default');
    onLovedOnlyChange(false);
    onTagsChange([]);
    onCookbookChange?.(null);
  };

  return (
    <SheetModal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={dismiss}
    >
      <View style={styles.modalRoot}>
        <Animated.View style={[styles.overlay, { opacity: backdropOpacity }]}>
          <SheetScrim onPress={dismiss} />
        </Animated.View>
        <Animated.View onLayout={sheet.onCardLayout} style={[styles.sheet, { transform: [{ translateY }] }]}>
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
                <NamedIcon
                  name={opt.icon}
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
                <ThumbIcon
                  size={13}
                  color={lovedOnly ? colors.onAccent : colors.orangeText}
                />
                <Text style={[styles.chipText, lovedOnly && styles.chipTextActive]}>
                  Loved only
                </Text>
              </TouchableOpacity>
            </View>

            {tags.length > 0 && (
              <>
                <Text style={[styles.groupLabel, { marginTop: spacing.lg }]}>Tags</Text>
                {/* Wrapping chips rather than a scrolling row: the vocabulary
                    is the user's own and has no ceiling. Tags AND together
                    (see filterRecipesByTags), so each chip is a checkbox. */}
                <View style={styles.chips}>
                  {tags.map(tag => {
                    const on = selectedTags.includes(tag);
                    const count = tagCounts.get(tag) ?? 0;
                    const color = tagColor(tag);
                    return (
                      <TouchableOpacity
                        key={tag}
                        style={[styles.chip, { backgroundColor: on ? color + '33' : colors.bgTertiary }]}
                        onPress={() => {
                          haptics.tap();
                          onTagsChange(toggleRecipeTag(selectedTags, tag));
                        }}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${tag}, ${count} recipes`}
                      >
                        {on && <Ionicons name="checkmark" size={13} color={color} />}
                        <Text style={[styles.chipText, on && { color }]}>{tag}</Text>
                        <Text style={styles.chipCount}>{count}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {cookbooks.length > 0 && !!onCookbookChange && (
              <>
                <Text style={[styles.groupLabel, { marginTop: spacing.lg }]}>Cookbook</Text>
                {/* One at a time: a recipe is in one book, so two picked would
                    match nothing. Tapping the picked one again clears it. */}
                <View style={styles.chips}>
                  {cookbooks.map(book => {
                    const on = cookbookId === book.id;
                    return (
                      <TouchableOpacity
                        key={book.id}
                        style={[styles.chip, on && styles.chipActive]}
                        onPress={() => {
                          haptics.tap();
                          onCookbookChange(on ? null : book.id);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextActive]}>{book.title}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}
          </ScrollView>
          <ScrollEdgeFade
            edge="bottom"
            opacity={fade.bottomOpacity}
            color={colors.bgSecondary}
            style={styles.scrollFade}
          />
        </Animated.View>
      </View>
    </SheetModal>
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
    paddingVertical: spacing.smd, paddingHorizontal: spacing.sm,
    borderRadius: radius.md, marginBottom: spacing.xxs,
  },
  sortRowActive: { backgroundColor: colors.bgTertiary },
  sortLabel: { flex: 1, color: colors.textSecondary, fontSize: font.md },
  sortLabelActive: { color: colors.text, fontWeight: fontWeight.medium },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xsm,
    paddingHorizontal: spacing.smd, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  chipActive: { backgroundColor: colors.accentFill },
  chipText: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
  chipCount: { color: colors.textSecondary, fontSize: font.xs },
  chipTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
});
