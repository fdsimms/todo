import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { HealthRule } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { spacing } from '../theme';
import { haptics } from '../utils/haptics';
import { generateId } from '../utils/id';
import type { HealthMetric } from '../utils/moodInsights';
import {
  HEALTH_METRICS,
  HEALTH_RULE_TITLE_MAX_LENGTH,
  HEALTH_THRESHOLDS,
  clampHealthThreshold,
  describeHealthRule,
  healthMetricLabel,
} from '../utils/healthRules';
import { CountStepper } from './CountStepper';
import { InlineAction } from './InlineAction';
import { SegmentedControl } from './SegmentedControl';
import { RuleListSheet, RuleSheetNoticeCard } from './RuleListSheet';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const METRIC_OPTIONS = HEALTH_METRICS.map(metric => ({
  value: metric,
  label: healthMetricLabel(metric),
}));

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
 * - **The stepper's range changes with the metric**, since steps and hours are
 *   not the same size of number. Switching the metric re-clamps the threshold
 *   into the new range rather than leaving 3,000 hours of sleep behind.
 * - **The read has to be on, and the card says so.** This is the one rules
 *   sheet whose feature needs a second switch elsewhere, and nothing else here
 *   would give that away: the rules look perfectly well formed either way.
 *   Same shape the weather sheet's location card uses, and it turns the read on
 *   from here rather than sending anybody to go and find it.
 */
export function HealthRulesSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const rules = useSettingsStore(useShallow(s => s.healthRules));
  const setRules = useSettingsStore(s => s.setHealthRules);
  const healthReadEnabled = useSettingsStore(s => s.healthReadEnabled);
  const setHealthReadEnabled = useSettingsStore(s => s.setHealthReadEnabled);

  return (
    <RuleListSheet<HealthRule>
      visible={visible}
      onClose={onClose}
      title="Health rules"
      caption={
        'A rule adds its task on a day the reading falls under its number. Steps are only '
        + 'judged from 6 PM, since a step count earlier in the day has not had its chance yet. '
        + 'Each rule adds its task at most once a day.'
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
      editorLabel="On a day with less than"
      renderEditor={(rule, update) => (
        <View style={styles.editor}>
          <SegmentedControl<HealthMetric>
            options={METRIC_OPTIONS}
            value={rule.metric}
            onChange={metric => update({
              metric,
              // Re-clamped into the new metric's range, or switching from
              // "under 3,000 steps" to hours would leave a rule asking about
              // three thousand hours of sleep.
              threshold: clampHealthThreshold(metric, rule.threshold),
            })}
            label="Reading"
            surface="card"
          />
          <CountStepper
            value={rule.threshold}
            onChange={next => update({
              threshold: next ?? HEALTH_THRESHOLDS[rule.metric].default,
            })}
            min={HEALTH_THRESHOLDS[rule.metric].min}
            max={HEALTH_THRESHOLDS[rule.metric].max}
            step={HEALTH_THRESHOLDS[rule.metric].step}
            format={n => (rule.metric === 'steps'
              ? n.toLocaleString()
              : `${n} ${n === 1 ? 'hr' : 'hrs'}`)}
            label="Threshold"
            describeValue={n => (rule.metric === 'steps'
              ? `${n} steps`
              : `${n} ${n === 1 ? 'hour' : 'hours'}`)}
          />
        </View>
      )}
      titlePlaceholder="e.g. Keep today light"
      titleMaxLength={HEALTH_RULE_TITLE_MAX_LENGTH}
      emptyIcon="footsteps-outline"
      emptyTitle="No health rules"
      emptySubtitle="Add a rule to get a task on a day your steps or sleep come up short."
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

const styles = StyleSheet.create({
  editor: { gap: spacing.sm },
});
