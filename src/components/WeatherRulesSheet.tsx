import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { WeatherCondition, WeatherRule } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { haptics } from '../utils/haptics';
import { generateId } from '../utils/id';
import {
  WEATHER_CONDITIONS,
  WEATHER_RULE_TITLE_MAX_LENGTH,
  weatherConditionLabel,
} from '../utils/weatherTasks';
import {
  getLocationPermission,
  requestLocationPermission,
  type LocationPermission,
} from '../utils/weatherLocation';
import { InlineAction } from './InlineAction';
import { RuleListSheet, RuleSheetNoticeCard } from './RuleListSheet';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const CONDITION_OPTIONS: SegmentOption<WeatherCondition>[] =
  WEATHER_CONDITIONS.map(c => ({ value: c, label: weatherConditionLabel(c) }));

/**
 * Every weather rule, in one list — the only home a rule has, since unlike a
 * title rule (which can point at an existing category or project) a weather
 * rule is nothing but itself.
 *
 * The sheet itself is `RuleListSheet`, shared with `ScreenTimeRulesSheet`;
 * what's here is the two ends that differ — the location permission card
 * above the list, and the condition picker inside a row.
 */
export function WeatherRulesSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const rules = useSettingsStore(useShallow(s => s.weatherRules));
  const setRules = useSettingsStore(s => s.setWeatherRules);

  const [permission, setPermission] = useState<LocationPermission | null>(null);

  const refreshPermission = useCallback(() => {
    getLocationPermission().then(setPermission).catch(() => setPermission(null));
  }, []);

  // Permission can change while the user is off in the system Settings app, so
  // it's re-read on every foreground while this sheet is open — same shape
  // CalendarSettings' own permission row uses, scoped to visibility rather
  // than navigation focus since this is a Modal, not a screen.
  useEffect(() => {
    if (!visible) return;
    refreshPermission();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refreshPermission();
    });
    return () => subscription.remove();
  }, [visible, refreshPermission]);

  return (
    <RuleListSheet<WeatherRule>
      visible={visible}
      onClose={onClose}
      title="Weather rules"
      caption={
        "A rule adds its task on any day the weather matches, checked once a day using your "
        + "location. It never applies to a day that's already passed."
      }
      rules={rules}
      onChange={setRules}
      makeRule={() => ({
        id: generateId(),
        condition: 'sunny',
        title: '',
        enabled: true,
        lastFiredDayKey: null,
      })}
      describeRule={rule => weatherConditionLabel(rule.condition)}
      editorLabel="On a day that's"
      renderEditor={(rule, update) => (
        <SegmentedControl
          options={CONDITION_OPTIONS}
          value={rule.condition}
          onChange={condition => update({ condition })}
          columns={3}
          label="Weather condition"
          surface="card"
        />
      )}
      titlePlaceholder="e.g. Put on sunscreen"
      titleMaxLength={WEATHER_RULE_TITLE_MAX_LENGTH}
      emptyIcon="partly-sunny-outline"
      emptyTitle="No weather rules"
      emptySubtitle="Add a rule to get a task on a day the weather matches, like sunscreen on a sunny day."
      // Orange rather than the accent, which is what it was before this sheet
      // shared a shell with the screen time one.
      toggleOnColor={colors.orange}
      header={permission !== null && permission !== 'granted' && (
        <RuleSheetNoticeCard
          icon="location-outline"
          iconColor={permission === 'denied' ? colors.warning : colors.textSecondary}
          title="Location access"
          hint={
            permission === 'denied'
              ? "Blocked. Rules can't check the weather until you turn this back on for this app."
              : permission === 'undetermined'
              ? "Not allowed yet. Rules can't check the weather until you allow it."
              : 'Not available on this platform.'
          }
          action={(permission === 'denied' || permission === 'undetermined') && (
            <InlineAction
              label={permission === 'denied' ? 'Open Settings' : 'Allow'}
              onPress={async () => {
                haptics.tap();
                if (permission === 'denied') { Linking.openSettings(); return; }
                await requestLocationPermission();
                refreshPermission();
              }}
            />
          )}
        />
      )}
    />
  );
}
