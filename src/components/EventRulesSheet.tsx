import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { EventTaskRule } from '../types';
import { useCalendarStore } from '../store/useCalendarStore';
import { useDemoStore } from '../store/useDemoStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, spacing, type Colors } from '../theme';
import { generateId } from '../utils/id';
import {
  EVENT_LEAD_DAYS_MAX,
  EVENT_MATCH_MIN_LENGTH,
  EVENT_RULE_TITLE_MAX_LENGTH,
  describeEventRule,
  describeRuleMatches,
  summarizeRuleAgainstEvents,
} from '../utils/eventTasks';
import { CountStepper } from './CountStepper';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { RuleListSheet } from './RuleListSheet';
import { KeywordMatchEditor } from './KeywordMatchEditor';
import { HelpText } from './HelpText';

type RuleTiming = 'before' | 'leaving' | 'after';
type FollowUpMode = 'always' | 'unlessBooked';

const TIMING_OPTIONS: SegmentOption<RuleTiming>[] = [
  { value: 'before', label: 'Before event' },
  { value: 'leaving', label: 'Before leaving' },
  { value: 'after', label: 'After it ends' },
];

const FOLLOW_UP_OPTIONS: SegmentOption<FollowUpMode>[] = [
  { value: 'always', label: 'Every time' },
  { value: 'unlessBooked', label: 'Only if none is booked' },
];

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
 * no information; an event rule is checked against words the user typed
 * against words they also typed, where "it hasn't fired" almost always means
 * the two don't agree. Without the count, a keyword with a typo in it and a
 * keyword with nothing to match are the same silence — which is exactly how
 * "dentists" sits in Settings for a year not fetching the insurance card.
 *
 * It reports per rule rather than per keyword, matching how a rule fires: the
 * keywords are an OR, so one of them finding something is the rule finding
 * something. See `summarizeRuleAgainstEvents`; the near miss under a zero
 * count is an offer, never an edit.
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
  const fallbackCategory = useSettingsStore(s => s.eventTaskCategory);
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
        'A rule adds its task when an event on your calendar has one of its keywords in the title. '
        + 'Invitees aren’t checked.'
      }
      rules={rules}
      categoryFallback={fallbackCategory}
      logOnComplete
      onChange={setRules}
      makeRule={() => ({
        id: generateId(),
        matches: [],
        title: '',
        leadDays: 0,
        enabled: true,
      })}
      describeRule={describeEventRule}
      rowNote={rowNote}
      editorLabel="When an event’s title has"
      renderEditor={(rule, update) => (
        <>
          <KeywordMatchEditor
            matches={rule.matches}
            onChange={matches => update({ matches })}
          />
          <HelpText style={styles.hint}>
            {`At least ${EVENT_MATCH_MIN_LENGTH} letters each. Matches whole words, so “Gym” matches `
            + '“Gym class” but not “Gymnastics”. Any one keyword is enough.'}
          </HelpText>
          <Text style={[styles.editorLabel, styles.editorLabelSpaced]}>Add the task</Text>
          <SegmentedControl<RuleTiming>
            options={TIMING_OPTIONS}
            value={rule.afterEvent ? 'after' : rule.beforeLeaving ? 'leaving' : 'before'}
            onChange={timing => update(
              timing === 'after'
                ? { afterEvent: true, beforeLeaving: false, leadDays: 0 }
                : timing === 'leaving'
                  ? { afterEvent: false, skipIfUpcoming: false, beforeLeaving: true, leadDays: 0 }
                  : { afterEvent: false, skipIfUpcoming: false, beforeLeaving: false },
            )}
            label="When the task is added"
            surface="card"
          />
          {rule.afterEvent ? (
            <>
              <HelpText style={styles.hint}>
                The task appears after the event ends.
              </HelpText>
              <Text style={[styles.editorLabel, styles.editorLabelSpaced]}>If another event matches</Text>
              <SegmentedControl<FollowUpMode>
                options={FOLLOW_UP_OPTIONS}
                value={rule.skipIfUpcoming ? 'unlessBooked' : 'always'}
                onChange={mode => update({ skipIfUpcoming: mode === 'unlessBooked' })}
                label="If another matching event is coming up"
                surface="card"
              />
              <HelpText style={styles.hint}>
                {'“Only if none is booked” skips the task while another matching event is on your '
                + 'calendar in the next 6 months.'}
              </HelpText>
            </>
          ) : rule.beforeLeaving ? (
            <HelpText style={styles.hint}>
              {'The task is added on the day of the event. The event’s “Leave for” task lists it '
              + 'while it’s open and asks before you check that one off. Needs a location on the event.'}
            </HelpText>
          ) : (
            <>
              <Text style={[styles.editorLabel, styles.editorLabelSpaced]}>Days before the event</Text>
              <View style={styles.stepperRow}>
                <CountStepper
                  value={rule.leadDays}
                  onChange={next => update({ leadDays: next ?? 0 })}
                  min={0}
                  max={EVENT_LEAD_DAYS_MAX}
                  format={n => (n === 0 ? 'Same day' : n === 1 ? '1 day' : `${n} days`)}
                  label="Days before the event"
                  describeValue={n => (n === 0 ? 'On the day of the event' : `${n} ${n === 1 ? 'day' : 'days'} before`)}
                />
              </View>
            </>
          )}
        </>
      )}
      titlePlaceholder="e.g. Pack a bag"
      titleMaxLength={EVENT_RULE_TITLE_MAX_LENGTH}
      emptyIcon="calendar-number-outline"
      emptyTitle="No event rules"
      emptySubtitle="Add a rule to get a task when a calendar event matches, like packing before a flight."
    />
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
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
