import React, { useMemo } from 'react';
import { View, Platform } from 'react-native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useColors } from '../../theme/ThemeContext';
import { useNavMenuOptions } from '../../hooks/useNavMenuOptions';
import { navigateToTab } from '../../navigation/navigationRef';
import { haptics } from '../../utils/haptics';
import { CountStepper } from '../../components/CountStepper';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';
import {
  FOCUS_DEFAULTS,
  FOCUS_LONG_REST_EVERY_MAX, FOCUS_LONG_REST_EVERY_MIN,
  FOCUS_REST_AFTER_MINUTES_MAX, FOCUS_REST_AFTER_MINUTES_MIN, FOCUS_REST_AFTER_TASKS_MAX,
  FOCUS_REST_MAX, FOCUS_REST_MIN, FOCUS_WORK_CAP_MAX, FOCUS_WORK_CAP_MIN,
  focusRestsDisabled,
} from '../../utils/focusSettings';

/**
 * Focus sessions, the scroll suggestion and the timers' Lock Screen activity.
 * Blocking apps (during a session, until a task is done, after failing one, or
 * with a key tag) is the Screen Time screen, which this points to.
 *
 * Split out of Tasks & projects, which held 36 settings across ten sections
 * with this one alone at sixteen rows: a group named for what it is about,
 * rather than the rows' being found by scrolling past everything else.
 * Every row keeps its entry id, so search and the screen gears resolve unchanged.
 */
export function FocusSettings() {
  const focusWorkCapMinutes = useSettingsStore(s => s.focusWorkCapMinutes);
  const setFocusWorkCapMinutes = useSettingsStore(s => s.setFocusWorkCapMinutes);
  const focusDefaultWorkMinutes = useSettingsStore(s => s.focusDefaultWorkMinutes);
  const setFocusDefaultWorkMinutes = useSettingsStore(s => s.setFocusDefaultWorkMinutes);
  const focusRestAfterTasks = useSettingsStore(s => s.focusRestAfterTasks);
  const setFocusRestAfterTasks = useSettingsStore(s => s.setFocusRestAfterTasks);
  const focusRestAfterMinutes = useSettingsStore(s => s.focusRestAfterMinutes);
  const setFocusRestAfterMinutes = useSettingsStore(s => s.setFocusRestAfterMinutes);
  const focusRestMinutes = useSettingsStore(s => s.focusRestMinutes);
  const setFocusRestMinutes = useSettingsStore(s => s.setFocusRestMinutes);
  const focusLongRestEvery = useSettingsStore(s => s.focusLongRestEvery);
  const setFocusLongRestEvery = useSettingsStore(s => s.setFocusLongRestEvery);
  const focusLongRestMinutes = useSettingsStore(s => s.focusLongRestMinutes);
  const setFocusLongRestMinutes = useSettingsStore(s => s.setFocusLongRestMinutes);
  const focusLiveActivity = useSettingsStore(s => s.focusLiveActivity);
  const setFocusLiveActivity = useSettingsStore(s => s.setFocusLiveActivity);
  const focusHideTimers = useSettingsStore(s => s.focusHideTimers);
  const setFocusHideTimers = useSettingsStore(s => s.setFocusHideTimers);
  const focusBreaksEnabled = useSettingsStore(s => s.focusBreaksEnabled);
  const setFocusBreaksEnabled = useSettingsStore(s => s.setFocusBreaksEnabled);
  const noBreaks = focusRestsDisabled({ focusRestAfterTasks, focusRestAfterMinutes, focusBreaksEnabled });
  const timerLiveActivity = useSettingsStore(s => s.timerLiveActivity);
  const setTimerLiveActivity = useSettingsStore(s => s.setTimerLiveActivity);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const { screenTimeSupported } = useNavMenuOptions();

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  return (
    <>
      {!simpleMode && (
      <SettingsSection
        label="Focus sessions"
        footer={`${noBreaks
          ? 'Breaks are off, so sessions run straight through.'
          : 'Breaks are added after the set work time or task count, whichever comes first. Start a session from Today’s … menu.'}${
          Platform.OS === 'ios' ? ' The Lock Screen activity requires iOS 17.' : ''}`}
      >
        <SettingsRow
          entryId="focusWorkCapMinutes"
          icon="hourglass-outline"
          label="Work stretch length"
          hint="The longest a single stretch runs. A task estimated for longer is split into equal parts."
          tight
        />
        <View style={styles.cadenceRow}>
          <CountStepper
            value={focusWorkCapMinutes}
            onChange={next => setFocusWorkCapMinutes(next ?? FOCUS_DEFAULTS.workCapMinutes)}
            min={FOCUS_WORK_CAP_MIN}
            max={FOCUS_WORK_CAP_MAX}
            format={n => `${n} min`}
            label="Work stretch length"
            describeValue={n => `${n} minutes`}
          />
        </View>

        <View style={styles.sep} />
        <SettingsRow
          entryId="focusDefaultWorkMinutes"
          icon="help-circle-outline"
          label="Length without an estimate"
          tight
        />
        <View style={styles.cadenceRow}>
          <CountStepper
            value={focusDefaultWorkMinutes}
            onChange={next => setFocusDefaultWorkMinutes(next ?? FOCUS_DEFAULTS.defaultWorkMinutes)}
            min={FOCUS_WORK_CAP_MIN}
            max={FOCUS_WORK_CAP_MAX}
            format={n => `${n} min`}
            label="Length without an estimate"
            describeValue={n => `${n} minutes`}
          />
        </View>

        <View style={styles.sep} />
        <SettingsRow
          entryId="focusBreaksEnabled"
          icon="cafe-outline"
          iconColor={focusBreaksEnabled ? colors.accent : undefined}
          label="Breaks in focus sessions"
          hint={focusBreaksEnabled
            ? 'Sessions add breaks using the settings below. Turn off to start every session with no breaks. Your break settings are kept.'
            : 'New sessions have no breaks. Turn on to use your break settings again.'}
          toggle={focusBreaksEnabled}
          onPress={() => setFocusBreaksEnabled(!focusBreaksEnabled)}
        />

        <View style={styles.sep} />
        <SettingsRow
          entryId="focusRestAfterMinutes"
          icon="time-outline"
          label="Break after this much work"
          hint="Set to Off to skip time-based breaks."
          tight
        />
        <View style={styles.cadenceRow}>
          <CountStepper
            value={focusRestAfterMinutes}
            onChange={setFocusRestAfterMinutes}
            min={FOCUS_REST_AFTER_MINUTES_MIN}
            max={FOCUS_REST_AFTER_MINUTES_MAX}
            allowNull
            emptyLabel="Off"
            format={n => `${n} min`}
            label="Break after this much work"
            describeValue={n => (n === null ? 'Off' : `${n} minutes`)}
          />
        </View>

        <View style={styles.sep} />
        <SettingsRow
          entryId="focusRestAfterTasks"
          icon="list-outline"
          label="Break after this many tasks"
          hint="Set to Off to skip task-based breaks."
          tight
        />
        <View style={styles.cadenceRow}>
          <CountStepper
            value={focusRestAfterTasks}
            onChange={setFocusRestAfterTasks}
            min={1}
            max={FOCUS_REST_AFTER_TASKS_MAX}
            allowNull
            emptyLabel="Off"
            format={n => `${n} task${n === 1 ? '' : 's'}`}
            label="Break after this many tasks"
            describeValue={n => (n === null ? 'Off' : `${n} tasks`)}
          />
        </View>

        {!noBreaks && (
          <>
            <View style={styles.sep} />
            <SettingsRow
              entryId="focusRestMinutes"
              icon="cafe-outline"
              label="Break length"
              tight
            />
            <View style={styles.cadenceRow}>
              <CountStepper
                value={focusRestMinutes}
                onChange={next => setFocusRestMinutes(next ?? FOCUS_DEFAULTS.restMinutes)}
                min={FOCUS_REST_MIN}
                max={FOCUS_REST_MAX}
                format={n => `${n} min`}
                label="Break length"
                describeValue={n => `${n} minutes`}
              />
            </View>

            <View style={styles.sep} />
            <SettingsRow
              entryId="focusLongRestEvery"
              icon="bed-outline"
              label="Long break every"
              hint="Makes every nth break longer. Set to Off to keep every break the same length."
              tight
            />
            <View style={styles.cadenceRow}>
              <CountStepper
                value={focusLongRestEvery}
                onChange={setFocusLongRestEvery}
                min={FOCUS_LONG_REST_EVERY_MIN}
                max={FOCUS_LONG_REST_EVERY_MAX}
                allowNull
                emptyLabel="Off"
                format={n => `${n} breaks`}
                label="Long break every"
                describeValue={n => (n === null ? 'Off' : `every ${n} breaks`)}
              />
            </View>

            {focusLongRestEvery !== null && (
              <>
                <View style={styles.sep} />
                <SettingsRow
                  entryId="focusLongRestMinutes"
                  icon="moon-outline"
                  label="Long break length"
                  tight
                />
                <View style={styles.cadenceRow}>
                  <CountStepper
                    value={focusLongRestMinutes}
                    onChange={next => setFocusLongRestMinutes(next ?? FOCUS_DEFAULTS.longRestMinutes)}
                    min={FOCUS_REST_MIN}
                    max={FOCUS_REST_MAX}
                    format={n => `${n} min`}
                    label="Long break length"
                    describeValue={n => `${n} minutes`}
                  />
                </View>
              </>
            )}
          </>
        )}

        <View style={styles.sep} />
        <SettingsRow
          entryId="focusHideTimers"
          icon="eye-off-outline"
          iconColor={focusHideTimers ? colors.accent : undefined}
          label="Hide timers while focusing"
          hint={focusHideTimers
            ? 'The countdown is hidden on the running session screen, the strip on Today, and the Lock Screen. Steps still end and chime on schedule. Change it per session from the start screen.'
            : 'The countdown shows everywhere a session runs. Change it per session from the start screen.'}
          toggle={focusHideTimers}
          onPress={() => setFocusHideTimers(!focusHideTimers)}
        />

        {Platform.OS === 'ios' && (
          <>
            <View style={styles.sep} />
            <SettingsRow
              entryId="focusLiveActivity"
              icon="phone-portrait-outline"
              iconColor={focusLiveActivity ? colors.accent : undefined}
              label="Live Activity while focusing"
              hint={focusLiveActivity
                ? 'The step you’re on shows on the Lock Screen and Dynamic Island, with a button to pause it or move to the next one'
                : 'Sessions stay in the app only'}
              toggle={focusLiveActivity}
              onPress={() => setFocusLiveActivity(!focusLiveActivity)}
            />
          </>
        )}

        {/* A pointer, not a switch: blocking apps moved to its own screen, and
            somebody looking for it here is looking where it used to be. No
            entry id, since the rows it points at are found by their own. */}
        {screenTimeSupported && (
          <>
            <View style={styles.sep} />
            <SettingsRow
              icon="lock-closed-outline"
              label="Blocking apps"
              hint="Block apps during a session, until a task is done, after failing one, or with a key tag. Set up on the Screen Time screen."
              value="Screen Time"
              onPress={() => { haptics.tap(); navigateToTab('ScreenTime'); }}
            />
          </>
        )}
      </SettingsSection>
      )}

      {Platform.OS === 'ios' && (
        <SettingsSection
          label="Timers"
          footer="Requires iOS 17. Ends when you pause, stop, or (for a task) complete it, or dismiss a completion timer’s own reminder. Resuming a timer starts a new one."
        >
          <SettingsRow
            entryId="timerLiveActivity"
            icon="phone-portrait-outline"
            iconColor={timerLiveActivity ? colors.accent : undefined}
            label="Live Activity while timing"
            hint={timerLiveActivity
              ? 'A running task timer, recipe cook/prep timer, or completion timer reminder shows on the Lock Screen and Dynamic Island'
              : 'Timers stay in the app only'}
            toggle={timerLiveActivity}
            onPress={() => setTimerLiveActivity(!timerLiveActivity)}
          />
        </SettingsSection>
      )}
    </>
  );
}
