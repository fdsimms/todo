import React, { useCallback, useMemo, useState } from 'react';
import { View, AppState, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { HealthRequestStatus } from 'todo-health-bridge';
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
 * Reading Apple Health.
 *
 * Sits beside the calendar read in spirit and not in the index: both only ever
 * look and neither writes anything, but the permission models are opposite, and
 * that difference is most of what this screen has to say.
 *
 * **EventKit tells you whether you were allowed. HealthKit refuses to.** A read
 * that was refused is served as an empty store, deliberately, so that an app
 * cannot learn what a person declined to share. So there is no "Blocked" state
 * to render here the way `CalendarSettings` renders one, and inventing one
 * would be worse than having none: every "Health access blocked" banner would
 * also be shown to somebody who simply has no step data yet.
 *
 * What the rows can honestly say is therefore narrower than it looks:
 *
 * - The access row says whether the app has *asked* yet, which is the one thing
 *   `getRequestStatusForAuthorization` will answer, and offers the sheet when it
 *   hasn't. Once it has asked, the row points at the Settings app rather than
 *   claiming an outcome.
 * - The reading row shows the number or says there isn't one. "No number" is
 *   the honest reading of both a refusal and an empty day, and it is never
 *   drawn as a zero.
 */
export function HealthSettings() {
  const healthReadEnabled = useSettingsStore(s => s.healthReadEnabled);
  const setHealthReadEnabled = useSettingsStore(s => s.setHealthReadEnabled);
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

  useFocusEffect(
    useCallback(() => {
      refreshStatus();
      const subscription = AppState.addEventListener('change', state => {
        if (state === 'active') refreshStatus();
      });
      return () => subscription.remove();
    }, [refreshStatus]),
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
    );
  }

  return (
    <SettingsSection
      label="Apple Health"
      footer="Reads what Health already has on this phone, so the app can show it beside your day. Nothing is written to Health, nothing is sent anywhere, and no copy is kept: the numbers are read when the app opens and are gone when it closes. iOS never tells an app whether a Health read was allowed, so if you say no, the app sees the same thing it sees on a day with nothing recorded."
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
  );
}
