import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, interaction, type Colors } from '../theme';
import { useFilterField } from '../hooks/useFilterField';
import { displayNameOf } from '../store/usePersonStore';
import { eventPeopleChoices } from '../utils/eventPeople';
import { SearchField } from './SearchField';
import type { Person } from '../types';
import { HelpText } from './HelpText';

interface Props {
  /** Everybody on the People list who isn't archived, in the user's own order. */
  people: readonly Person[];
  /** The event's title, which decides who is suggested first. */
  title: string;
  linkedIds: readonly string[];
  onToggle: (personId: string) => void;
}

/**
 * The "who is this event with" picker under a row in Today's events sheet.
 *
 * Shows the people already linked as filled chips, a find field, and a short
 * list of suggestions (`eventPeopleChoices`) rather than the whole People list:
 * with thirty people the old flat list of chips was taller than the event it
 * was about. "N more" is not a second list, it moves the cursor to the field.
 *
 * It is mounted only while its panel is open, so the filter field starts empty
 * each time and nothing here needs resetting.
 */
export function EventPeoplePanel({ people, title, linkedIds, onToggle }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const filter = useFilterField();

  const linked = useMemo(() => people.filter(p => linkedIds.includes(p.id)), [people, linkedIds]);
  const { shown, hidden } = useMemo(
    () => eventPeopleChoices(people, title, linkedIds, filter.query),
    [people, title, linkedIds, filter.query]
  );
  const searching = filter.query.trim().length > 0;

  const chip = (p: Person, on: boolean) => (
    <TouchableOpacity
      key={p.id}
      style={[styles.pill, on && styles.pillActive]}
      onPress={() => onToggle(p.id)}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
    >
      <Text style={[styles.pillText, on && styles.pillTextActive]}>{displayNameOf(p)}</Text>
    </TouchableOpacity>
  );

  return (
    <View>
      <HelpText style={styles.hint}>Who this is with. Only this app sees it; nobody is invited.</HelpText>
      {linked.length > 0 && <View style={styles.pillRow}>{linked.map(p => chip(p, true))}</View>}
      <SearchField field={filter} placeholder="Find a person" surface="sunken" style={styles.field} />
      {!searching && shown.length > 0 && <Text style={styles.label}>Suggested</Text>}
      <View style={styles.pillRow}>
        {shown.map(p => chip(p, false))}
        {!searching && hidden > 0 && (
          <TouchableOpacity
            style={styles.morepill}
            onPress={() => filter.inputRef.current?.focus()}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`${hidden} more people. Search to find one.`}
          >
            <Text style={styles.moreText}>+ {hidden} more</Text>
          </TouchableOpacity>
        )}
      </View>
      {searching && shown.length === 0 && <Text style={styles.empty}>No one matches.</Text>}
      {searching && hidden > 0 && <Text style={styles.empty}>{hidden} more. Keep typing to narrow it down.</Text>}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  hint: { color: colors.textSecondary, fontSize: font.xs, marginBottom: spacing.sm },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.smd },
  field: { marginBottom: spacing.smd },
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.xsm,
  },
  pill: {
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xsm,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  pillActive: { backgroundColor: colors.accentFill },
  pillText: { color: colors.text, fontSize: font.sm },
  pillTextActive: { color: colors.onAccent, fontWeight: fontWeight.medium },
  morepill: {
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xsm,
    borderRadius: radius.full,
    borderWidth: border.hairline,
    borderColor: colors.separator,
  },
  moreText: { color: colors.textSecondary, fontSize: font.sm },
  empty: { color: colors.textSecondary, fontSize: font.xs },
});
