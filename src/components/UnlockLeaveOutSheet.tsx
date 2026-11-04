import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { UnlockIgnoreList } from '../types';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, iconSize, interaction, radius, type Colors } from '../theme';
import { useFilterField } from '../hooks/useFilterField';
import { haptics } from '../utils/haptics';
import { PickerSheet, PICKER_SHEET_LIST_MAX_HEIGHT } from './CategoryPicker';
import { HelpText } from './HelpText';
import { BUTTON_LABEL } from '../copy/shared';
import { InlineAction } from './InlineAction';
import { TextField } from './TextField';

interface Props {
  visible: boolean;
  onClose: () => void;
  value: UnlockIgnoreList | null;
  /** Called on every tap, so there is nothing staged to lose on a swipe away. */
  onChange: (next: UnlockIgnoreList | null) => void;
  /** Adding is refused while the unlock is locked, so those chips say so instead of going dead. */
  addingRefused: boolean;
}

type Kind = keyof UnlockIgnoreList;

const EMPTY: UnlockIgnoreList = { categories: [], stackIds: [], projectIds: [] };

/**
 * Pick the categories, stacks and projects an unlock leaves out of today's work
 * (`RewardUnlock.ignoreList`). One sheet with a section per kind, because a
 * person thinking "my evening routine" doesn't know which of the three it is.
 * Chips toggle on tap and commit at once; Done only closes.
 */
export function UnlockLeaveOutSheet({ visible, onClose, value, onChange, addingRefused }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const filter = useFilterField();
  const categories = useCategoryStore(useShallow(s => s.categories.map(c => c.name)));
  const stacks = useTaskGroupStore(useShallow(s => s.groups.map(g => ({ id: g.id, title: g.title }))));
  const projects = useProjectStore(useShallow(s => s.projects.filter(p => !p.archived && !p.completed).map(p => ({ id: p.id, title: p.title }))));

  const list = value ?? EMPTY;
  const q = filter.query.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const toggle = (kind: Kind, key: string) => {
    const has = list[kind].includes(key);
    if (!has && addingRefused) return;
    haptics.tap();
    const next = { ...list, [kind]: has ? list[kind].filter(x => x !== key) : [...list[kind], key] };
    onChange(next.categories.length + next.stackIds.length + next.projectIds.length > 0 ? next : null);
  };

  const sections: { kind: Kind; label: string; options: { key: string; label: string }[] }[] = [
    { kind: 'stackIds', label: 'Stacks', options: stacks.map(s => ({ key: s.id, label: s.title })) },
    { kind: 'categories', label: 'Categories', options: categories.map(c => ({ key: c, label: c })) },
    { kind: 'projectIds', label: 'Projects', options: projects.map(p => ({ key: p.id, label: p.title })) },
  ];

  return (
    <PickerSheet visible={visible} onClose={() => { filter.clear(); onClose(); }} title="Leave out">
      {choose => (
        <ScrollView style={{ maxHeight: PICKER_SHEET_LIST_MAX_HEIGHT }} keyboardShouldPersistTaps="handled">
          <TextField
            {...filter.props}
            style={styles.find}
            placeholder="Find"
            placeholderTextColor={colors.textTertiary}
            autoCorrect={false}
            accessibilityLabel="Find a stack, category or project"
          />
          {sections.map(({ kind, label, options }) => {
            const shown = options.filter(o => matches(o.label) || list[kind].includes(o.key));
            if (shown.length === 0) return null;
            return (
              <View key={kind} style={styles.section}>
                <Text style={styles.sectionLabel}>{label}</Text>
                <View style={styles.chips}>
                  {shown.map(o => {
                    const on = list[kind].includes(o.key);
                    return (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.chip, on && styles.chipOn]}
                        onPress={() => toggle(kind, o.key)}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on, disabled: !on && addingRefused }}
                        accessibilityLabel={`${on ? 'Stop leaving out' : 'Leave out'} ${o.label}`}
                      >
                        {on ? <Ionicons name="checkmark" size={iconSize.xs} color={colors.onAccent} /> : null}
                        <Text style={[styles.chipText, on && styles.chipTextOn, !on && addingRefused && styles.chipTextDim]} numberOfLines={1}>{o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            );
          })}
          {addingRefused ? (
            <Text style={styles.locked}>While it’s locked you can remove places but not add them. You can once it’s unlocked.</Text>
          ) : (
            <HelpText style={styles.hint}>Tasks in these don’t count toward the percentage, done or not.</HelpText>
          )}
          <View style={styles.done}>
            <InlineAction label={BUTTON_LABEL.done} variant="neutral" onPress={() => { haptics.tap(); choose(() => filter.clear()); }} />
          </View>
        </ScrollView>
      )}
    </PickerSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  find: {
    color: colors.text,
    fontSize: font.md,
    minHeight: 44,
    paddingHorizontal: spacing.smd,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
  },
  section: { marginTop: spacing.md },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.xsm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xsm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: '100%',
    paddingHorizontal: spacing.smd,
    minHeight: interaction.pillHeight,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  chipOn: { backgroundColor: colors.accentFill },
  chipText: { color: colors.text, fontSize: font.sm, flexShrink: 1 },
  chipTextOn: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  chipTextDim: { color: colors.textTertiary },
  hint: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.md },
  locked: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.md },
  done: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.md, marginBottom: spacing.sm },
});
