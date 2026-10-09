import React, { useState, useMemo } from 'react';
import { View, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTaskStore } from '../../store/useTaskStore';
import { useCalendarStore } from '../../store/useCalendarStore';
import { useColors } from '../../theme/ThemeContext';
import { spacing } from '../../theme';
import { WhenPicker } from '../../components/WhenPicker';
import { getTaskDayStart } from '../../utils/dateUtils';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';

/**
 * Vacation mode and the destination forecast, rendered at the end of Day and time.
 * Vacation is a span of days the app behaves differently on, which is the
 * subject of that group; it used to sit in Tasks and projects between expiry and
 * the forecast. Every row keeps its entry id, so search and the screen gears
 * resolve unchanged.
 */
export function VacationTripsSettings() {
  const vacationMode = useSettingsStore(s => s.vacationMode);
  const setVacationMode = useSettingsStore(s => s.setVacationMode);
  const vacationStart = useSettingsStore(s => s.vacationStart);
  const vacationEnd = useSettingsStore(s => s.vacationEnd);
  const destinationForecastEnabled = useSettingsStore(s => s.destinationForecastEnabled);
  const setDestinationForecastEnabled = useSettingsStore(s => s.setDestinationForecastEnabled);
  const setVacationEnd = useSettingsStore(s => s.setVacationEnd);
  const simpleMode = useSettingsStore(s => s.simpleMode);

  const forgivVacationStreaks = useTaskStore(s => s.forgivVacationStreaks);

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const [showVacationEndPicker, setShowVacationEndPicker] = useState(false);

  return (
    <>
      {/* Nothing to configure in simplified mode: it removes the per-task
          "vacation pause" row, so vacation mode has nothing new to hide.
          Nothing *new* is the whole of it, though — the mode changes what is
          rendered and never what is stored, so tasks already marked for
          vacation pause, and whole categories set to hide on vacation, stay
          hidden exactly as they were. Switching simplified mode on with
          vacation mode already on therefore used to take the off-switch away
          from a state that was still hiding the user's tasks, with no way back
          to it. So the section survives as long as it is on. */}
      {(!simpleMode || vacationMode) && (
      <SettingsSection
        label="Vacation"
        footer={`${vacationMode && vacationStart ? `On since ${format(new Date(vacationStart), 'MMM d')}. ` : ''}While on, tasks with “Vacation pause” turned on are hidden everywhere and their streaks are protected. Tasks in categories set to “Hide on vacation” are hidden too. Turning it off, manually or on the end date, forgives streaks.`}
      >
        <SettingsRow
          entryId="vacationMode"
          icon="airplane-outline"
          iconColor={vacationMode ? colors.accent : undefined}
          label="Vacation mode"
          hint="Hides tasks marked for vacation pause."
          toggle={vacationMode}
          onPress={() => {
            if (vacationMode) {
              forgivVacationStreaks();
              setVacationMode(false);
            } else {
              setVacationMode(true);
            }
            // Any calendar in vacationHiddenCalendarIds joins or leaves the
            // read right on the toggle, rather than waiting on the next
            // focus of a screen that happens to call refresh() itself.
            void useCalendarStore.getState().refresh();
          }}
        />
        {vacationMode && (
          <>
            <View style={styles.sep} />
            <SettingsRow
              entryId="vacationEnd"
              icon="calendar-outline"
              label="End date"
              hint={vacationEnd
                ? 'Turns off automatically on this day'
                : 'Optional. Turn off manually if not set'}
              value={vacationEnd ? format(new Date(vacationEnd), 'MMM d, yyyy') : 'None'}
              onPress={() => setShowVacationEndPicker(true)}
              accessibilityLabel="Vacation end date"
              trailing={vacationEnd ? (
                <TouchableOpacity
                  onPress={() => setVacationEnd(null)}
                  hitSlop={8}
                  style={{ marginLeft: spacing.xs }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear vacation end date"
                >
                  <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              ) : undefined}
            />
          </>
        )}
      </SettingsSection>
      )}

      <SettingsSection
        label="Trips"
        footer="With this on, a project’s destination is sent to Open-Meteo to look up its coordinates and the forecast for your dates. The project shows the temperature range and whether rain or snow is expected. Only projects with a destination and a departure date are looked up. Nothing is stored. Off means nothing leaves the app."
      >
        <SettingsRow
          entryId="destinationForecastEnabled"
          icon="partly-sunny-outline"
          iconColor={destinationForecastEnabled ? colors.accent : undefined}
          label="Destination forecast"
          hint="Looks up the weather where you’re going."
          toggle={destinationForecastEnabled}
          onPress={() => setDestinationForecastEnabled(!destinationForecastEnabled)}
        />
      </SettingsSection>

      {/*
        A plain day, so WhenPicker — the CalendarPicker this used to be is only
        for a completion timestamp or a set of dates. Time of day and Suggest
        are off: this is a range bound, not a task's own schedule.
      */}
      <WhenPicker
        visible={showVacationEndPicker}
        value={vacationEnd ? new Date(vacationEnd) : null}
        title="Vacation end date"
        showTimeOfDay={false}
        showSuggest={false}
        onConfirm={date => {
          setVacationEnd(date ? getTaskDayStart(date).toISOString() : null);
          setShowVacationEndPicker(false);
        }}
        onClear={() => {
          setVacationEnd(null);
          setShowVacationEndPicker(false);
        }}
        onCancel={() => setShowVacationEndPicker(false)}
      />
    </>
  );
}
