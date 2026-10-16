import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Linking, Text, View, StyleSheet } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { ScreenTimeRule } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { font, spacing } from '../theme';
import { haptics } from '../utils/haptics';
import { generateId } from '../utils/id';
import {
  SCREEN_TIME_RULE_TITLE_MAX_LENGTH,
  SCREEN_TIME_THRESHOLD_DEFAULT,
  SCREEN_TIME_THRESHOLD_MAX,
  SCREEN_TIME_THRESHOLD_MIN,
} from '../utils/screenTimeRules';
import { screenTimeBridge } from '../utils/screenTimeBridge';
import { allGroups, groupName, isAllowGroup, resolveGroupId } from '../utils/appGroups';
import { useAppGroupStore } from '../store/useAppGroupStore';
import { useShieldReasons } from '../hooks/useShieldReasons';
import { groupEditLocked } from '../utils/blockEditLock';
import { confirmLivePicker } from '../utils/livePickerConfirm';
import { reconcileAppShield } from '../utils/appShieldReconcile';
import type { ScreenTimeAuthorization, ScreenTimeSelectionCount } from 'todo-screentime-bridge';
import { PillGroup } from './PillGroup';
import { CountStepper } from './CountStepper';
import { InlineAction } from './InlineAction';
import { RuleFieldLabel, RuleListSheet, RuleSheetNoticeCard } from './RuleListSheet';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Every screen-time rule, in one list. The sheet is `RuleListSheet`, shared
 * with `WeatherRulesSheet`; what's here is the two ends that differ.
 *
 * Both of this one's differences come from the same source — the app cannot
 * see usage:
 *
 * - **A rule picks an app group, never apps.** iOS hands back opaque tokens
 *   that live in the App Group container, one selection per group, so a rule
 *   holds a group id (`ScreenTimeRule.groupId`) and the groups are the ones
 *   defined on the Screen Time screen.
 * - **A rule with no apps picked does nothing**, and the card says so, because
 *   nothing else here would give it away — the rules look perfectly well formed.
 */
export function ScreenTimeRulesSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const rules = useSettingsStore(useShallow(s => s.screenTimeRules));
  const fallbackCategory = useSettingsStore(s => s.screenTimeTaskCategory);
  const setRules = useSettingsStore(s => s.setScreenTimeRules);

  const [authorization, setAuthorization] = useState<ScreenTimeAuthorization | null>(null);
  const customGroups = useAppGroupStore(s => s.groups);
  const groupsMeta = useAppGroupStore(s => s.meta);
  const groups = useMemo(() => allGroups(customGroups, groupsMeta), [customGroups, groupsMeta]);
  const [counts, setCounts] = useState<Record<string, ScreenTimeSelectionCount>>({});

  const refreshNativeState = useCallback(() => {
    const bridge = screenTimeBridge();
    if (!bridge) {
      setAuthorization('unavailable');
      return;
    }
    setAuthorization(bridge.screenTimeAuthorizationStatus());
    const next: Record<string, ScreenTimeSelectionCount> = {};
    for (const group of allGroups(customGroups, groupsMeta)) {
      next[group.id] = bridge.screenTimeSelectionCount(group.id);
    }
    setCounts(next);
  }, [customGroups, groupsMeta]);

  // Authorization can be revoked while the user is off in the system Settings
  // app, so it's re-read on every foreground while this sheet is open — the
  // same shape WeatherRulesSheet uses for location.
  useEffect(() => {
    if (!visible) return;
    refreshNativeState();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refreshNativeState();
    });
    return () => subscription.remove();
  }, [visible, refreshNativeState]);

  const reasons = useShieldReasons();

  const chooseApps = async (groupId: string) => {
    haptics.tap();
    // A live group takes adds now and removals when its block ends.
    const live = groupEditLocked(groupId, reasons);
    if (live && !(await confirmLivePicker(isAllowGroup(customGroups, groupId, groupsMeta)))) return;
    const bridge = screenTimeBridge();
    if (!bridge) return;
    if (await bridge.presentAppPicker(groupId, live)) {
      setCounts(prev => ({ ...prev, [groupId]: bridge.screenTimeSelectionCount(groupId) }));
      if (live) reconcileAppShield();
    }
  };

  const groupIdOf = (rule: ScreenTimeRule) => resolveGroupId(customGroups, rule.groupId, groupsMeta);
  const selectionLabelFor = (groupId: string) => {
    const selection = counts[groupId] ?? { applications: 0, categories: 0 };
    if (selection.applications + selection.categories === 0) return 'None yet';
    return [
      selection.applications > 0
        ? `${selection.applications} ${selection.applications === 1 ? 'app' : 'apps'}`
        : null,
      selection.categories > 0
        ? `${selection.categories} ${selection.categories === 1 ? 'category' : 'categories'}`
        : null,
    ].filter(Boolean).join(', ');
  };
  const groupIsEmpty = (groupId: string) => {
    const selection = counts[groupId];
    return !selection || selection.applications + selection.categories === 0;
  };

  return (
    <RuleListSheet<ScreenTimeRule>
      visible={visible}
      onClose={onClose}
      title="Screen Time rules"
      caption={
        'A rule adds its task once your total time today on its group of apps '
        + 'reaches the time you set. Each rule adds its task at most once a day.'
      }
      rules={rules}
      categoryFallback={fallbackCategory}
      logOnComplete
      onChange={setRules}
      makeRule={() => ({
        id: generateId(),
        thresholdMinutes: SCREEN_TIME_THRESHOLD_DEFAULT,
        title: '',
        enabled: true,
        lastFiredDayKey: null,
      })}
      describeRule={rule => `After ${rule.thresholdMinutes} min`}
      editorLabel="After this much use"
      rowNote={rule => authorization === 'approved' && groupIsEmpty(groupIdOf(rule))
        ? { text: `No apps picked in ${groupName(customGroups, rule.groupId, groupsMeta)}, so this rule can’t fire.`, tone: 'warn' }
        : null}
      renderEditor={(rule, update) => {
        const groupId = groupIdOf(rule);
        return (
          <>
            <View style={styles.stepperRow}>
              <CountStepper
                value={rule.thresholdMinutes}
                onChange={next => update({ thresholdMinutes: next ?? SCREEN_TIME_THRESHOLD_DEFAULT })}
                min={SCREEN_TIME_THRESHOLD_MIN}
                max={SCREEN_TIME_THRESHOLD_MAX}
                step={5}
                format={n => `${n} min`}
                label="Usage threshold"
                describeValue={n => `${n} minutes`}
              />
            </View>
            <RuleFieldLabel>Count time on</RuleFieldLabel>
            <PillGroup
              noun="group"
              surface="card"
              options={groups.map(g => ({
                key: g.id,
                label: g.name,
                selected: g.id === groupId,
                suffix: groupIsEmpty(g.id) ? 'no apps' : undefined,
                onPress: () => update({ groupId: g.id }),
              }))}
            />
            {authorization === 'approved' && (
              <View style={styles.appsRow}>
                <InlineAction
                  label="Choose apps"
                  variant="neutral"
                  onPress={() => chooseApps(groupId)}
                  accessibilityLabel={`Choose apps for ${groupName(customGroups, groupId, groupsMeta)}`}
                />
                <Text style={[styles.appsCount, { color: colors.textSecondary }]}>{selectionLabelFor(groupId)}</Text>
              </View>
            )}
          </>
        );
      }}
      titlePlaceholder="e.g. Take a walk"
      titleMaxLength={SCREEN_TIME_RULE_TITLE_MAX_LENGTH}
      emptyIcon="phone-portrait-outline"
      emptyTitle="No Screen Time rules"
      emptySubtitle="Add a rule to get a task after you spend a set time on a group of apps."
      header={
        <>
          {authorization !== null && authorization !== 'approved' && (
            <RuleSheetNoticeCard
              icon="hourglass-outline"
              iconColor={authorization === 'denied' ? colors.warningText : colors.textSecondary}
              title="Screen Time access"
              hint={
                authorization === 'denied'
                  ? "Blocked. Rules can’t see your app usage until you turn access back on in Settings."
                  : authorization === 'notDetermined'
                  ? "Not allowed yet. Rules can’t see your app usage until you allow it."
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
          )}
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  // The stepper is left-aligned rather than stretched, so it reads as a
  // control rather than as a row of the card behind it.
  stepperRow: { alignItems: 'flex-start', marginTop: spacing.xs, marginBottom: spacing.xs },
  appsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, marginTop: spacing.xs },
  appsCount: { fontSize: font.sm },
});
