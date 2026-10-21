import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../store/useSettingsStore';
import { CountStepper } from '../../components/CountStepper';
import { TextField } from '../../components/TextField';
import { useColors } from '../../theme/ThemeContext';
import {
  WANIKANI_APPRENTICE_CAP_DEFAULT,
  WANIKANI_APPRENTICE_CAP_MAX,
  WANIKANI_APPRENTICE_CAP_MIN,
  WANIKANI_APPRENTICE_CAP_STEP,
  WANIKANI_LESSONS_PER_DAY_MAX,
  WANIKANI_LESSONS_PER_DAY_MIN,
  WANIKANI_REVIEW_THRESHOLD_DEFAULT,
  WANIKANI_REVIEW_THRESHOLD_MAX,
  WANIKANI_REVIEW_THRESHOLD_MIN,
} from '../../utils/wanikaniTasks';
import { SettingsRow } from './SettingsRow';
import { WaniKaniTokenRows } from './WaniKaniTokenRows';
import { makeSettingsStyles } from './settingsStyles';

/**
 * The WaniKani generator's options, under its row on Automations: the API
 * token, how many reviews make a task, the daily lessons task and its
 * Apprentice cap, and whether a held task notifies. Its own file because the
 * token needs a draft and the account's status, which the other generators'
 * extras don't, and `GeneratedTasksSection` is long enough.
 */

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function WaniKaniSettingsRows(): React.ReactElement {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const s = useSettingsStore(useShallow(st => ({
    threshold: st.wanikaniReviewThreshold,
    lessonsPerDay: st.wanikaniLessonsPerDay,
    apprenticeCap: st.wanikaniApprenticeCap,
    notify: st.wanikaniNotify,
    clientLink: st.wanikaniClientLink,
    setClientLink: st.setWanikaniClientLink,
    setThreshold: st.setWanikaniReviewThreshold,
    setLessonsPerDay: st.setWanikaniLessonsPerDay,
    setApprenticeCap: st.setWanikaniApprenticeCap,
    setNotify: st.setWanikaniNotify,
  })));
  return (
    <>
      <View style={styles.sep} />
      <WaniKaniTokenRows entryId="wanikaniToken" linkToPrivacy />

      <View style={styles.sep} />
      <SettingsRow
        entryId="wanikaniReviewThreshold"
        icon="time-outline"
        label="Add the task at"
        hint="How many reviews have to be waiting. If fewer are, the task waits for the hour WaniKani expects that many."
        value={plural(s.threshold, 'review', 'reviews')}
        tight
      />
      <View style={styles.cadenceRow}>
        <CountStepper
          value={s.threshold}
          onChange={next => s.setThreshold(next ?? WANIKANI_REVIEW_THRESHOLD_DEFAULT)}
          min={WANIKANI_REVIEW_THRESHOLD_MIN}
          max={WANIKANI_REVIEW_THRESHOLD_MAX}
          label="Reviews waiting"
          describeValue={n => plural(n ?? WANIKANI_REVIEW_THRESHOLD_DEFAULT, 'review', 'reviews')}
        />
      </View>

      <View style={styles.sep} />
      <SettingsRow
        entryId="wanikaniLessonsPerDay"
        icon="sparkles-outline"
        iconColor={s.lessonsPerDay !== null ? colors.accent : undefined}
        label="Lessons"
        hint="A task each day to do this many lessons, on a day there are lessons to do."
        value={s.lessonsPerDay === null ? 'Off' : `${s.lessonsPerDay} a day`}
        tight
      />
      <View style={styles.cadenceRow}>
        <CountStepper
          value={s.lessonsPerDay}
          onChange={s.setLessonsPerDay}
          min={WANIKANI_LESSONS_PER_DAY_MIN}
          max={WANIKANI_LESSONS_PER_DAY_MAX}
          start={5}
          allowNull
          label="Lessons a day"
          describeValue={n => (n === null ? 'No lessons task' : `${plural(n, 'lesson', 'lessons')} a day`)}
        />
      </View>

      {s.lessonsPerDay !== null && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="wanikaniApprenticeCap"
            icon="layers-outline"
            label="Skip lessons at"
            hint="No lessons task on a day this many items or more are in Apprentice."
            value={s.apprenticeCap === null ? 'No limit' : plural(s.apprenticeCap, 'item', 'items')}
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.apprenticeCap ?? WANIKANI_APPRENTICE_CAP_MAX}
              onChange={next => s.setApprenticeCap(next ?? WANIKANI_APPRENTICE_CAP_DEFAULT)}
              min={WANIKANI_APPRENTICE_CAP_MIN}
              max={WANIKANI_APPRENTICE_CAP_MAX}
              step={WANIKANI_APPRENTICE_CAP_STEP}
              label="Apprentice items"
              describeValue={n => plural(n ?? WANIKANI_APPRENTICE_CAP_DEFAULT, 'item', 'items')}
            />
          </View>
        </>
      )}

      <View style={styles.sep} />
      <SettingsRow
        entryId="wanikaniClientLink"
        icon="link-outline"
        iconColor={s.clientLink ? colors.accent : undefined}
        label="Open in"
        hint="Where the task opens. Paste a link from the WaniKani app you use. Leave blank for wanikani.com."
        alwaysShowHint
      >
        <TextField
          style={[styles.apiKeyInput, { color: colors.text, borderBottomColor: colors.separator }]}
          value={s.clientLink}
          onChangeText={s.setClientLink}
          placeholder="e.g. https://example.com/reviews"
          placeholderTextColor={colors.textTertiary}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          accessibilityLabel="WaniKani task link"
        />
      </SettingsRow>

      <View style={styles.sep} />
      <SettingsRow
        entryId="wanikaniNotify"
        icon="notifications-outline"
        iconColor={s.notify ? colors.accent : undefined}
        label="Notify when reviews arrive"
        hint={s.notify
          ? 'A notification at the hour a held task appears.'
          : 'The task appears without a notification'}
        toggle={s.notify}
        onPress={() => s.setNotify(!s.notify)}
      />
    </>
  );
}
