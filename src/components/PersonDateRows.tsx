import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { PersonDate } from '../types';
import { EditorRow } from './EditorRow';
import { BirthdayPicker } from './BirthdayPicker';
import { InlineAction } from './InlineAction';
import { HelpText } from './HelpText';
import { TextField } from './TextField';
import { Toggle } from './Toggle';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, interaction, type Colors } from '../theme';
import { disclosureValue } from '../theme/textStyles';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { generateId } from '../utils/id';
import {
  MAX_PERSON_DATES,
  PERSON_DATE_LABEL_MAX_LENGTH,
  PERSON_DATE_PRESETS,
  personDateInYear,
} from '../utils/personDateTasks';
import { FieldLabel } from './FieldLabel';

/** "June 14, 2019", "June 14", or "June 14, 2027, once". */
function describeDate(date: Pick<PersonDate, 'month' | 'day' | 'year' | 'yearly'>): string {
  // 2024 is a leap year, so a year-less February 29 reads as the 29th.
  const when = personDateInYear(date, date.year ?? 2024);
  if (!when) return '';
  const text = when.toLocaleDateString(
    undefined,
    date.year ? { month: 'long', day: 'numeric', year: 'numeric' } : { month: 'long', day: 'numeric' }
  );
  return date.yearly ? text : `${text}, once`;
}

interface Props {
  dates: PersonDate[];
  onChange: (dates: PersonDate[]) => void;
}

/**
 * A person's other dates, inside the editor's DATES card under the birthday
 * row. Each is a collapsed `EditorRow` that opens in place to its label, its
 * date, whether it repeats, and whether it reminds. The date itself is picked
 * on `BirthdayPicker`, which is the same question: a month and a day, and a
 * year only if you know it.
 *
 * Edits go straight into the editor's own state through `onChange`, so they
 * save with Done like every other field there.
 */
export function PersonDateRows({ dates, onChange }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The date being picked: an existing one's id, 'new' for a date not yet in
  // the list, or null with the picker closed.
  const [pickingFor, setPickingFor] = useState<string | null>(null);

  const picking = pickingFor && pickingFor !== 'new' ? dates.find(d => d.id === pickingFor) ?? null : null;

  const patch = (id: string, next: Partial<PersonDate>) => {
    onChange(dates.map(d => (d.id === id ? { ...d, ...next } : d)));
  };

  const remove = (id: string) => {
    haptics.tap();
    animateLayout();
    setExpandedId(null);
    onChange(dates.filter(d => d.id !== id));
  };

  const confirmPick = (month: number, day: number, year: number | null) => {
    if (pickingFor === 'new') {
      const added: PersonDate = {
        id: generateId(), label: PERSON_DATE_PRESETS[0], month, day, year, yearly: true, remind: true,
      };
      animateLayout();
      onChange([...dates, added]);
      setExpandedId(added.id);
    } else if (pickingFor) {
      patch(pickingFor, { month, day, year });
    }
    setPickingFor(null);
  };

  return (
    <>
      {dates.map(date => {
        const open = expandedId === date.id;
        const needsYear = !date.yearly && date.year === null;
        return (
          <View key={date.id}>
            <View style={styles.sep} />
            <EditorRow
              icon="heart-outline"
              label={date.label.trim() || 'Date'}
              value={describeDate(date)}
              expanded={open}
              onPress={() => { haptics.tap(); animateLayout(); setExpandedId(open ? null : date.id); }}
            />
            {open && (
              <View style={styles.body}>
                <View style={styles.pillRow}>
                  {PERSON_DATE_PRESETS.map(preset => {
                    const active = date.label.trim() === preset;
                    return (
                      <TouchableOpacity
                        key={preset}
                        style={[styles.pill, active && styles.pillActive]}
                        onPress={() => { haptics.tap(); patch(date.id, { label: preset }); }}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.pillText, active && styles.pillTextActive]}>{preset}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <FieldLabel>What it is</FieldLabel>
                <TextField
                  style={styles.labelInput}
                  value={date.label}
                  onChangeText={label => patch(date.id, { label })}
                  placeholder="e.g. Started new job"
                  placeholderTextColor={colors.textTertiary}
                  maxLength={PERSON_DATE_LABEL_MAX_LENGTH}
                  accessibilityLabel="What the date is"
                />
                <TouchableOpacity
                  style={styles.line}
                  onPress={() => setPickingFor(date.id)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Change the date, ${describeDate(date)}`}
                >
                  <Text style={styles.lineLabel}>Date</Text>
                  <Text style={styles.lineValue}>{describeDate(date)}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.line}
                  onPress={() => { haptics.tap(); patch(date.id, { yearly: !date.yearly }); }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: date.yearly }}
                  accessibilityLabel="Every year"
                >
                  <Text style={styles.lineLabel}>Every year</Text>
                  <Toggle value={date.yearly} />
                </TouchableOpacity>
                {needsYear && (
                  <Text style={styles.warning}>A date that happens once needs a year. Tap Date to add one.</Text>
                )}
                <TouchableOpacity
                  style={styles.line}
                  onPress={() => { haptics.tap(); patch(date.id, { remind: !date.remind }); }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: date.remind }}
                  accessibilityLabel="Remind me"
                >
                  <Text style={styles.lineLabel}>Remind me</Text>
                  <Toggle value={date.remind} />
                </TouchableOpacity>
                <HelpText style={styles.hint}>Adds a task a few days before it, the same as a birthday.</HelpText>
                <TouchableOpacity
                  onPress={() => remove(date.id)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <Text style={styles.remove}>Remove this date</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}
      {dates.length < MAX_PERSON_DATES && (
        <>
          <View style={styles.sep} />
          <View style={styles.addRow}>
            <InlineAction icon="add" label="Add a date" onPress={() => setPickingFor('new')} />
          </View>
        </>
      )}
      <BirthdayPicker
        visible={pickingFor !== null}
        title={picking ? picking.label.trim() || 'Date' : 'New date'}
        hint="The year is optional for a date that comes round every year."
        month={picking?.month ?? null}
        day={picking?.day ?? null}
        year={picking?.year ?? null}
        onConfirm={confirmPick}
        onClear={() => {
          // Clearing a date's day leaves nothing to remember, so it goes.
          if (picking) remove(picking.id);
          setPickingFor(null);
        }}
        onCancel={() => setPickingFor(null)}
      />
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: spacing.md },
  body: {
    paddingLeft: spacing.md + 18 + spacing.md, paddingRight: spacing.md, paddingBottom: spacing.md,
    gap: spacing.smd,
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    paddingHorizontal: 14, paddingVertical: spacing.sm,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  pillActive: { backgroundColor: colors.accentFill },
  pillText: { color: colors.text, fontSize: font.sm, fontWeight: '500' },
  pillTextActive: { color: colors.onAccent, fontWeight: '600' },
  labelInput: {
    color: colors.text, fontSize: font.md, minHeight: 36,
    paddingHorizontal: spacing.smd, borderRadius: radius.sm, backgroundColor: colors.bgTertiary,
  },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, minHeight: 32 },
  lineLabel: { color: colors.text, fontSize: font.md },
  lineValue: disclosureValue(colors),
  warning: { color: colors.warningText, fontSize: font.xs },
  hint: { color: colors.textSecondary, fontSize: font.xs },
  remove: { color: colors.redText, fontSize: font.md },
  addRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
});
