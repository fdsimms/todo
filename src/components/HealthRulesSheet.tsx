import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { HealthRule, HealthRuleMetric } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { font, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { generateId } from '../utils/id';
import {
  HEALTH_METRICS,
  HEALTH_METRIC_DIRECTION,
  HEALTH_METRIC_EARLIEST_HOUR,
  HEALTH_RULE_TITLE_MAX_LENGTH,
  HEALTH_THRESHOLDS,
  clampCheckpointHour,
  clampHealthThreshold,
  describeHealthRule,
  formatCheckpointHour,
  healthMetricAmount,
  healthMetricLabel,
  healthRuleCheckpointHour,
  healthRuleDirection,
  usesCheckpoint,
} from '../utils/healthRules';
import { CountStepper } from './CountStepper';
import { InlineAction } from './InlineAction';
import { SegmentedControl } from './SegmentedControl';
import { RuleListSheet, RuleSheetNoticeCard, RuleFieldLabel } from './RuleListSheet';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const METRIC_OPTIONS = HEALTH_METRICS.map(metric => ({
  value: metric,
  label: healthMetricLabel(metric),
}));

const DIRECTION_OPTIONS: { value: 'under' | 'over'; label: string }[] = [
  { value: 'under', label: 'Under' },
  { value: 'over', label: 'Over' },
];

/**
 * Every health rule, in one list. The sheet is `RuleListSheet`, shared with
 * `WeatherRulesSheet` and `ScreenTimeRulesSheet`; what's here is the two ends
 * that differ.
 *
 * Two rule-specific things, and one notice:
 *
 * - **The editor is a metric and a number**, where weather's is a condition and
 *   screen time's is a number alone. The number is per rule for screen time's
 *   reason rather than weather's: six hours and four hours are two different
 *   days, so the title cannot carry the bar.
 * - **The stepper's range and rendering both change with the metric**, since
 *   steps, hours, milligrams, grams and millilitres are not the same size of
 *   number or the same unit. Switching the metric re-clamps the threshold
 *   into the new range rather than leaving 3,000 hours of sleep behind, and
 *   `healthMetricAmount` — the same function `describeHealthRule` builds its
 *   own line from — renders the stepper's value so the two can't drift on how
 *   a given metric's number reads.
 * - **Every metric but steps and sleep also picks its own hour.** Those two
 *   judge from a fixed point in the day (see `HEALTH_METRIC_EARLIEST_HOUR`'s
 *   comment), but a nutrient target is naturally checked more than once — a
 *   lunchtime sodium floor and a separate, higher dinner one, say — so any of
 *   the eight nutrient rules carries its own checkpoint hour instead of
 *   sharing one.
 * - **Under/over is a per-rule choice for the same eight metrics**, not a
 *   fixed property read off the metric — a sodium ceiling (blood pressure) and
 *   a sodium floor (POTS) are both real diets, so it's its own control rather
 *   than something only saturated fat, sugar or caffeine get to flip.
 * - **The read has to be on, and the card says so.** This is the one rules
 *   sheet whose feature needs a second switch elsewhere, and nothing else here
 *   would give that away: the rules look perfectly well formed either way.
 *   Same shape the weather sheet's location card uses, and it turns the read on
 *   from here rather than sending anybody to go and find it.
 *
 * **Four controls, four headers, no shared lead-in sentence.** `RuleListSheet`'s
 * `editorLabel` is a single sentence above one control, which is what weather's
 * condition picker and screen time's minutes stepper each are. Health's editor
 * is up to four controls (Reading, Direction, Threshold, Checked from) for a
 * nutrient rule, and a rule that used the same shared header ("On a day with
 * less than") to introduce all four read like a sentence that had wandered off
 * after its own second clause — the direction and checkpoint controls that
 * follow the threshold had no header of their own at all. `editorLabel` here
 * returns `''` (which `RuleListSheet` renders as nothing) and each control gets
 * its own `RuleFieldLabel` instead, in the order a person would actually answer
 * them: which reading, compared which way, against what number, checked from
 * when.
 */
export function HealthRulesSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const rules = useSettingsStore(useShallow(s => s.healthRules));
  const setRules = useSettingsStore(s => s.setHealthRules);
  const healthReadEnabled = useSettingsStore(s => s.healthReadEnabled);
  const setHealthReadEnabled = useSettingsStore(s => s.setHealthReadEnabled);
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <RuleListSheet<HealthRule>
      visible={visible}
      onClose={onClose}
      title="Health rules"
      caption={
        'A rule adds its task on a day the reading crosses its number. Steps are only judged '
        + 'from 6 PM, since a step count earlier in the day has not had its chance yet. A '
        + 'nutrient rule is judged from whatever hour you set it to, and needs another app '
        + 'logging food to Health, since this app never writes one of those samples itself. A '
        + 'nutrient rule can also be set as a ceiling instead of a floor, so it adds its task when '
        + 'the day goes over its number rather than under it. Each rule adds its task at most once '
        + 'a day.'
      }
      rules={rules}
      onChange={setRules}
      makeRule={() => ({
        id: generateId(),
        metric: 'sleepHours',
        threshold: HEALTH_THRESHOLDS.sleepHours.default,
        title: '',
        enabled: true,
        lastFiredDayKey: null,
      })}
      describeRule={describeHealthRule}
      editorLabel={() => ''}
      renderEditor={(rule, update) => (
        <View style={styles.editor}>
          <RuleFieldLabel>Reading</RuleFieldLabel>
          <SegmentedControl<HealthRuleMetric>
            options={METRIC_OPTIONS}
            value={rule.metric}
            onChange={metric => update({
              metric,
              // Re-clamped into the new metric's range, or switching from
              // "under 3,000 steps" to hours would leave a rule asking about
              // three thousand hours of sleep.
              threshold: clampHealthThreshold(metric, rule.threshold),
              // Checkpoint hour and direction both only apply to the eight
              // nutrients, so both are only given a starting value the first
              // time a rule turns into one of them — everything else leaves
              // whatever the rule already carries alone.
              checkpointHour: usesCheckpoint(metric)
                ? (rule.checkpointHour ?? HEALTH_METRIC_EARLIEST_HOUR[metric])
                : rule.checkpointHour,
              direction: usesCheckpoint(metric)
                ? (rule.direction ?? HEALTH_METRIC_DIRECTION[metric])
                : rule.direction,
            })}
            label="Reading"
            surface="card"
            columns={2}
          />

          {usesCheckpoint(rule.metric) && (
            <>
              <RuleFieldLabel>Direction</RuleFieldLabel>
              <SegmentedControl<'under' | 'over'>
                options={DIRECTION_OPTIONS}
                value={healthRuleDirection(rule)}
                onChange={direction => update({ direction })}
                label="Adds the task when the day is"
                surface="card"
              />
            </>
          )}

          <RuleFieldLabel>Threshold</RuleFieldLabel>
          <CountStepper
            value={rule.threshold}
            onChange={next => update({
              threshold: next ?? HEALTH_THRESHOLDS[rule.metric].default,
            })}
            min={HEALTH_THRESHOLDS[rule.metric].min}
            max={HEALTH_THRESHOLDS[rule.metric].max}
            step={HEALTH_THRESHOLDS[rule.metric].step}
            format={n => healthMetricAmount(rule.metric, n)}
            label="Threshold"
            describeValue={n => healthMetricAmount(rule.metric, n ?? HEALTH_THRESHOLDS[rule.metric].default)}
          />

          {usesCheckpoint(rule.metric) && (
            <>
              <RuleFieldLabel>Checked from</RuleFieldLabel>
              <CountStepper
                value={healthRuleCheckpointHour(rule)}
                onChange={next => update({
                  checkpointHour: clampCheckpointHour(next ?? HEALTH_METRIC_EARLIEST_HOUR[rule.metric]),
                })}
                min={0}
                max={23}
                step={1}
                format={formatCheckpointHour}
                label="Checked from"
                describeValue={n => formatCheckpointHour(n ?? HEALTH_METRIC_EARLIEST_HOUR[rule.metric])}
              />
              <Text style={styles.hint}>
                This rule won't add its task before this hour, since a nutrient goal is often
                checked more than once a day.
              </Text>
            </>
          )}
        </View>
      )}
      titlePlaceholder="e.g. Keep today light"
      titleMaxLength={HEALTH_RULE_TITLE_MAX_LENGTH}
      emptyIcon="footsteps-outline"
      emptyTitle="No health rules"
      emptySubtitle="Add a rule to get a task on a day a reading crosses its number."
      header={
        !healthReadEnabled ? (
          <RuleSheetNoticeCard
            icon="heart-outline"
            iconColor={colors.textSecondary}
            title="Apple Health isn't being read"
            hint="These rules do nothing until the app is reading Health. Nothing is written to Health and no copy is kept."
            action={
              <InlineAction
                icon="heart-outline"
                label="Turn on"
                onPress={() => { haptics.tap(); setHealthReadEnabled(true); }}
              />
            }
          />
        ) : null
      }
      toggleOnColor={colors.red}
    />
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  editor: { gap: spacing.sm },
  hint: { color: colors.textSecondary, fontSize: font.xs, lineHeight: 16 },
});
