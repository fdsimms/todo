import React, { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { EventTaskRule } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { generateId } from '../utils/id';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import {
  EVENT_LEAD_DAYS_MAX,
  EVENT_MATCH_MAX_LENGTH,
  EVENT_MATCH_MIN_LENGTH,
  EVENT_RULE_MAX_MATCHES,
  EVENT_RULE_TITLE_MAX_LENGTH,
  describeEventRule,
} from '../utils/eventTasks';
import { CountStepper } from './CountStepper';
import { RuleListSheet } from './RuleListSheet';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Every event rule, in one list — the third caller of `RuleListSheet`, which
 * is what that component's own note asks a third rules sheet to be rather than
 * a copy of one of the two that came first.
 *
 * What's here is the one end that differs, and it differs by being two
 * controls rather than one: "which events" and "how far ahead" are genuinely
 * separate questions, where a weather rule's condition and a screen time
 * rule's threshold are each the whole of what a rule says.
 *
 * **There is no permission card above the list**, unlike both of the others.
 * This reads nothing the app was not already reading for Today's own event
 * rows, so the only thing that can stop a rule firing is the calendar read
 * being switched off — which lives in Settings › Calendar, and is a different
 * switch from a permission this sheet could ask for.
 */
export function EventRulesSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const rules = useSettingsStore(useShallow(s => s.eventRules));
  const setRules = useSettingsStore(s => s.setEventRules);

  return (
    <RuleListSheet<EventTaskRule>
      visible={visible}
      onClose={onClose}
      title="Event rules"
      caption={
        'A rule adds its task when an event on your calendar has one of the words you pick in its title. '
        + 'It reads the title only, never who was invited.'
      }
      rules={rules}
      onChange={setRules}
      makeRule={() => ({
        id: generateId(),
        matches: [],
        title: '',
        leadDays: 0,
        enabled: true,
      })}
      describeRule={describeEventRule}
      editorLabel="When an event's title has"
      renderEditor={(rule, update) => (
        <>
          <MatchEditor
            matches={rule.matches}
            onChange={matches => update({ matches })}
          />
          <Text style={styles.hint}>
            {`At least ${EVENT_MATCH_MIN_LENGTH} letters each, matched as a whole word. "Gym" finds `
            + '"Gym class" but not "Gymnastics". The rule fires if any of them appears.'}
          </Text>
          <Text style={[styles.editorLabel, styles.editorLabelSpaced]}>Days before the event</Text>
          <View style={styles.stepperRow}>
            <CountStepper
              value={rule.leadDays}
              onChange={next => update({ leadDays: next ?? 0 })}
              min={0}
              max={EVENT_LEAD_DAYS_MAX}
              format={n => (n === 0 ? 'Same day' : n === 1 ? '1 day' : `${n} days`)}
              label="Days before the event"
              describeValue={n => (n === 0 ? 'On the day of the event' : `${n} days before`)}
            />
          </View>
        </>
      )}
      titlePlaceholder="e.g. Pack a bag"
      titleMaxLength={EVENT_RULE_TITLE_MAX_LENGTH}
      emptyIcon="calendar-number-outline"
      emptyTitle="No event rules"
      emptySubtitle="Add a rule to get a task when an event on your calendar matches, like packing before a flight."
    />
  );
}

/**
 * The keyword list for one rule — a chip per cue with an X to remove it, and
 * a field to add another. Capped at `EVENT_RULE_MAX_MATCHES`: past that the
 * field and its hint disappear, since a chip row past the ceiling has nowhere
 * left to grow and a field with nothing it can do reads as broken rather than
 * as a limit.
 */
function MatchEditor({
  matches,
  onChange,
}: {
  matches: readonly string[];
  onChange: (matches: string[]) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [draft, setDraft] = useState('');

  const atLimit = matches.length >= EVENT_RULE_MAX_MATCHES;

  const commit = () => {
    const cue = draft.trim();
    if (!cue || atLimit) return;
    if (matches.some(m => m.toLowerCase() === cue.toLowerCase())) {
      setDraft('');
      return;
    }
    haptics.tap();
    animateLayout();
    onChange([...matches, cue]);
    setDraft('');
  };

  const remove = (index: number) => {
    haptics.tap();
    animateLayout();
    onChange(matches.filter((_, i) => i !== index));
  };

  return (
    <View>
      {matches.length > 0 && (
        <View style={styles.chips}>
          {matches.map((cue, i) => (
            <View key={`${cue}-${i}`} style={styles.chip}>
              <Text style={styles.chipText}>{cue}</Text>
              <TouchableOpacity
                onPress={() => remove(i)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`Remove keyword ${cue}`}
              >
                <Ionicons name="close-circle" size={iconSize.sm} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      {!atLimit && (
        <TextInput
          style={[styles.matchInput, matches.length > 0 && styles.matchInputSpaced]}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={commit}
          onBlur={commit}
          placeholder={matches.length === 0 ? 'e.g. flight' : 'Add another keyword'}
          placeholderTextColor={colors.textTertiary}
          maxLength={EVENT_MATCH_MAX_LENGTH}
          autoCapitalize="none"
          returnKeyType="done"
        />
      )}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // Matches RuleListSheet's own title field, so the two inputs in one
    // expanded row read as a pair rather than as two different controls.
    matchInput: {
      color: colors.text,
      fontSize: font.md,
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    matchInputSpaced: { marginTop: spacing.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.full,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.xs,
    },
    chipText: { color: colors.text, fontSize: font.sm },
    hint: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xs },
    editorLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    editorLabelSpaced: { marginTop: spacing.sm },
    stepperRow: { marginTop: spacing.xs, alignSelf: 'flex-start' },
  });
}
