import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { SavedFocusFilter, SavedFocusSession } from '../types';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { FieldError } from './FieldError';
import { HelpText } from './HelpText';
import { SegmentedControl } from './SegmentedControl';
import { PillGroup, type PillGroupOption } from './PillGroup';
import { CountStepper } from './CountStepper';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useSavedFocusStore } from '../store/useSavedFocusStore';
import { useAlarmStore } from '../store/useAlarmStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskStore } from '../store/useTaskStore';
import { FOCUS_WINDOW_MAX, FOCUS_WINDOW_MIN, FOCUS_WINDOW_STEP } from '../utils/focusSettings';
import { alarmsUsing, savedFocusNameTaken } from '../utils/savedFocus';
import { confirmDiscard } from '../utils/confirmDiscard';
import { changedList } from '../utils/editorChangeSummary';
import { confirmDelete } from '../utils/confirmDelete';
import { haptics } from '../utils/haptics';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** The session to edit, or null for a new one. */
  session: SavedFocusSession | null;
  /** Called with the saved session's id once it is saved, so a caller can pick it. */
  onSaved?: (id: string) => void;
  onClose: () => void;
}

interface Draft {
  name: string;
  kind: SavedFocusFilter['kind'];
  value: string;
  windowMinutes: number | null;
}

const KIND_OPTIONS = [
  { value: 'all' as const, label: 'Any' },
  { value: 'category' as const, label: 'Category' },
  { value: 'project' as const, label: 'Project' },
  { value: 'tag' as const, label: 'Tag' },
];

function draftFor(session: SavedFocusSession | null): Draft {
  if (!session) return { name: '', kind: 'all', value: '', windowMinutes: 90 };
  return {
    name: session.name,
    kind: session.filter.kind,
    value: session.filter.kind === 'all' ? '' : session.filter.value,
    windowMinutes: session.windowMinutes,
  };
}

function filterOf(draft: Draft): SavedFocusFilter {
  return draft.kind === 'all' || draft.value === '' ? { kind: 'all' } : { kind: draft.kind, value: draft.value };
}

const changedDraft = (a: Draft, b: Draft) => changedList([
  ['name', a.name.trim() !== b.name.trim()],
  ['tasks from', a.kind !== b.kind || a.value !== b.value],
  ['time available', a.windowMinutes !== b.windowMinutes],
]);

/**
 * Adds or edits a saved focus session (utils/savedFocus.ts): a name, which
 * tasks it draws from, and the time available. A page sheet that stages its
 * fields until Save, so a swipe down asks before throwing an edit away. Opened
 * from the alarm editor, inside that sheet's Modal ("Two sibling Modals").
 */
export function SavedFocusEditorSheet({ visible, session, onSaved, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });
  const sessions = useSavedFocusStore(s => s.sessions);
  const alarms = useAlarmStore(s => s.alarms);
  const categories = useCategoryStore(s => s.categories);
  const projects = useProjectStore(s => s.projects);
  const tagRegistry = useTaskStore(s => s.tagRegistry);
  const [draft, setDraft] = useState<Draft>(() => draftFor(session));
  const [opened, setOpened] = useState<Draft>(() => draftFor(session));

  useEffect(() => {
    if (!visible) return;
    const start = draftFor(session);
    setDraft(start);
    setOpened(start);
  }, [visible, session]);

  const patch = (next: Partial<Draft>) => setDraft(d => ({ ...d, ...next }));
  const taken = savedFocusNameTaken(draft.name, sessions, session?.id);
  const canSave = draft.name.trim() !== '' && !taken;

  const valueOptions: PillGroupOption[] = useMemo(() => {
    const pill = (key: string, label: string): PillGroupOption => ({
      key, label, selected: draft.value === key, onPress: () => { haptics.tap(); patch({ value: key }); },
    });
    if (draft.kind === 'category') return categories.map(c => pill(c.name, c.name));
    if (draft.kind === 'project') return projects.filter(p => !p.archived).map(p => pill(p.id, p.title));
    if (draft.kind === 'tag') return tagRegistry.map(t => pill(t, t));
    return [];
  }, [draft.kind, draft.value, categories, projects, tagRegistry]);

  const handleCancel = () => {
    const changed = changedDraft(draft, opened);
    if (!changed) {
      onClose();
      return;
    }
    confirmDiscard(onClose, { changed });
  };

  const handleSave = () => {
    if (!canSave) return;
    const saved = useSavedFocusStore.getState().save({
      id: session?.id, name: draft.name, filter: filterOf(draft), windowMinutes: draft.windowMinutes,
    });
    if (!saved) return;
    haptics.success();
    onSaved?.(saved.id);
    onClose();
  };

  const handleDelete = () => {
    if (!session) return;
    const using = alarmsUsing(session.id, alarms).length;
    confirmDelete({
      title: 'Delete this focus session?',
      message: using === 0
        ? 'It can’t be started from an alarm anymore.'
        : `${using === 1 ? 'The alarm that starts it' : `The ${using} alarms that start it`} will no longer start a focus session.`,
      onConfirm: () => {
        useSavedFocusStore.getState().remove(session.id);
        onClose();
      },
    });
  };

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <SheetHeader
          title={session ? 'Edit Focus Session' : 'New Focus Session'}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={handleCancel} minWidth={64} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.save} onPress={handleSave} minWidth={64} />}
        />
        <ScrollView
          ref={keyboardScroll.ref}
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          <Text style={styles.label}>Name</Text>
          <View style={styles.card}>
            <TextField
              style={styles.input}
              value={draft.name}
              onChangeText={t => patch({ name: t })}
              placeholder="e.g. Deep work"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              maxLength={40}
              accessibilityLabel="Focus session name"
            />
            <FieldError>{taken ? 'Another focus session already has that name. Pick a different one.' : null}</FieldError>
          </View>

          <Text style={styles.label}>Tasks from</Text>
          <View style={styles.card}>
            <SegmentedControl
              options={KIND_OPTIONS}
              value={draft.kind}
              onChange={kind => patch({ kind, value: '' })}
              label="Tasks from"
            />
            {draft.kind !== 'all' && (
              <View style={styles.values}>
                <PillGroup options={valueOptions} noun={draft.kind} />
                {valueOptions.length === 0 && <Text style={styles.empty}>There are none yet. Any task is used until you add one.</Text>}
              </View>
            )}
            <HelpText style={styles.hint}>
              The tasks are picked when the session starts, so finished ones never appear.
            </HelpText>
          </View>

          <Text style={styles.label}>Time available</Text>
          <View style={styles.card}>
            <CountStepper
              value={draft.windowMinutes}
              onChange={windowMinutes => patch({ windowMinutes })}
              min={FOCUS_WINDOW_MIN}
              max={FOCUS_WINDOW_MAX}
              step={FOCUS_WINDOW_STEP}
              allowNull
              start={90}
              emptyLabel="No limit"
              format={n => `${n} min`}
              label="time available"
            />
            <HelpText style={styles.hint}>Breaks follow the Focus settings, and count toward this time.</HelpText>
          </View>

          {session && (
            <TouchableOpacity
              style={[styles.card, styles.delete]}
              onPress={handleDelete}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
            >
              <Text style={styles.deleteText}>Delete Focus Session</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  bodyContent: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, padding: spacing.md },
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginLeft: spacing.md,
  },
  input: { color: colors.text, fontSize: font.md, minHeight: 24, padding: 0 },
  values: { marginTop: spacing.smd },
  empty: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.sm },
  hint: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18, marginTop: spacing.smd },
  delete: { marginTop: spacing.lg, alignItems: 'center' },
  deleteText: { color: colors.redText, fontSize: font.md },
});
