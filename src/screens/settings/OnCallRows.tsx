import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useColors } from '../../theme/ThemeContext';
import { TextField } from '../../components/TextField';
import { FieldError } from '../../components/FieldError';
import { animateLayout } from '../../utils/layoutAnimation';
import { haptics } from '../../utils/haptics';
import { onCallWordsProblem, splitTypedWords } from '../../utils/onCall';
import { SettingsRow } from './SettingsRow';
import { SettingsChoiceTray } from './SettingsChoiceTray';
import { makeSettingsStyles } from './settingsStyles';

interface Props {
  /** The calendars being read: only those can hold an on-call event. */
  calendars: { id: string; title: string }[];
}

/**
 * The two ways an event is marked as on call: its calendar, or a word in its
 * title (`src/utils/onCall.ts`). Either is enough, and with neither set the
 * feature is off. Rows of `CalendarSettings`, in a file of their own so that
 * screen keeps its length.
 *
 * Words are typed comma-separated and saved when the field is left. What the
 * match will not use (too short, too many) is said under the field while it is
 * typed, never dropped without saying so.
 */
export function OnCallRows({ calendars }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const onCallCalendarIds = useSettingsStore(s => s.onCallCalendarIds);
  const setOnCallCalendarIds = useSettingsStore(s => s.setOnCallCalendarIds);
  const onCallWords = useSettingsStore(s => s.onCallWords);
  const setOnCallWords = useSettingsStore(s => s.setOnCallWords);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [typed, setTyped] = useState(() => onCallWords.join(', '));

  // A calendar no longer being read (or no longer on the device) is not counted.
  const chosen = calendars.filter(c => onCallCalendarIds.includes(c.id));
  const summary = chosen.length === 0 ? undefined
    : chosen.length === 1 ? chosen[0].title
    : `${chosen.length} calendars`;

  const toggle = (id: string) => {
    haptics.tap();
    setOnCallCalendarIds(
      onCallCalendarIds.includes(id) ? onCallCalendarIds.filter(c => c !== id) : [...onCallCalendarIds, id],
    );
  };

  return (
    <>
      <View style={styles.sep} />
      <SettingsRow
        entryId="onCallCalendars"
        icon="call-outline"
        iconColor={chosen.length > 0 ? colors.accent : undefined}
        label="On-call calendars"
        hint="Every event on these calendars counts as on call. Today shows when you are, and adding something over it warns you."
        value={summary}
        expanded={pickerOpen}
        onPress={() => { animateLayout(); setPickerOpen(open => !open); }}
        accessibilityLabel="Choose which calendars are on call"
      />
      {pickerOpen && (
        <SettingsChoiceTray
          caption="On call"
          options={calendars}
          selectedIds={onCallCalendarIds}
          onSelect={option => toggle(option.id)}
          emptyText="Pick the calendars to read above first."
          accessibilityLabelFor={option => `${option.title} is an on-call calendar`}
        />
      )}

      <View style={styles.sep} />
      <SettingsRow
        entryId="onCallWords"
        icon="text-outline"
        label="On-call words"
        hint="Events with one of these words in the title count as on call, on any calendar. Separate words with commas."
        alwaysShowHint
      >
        <TextField
          style={[styles.apiKeyInput, { color: colors.text, borderBottomColor: colors.separator }]}
          value={typed}
          onChangeText={setTyped}
          onEndEditing={() => setOnCallWords(splitTypedWords(typed))}
          placeholder="e.g. on call, pager"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="done"
          accessibilityLabel="Words that mark an event as on call"
        />
        <FieldError>{onCallWordsProblem(typed)}</FieldError>
      </SettingsRow>
    </>
  );
}
