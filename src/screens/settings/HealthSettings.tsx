import React, { useCallback, useMemo, useState } from 'react';
import { View, AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { HealthRequestStatus, HealthWriteStatus } from 'todo-health-bridge';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useHealthStore } from '../../store/useHealthStore';
import { useDemoStore } from '../../store/useDemoStore';
import { useCategoryStore, ensureHealthCategory } from '../../store/useCategoryStore';
import { categoryLabel } from '../../utils/categoryLabel';
import { PillGroup } from '../../components/PillGroup';
import { CountStepper } from '../../components/CountStepper';
import { STEP_GOAL_DEFAULT, STEP_GOAL_MAX, STEP_GOAL_MIN, STEP_GOAL_STEP } from '../../utils/stepGoal';
import { ActivityRingsCard } from '../../components/ActivityRingsCard';
import { HEALTH_WRITABLE_NUTRIENTS } from '../../types';
import { NUTRIENT_LABEL } from '../../utils/foodNutrition';
import { healthBridge, isHealthSupported, openHealthApp } from '../../utils/healthBridge';
import type { WeightUnit } from '../../utils/weightLog';
import { dayKeyOf, getCurrentDayStart } from '../../utils/dateUtils';
import { formatWeight } from '../../utils/weightLog';
import { goalDirection } from '../../utils/weightGoal';
import { formatSleepDuration } from '../../utils/sleepLog';
import { SleepGoalSheet } from '../../components/SleepGoalSheet';
import { resetToWeightGoal } from '../../navigation/navigationRef';
import { useColors } from '../../theme/ThemeContext';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsSegments } from './SettingsSegments';
import { makeSettingsStyles } from './settingsStyles';
import { haptics } from '../../utils/haptics';

/**
 * What the access rows say in demo mode. `healthBridge()` refuses every read and
 * write there, so the rows would otherwise sit on "Checking…" for good, or blame
 * the device, when the refusal is demo mode's own.
 */
const DEMO_HINT = 'Not available in demo mode. Demo mode does not read or write Apple Health';

/**
 * Reading Apple Health, and — in a section of its own below — writing the two
 * things this app writes to it.
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
 *   hasn't. Once it has asked, the row points at the Health app's own
 *   Privacy → Apps page rather than claiming an outcome — permissions live
 *   there, not in iOS Settings, which has no Health row for a third-party app
 *   to show.
 * - The reading row shows the number or says there isn't one. "No number" is
 *   the honest reading of both a refusal and an empty day, and it is never
 *   drawn as a zero.
 *
 * **Writing is the mirror case, and this is the one place in the screen that
 * gets to say "Allowed" or "Not allowed" outright.** `authorizationStatus(for:)`
 * is truthful for share/write types — Apple's own docs draw the line at reads,
 * not at Health generally — so the write access rows below read exactly like
 * `CalendarSettings`' access row, not like the read access row above them.
 * It's a separate `SettingsSection` and a separate switch
 * (`healthWriteEnabled`) so each still gates its own feature independently —
 * but the two now share one native sheet. They used to raise two separate
 * sheets, on the reasoning above (someone who only wanted the steps row
 * shouldn't be asked about writing). That stopped being the whole story once
 * iOS was observed silently revoking an existing write grant the moment read
 * access for the same type is granted later, an undocumented OS bug with no
 * API to prevent or reverse it. Asking for both together, from whichever
 * switch is turned on first, removes the one sequence that triggers it —
 * there is no later solo grant left to flip anything. See the module note in
 * `modules/todo-health-bridge/index.ts` and `docs/arch/health-data.md`.
 *
 * **There is one app-level write switch but two access rows under it, and that
 * asymmetry is deliberate.** "May this app write to my Health record" is asked
 * once, and the switch answers it. *Which types* it may write is Health's
 * question rather than this app's, answered in Health's own sheet, and Health
 * lets somebody allow water and refuse body mass in that one sheet — so the
 * rows report per type while the switch stays single. A second app-level
 * toggle would only add a way to be refused twice for the same reason.
 */
export function HealthSettings() {
  const demoActive = useDemoStore(s => s.active);
  const healthReadEnabled = useSettingsStore(s => s.healthReadEnabled);
  const setHealthReadEnabled = useSettingsStore(s => s.setHealthReadEnabled);
  const healthWriteEnabled = useSettingsStore(s => s.healthWriteEnabled);
  const setHealthWriteEnabled = useSettingsStore(s => s.setHealthWriteEnabled);
  const healthWriteNutrients = useSettingsStore(useShallow(s => s.healthWriteNutrients));
  const setHealthWriteNutrients = useSettingsStore(s => s.setHealthWriteNutrients);
  const healthCategory = useSettingsStore(s => s.healthCategory);
  const stepGoal = useSettingsStore(s => s.stepGoal);
  const setStepGoal = useSettingsStore(s => s.setStepGoal);
  const setHealthCategory = useSettingsStore(s => s.setHealthCategory);
  const weightUnit = useSettingsStore(s => s.weightUnit);
  const weightGoal = useSettingsStore(useShallow(s => s.weightGoal));
  const setWeightUnit = useSettingsStore(s => s.setWeightUnit);
  const sleepGoalMinutes = useSettingsStore(s => s.sleepGoalMinutes);
  const [sleepGoalOpen, setSleepGoalOpen] = useState(false);
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
  // Two statuses, not one, because Health lets somebody allow water and refuse
  // weight on the same sheet — a single "write access" row would be wrong for
  // whichever of the two they declined.
  const [waterWriteStatus, setWaterWriteStatus] = useState<HealthWriteStatus | null>(null);
  const [weightWriteStatus, setWeightWriteStatus] = useState<HealthWriteStatus | null>(null);
  // A third, and the only one standing for more than one share type: a meal is
  // fourteen of them, and this reads as allowed only when every one is. See the
  // native `writeAuthorizationStatus`.
  const [nutritionWriteStatus, setNutritionWriteStatus] = useState<HealthWriteStatus | null>(null);

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
    setWaterWriteStatus(bridge ? bridge.healthWriteAuthorizationStatus('water') : null);
    setWeightWriteStatus(bridge ? bridge.healthWriteAuthorizationStatus('weight') : null);
    setNutritionWriteStatus(bridge ? bridge.healthWriteAuthorizationStatus('nutrition') : null);
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
          // This sheet now asks to write too (see the module note in
          // modules/todo-health-bridge/index.ts) precisely so a read grant
          // can no longer silently cost write access on the types the two
          // sides share: both are decided in this one sheet, so there is no
          // later solo read grant left to trigger the OS bug that used to
          // cause that. Refreshed here as well as on focus/foreground so the
          // rows below reflect whatever was just decided immediately.
          refreshWriteStatus();
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
    // Same reason as onToggle above.
    refreshWriteStatus();
    void refresh();
  };

  const onToggleWrite = () => {
    const next = !healthWriteEnabled;
    haptics.tap();
    setHealthWriteEnabled(next);
    // Same moment-of-asking rule the read toggle follows: turning this on is
    // the one unambiguous ask, so it's the one moment the sheet may appear.
    // One sheet covers every share type (`requestHealthWriteAuthorization`
    // passes the whole of `writeTypes`), so it is worth raising if *any* is
    // still unanswered.
    if (next && (waterWriteStatus === 'notDetermined' || weightWriteStatus === 'notDetermined'
      || nutritionWriteStatus === 'notDetermined')) {
      const bridge = healthBridge();
      bridge?.requestHealthWriteAuthorization()
        .then(() => {
          refreshWriteStatus();
          // This sheet now asks to read too (see the module note in
          // modules/todo-health-bridge/index.ts on why), so a decision made
          // from this toggle can change the read side just as much as a
          // decision made from the read toggle above.
          refreshStatus();
          void refresh();
        })
        .catch(() => refreshWriteStatus());
    }
  };

  const toggleWriteNutrient = (key: (typeof HEALTH_WRITABLE_NUTRIENTS)[number]) => {
    haptics.tap();
    const next = healthWriteNutrients.includes(key)
      ? healthWriteNutrients.filter(k => k !== key)
      : [...healthWriteNutrients, key];
    setHealthWriteNutrients(next);
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
          footer={demoActive
            ? 'Demo mode does not read or write Apple Health.'
            : "This device doesn't have Health data, so there is nothing for the app to read."}
        >
          <SettingsRow
            entryId="healthRead"
            icon="heart-outline"
            label="Read Apple Health"
            hint={demoActive ? 'Not available in demo mode' : 'Not available on this device'}
            disabled
          />
        </SettingsSection>
        <SettingsSection
          label="Log to Health"
          footer={demoActive ? 'Demo mode does not read or write Apple Health.' : 'Not available on this device.'}
        >
          <SettingsRow
            entryId="healthWrite"
            icon="create-outline"
            label="Log to Health"
            hint={demoActive ? 'Not available in demo mode' : 'Not available on this device'}
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
          ? "Reads today's steps, active calories and Activity rings, and shows them on Today"
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
              demoActive ? DEMO_HINT
              : requestStatus === 'shouldRequest'
                // The sheet this raises asks about writing too now, not just
                // reading — see the module note in modules/todo-health-bridge/
                // index.ts for why. Said here so the extra rows in that sheet
                // aren't a surprise, whether or not Log to Health is even on.
                ? "Not asked yet. Allowing this also asks about writing to Health (water, weight, meals), in the same sheet"
                : requestStatus === 'unnecessary'
                  ? "Already asked. To change what's shared, open Health, tap your profile picture, then Privacy, then Apps, then dundundun"
                  : requestStatus === 'unavailable'
                    ? 'Not available on this device'
                    : 'Checking…'
            }
            alwaysShowHint
            value={
              demoActive ? undefined
              : requestStatus === 'shouldRequest' ? 'Allow'
                : requestStatus === 'unnecessary' ? 'Open Health'
                  : undefined
            }
            onPress={
              demoActive ? undefined
              : requestStatus === 'shouldRequest' ? askForAccess
                : requestStatus === 'unnecessary' ? () => { void openHealthApp(); }
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

          {/* Drawn only when a summary arrived. No summary is no card rather
              than three empty rings: HealthKit serves a refused read, a day
              with nothing recorded and a device with no rings alike. */}
          {reading?.rings ? <ActivityRingsCard rings={reading.rings} /> : null}

          <View style={styles.sep} />
          <SettingsRow
            entryId="stepGoal"
            icon="flag-outline"
            label="Daily step goal"
            hint={stepGoal
              ? 'The steps row on Today shows a bar toward this number'
              : 'No goal set. The steps row shows the count only'}
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={stepGoal}
              onChange={next => setStepGoal(next)}
              allowNull
              start={STEP_GOAL_DEFAULT}
              min={STEP_GOAL_MIN}
              max={STEP_GOAL_MAX}
              step={STEP_GOAL_STEP}
              emptyLabel="No goal"
              format={n => `${n.toLocaleString()} steps`}
              label="Daily step goal"
              describeValue={n => (n === null ? 'No goal' : `${n} steps`)}
            />
          </View>

          <View style={styles.sep} />
          <SettingsRow
            entryId="healthCategory"
            icon="pricetag-outline"
            label="Show Health readings under"
            hint={healthCategory
              ? 'Steps, active calories and your Activity rings show as rows in this category'
              : "Health readings don't show on Today"}
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
                accessibilityLabel: `Show Health readings under: ${o.label}`,
                onPress: () => { haptics.tap(); setHealthCategory(o.value); },
              }))}
            />
          </View>
        </>
      )}
    </SettingsSection>

    <SettingsSection
      label="Log to Health"
      footer="Writes a dietary water sample when a task you've set up to log it is completed, a body mass sample when you record a weight, and a meal's nutrition when you add it to the food log. These are the only things this app ever writes to Health, and nothing else is touched. Deleting a food log entry removes what it wrote. Which nutrients a logged meal is allowed to carry into Health is picked below; nothing a meal doesn't state is ever written, whatever's selected there."
    >
      <SettingsRow
        entryId="healthWrite"
        icon="create-outline"
        iconColor={healthWriteEnabled ? colors.accent : undefined}
        label="Log to Health"
        hint={healthWriteEnabled
          ? 'Water from tasks set up to log it, weights you record, and meals you log'
          : 'Nothing is written to Health'}
        toggle={healthWriteEnabled}
        onPress={onToggleWrite}
        accessibilityLabel="Log to Health"
      />

      {healthWriteEnabled && (
        <>
          <View style={styles.sep} />
          <WriteAccessRow
            entryId="healthWriteAccess"
            label="Water-write access"
            deniedHint="Not allowed. To log water, open Health, tap your profile picture, then Privacy, then Apps, then dundundun"
            status={waterWriteStatus}
            demoActive={demoActive}
            colors={colors}
            onAsk={askForWriteAccess}
          />
          <View style={styles.sep} />
          <WriteAccessRow
            entryId="healthWeightWriteAccess"
            label="Weight-write access"
            deniedHint="Not allowed. To record a weight, open Health, tap your profile picture, then Privacy, then Apps, then dundundun"
            status={weightWriteStatus}
            demoActive={demoActive}
            colors={colors}
            onAsk={askForWriteAccess}
          />
          <View style={styles.sep} />
          <WriteAccessRow
            entryId="healthNutritionWriteAccess"
            label="Nutrition-write access"
            deniedHint="Not allowed. To log what you ate, open Health, tap your profile picture, then Privacy, then Apps, then dundundun"
            status={nutritionWriteStatus}
            demoActive={demoActive}
            colors={colors}
            onAsk={askForWriteAccess}
          />
          <View style={styles.sep} />
          <SettingsRow
            entryId="healthWriteNutrients"
            icon="nutrition-outline"
            label="Nutrients written per meal"
            hint="Which of these a logged meal is allowed to carry into Health"
            tight
          />
          <View style={styles.pillGroupRow}>
            <PillGroup
              noun="nutrient"
              options={HEALTH_WRITABLE_NUTRIENTS.map(key => ({
                key,
                label: NUTRIENT_LABEL[key].label,
                selected: healthWriteNutrients.includes(key),
                accessibilityLabel: `Write ${NUTRIENT_LABEL[key].label} to Health`,
                onPress: () => toggleWriteNutrient(key),
              }))}
            />
          </View>
        </>
      )}
    </SettingsSection>

    <SettingsSection
      label="Weight"
      footer="Which unit a weight is shown and typed in. Health always stores kilograms, so this changes what you read and type, not what is recorded."
    >
      {/* Opens the sheet on the Weight screen rather than in place. The sheet
          needs the latest weigh-in to measure a goal from, and that is a read
          of Health this page has no reason to hold — so the row navigates to
          where the data already is, which is also where the progress it sets up
          gets read. */}
      <SettingsRow
        entryId="weightGoal"
        icon="target"
        iconColor={weightGoal !== null ? colors.accent : undefined}
        label="Weight goal"
        hint="Set a target weight and a rate, and calculate a daily calorie figure."
        value={weightGoal === null
          ? 'None'
          : goalDirection(weightGoal) === 'maintain'
            ? `Hold ${formatWeight(weightGoal.targetKg, weightUnit)}`
            : formatWeight(weightGoal.targetKg, weightUnit)}
        onPress={() => { haptics.tap(); resetToWeightGoal(); }}
      />
      <SettingsRow
        entryId="weightUnit"
        icon="scale-outline"
        label="Weight unit"
        value={weightUnit === 'kg' ? 'Kilograms' : 'Pounds'}
        tight
      />
      <SettingsSegments
        attached
        label="Weight unit"
        options={[
          { value: 'kg' as WeightUnit, label: 'kg' },
          { value: 'lb' as WeightUnit, label: 'lb' },
        ]}
        selected={weightUnit}
        onSelect={unit => { haptics.tap(); setWeightUnit(unit); }}
        accessibilityLabelFor={o => (o.value === 'kg' ? 'Kilograms' : 'Pounds')}
      />
    </SettingsSection>

    <SettingsSection
      label="Sleep"
      footer="The Sleep screen draws this as a line and counts the days that reach it. Nothing else reads it."
    >
      <SettingsRow
        entryId="sleepGoal"
        icon="moon-outline"
        iconColor={sleepGoalMinutes !== null ? colors.accent : undefined}
        label="Sleep goal"
        hint="Hours asleep you want each day to reach."
        value={sleepGoalMinutes === null ? 'None' : formatSleepDuration(sleepGoalMinutes)}
        onPress={() => { haptics.tap(); setSleepGoalOpen(true); }}
      />
    </SettingsSection>
    {/* The sheet the Sleep screen's own target icon opens, not a second
        stepper for the same number. */}
    <SleepGoalSheet visible={sleepGoalOpen} onClose={() => setSleepGoalOpen(false)} />
    </>
  );
}

interface WriteAccessRowProps {
  entryId: string;
  label: string;
  /** What to say, and where to go, when this type was refused. */
  deniedHint: string;
  status: HealthWriteStatus | null;
  /** Demo mode refuses every write, so the row says so rather than "Checking…". */
  demoActive: boolean;
  colors: ReturnType<typeof useColors>;
  onAsk: () => void;
}

/**
 * One share type's real authorization state.
 *
 * Unlike the read access row above, these are allowed to say "Allowed" or "Not
 * allowed" outright — see the file's own note on why write authorization is
 * truthful where read isn't.
 *
 * A component rather than the row written twice because the two differ only in
 * their label and in which sharing row to point somebody at: the four-state
 * ladder, which state offers a button, and which opens the Health app are
 * the same decision for every share type, and a second hand-written copy is
 * how one of them ends up still saying "water" after a third is added.
 */
function WriteAccessRow({ entryId, label, deniedHint, status: realStatus, demoActive, colors, onAsk }: WriteAccessRowProps) {
  const status = demoActive ? null : realStatus;
  const allowed = status === 'sharingAuthorized';
  return (
    <SettingsRow
      entryId={entryId}
      icon={allowed ? 'lock-open-outline' : 'lock-closed-outline'}
      iconColor={allowed ? colors.accent : undefined}
      label={label}
      hint={
        demoActive ? DEMO_HINT
        : status === 'notDetermined'
          // Same combined sheet the read access row above raises — see the
          // module note in modules/todo-health-bridge/index.ts.
          ? 'Not asked yet. Allowing this also asks to read Apple Health, in the same sheet'
          : status === 'sharingDenied'
            ? deniedHint
            : allowed
              ? 'Allowed'
              : status === 'unavailable'
                ? 'Not available on this device'
                : 'Checking…'
      }
      alwaysShowHint
      value={
        status === 'notDetermined' ? 'Allow'
          : status === 'sharingDenied' ? 'Open Health'
            : undefined
      }
      onPress={
        status === 'notDetermined' ? onAsk
          : status === 'sharingDenied' ? () => { void openHealthApp(); }
            : undefined
      }
    />
  );
}
