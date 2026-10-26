import React, { useMemo } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { SpeedBumpRule } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAppGroupStore } from '../store/useAppGroupStore';
import { useColors } from '../theme/ThemeContext';
import { spacing } from '../theme';
import { haptics } from '../utils/haptics';
import { screenTimeBridge } from '../utils/screenTimeBridge';
import { allGroups, groupName, plainGroups, resolveGroupId } from '../utils/appGroups';
import {
  SPEED_BUMP_BLOCK_CHOICES,
  SPEED_BUMP_REPEAT_DEFAULT,
  SPEED_BUMP_REPEAT_MAX,
  SPEED_BUMP_REPEAT_MIN,
  SPEED_BUMP_THRESHOLD_DEFAULT,
  SPEED_BUMP_TIMES_MAX,
  SPEED_BUMP_TITLE_MAX_LENGTH,
  describeSpeedBump,
  newSpeedBumpRule,
} from '../utils/speedBump';
import { SCREEN_TIME_THRESHOLD_MAX, SCREEN_TIME_THRESHOLD_MIN } from '../utils/screenTimeRules';
import { describeDuration } from '../utils/manualBlock';
import { useGroupSelectionCounts } from '../hooks/useGroupSelectionCounts';
import { PillGroup } from './PillGroup';
import { CountStepper } from './CountStepper';
import { InlineAction } from './InlineAction';
import { SegmentedControl } from './SegmentedControl';
import { RuleFieldLabel, RuleListSheet, RuleSheetNoticeCard } from './RuleListSheet';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Frequency = 'once' | 'repeat';

/** "15 min", "1 hr", "2 hr": the segment labels for a block length. */
function blockLabel(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60} hr` : `${minutes} min`;
}

/**
 * Every speed bump, in one list: `RuleListSheet`, shared with
 * `ScreenTimeRulesSheet`, with the two ends that differ (see
 * `src/utils/speedBump.ts` for what a rule means).
 *
 * A rule names two groups, one whose use is timed and one that gets blocked,
 * and picks neither's apps here: the apps of a group are chosen on the Screen
 * Time screen, so a group with none says so on the row rather than offering a
 * second picker.
 */
export function SpeedBumpRulesSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const rules = useSettingsStore(useShallow(s => s.speedBumpRules));
  const setRules = useSettingsStore(s => s.setSpeedBumpRules);

  const customGroups = useAppGroupStore(s => s.groups);
  const groupsMeta = useAppGroupStore(s => s.meta);
  // The timed group has to hold apps of its own; the blocked one may be a supergroup.
  const timedOptions = useMemo(() => plainGroups(customGroups, groupsMeta), [customGroups, groupsMeta]);
  const blockOptions = useMemo(() => allGroups(customGroups, groupsMeta), [customGroups, groupsMeta]);
  const { authorization, counts, refresh: refreshNativeState } = useGroupSelectionCounts(visible);

  const timedId = (rule: SpeedBumpRule) => resolveGroupId(customGroups, rule.groupId, groupsMeta);
  const blockedId = (rule: SpeedBumpRule) => resolveGroupId(customGroups, rule.blockGroupId ?? rule.groupId, groupsMeta);
  const nameOf = (id: string | undefined) => groupName(customGroups, id, groupsMeta);
  const groupIsEmpty = (groupId: string) => {
    const selection = counts[groupId];
    return !selection || selection.applications + selection.categories === 0;
  };

  return (
    <RuleListSheet<SpeedBumpRule>
      visible={visible}
      onClose={onClose}
      title="Speed bumps"
      caption={
        'When your total time today on a group of apps reaches the time you set, a group of apps is blocked '
        + 'for a short while. A key tag or the emergency button ends the block early.'
      }
      rules={rules}
      onChange={setRules}
      makeRule={() => newSpeedBumpRule('')}
      describeRule={rule => describeSpeedBump(rule, nameOf(rule.groupId), nameOf(rule.blockGroupId ?? rule.groupId))}
      editorLabel="After this much use"
      rowNote={rule => {
        if (authorization !== 'approved') return null;
        if (groupIsEmpty(timedId(rule))) {
          return { text: `No apps picked in ${nameOf(rule.groupId)}, so this speed bump can’t fire.`, tone: 'warn' };
        }
        if (groupIsEmpty(blockedId(rule))) {
          return { text: `No apps picked in ${nameOf(rule.blockGroupId ?? rule.groupId)}, so nothing would be blocked.`, tone: 'warn' };
        }
        return null;
      }}
      renderEditor={(rule, update) => {
        const frequency: Frequency = rule.repeatEveryMinutes ? 'repeat' : 'once';
        return (
          <View style={styles.sections}>
            <CountStepper
              value={rule.thresholdMinutes}
              onChange={next => update({ thresholdMinutes: next ?? SPEED_BUMP_THRESHOLD_DEFAULT })}
              min={SCREEN_TIME_THRESHOLD_MIN}
              max={SCREEN_TIME_THRESHOLD_MAX}
              step={5}
              format={n => `${n} min`}
              label="Usage threshold"
              describeValue={n => `${n} minutes`}
            />
            <View style={styles.field}>
              <RuleFieldLabel>Count time on</RuleFieldLabel>
              <PillGroup
                noun="group"
                surface="card"
                options={timedOptions.map(g => ({
                  key: g.id,
                  label: g.name,
                  selected: g.id === timedId(rule),
                  suffix: groupIsEmpty(g.id) ? ' · no apps' : undefined,
                  onPress: () => update({ groupId: g.id }),
                }))}
              />
            </View>
            <View style={styles.field}>
              <RuleFieldLabel>Then block</RuleFieldLabel>
              <PillGroup
                noun="group"
                surface="card"
                options={[
                  {
                    key: 'same',
                    label: 'Same group',
                    selected: !rule.blockGroupId,
                    pinned: true,
                    onPress: () => update({ blockGroupId: undefined }),
                  },
                  ...blockOptions.map(g => ({
                    key: g.id,
                    label: g.name,
                    selected: rule.blockGroupId === g.id,
                    onPress: () => update({ blockGroupId: g.id }),
                  })),
                ]}
              />
            </View>
            <View style={styles.field}>
              <RuleFieldLabel>Block for</RuleFieldLabel>
              <SegmentedControl<number>
                label="Block length"
                options={SPEED_BUMP_BLOCK_CHOICES.map(m => ({ value: m, label: blockLabel(m), accessibilityLabel: describeDuration(m) }))}
                value={rule.blockMinutes}
                onChange={minutes => { haptics.tap(); update({ blockMinutes: minutes }); }}
              />
            </View>
            <View style={styles.field}>
              <RuleFieldLabel>How often</RuleFieldLabel>
              <SegmentedControl<Frequency>
                label="How often"
                options={[{ value: 'once', label: 'Once a day' }, { value: 'repeat', label: 'Repeat' }]}
                value={frequency}
                onChange={next => {
                  haptics.tap();
                  update(next === 'repeat'
                    ? { repeatEveryMinutes: SPEED_BUMP_REPEAT_DEFAULT, maxTimes: 3 }
                    : { repeatEveryMinutes: null, maxTimes: 1 });
                }}
              />
            </View>
            {frequency === 'repeat' && (
              <>
                <View style={styles.field}>
                  <RuleFieldLabel>Repeat every</RuleFieldLabel>
                  <CountStepper
                    value={rule.repeatEveryMinutes ?? SPEED_BUMP_REPEAT_DEFAULT}
                    onChange={next => update({ repeatEveryMinutes: next ?? SPEED_BUMP_REPEAT_DEFAULT })}
                    min={SPEED_BUMP_REPEAT_MIN}
                    max={SPEED_BUMP_REPEAT_MAX}
                    step={15}
                    format={n => `${n} min`}
                    label="Repeat interval"
                    describeValue={n => `${n} minutes of further use`}
                  />
                </View>
                <View style={styles.field}>
                  <RuleFieldLabel>Up to</RuleFieldLabel>
                  <CountStepper
                    value={rule.maxTimes}
                    onChange={next => update({ maxTimes: next ?? 2 })}
                    min={2}
                    max={SPEED_BUMP_TIMES_MAX}
                    step={1}
                    format={n => `${n} times a day`}
                    label="Times a day"
                    describeValue={n => `${n} times a day`}
                  />
                </View>
              </>
            )}
          </View>
        );
      }}
      titleLabel="Name"
      titlePlaceholder="e.g. Social wind-down"
      titleMaxLength={SPEED_BUMP_TITLE_MAX_LENGTH}
      emptyIcon="speedometer-outline"
      emptyTitle="No speed bumps"
      emptySubtitle="Add one to block a group of apps for a short while after you spend a set time on another."
      header={
        authorization !== null && authorization !== 'approved' ? (
          <RuleSheetNoticeCard
            icon="hourglass-outline"
            iconColor={authorization === 'denied' ? colors.warningText : colors.textSecondary}
            title="Screen Time access"
            hint={
              authorization === 'denied'
                ? 'Blocked. Speed bumps can’t see your app usage until you turn access back on in Settings.'
                : authorization === 'notDetermined'
                ? 'Not allowed yet. Speed bumps can’t see your app usage until you allow it.'
                : 'Not available on this device.'
            }
            action={(authorization === 'denied' || authorization === 'notDetermined') && (
              <InlineAction
                label={authorization === 'denied' ? 'Open Settings' : 'Allow'}
                onPress={async () => {
                  haptics.tap();
                  if (authorization === 'denied') { Linking.openSettings(); return; }
                  const bridge = screenTimeBridge();
                  if (bridge) await bridge.requestScreenTimeAuthorization();
                  refreshNativeState();
                }}
              />
            )}
          />
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  // Roomier than the other rule sheets: this editor has seven controls, and at
  // their 4pt gap the labels read as part of the control above them. The bottom
  // margin plus the shared sheet's own spacing gives the Name field, which it
  // adds after this, the same 24pt the sections have between them.
  sections: { gap: spacing.lg, marginBottom: spacing.smd },
  field: { gap: spacing.xs },
});
