import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ScrollView, Animated } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollEdgeFade } from './ScrollEdgeFade';
import { PressableScale } from './PressableScale';
import { useTheme } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, border, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useBulkBarEntrance } from '../hooks/useBulkBarEntrance';
import { useScrollEdgeFade } from '../hooks/useScrollEdgeFade';

export interface ListBulkAction {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Destructive actions are red, 'purple' matches the built-in category Move button, everything else is accent. */
  tone?: 'accent' | 'destructive' | 'purple';
  onPress: () => void;
}

export interface ListBulkCategoryPanel {
  /**
   * Sub-panel heading, e.g. "Move to Category" — also what the Move action
   * announces to a screen reader, since the button itself is one word.
   */
  title: string;
  /** Category names offered as chips, in the order they should appear. */
  options: string[];
  onSet: (category: string | null) => void;
  /** Called before onSet when the typed name isn't one of the options yet. */
  onCreate: (name: string) => void;
  /** Off for a field that always holds a value — an aisle, say — where "None" isn't a real choice. Defaults to true. */
  allowNone?: boolean;
}

interface Props {
  selectedCount: number;
  totalCount: number;
  /** Rendered after the Category action, in order. */
  actions: ListBulkAction[];
  /** Omit on a list whose rows have no categories, and the action hides. */
  category?: ListBulkCategoryPanel;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onCancel: () => void;
  /** Clearance to leave below the bar — the floating tab bar's rendered height. */
  bottomInset: number;
  /** Reports the bar's height so the list can reserve matching space at its bottom. */
  onHeightChange?: (height: number) => void;
}

/** Four rows of chips (34pt each, spacing.sm between) before the grid starts scrolling. */
const CATEGORY_LIST_MAX_HEIGHT = 172;

/**
 * Floating bulk-action bar for list screens whose rows aren't tasks — Templates
 * and Projects. Same shape as BulkActionBar and SimpleBulkBar (select-all /
 * count / dismiss, then a row of actions), but the actions come from the caller
 * instead of being spelled out: there is nothing a template and a project want
 * to do in common beyond being filed and being deleted, and a fourth hand-rolled
 * copy of the bar for each of them is how the count/chip/panel styles drifted
 * apart the last time.
 */
export function ListBulkBar({
  selectedCount,
  totalCount,
  actions,
  category,
  onSelectAll,
  onDeselectAll,
  onCancel,
  bottomInset,
  onHeightChange,
}: Props) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const fade = useScrollEdgeFade();
  const entranceStyle = useBulkBarEntrance();
  const [panel, setPanel] = useState<'actions' | 'category'>('actions');
  const [categoryText, setCategoryText] = useState('');

  const allSelected = selectedCount === totalCount;
  const none = selectedCount === 0;

  const goBack = () => {
    setPanel('actions');
    setCategoryText('');
  };

  const handleSetCategory = (name: string | null) => {
    haptics.tap();
    category?.onSet(name);
    setCategoryText('');
    setPanel('actions');
  };

  const handleCreateCategory = () => {
    const trimmed = categoryText.trim();
    if (!trimmed || !category) return;
    category.onCreate(trimmed);
    handleSetCategory(trimmed);
  };

  // The field doubles as a filter and as the create-new input, the same way the
  // task bar's does: with a dozen categories, finding one is the common case and
  // typing a new one is the rare one, and both start by typing.
  const query = categoryText.trim().toLowerCase();
  const options = category?.options ?? [];
  const filtered = useMemo(
    () => (query ? options.filter(c => c.toLowerCase().includes(query)) : options),
    [options, query],
  );
  const exact = useMemo(
    () => (query ? filtered.find(c => c.toLowerCase() === query) ?? null : null),
    [filtered, query],
  );

  // Enter picks the obvious match before it creates anything, so hitting done
  // never silently creates a duplicate of a category that exists.
  const handleSubmit = () => {
    if (!query) return;
    if (exact) return handleSetCategory(exact);
    if (filtered.length === 1) return handleSetCategory(filtered[0]);
    handleCreateCategory();
  };

  return (
    <Animated.View
      style={[styles.container, shadows.sheet, { bottom: bottomInset + spacing.sm }, entranceStyle]}
      onLayout={onHeightChange ? e => onHeightChange(e.nativeEvent.layout.height) : undefined}
    >
      {panel === 'actions' && (
        <>
          <View style={styles.topRow}>
            <TouchableOpacity
              style={styles.selectAllBtn}
              onPress={() => { haptics.tap(); allSelected ? onDeselectAll() : onSelectAll(); }}
            >
              <Text style={styles.selectAllText}>{allSelected ? 'Deselect All' : 'Select All'}</Text>
            </TouchableOpacity>
            <Text style={styles.countText}>{selectedCount} selected</Text>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel selection">
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.actionRow}>
            {/* "Move", purple, filled folder — the same word and treatment
                BulkActionBar gives filing tasks into a category. */}
            {category && (
              <PressableScale
                style={[styles.actionBtn, none && styles.actionBtnDisabled]}
                disabled={none}
                onPress={() => { haptics.tap(); setPanel('category'); }}
                accessibilityLabel={category.title}
              >
                <Ionicons name="folder" size={24} color={colors.purple} />
                <Text style={[styles.actionLabel, { color: colors.purple }]}>Move</Text>
              </PressableScale>
            )}
            {actions.map(action => {
              const tint = action.tone === 'destructive' ? colors.red
                : action.tone === 'purple' ? colors.purple
                : colors.accent;
              return (
                <PressableScale
                  key={action.key}
                  style={[styles.actionBtn, none && styles.actionBtnDisabled]}
                  disabled={none}
                  onPress={() => {
                    if (action.tone === 'destructive') haptics.impactMedium(); else haptics.tap();
                    action.onPress();
                  }}
                  accessibilityLabel={action.label}
                >
                  <Ionicons name={action.icon} size={24} color={tint} />
                  <Text style={[styles.actionLabel, { color: tint }]}>{action.label}</Text>
                </PressableScale>
              );
            })}
          </View>
        </>
      )}

      {panel === 'category' && category && (
        <View style={styles.subPanel}>
          <View style={styles.subHeader}>
            <TouchableOpacity onPress={goBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to bulk actions">
              <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.subTitle}>{category.title}</Text>
            <View style={{ width: 28 }} />
          </View>
          <TextInput
            style={styles.categoryInput}
            placeholder="Find or add a category…"
            placeholderTextColor={colors.textTertiary}
            value={categoryText}
            onChangeText={setCategoryText}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            autoCapitalize="words"
            autoCorrect={false}
          />
          <ScrollView
            style={styles.categoryList}
            contentContainerStyle={styles.categoryListContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            {...fade.scrollProps}
          >
            {!query && category.allowNone !== false && (
              <TouchableOpacity style={styles.categoryChip} onPress={() => handleSetCategory(null)}>
                <Text style={styles.categoryChipText}>None</Text>
              </TouchableOpacity>
            )}
            {filtered.map(name => (
              <TouchableOpacity key={name} style={styles.categoryChip} onPress={() => handleSetCategory(name)}>
                <Ionicons name="folder-outline" size={13} color={colors.textSecondary} />
                <Text style={styles.categoryChipText}>{name}</Text>
              </TouchableOpacity>
            ))}
            {query !== '' && !exact && (
              <TouchableOpacity
                style={[styles.categoryChip, styles.categoryCreateChip]}
                onPress={handleCreateCategory}
              >
                <Ionicons name="add" size={13} color={colors.accent} />
                <Text style={[styles.categoryChipText, styles.categoryCreateChipText]} numberOfLines={1}>
                  Create “{categoryText.trim()}”
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
          <ScrollEdgeFade edge="bottom" opacity={fade.bottomOpacity} color={colors.bgSecondary} />
        </View>
      )}
    </Animated.View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: border.md,
    borderColor: colors.separator,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  countText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.semibold },
  selectAllBtn: { paddingVertical: 4 },
  selectAllText: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.medium },
  cancelBtn: { padding: 4 },
  actionRow: { flexDirection: 'row', justifyContent: 'space-around', paddingBottom: spacing.xs },
  actionBtn: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    minWidth: 72,
  },
  actionBtnDisabled: { opacity: 0.4 },
  actionLabel: { fontSize: font.xs, fontWeight: fontWeight.medium },
  subPanel: { gap: spacing.sm },
  subHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  categoryInput: {
    color: colors.text,
    fontSize: font.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  // Four rows of chips, then it scrolls — enough that a normal set of categories
  // is on screen at once, without the bar growing tall enough to swallow the list
  // it's floating over.
  categoryList: {
    maxHeight: CATEGORY_LIST_MAX_HEIGHT,
    flexGrow: 0,
  },
  categoryListContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingVertical: 2,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.bgQuaternary,
    backgroundColor: colors.bgTertiary,
  },
  categoryChipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  categoryCreateChip: {
    borderColor: colors.accent,
    backgroundColor: colors.accent + '33',
    maxWidth: '100%',
  },
  categoryCreateChipText: { color: colors.accent, flexShrink: 1 },
});
