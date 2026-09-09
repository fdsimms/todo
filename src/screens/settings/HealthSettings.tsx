import React, { useCallback, useMemo, useState } from 'react';
import { View, AppState, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { HealthRequestStatus, HealthWriteStatus } from 'todo-health-bridge';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useHealthStore } from '../../store/useHealthStore';
import { useCategoryStore, ensureHealthCategory } from '../../store/useCategoryStore';
import { categoryLabel } from '../../utils/categoryLabel';
import { PillGroup } from '../../components/PillGroup';
import { healthBridge, isHealthSupported } from '../../utils/healthBridge';
import { dayKeyOf, getCurrentDayStart } from '../../utils/dateUtils';
import { useColors } from '../../theme/ThemeContext';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';
import { haptics } from '../../utils/haptics';

/**
 * Reading Apple Health, and — in a section of its own below — writing exactly
 * one thing to it.
 *
 * **Reading sits beside the calendar read in spirit and not in the index: both
 * only ever look, but the permission models are opposite**, and that
 * difference is most of what the read section has to say.
 *
 * **EventKit tells you whether you were allowed. HealthKit refuses to, for
 * reads.** A read that was refused is served as an empty store, deliberately,
 * so that an app cannot learn what a person declined to share. So there is no
 * "Blocked" state to render for reading the way `CalendarSettings` renders
 * one, and inventing one would be worse than having none: every "Health
 * access blocked" banner would also be shown to somebody who simply has no
 * step data yet.
 *
 * What the read rows can honestly say is therefore narrower than it looks:
 *
 * - The access row says whether the app has *asked* yet, which is the one thing
 *   `getRequestStatusForAuthorization` will answer, and offers the sheet when it
 *   hasn't. Once it has asked, the row points at the Settings app rather than
 *   claiming an outcome.
 * - The reading row shows the number or says there isn't one. "No number" is
 *   the honest reading of both a refusal and an empty day, and it is never
 *   drawn as a zero.
 *
 * **Writing is the mirror case, and this is the one place in the screen that
 * gets to say "Allowed" or "Not allowed" outright.** `authorizationStatus(for:)`
 * is truthful for share/write types — Apple's own docs draw the line at reads,
 * not at Health generally — so the water-write access row below reads exactly
 * like `CalendarSettings`' access row, not like the read access row above it.
 * It's a separate `SettingsSection` and a separate switch
 * (`healthWriteEnabled`) on purpose: reading steps and writing water are two
 * different permissions with two different sheets, and folding them into one
 * switch would ask someone who only wanted the steps row about writing water
 * too.
 */
export function HealthSettings() {
  const healthReadEnabled = useSettingsStore(s => s.healthReadEnabled);
  const setHealthReadEnabled = useSettingsStore(s => s.setHealthReadEnabled);
  const healthWriteEnabled = useSettingsStore(s => s.healthWriteEnabled);
  const setHealthWriteEnabled = useSettingsStore(s => s.setHealthWriteEnabled);
  const healthCategory = useSettingsStore(s => s.healthCategory);
  const setHealthCategory = useSettingsStore(s => s.setHealthCategory);
  const categories = useCategoryStore(s => s.categories);
  const today = useHealthStore(s => s.today);
  const refreshing = useHealthStore(s => s.refreshing);
  const refresh = useHealthStore(s => s.refresh);

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  // Probed once, like the Screen Time rows do: whether this device has health
  // data at all cannot change while the screen is open.
  const [supported] = useState(isHealthSupported);
  const [requestStatus, setRequestStatus] = useState<HealthRequestStatus | null>(null);
  const [writeStatus, setWriteStatus] = useState<HealthWriteStatus | null>(null);

  // Re-read on focus *and* on foreground, for the reason the calendar rows
  // give: the access row can send someone to the system Settings app, which
  // doesn't unfocus this screen, and what they do over there changes the answer.
  const refreshStatus = useCallback(() => {
    const bridge = healthBridge();
    if (!bridge) {
      setRequestStatus(null);
      return;
    }
    bridge.healthRequestStatus().then(setRequestStatus).catch(() => setRequestStatus(null));
  }, []);

  // Synchronous, unlike refreshStatus above — writeAuthorizationStatus is a
  // plain fact, not a sheet-shaped question, so there's nothing to await.
  const refreshWriteStatus = useCallback(() => {
    const bridge = healthBridge();
    setWriteStatus(bridge ? bridge.healthWriteAuthorizationStatus() : null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshStatus();
      refreshWriteStatus();
      const subscription = AppState.addEventListener('change', state => {
        if (state === 'active') { refreshStatus(); refreshWriteStatus(); }
      });
      return () => subscription.remove();
    }, [refreshStatus, refreshWriteStatus]),
  );

  const onToggle = () => {
    const next = !healthReadEnabled;
    haptics.tap();
    setHealthReadEnabled(next);
    // Before the sheet, so the section is there for the reading whichever way
    // the permission goes. `force` because this is the moment the answer is
    // being given — see ensureHealthCategory for why the startup pass isn't.
    if (next) ensureHealthCategory({ force: true });
    // Turning it on is the one moment a person is unambiguously asking, so it
    // is the one moment the sheet may be raised. A sweep never does this.
    if (next && requestStatus === 'shouldRequest') {
      const bridge = healthBridge();
      bridge?.requestHealthAuthorization()
        .then(() => {
          refreshStatus();
          void refresh();
        })
        .catch(() => refreshStatus());
    }
  };

  const askForAccess = async () => {
    haptics.tap();
    const bridge = healthBridge();
    if (!bridge) return;
    await bridge.requestHealthAuthorization();
    refreshStatus();
    void refresh();
  };

  const onToggleWrite = () => {
    const next = !healthWriteEnabled;
    haptics.tap();
    setHealthWriteEnabled(next);
    // Same moment-of-asking rule the read toggle follows: turning this on is
    // the one unambiguous ask, so it's the one moment the sheet may appear.
    if (next && writeStatus === 'notDetermined') {
      const bridge = healthBridge();
      bridge?.requestHealthWriteAuthorization()
        .then(() => refreshWriteStatus())
        .catch(() => refreshWriteStatus());
    }
  };

  const askForWriteAccess = async () => {
    haptics.tap();
    const bridge = healthBridge();
    if (!bridge) return;
    await bridge.requestHealthWriteAuthorization();
    refreshWriteStatus();
  };

  // A reading from a day that has already turned over is not an answer about
  // today, the same check every reader of a day-keyed snapshot makes.
  const todayKey = dayKeyOf(getCurrentDayStart());
  const reading = today?.dayKey === todayKey ? today : null;

  const stepsValue = refreshing && !reading
    ? 'Reading…'
    : reading?.steps != null
      ? reading.steps.toLocaleString()
      : 'No number';

  if (!supported) {
    return (
      <>
        <SettingsSection
          label="Apple Health"
          footer="This device doesn't have Health data, so there is nothing for the app to read."
        >
          <SettingsRow
            entryId="healthRead"
            icon="heart-outline"
            label="Read Apple Health"
            hint="Not available on this device"
            disabled
          />
        </SettingsSection>
        <SettingsSection
          label="Log to Health"
          footer="Not available on this device."
        >
          <SettingsRow
            entryId="healthWrite"
            icon="water-outline"
            label="Log water to Health"
            hint="Not available on this device"
            disabled
          />
        </SettingsSection>
      </>
    );
  }

  return (
    <>
    <SettingsSection
      label="Apple Health"
      footer="Reads what Health already has on this phone, so the app can show it beside your day and check it against rules you set. This section never writes anything to Health, nothing is sent anywhere, and no copy is kept: the numbers are read when the app opens and are gone when it closes. iOS never tells an app whether a Health read was allowed, so if you say no, the app sees the same thing it sees on a day with nothing recorded."
    >
      <SettingsRow
        entryId="healthRead"
        icon="heart-outline"
        iconColor={healthReadEnabled ? colors.accent : undefined}
        label="Read Apple Health"
        hint={healthReadEnabled
          ? "Reads your step count for today, and shows it on Today"
          : 'Nothing is read from Health'}
        toggle={healthReadEnabled}
        onPress={onToggle}
        accessibilityLabel="Read Apple Health"
      />

      {healthReadEnabled && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="healthAccess"
            icon={requestStatus === 'unnecessary' ? 'lock-open-outline' : 'lock-closed-outline'}
            iconColor={requestStatus === 'unnecessary' ? colors.accent : undefined}
            label="Health access"
            // Deliberately never says "allowed" or "blocked". iOS answers only
            // whether asking again would show the sheet, so that is all the row
            // reports, and the reading row below is where you find out whether
            // anything is actually coming through.
            hint={
              requestStatus === 'shouldRequest'
                ? "Not asked yet. Nothing can be read until you allow it in Health"
                : requestStatus === 'unnecessary'
                  ? "Already asked. Change what's shared in the Health app under Sharing"
                  : requestStatus === 'unavailable'
                    ? 'Not available on this device'
                    : 'Checking…'
            }
            alwaysShowHint
            value={
              requestStatus === 'shouldRequest' ? 'Allow'
                : requestStatus === 'unnecessary' ? 'Open Settings'
                  : undefined
            }
            onPress={
              requestStatus === 'shouldRequest' ? askForAccess
                : requestStatus === 'unnecessary' ? () => Linking.openSettings()
                  : undefined
            }
          />

          <View style={styles.sep} />
          <SettingsRow
            entryId="healthToday"
            icon="footsteps-outline"
            label="Steps today"
            // "No number" rather than 0: a refused read and a day with nothing
            // recorded are the same answer from HealthKit, and neither of them
            // is a day somebody took no steps.
            hint={reading?.steps == null && !refreshing
              ? 'Nothing recorded for today, or Health is not sharing steps with this app'
              : undefined}
            alwaysShowHint
            value={stepsValue}
            busy={refreshing}
            onPress={() => { haptics.tap(); void refresh(); }}
            accessibilityLabel={`Steps today, ${stepsValue}`}
          />

          <View style={styles.sep} />
          <SettingsRow
            entryId="healthCategory"
            icon="pricetag-outline"
            label="Show steps under"
            hint={healthCategory
              ? "Today's step count shows as a row in this category"
              : "Steps don't show on Today"}
            value={healthCategory ? categoryLabel(healthCategory, categories) : 'Nowhere'}
            tight
          />
          <View style={styles.pillGroupRow}>
            <PillGroup
              noun="category"
              options={[
                { value: null, label: 'Nowhere' },
                ...categories.map(c => ({ value: c.name, label: categoryLabel(c.name, categories) })),
              ].map(o => ({
                key: String(o.value),
                label: o.label,
                selected: o.value === healthCategory,
                pinned: o.value === null,
                accessibilityLabel: `Show steps under: ${o.label}`,
                onPress: () => { haptics.tap(); setHealthCategory(o.value); },
              }))}
            />
          </View>
        </>
      )}
    </SettingsSection>

    <SettingsSection
      label="Log to Health"
      footer="Writes a dietary water sample to Health when a task you've set up to log it is completed. This is the only thing this app ever writes to Health, and nothing else is touched."
    >
      <SettingsRow
        entryId="healthWrite"
        icon="water-outline"
        iconColor={healthWriteEnabled ? colors.accent : undefined}
        label="Log water to Health"
        hint={healthWriteEnabled
          ? 'Tasks set up to log water write a sample when completed'
          : 'Nothing is written to Health'}
        toggle={healthWriteEnabled}
        onPress={onToggleWrite}
        accessibilityLabel="Log water to Health"
      />

      {healthWriteEnabled && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="healthWriteAccess"
            icon={writeStatus === 'sharingAuthorized' ? 'lock-open-outline' : 'lock-closed-outline'}
            iconColor={writeStatus === 'sharingAuthorized' ? colors.accent : undefined}
            label="Water-write access"
            // Unlike the read access row above, this one is allowed to say
            // "Allowed" or "Not allowed" outright — see the file's own note on
            // why write authorization is truthful where read isn't.
            hint={
              writeStatus === 'notDetermined'
                ? "Not asked yet. Nothing can be written until you allow it in Health"
                : writeStatus === 'sharingDenied'
                  ? 'Not allowed. Turn it on in the Health app under Sharing to log water'
                  : writeStatus === 'sharingAuthorized'
                    ? 'Allowed'
                    : writeStatus === 'unavailable'
                      ? 'Not available on this device'
                      : 'Checking…'
            }
            alwaysShowHint
            value={
              writeStatus === 'notDetermined' ? 'Allow'
                : writeStatus === 'sharingDenied' ? 'Open Settings'
                  : undefined
            }
            onPress={
              writeStatus === 'notDetermined' ? askForWriteAccess
                : writeStatus === 'sharingDenied' ? () => Linking.openSettings()
                  : undefined
            }
          />
        </>
      )}
    </SettingsSection>
    </>
  );
}
