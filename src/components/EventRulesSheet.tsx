import React, { useMemo } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { EventTaskRule } from '../types';
import { useCalendarStore } from '../store/useCalendarStore';
import { useDemoStore } from '../store/useDemoStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { generateId } from '../utils/id';
import {
  EVENT_LEAD_DAYS_MAX,
  EVENT_MATCH_MAX_LENGTH,
  EVENT_MATCH_MIN_LENGTH,
  EVENT_RULE_TITLE_MAX_LENGTH,
  describeEventRule,
  describeRuleMatches,
  summarizeRuleAgainstEvents,
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
 * **Each row says what its rule currently finds**, which is the one thing
 * this sheet does that the other two don't need. A weather rule's condition is
 * checked against a forecast that changes daily, so "it hasn't fired" carries
 * no information; an event rule is checked against a word the user typed
 * against words they also typed, where "it hasn't fired" almost always means
 * the two don't agree. Without the count, a cue with a typo in it and a cue
 * with nothing to match are the same silence — which is exactly how "dentists"
 * sits in Settings for a year not fetching the insurance card. See
 * `summarizeRuleAgainstEvents`; the near miss under a zero count is an offer,
 * never an edit.
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
  const calendarReadEnabled = useSettingsStore(s => s.calendarReadEnabled);
  const events = useCalendarStore(s => s.events);
  const calendarLoaded = useCalendarStore(s => s.loaded);
  const demoActive = useDemoStore(s => s.active);

  // Three reasons to say nothing rather than "no upcoming events match", and
  // they are the same distinction `dayBusyKnown` draws on the Calendar screen:
  // a window nobody has read, a feature switched off, and demo mode's fiction
  // are all cases where the app has no standing to report an absence. A count
  // is only honest when the read behind it really happened.
  const canReport = calendarReadEnabled && calendarLoaded && !demoActive;

  // `now` is captured per render rather than per rule so every row is judged
  // against one instant, and so a rule whose event starts mid-scroll doesn't
  // drop out from under the row above it. Eligibility is a plain
  // is-it-in-the-future test, so the grace window doesn't apply here — see
  // `eventIsRuleEligible`.
  const rowNote = useMemo(() => {
    if (!canReport) return undefined;
    const now = new Date();
    return (rule: EventTaskRule) => {
      const summary = summarizeRuleAgainstEvents(rule, events, now);
      const text = describeRuleMatches(summary);
      if (!text) return null;
      // Only a rule that is on and finding nothing is worth tinting. A rule
      // switched off is not failing at anything, and one that matches is fine.
      const tone = rule.enabled && summary.matched.length === 0 ? 'warn' as const : 'quiet' as const;
      return { text, tone };
    };
  }, [canReport, events]);

  return (
    <RuleListSheet<EventTaskRule>
      visible={visible}
      onClose={onClose}
      title="Event rules"
      caption={
        'A rule adds its task when an event on your calendar has the word you pick in its title. '
        + 'It reads the title only, never who was invited.'
      }
      rules={rules}
      onChange={setRules}
      makeRule={() => ({
        id: generateId(),
        match: '',
        title: '',
        leadDays: 0,
        enabled: true,
      })}
      describeRule={describeEventRule}
      rowNote={rowNote}
      editorLabel="When an event's title has"
      renderEditor={(rule, update) => (
        <>
          <TextInput
            style={styles.matchInput}
            value={rule.match}
            onChangeText={text => update({ match: text.slice(0, EVENT_MATCH_MAX_LENGTH) })}
            placeholder="e.g. flight"
            placeholderTextColor={colors.textTertiary}
            maxLength={EVENT_MATCH_MAX_LENGTH}
            autoCapitalize="none"
            returnKeyType="done"
          />
          <Text style={styles.hint}>
            {`At least ${EVENT_MATCH_MIN_LENGTH} letters, matched as a whole word. "Gym" finds `
            + '"Gym class" but not "Gymnastics".'}
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
