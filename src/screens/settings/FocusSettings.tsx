import React, { useState, useMemo } from 'react';
import { View, Platform } from 'react-native';
import { format } from 'date-fns/format';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useColors } from '../../theme/ThemeContext';
import { clockTimeToken } from '../../utils/clockTime';
import { CountStepper } from '../../components/CountStepper';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';
import { haptics } from '../../utils/haptics';
import { isScreenTimeSupported, screenTimeBridge } from '../../utils/screenTimeBridge';
import {
  FOCUS_DEFAULTS,
  FOCUS_LONG_REST_EVERY_MAX, FOCUS_LONG_REST_EVERY_MIN,
  FOCUS_REST_AFTER_MINUTES_MAX, FOCUS_REST_AFTER_MINUTES_MIN, FOCUS_REST_AFTER_TASKS_MAX,
  FOCUS_REST_MAX, FOCUS_REST_MIN, FOCUS_WORK_CAP_MAX, FOCUS_WORK_CAP_MIN,
  focusRestsDisabled,
} from '../../utils/focusSettings';
import { alertPermissionOff } from '../../utils/permissionAlert';

/**
 * Focus sessions, the apps that stay blocked around them, and the timers' Lock
 * Screen activity. Split out of Tasks & projects, which held 36 settings across
 * ten sections with this one alone at sixteen rows: a group named for what it
 * is about, rather than the rows' being found by scrolling past everything else.
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

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  // --- Screen Time -----------------------------------------------------
  // Asked once on mount rather than subscribed to: whether this build has the
  // native half, on a device new enough, cannot change while the screen is up.
  const [screenTimeSupported] = useState(isScreenTimeSupported);
  const focusShieldEnabled = useSettingsStore(s => s.focusShieldEnabled);
  const setFocusShieldEnabled = useSettingsStore(s => s.setFocusShieldEnabled);
  // Counts, not names. iOS hands the app opaque tokens for the apps somebody
  // picked and only SwiftUI can render them, so this is the most the row can
  // say — see modules/todo-screentime-bridge.
  const [shieldCount, setShieldCount] = useState(
    () => screenTimeBridge()?.screenTimeSelectionCount() ?? { applications: 0, categories: 0 },
  );
  const shieldTotal = shieldCount.applications + shieldCount.categories;
  const shieldSelectionLabel = shieldTotal === 0
    ? 'None'
    : [
      shieldCount.applications > 0
        ? `${shieldCount.applications} ${shieldCount.applications === 1 ? 'app' : 'apps'}`
        : null,
      shieldCount.categories > 0
        ? `${shieldCount.categories} ${shieldCount.categories === 1 ? 'category' : 'categories'}`
        : null,
    ].filter(Boolean).join(', ');

  const handleChooseApps = async () => {
    haptics.tap();
    const bridge = screenTimeBridge();
    if (!bridge) return;
    const picked = await bridge.presentAppPicker();
    if (picked) setShieldCount(bridge.screenTimeSelectionCount());
  };

  const handleToggleShield = async () => {
    haptics.tap();
    if (focusShieldEnabled) {
      setFocusShieldEnabled(false);
      return;
    }
    const bridge = screenTimeBridge();
    if (!bridge) return;
    // Asking is a Settings action and never something the app does on its own
    // — the same rule the weather rules sheet follows for location.
    const status = await bridge.requestScreenTimeAuthorization();
    if (status !== 'approved') {
      alertPermissionOff(
        'Screen Time access needed',
        'Blocking apps during a focus session needs Screen Time access. Grant it in Settings, under Screen Time.',
      );
      return;
    }
    setFocusShieldEnabled(true);
    // Straight into the picker the first time: the setting does nothing at all
    // until some apps are chosen, and a toggle that visibly changes nothing is
    // how somebody concludes the feature is broken.
    if (shieldTotal === 0) await handleChooseApps();
  };

  const penaltyShieldEnabled = useSettingsStore(s => s.penaltyShieldEnabled);
  const gateShieldEnabled = useSettingsStore(s => s.gateShieldEnabled);
  const setGateShieldEnabled = useSettingsStore(s => s.setGateShieldEnabled);
  const setPenaltyShieldEnabled = useSettingsStore(s => s.setPenaltyShieldEnabled);
  const penaltyShieldUntil = useSettingsStore(s => s.penaltyShieldUntil);
  const setPenaltyShieldUntil = useSettingsStore(s => s.setPenaltyShieldUntil);
  const use24HourTime = useSettingsStore(s => s.use24HourTime);
  // Only while one is actually being served. A row reporting a time that has
  // already passed reads as a block still in force.
  const penaltyUntilLabel = penaltyShieldUntil && new Date(penaltyShieldUntil) > new Date()
    ? format(new Date(penaltyShieldUntil), clockTimeToken(use24HourTime))
    : null;

  const handleToggleGate = async () => {
    haptics.tap();
    if (gateShieldEnabled) {
      setGateShieldEnabled(false);
      return;
    }
    const bridge = screenTimeBridge();
    if (!bridge) return;
    const status = await bridge.requestScreenTimeAuthorization();
    if (status !== 'approved') {
      alertPermissionOff(
        'Screen Time access needed',
        'Blocking apps until a task is done needs Screen Time access. Grant it in Settings, under Screen Time.',
      );
      return;
    }
    setGateShieldEnabled(true);
    if (shieldTotal === 0) await handleChooseApps();
  };

  const handleTogglePenalty = async () => {
    haptics.tap();
    if (penaltyShieldEnabled) {
      setPenaltyShieldEnabled(false);
      // Switching the feature off is the way out of a block being served, so
      // the block must not be left waiting to resume the moment it comes back
      // on. This is deliberately the *only* way out from inside the app: a
      // "lift it now" button would undo the one thing the feature is for.
      setPenaltyShieldUntil(null);
      return;
    }
    const bridge = screenTimeBridge();
    if (!bridge) return;
    const status = await bridge.requestScreenTimeAuthorization();
    if (status !== 'approved') {
      alertPermissionOff(
        'Screen Time access needed',
        'Blocking apps when you fail a task needs Screen Time access. Grant it in Settings, under Screen Time.',
      );
      return;
    }
    setPenaltyShieldEnabled(true);
    if (shieldTotal === 0) await handleChooseApps();
  };

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
          hint="How long a stretch runs for a task that has no time estimate."
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
          hint="Minutes of work before a break is added. Set to Off to skip time-based breaks."
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
          hint="Tasks finished before a break is added. Set to Off to skip task-based breaks."
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

        {/*
          Screen Time. Hidden outright rather than shown disabled when the
          device or build can't do it — the authorization it wants is one an
          iOS 15 phone can never grant, so offering the row would be asking a
          question with no answer. Same call the Live Activity row above makes
          about a non-iOS device.
        */}
        {screenTimeSupported && (
          <>
            <View style={styles.sep} />
            <SettingsRow
              entryId="focusShield"
              icon="lock-closed-outline"
              iconColor={focusShieldEnabled ? colors.accent : undefined}
              label="Block apps while focusing"
              hint={focusShieldEnabled
                ? 'The apps you choose are blocked while a session is running, and unblocked when you pause or finish it'
                : 'Apps stay available during a session'}
              toggle={focusShieldEnabled}
              onPress={handleToggleShield}
            />
            {focusShieldEnabled && (
              <>
                <View style={styles.sep} />
                <SettingsRow
                  entryId="focusShieldApps"
                  icon="apps-outline"
                  label="Apps to block"
                  hint="Chosen in the system picker. iOS doesn’t share which apps you picked, so only the count shows here."
                  value={shieldSelectionLabel}
                  onPress={handleChooseApps}
                />
              </>
            )}
            <View style={styles.sep} />
            <SettingsRow
              entryId="gateShield"
              icon="lock-closed-outline"
              iconColor={gateShieldEnabled ? colors.accent : undefined}
              label="Block apps until a task is done"
              hint={gateShieldEnabled
                ? 'Tasks you mark keep the same apps blocked while they sit on Today undone. Finishing one, or moving it to another day, unblocks them'
                : 'No tasks block apps'}
              toggle={gateShieldEnabled}
              onPress={handleToggleGate}
            />
            <View style={styles.sep} />
            <SettingsRow
              entryId="penaltyShield"
              icon="alert-circle-outline"
              iconColor={penaltyShieldEnabled ? colors.accent : undefined}
              label="Block apps when you fail a task"
              hint={penaltyShieldEnabled
                ? 'Each task sets how long. The same apps are blocked when you miss a cutoff, or log a slip on a task you’re avoiding'
                : 'Failing a task blocks nothing'}
              toggle={penaltyShieldEnabled}
              onPress={handleTogglePenalty}
            />
            {penaltyShieldEnabled && (
              <>
                {shieldTotal === 0 && !focusShieldEnabled && (
                  <>
                    <View style={styles.sep} />
                    <SettingsRow
                      entryId="penaltyShieldApps"
                      icon="apps-outline"
                      label="Apps to block"
                      hint="The same apps blocked during a focus session. iOS doesn’t share which apps you picked, so only the count shows here."
                      value={shieldSelectionLabel}
                      onPress={handleChooseApps}
                    />
                  </>
                )}
                {penaltyUntilLabel && (
                  <>
                    <View style={styles.sep} />
                    <SettingsRow
                      entryId="penaltyShieldActive"
                      icon="time-outline"
                      iconColor={colors.accent}
                      label="Blocked until"
                      hint="To end this early, turn off “Block apps when you fail a task.”"
                      value={penaltyUntilLabel}
                    />
                  </>
                )}
              </>
            )}
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
