// One category picker, in two presentations. The list body is the whole
// component; the sheet is a shell around it.
//
//   CategoryPickerList   the search field + rows. Drop it into a host that
//                        already scrolls (the task editor's Category field).
//   CategoryPickerSheet  the same list in a bottom sheet, for hosts with no
//                        room of their own (quick add, the bulk-action bar).
//
// The filter and the keyboard rules live in src/utils/categoryPicker.ts.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Animated,
  PanResponder,
  Keyboard,
  Platform,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeBlurView } from './SafeBlurView';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import {
  filterCategories,
  resolveCategorySubmit,
  type CategoryOption,
} from '../utils/categoryPicker';

interface ListProps {
  /**
   * The chosen category's name, or null for "None". `undefined` is a host with
   * no current value to tick — a bulk move, where the selected tasks may sit in
   * several categories and "None" is a destination rather than the state.
   */
  value?: string | null;
  /** The pick. `null` is "None"; a name that didn't exist has already been created. */
  onSelect: (name: string | null) => void;
  /** Drop the "None" row where clearing the field isn't on offer. */
  showNone?: boolean;
  /** Turns off creating from the field. The field stays — it still filters. */
  allowCreate?: boolean;
  /**
   * Bounds the list and gives it its own scroll. Omit inside a host that
   * already scrolls (the task editor), so there's no scroll view inside a
   * scroll view fighting over the drag.
   */
  maxHeight?: number;
  /** Placeholder on the find-or-add field. Defaults to the create-aware wording. */
  searchPlaceholder?: string;
}

/** Rows are 44pt; this is a little over four of them, so the fifth peeks. */
const SHEET_LIST_MAX_HEIGHT = 340;

/** Kept clear above the lifted sheet so its title never slides under the status bar. */
const TOP_INSET = 72;

/**
 * Every category, listed one per row, with a field that both filters and adds.
 *
 * The pill grid this replaced capped itself at eight and put the rest behind
 * "N more" — so picking anything else meant either finding that control or
 * typing a name from memory, and the quick-add sheet is short enough that the
 * control was usually below its fold. Rows instead of pills because a wrapping
 * grid of ragged widths is the hardest shape to scan, and because a name as
 * long as "Expiring Groceries" has to fit whole: two columns truncate it, and
 * a truncated category is one you can't recognise, which is the entire problem.
 *
 * The field is always on show, not revealed past some count. It's one control
 * doing find and add together, and the alternative — a field that appears once
 * the list is long enough, plus a separate "New category" button for when it
 * hasn't — is two affordances and a threshold to explain.
 */
export function CategoryPickerList({
  value,
  onSelect,
  showNone = true,
  allowCreate = true,
  maxHeight,
  searchPlaceholder,
}: ListProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const names = useTaskStore(useShallow(s => s.allCategories()));
  const categories = useCategoryStore(useShallow(s => s.categories));
  const addCategory = useTaskStore(s => s.addCategory);

  const [query, setQuery] = useState('');

  const options: CategoryOption[] = useMemo(
    () => names.map(name => ({ name, emoji: categories.find(c => c.name === name)?.emoji ?? null })),
    [names, categories],
  );

  const result = useMemo(() => filterCategories(options, query), [options, query]);
  const trimmed = query.trim();
  const canCreate = allowCreate && !!trimmed && !result.exact;

  const pick = (name: string | null) => {
    haptics.tap();
    onSelect(name);
  };

  const create = () => {
    if (!canCreate) return;
    addCategory(trimmed);
    pick(trimmed);
  };

  const handleSubmit = () => {
    const decision = resolveCategorySubmit(result, { text: query, canCreate: allowCreate });
    if (decision.action === 'pick') pick(decision.name);
    else if (decision.action === 'create') create();
  };

  const rows = (
    <>
      {/* "None" is the field's empty value, not a category, so it's hidden the
          moment there's a query — nothing about typing "no" is a request to
          clear the field. */}
      {showNone && !trimmed && (
        <TouchableOpacity
          style={styles.row}
          onPress={() => pick(null)}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityState={{ selected: value === null }}
          accessibilityLabel="No category"
        >
          <View style={styles.rowIcon}>
            <Ionicons name="remove-outline" size={16} color={colors.textSecondary} />
          </View>
          <Text style={[styles.rowName, styles.rowNameMuted]} numberOfLines={1}>None</Text>
          {value === null && <Ionicons name="checkmark" size={17} color={colors.accent} />}
        </TouchableOpacity>
      )}

      {result.matches.map(option => {
        const selected = option.name === value;
        return (
          <TouchableOpacity
            key={option.name}
            style={styles.row}
            onPress={() => pick(option.name)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={option.name}
          >
            <View style={styles.rowIcon}>
              {option.emoji
                ? <Text style={styles.rowEmoji}>{option.emoji}</Text>
                : <Ionicons name="folder-outline" size={16} color={colors.textSecondary} />}
            </View>
            <Text style={[styles.rowName, selected && styles.rowNameSelected]} numberOfLines={1}>
              {option.name}
            </Text>
            {selected && <Ionicons name="checkmark" size={17} color={colors.accent} />}
          </TouchableOpacity>
        );
      })}

      {canCreate && (
        <TouchableOpacity
          style={styles.row}
          onPress={create}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={`Create the category ${trimmed}`}
        >
          <View style={styles.rowIcon}>
            <Ionicons name="add" size={17} color={colors.accent} />
          </View>
          <Text style={[styles.rowName, styles.rowNameCreate]} numberOfLines={1}>
            Create “{trimmed}”
          </Text>
        </TouchableOpacity>
      )}

      {result.noMatches && !canCreate && (
        <Text style={styles.empty}>No category matches “{trimmed}”.</Text>
      )}
    </>
  );

  return (
    <View>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={iconSize.sm} color={colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder ?? (allowCreate ? 'Find or add a category…' : 'Find a category…')}
          placeholderTextColor={colors.textTertiary}
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
          autoCorrect={false}
          autoCapitalize="words"
          accessibilityLabel={searchPlaceholder ?? 'Find or add a category'}
        />
        {!!trimmed && (
          <TouchableOpacity
            onPress={() => setQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear the search"
          >
            <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {maxHeight === undefined ? (
        rows
      ) : (
        <ScrollView
          style={{ maxHeight }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {rows}
        </ScrollView>
      )}
    </View>
  );
}

interface SheetProps extends Omit<ListProps, 'maxHeight'> {
  visible: boolean;
  onClose: () => void;
  /** Header title. "Category" unless the host is doing something more specific. */
  title?: string;
}

/**
 * The list in a bottom sheet, for hosts with no room to show it inline.
 *
 * Same shell as `TaskRelationPickerSheet` — bottom-anchored card, swipe or tap
 * away to dismiss, its own Cancel below. Both of its callers open it from
 * inside another Modal (quick add is one; the bulk bar's sits over a screen),
 * which is the arrangement the relation picker and `WhenPicker` already ship
 * from the task editor.
 *
 * The search field is deliberately **not** autofocused. The picker exists so
 * the answer can be recognised rather than remembered, and a keyboard on open
 * would cover half the list to serve the typists who can already tap the field.
 */
export function CategoryPickerSheet({ visible, onClose, title = 'Category', onSelect, ...listProps }: SheetProps) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { height: windowHeight } = useWindowDimensions();

  const translateY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  /**
   * The sheet is bottom-anchored, so a short list sits behind the keyboard the
   * search field raises. Lifting it clear needs the height cap below as well
   * as this offset: the lift alone would push a full list's title off the top.
   */
  const keyboardOffset = useRef(new Animated.Value(0)).current;
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => {
      const height = e.endCoordinates?.height ?? 0;
      setKeyboardHeight(height);
      Animated.spring(keyboardOffset, {
        toValue: -height, ...animation.spring.smooth, useNativeDriver: true,
      }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
      Animated.spring(keyboardOffset, {
        toValue: 0, ...animation.spring.smooth, useNativeDriver: true,
      }).start();
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  useEffect(() => {
    if (visible) {
      translateY.setValue(600);
      backdropOpacity.setValue(0);
      // Seeded from whatever is on screen rather than assumed to be nothing:
      // both hosts open this over a keyboard of their own (quick add's title
      // field, the bulk bar's tag field), and if iOS leaves that keyboard up
      // there is no show event to hear — the sheet would lay itself out into
      // space the keyboard is already covering. A hide event that follows
      // corrects it back to 0.
      const height = Keyboard.metrics()?.height ?? 0;
      setKeyboardHeight(height);
      keyboardOffset.setValue(-height);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = (after?: () => void) => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.spring(translateY, { toValue: 700, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      translateY.setValue(600);
      onClose();
      after?.();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 4,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 1.2) {
          dismiss();
        } else {
          Animated.spring(translateY, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => dismiss()} />

      <Animated.View
        style={[
          styles.sheetOuter,
          // Capped against what's left above the keyboard; the card and its
          // list both shrink, so no chrome constant has to be kept in sync
          // with the header's real height.
          { maxHeight: windowHeight - keyboardHeight - TOP_INSET },
          { transform: [{ translateY: Animated.add(translateY, keyboardOffset) }] },
        ]}
      >
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <View style={styles.sheetBody}>
            <CategoryPickerList
              {...listProps}
              maxHeight={SHEET_LIST_MAX_HEIGHT}
              onSelect={name => dismiss(() => onSelect(name))}
            />
          </View>
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={() => dismiss()} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    // A height rather than a lineHeight: RN maps lineHeight straight onto the
    // iOS paragraph style with no baseline compensation, so the glyphs sit low
    // in the box while the caret stays centred.
    height: 40,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    minHeight: 44,
  },
  // Fixed width so every name starts on the same line, whether its category
  // carries an emoji or falls back to the folder glyph.
  rowIcon: { width: 24, alignItems: 'center' },
  rowEmoji: { fontSize: font.md },
  rowName: { flex: 1, color: colors.text, fontSize: font.md },
  rowNameSelected: { fontWeight: fontWeight.semibold },
  rowNameMuted: { color: colors.textSecondary },
  rowNameCreate: { color: colors.accent, fontWeight: fontWeight.medium },
  empty: { fontSize: font.sm, color: colors.textTertiary, paddingVertical: spacing.sm },

  backdropDim: { backgroundColor: colors.backdrop },
  sheetOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
  },
  handleArea: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.sm },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.bgQuaternary },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
    flexShrink: 1,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  sheetBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, flexShrink: 1 },
  cancelCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
  },
  cancelLabel: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
});
