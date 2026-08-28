import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, View, StyleSheet } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { ScreenTimeRule } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { spacing } from '../theme';
import { haptics } from '../utils/haptics';
import { generateId } from '../utils/id';
import {
  SCREEN_TIME_RULE_TITLE_MAX_LENGTH,
  SCREEN_TIME_THRESHOLD_DEFAULT,
  SCREEN_TIME_THRESHOLD_MAX,
  SCREEN_TIME_THRESHOLD_MIN,
} from '../utils/screenTimeRules';
import { screenTimeBridge } from '../utils/screenTimeBridge';
import type { ScreenTimeAuthorization } from 'todo-screentime-bridge';
import { CountStepper } from './CountStepper';
import { InlineAction } from './InlineAction';
import { RuleListSheet, RuleSheetNoticeCard } from './RuleListSheet';

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
 * - **The app picker is above the rules, not inside one.** iOS hands back
 *   opaque tokens, so there is one selection every rule shares. Putting it in
 *   the header is the honest layout: it's a property of the feature, not of a
 *   rule, and a per-rule set of apps isn't a design that was passed over, it
 *   isn't available.
 * - **A rule with no apps picked does nothing**, and the card says so, because
 *   nothing else here would give it away — the rules look perfectly well formed.
 */
export function ScreenTimeRulesSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const rules = useSettingsStore(useShallow(s => s.screenTimeRules));
  const setRules = useSettingsStore(s => s.setScreenTimeRules);

  const [authorization, setAuthorization] = useState<ScreenTimeAuthorization | null>(null);
  const [selection, setSelection] = useState({ applications: 0, categories: 0 });

  const refreshNativeState = useCallback(() => {
    const bridge = screenTimeBridge();
    if (!bridge) {
      setAuthorization('unavailable');
      return;
    }
    setAuthorization(bridge.screenTimeAuthorizationStatus());
    setSelection(bridge.screenTimeSelectionCount());
  }, []);

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

  const chooseApps = async () => {
    haptics.tap();
    const bridge = screenTimeBridge();
    if (!bridge) return;
    if (await bridge.presentAppPicker()) setSelection(bridge.screenTimeSelectionCount());
  };

  const totalPicked = selection.applications + selection.categories;
  const selectionLabel = totalPicked === 0
    ? 'None yet'
    : [
      selection.applications > 0
        ? `${selection.applications} ${selection.applications === 1 ? 'app' : 'apps'}`
        : null,
      selection.categories > 0
        ? `${selection.categories} ${selection.categories === 1 ? 'category' : 'categories'}`
        : null,
    ].filter(Boolean).join(', ');

  return (
    <RuleListSheet<ScreenTimeRule>
      visible={visible}
      onClose={onClose}
      title="Screen time rules"
      caption={
        'A rule adds its task once you have spent that long on the apps you picked, counted '
        + 'across the day. Each rule adds its task at most once a day.'
      }
      rules={rules}
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
      renderEditor={(rule, update) => (
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
      )}
      titlePlaceholder="e.g. Take a walk"
      titleMaxLength={SCREEN_TIME_RULE_TITLE_MAX_LENGTH}
      emptyIcon="phone-portrait-outline"
      emptyTitle="No screen time rules"
      emptySubtitle="Add a rule to get a task once you've spent a while on the apps you picked."
      header={
        <>
          {authorization !== null && authorization !== 'approved' && (
            <RuleSheetNoticeCard
              icon="hourglass-outline"
              iconColor={authorization === 'denied' ? colors.warning : colors.textSecondary}
              title="Screen Time access"
              hint={
                authorization === 'denied'
                  ? "Blocked. Rules can't see your app usage until you turn this back on for this app."
                  : authorization === 'notDetermined'
                  ? "Not allowed yet. Rules can't see your app usage until you allow it."
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
          {authorization === 'approved' && (
            <RuleSheetNoticeCard
              icon="apps-outline"
              iconColor={colors.accent}
              title="Apps to watch"
              hint={totalPicked === 0
                ? 'No apps picked yet, so no rule below can fire.'
                : 'Every rule below counts time across these.'}
              value={selectionLabel}
              onPress={chooseApps}
              accessibilityLabel={`Apps to watch: ${selectionLabel}`}
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
  stepperRow: { alignItems: 'flex-start', marginTop: spacing.xs },
});
