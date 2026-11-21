import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useColors } from '../../theme/ThemeContext';
import { TextField } from '../../components/TextField';
import { FieldError } from '../../components/FieldError';
import { animateLayout } from '../../utils/layoutAnimation';
import { haptics } from '../../utils/haptics';
import { cleanWords, onCallWordsProblem, splitTypedWords } from '../../utils/onCall';
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
 * Words are typed comma-separated and saved when the field is left, and the field
 * then shows the saved list. What the match will not use (too short, too many) is
 * said under the field while it is typed, never dropped without saying so.
 */
export function OnCallRows({ calendars }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const onCallCalendarIds = useSettingsStore(s => s.onCallCalendarIds);
  const setOnCallCalendarIds = useSettingsStore(s => s.setOnCallCalendarIds);
  const onCallWords = useSettingsStore(s => s.onCallWords);
  const setOnCallWords = useSettingsStore(s => s.setOnCallWords);
  const onCallSwapTasks = useSettingsStore(s => s.onCallSwapTasks);
  const ignoredIds = useSettingsStore(s => s.onCallSwapIgnoredCalendarIds);
  const setIgnoredIds = useSettingsStore(s => s.setOnCallSwapIgnoredCalendarIds);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [ignoredOpen, setIgnoredOpen] = useState(false);
  const [typed, setTyped] = useState(() => onCallWords.join(', '));
  const typedRef = useRef(typed);
  typedRef.current = typed;

  // Saves what is typed, then shows what was saved: the store trims, collapses
  // spaces, drops repeats and drops what is too short, so leaving the typed text
  // as it was would keep showing words the match does not use.
  const commitWords = (text: string) => {
    setOnCallWords(splitTypedWords(text));
    setTyped(useSettingsStore.getState().onCallWords.join(', '));
  };

  // Leaving the screen with the field still focused may not end the edit first,
  // so what is typed is saved on the way out as well. Nothing changes when the
  // field already saved it.
  useEffect(() => () => {
    const saved = useSettingsStore.getState().onCallWords;
    const typedWords = cleanWords(splitTypedWords(typedRef.current));
    if (typedWords.join('\n') !== saved.join('\n')) setOnCallWords(typedWords);
  }, []);

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

  const ignored = calendars.filter(c => ignoredIds.includes(c.id));
  const ignoredSummary = ignored.length === 0 ? undefined
    : ignored.length === 1 ? ignored[0].title
    : `${ignored.length} calendars`;
  const toggleIgnored = (id: string) => {
    haptics.tap();
    setIgnoredIds(ignoredIds.includes(id) ? ignoredIds.filter(c => c !== id) : [...ignoredIds, id]);
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
        stackValue
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
          onEndEditing={() => commitWords(typed)}
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

      {onCallSwapTasks && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="onCallSwapIgnored"
            icon="eye-off-outline"
            iconColor={ignored.length > 0 ? colors.accent : undefined}
            label="Skip for swap tasks"
            hint="Events on these calendars never get a task to find someone to swap with. Pick your work calendar here."
            value={ignoredSummary}
            stackValue
            expanded={ignoredOpen}
            onPress={() => { animateLayout(); setIgnoredOpen(open => !open); }}
            accessibilityLabel="Choose which calendars to skip for swap tasks"
          />
          {ignoredOpen && (
            <SettingsChoiceTray
              caption="Skip"
              options={calendars}
              selectedIds={ignoredIds}
              onSelect={option => toggleIgnored(option.id)}
              emptyText="Pick the calendars to read above first."
              accessibilityLabelFor={option => `Skip ${option.title} for swap tasks`}
            />
          )}
        </>
      )}
    </>
  );
}
