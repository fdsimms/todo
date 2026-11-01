import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { format } from 'date-fns/format';
import type { CoinEntry, RewardUnlock, Task } from '../types';
import { useUnlockStore, type UnlockDraft } from '../store/useUnlockStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { confirmDelete } from '../utils/confirmDelete';
import { getCurrentDayStart, getLogicalDayKey } from '../utils/dateUtils';
import { displayTitleFor } from '../utils/visibilityUtils';
import { MAX_GLYPH_CHARS } from '../utils/rewards';
import {
  DEFAULT_UNLOCK_SHARE,
  MAX_PLAY_HOURS,
  MAX_UNLOCK_SHARE,
  MIN_UNLOCK_SHARE,
  PLAY_EXTRA_MINUTES,
  UNLOCK_SHARE_STEP,
  describePlayMinutes,
  formatPlayClock,
  playState,
  statusOfUnlock,
  type UnlockStatus,
} from '../utils/rewardUnlocks';
import { BUTTON_LABEL } from '../copy/shared';
import { CountStepper } from './CountStepper';
import { EmptyNote } from './EmptyNote';
import { HelpText } from './HelpText';
import { HabitPickerSheet } from './HabitPickerSheet';
import { InlineAction } from './InlineAction';
import { ProgressBar } from './ProgressBar';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TaskRelationPickerSheet } from './TaskRelationPickerSheet';
import { TextField } from './TextField';
import { Toggle } from './Toggle';

/**
 * The Rewards screen's Unlocks section: treats opened by the day's work
 * instead of bought with coins (see `src/utils/rewardUnlocks.ts`). Each is a
 * full-width card rather than a grid tile, since it resets every day and
 * isn't bought: locked with the work still to do, open with its code and a
 * Start button, or playing with the day's timer. Editing swaps the card for
 * a form in place, the same way a reward's tile is edited.
 */
interface Props {
  tasks: readonly Task[];
  entries: readonly CoinEntry[];
  /** Habits rewards guard: left out of the habit picker, since a habit has one link. */
  guardedByRewards: ReadonlySet<string>;
}

/** One-tap icons in the form. Anything else is typed into the field beside them. */
const UNLOCK_GLYPHS = ['🎮', '🕹️', '📺', '🎬', '📱', '🛋️', '📖', '🎧'];

/** The play time stepper's step and range, in minutes. */
const PLAY_STEP = 30;

type Draft = { mode: 'new' } | { mode: 'edit'; id: string };

const EMPTY_DRAFT: UnlockDraft = {
  title: '',
  glyph: null,
  sharePct: DEFAULT_UNLOCK_SHARE,
  requiredTaskIds: [],
  playMinutes: 120,
  freeOnWeekends: false,
  freeOnVacation: false,
  guardsTaskId: null,
  pin: null,
};

export function UnlocksSection({ tasks, entries, guardedByRewards }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const unlocks = useUnlockStore(s => s.unlocks);
  const vacation = useSettingsStore(s => s.vacationMode);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  // What Today shows: the work the share is a share of.
  const onToday = useTaskStore(useShallow(s => [...s.visibleTasks(), ...s.upcomingTodayTasks()]));
  const taskById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);

  // A second's tick while a timer runs, and a minute's otherwise, so the
  // countdown moves and a day boundary is noticed.
  const [now, setNow] = useState(() => new Date());
  const todayKey = getLogicalDayKey(now, dayResetTime);
  const anyRunning = unlocks.some(u => playState(u, now, todayKey).running);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), anyRunning ? 1000 : 60_000);
    return () => clearInterval(id);
  }, [anyRunning]);

  const world = useMemo(
    () => ({ entries, tasks, onToday, todayStart: getCurrentDayStart(), todayKey, vacation }),
    [entries, tasks, onToday, todayKey, vacation],
  );

  // ==== the form ====
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fields, setFields] = useState<UnlockDraft>(EMPTY_DRAFT);
  const [habitPickerOpen, setHabitPickerOpen] = useState(false);
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const editingId = draft?.mode === 'edit' ? draft.id : null;
  const set = <K extends keyof UnlockDraft>(key: K, value: UnlockDraft[K]) => setFields(f => ({ ...f, [key]: value }));
  const openDraft = (next: Draft, from?: RewardUnlock) => {
    haptics.tap();
    animateLayout();
    setFields(from ? {
      title: from.title, glyph: from.glyph, sharePct: from.sharePct, requiredTaskIds: from.requiredTaskIds,
      playMinutes: from.playMinutes, freeOnWeekends: from.freeOnWeekends, freeOnVacation: from.freeOnVacation,
      guardsTaskId: from.guardsTaskId, pin: from.pin,
    } : EMPTY_DRAFT);
    setDraft(next);
  };
  const closeDraft = () => {
    animateLayout();
    setDraft(null);
  };
  const canSave = fields.title.trim().length > 0;
  const save = () => {
    if (!canSave || !draft) return;
    haptics.success();
    if (draft.mode === 'edit') useUnlockStore.getState().updateUnlock(draft.id, fields);
    else useUnlockStore.getState().addUnlock(fields);
    closeDraft();
  };
  const remove = (unlock: RewardUnlock) => {
    confirmDelete({
      title: `Delete “${unlock.title}”?`,
      message: 'Its timer and code go with it. No coins were spent on it.',
      onConfirm: () => {
        closeDraft();
        useUnlockStore.getState().deleteUnlock(unlock.id);
      },
    });
  };
  // A habit has one link: a reward that guards it, or one unlock.
  const habitExcluded = useMemo(
    () => new Set([...guardedByRewards, ...unlocks.filter(u => u.id !== editingId && u.guardsTaskId).map(u => u.guardsTaskId!)]),
    [guardedByRewards, unlocks, editingId],
  );

  const renderForm = () => {
    const habit = fields.guardsTaskId ? taskById.get(fields.guardsTaskId) : undefined;
    return (
      <View style={styles.card}>
        <View style={styles.draftHeader}>
          <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={closeDraft} minWidth={56} />
          <Text style={styles.draftHeaderTitle} numberOfLines={1}>{draft?.mode === 'edit' ? 'Edit unlock' : 'New unlock'}</Text>
          <SheetHeaderButton label={draft?.mode === 'edit' ? BUTTON_LABEL.save : 'Add'} onPress={save} disabled={!canSave} minWidth={56} />
        </View>
        <TextField
          style={styles.input}
          value={fields.title}
          onChangeText={t => set('title', t)}
          placeholder="e.g. Switch"
          placeholderTextColor={colors.textTertiary}
          autoFocus={draft?.mode === 'new'}
          returnKeyType="next"
          accessibilityLabel="Unlock"
        />

        <Text style={styles.fieldLabel}>Icon</Text>
        <View style={styles.presetRow}>
          {UNLOCK_GLYPHS.map(g => (
            <TouchableOpacity
              key={g}
              style={[styles.presetChip, fields.glyph === g && styles.presetChipActive]}
              onPress={() => { haptics.tap(); set('glyph', fields.glyph === g ? null : g); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityState={{ selected: fields.glyph === g }}
              accessibilityLabel={`Icon ${g}`}
            >
              <Text style={styles.glyphChipText}>{g}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextField
          style={[styles.input, styles.glyphInput]}
          value={fields.glyph ?? ''}
          onChangeText={text => set('glyph', Array.from(text).slice(0, MAX_GLYPH_CHARS).join('') || null)}
          placeholder="e.g. 🎮"
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel="Icon"
        />

        <Text style={styles.fieldLabel}>Unlocks after</Text>
        <View style={styles.stepRow}>
          <CountStepper
            value={fields.sharePct}
            onChange={n => set('sharePct', n ?? fields.sharePct)}
            min={MIN_UNLOCK_SHARE}
            max={MAX_UNLOCK_SHARE}
            step={UNLOCK_SHARE_STEP}
            format={n => `${n}%`}
            label="Share of today’s work"
          />
          <Text style={styles.stepUnit}>of today’s work</Text>
        </View>
        <HelpText style={styles.hint}>Counted in coins, so hard tasks count for more. A day with nothing on it is unlocked.</HelpText>

        <Text style={styles.fieldLabel}>Also needs</Text>
        <View style={styles.chipRow}>
          {fields.requiredTaskIds.map(id => {
            const task = taskById.get(id);
            const title = task ? displayTitleFor(task) : 'A task that’s gone';
            return (
              <TouchableOpacity
                key={id}
                style={styles.taskChip}
                onPress={() => { haptics.tap(); set('requiredTaskIds', fields.requiredTaskIds.filter(x => x !== id)); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${title}`}
              >
                <Text style={styles.taskChipText} numberOfLines={1}>{title}</Text>
                <Ionicons name="close" size={iconSize.xs} color={colors.textSecondary} />
              </TouchableOpacity>
            );
          })}
          <InlineAction label="Add a task" icon="add" variant="neutral" onPress={() => { haptics.tap(); setTaskPickerOpen(true); }} />
        </View>
        <HelpText style={styles.hint}>Only on the days they’re due. Any repeat of the task counts.</HelpText>

        <Text style={styles.fieldLabel}>Play for</Text>
        <CountStepper
          value={fields.playMinutes}
          onChange={n => set('playMinutes', n)}
          min={PLAY_STEP}
          max={MAX_PLAY_HOURS * 60}
          step={PLAY_STEP}
          allowNull
          start={120}
          emptyLabel="No limit"
          format={describePlayMinutes}
          label="Play time a day"
          style={styles.stepper}
        />
        <HelpText style={styles.hint}>A timer you start once it’s unlocked, with a notification when today’s time is up.</HelpText>

        <Text style={styles.fieldLabel}>Unlocked all day on</Text>
        {([['freeOnWeekends', 'Weekends'], ['freeOnVacation', 'Vacation']] as const).map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={styles.switchRow}
            onPress={() => { haptics.tap(); set(key, !fields[key]); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="switch"
            accessibilityState={{ checked: fields[key] }}
            accessibilityLabel={`Unlocked all day on ${label.toLowerCase()}`}
          >
            <Text style={styles.switchLabel}>{label}</Text>
            <Toggle value={fields[key]} />
          </TouchableOpacity>
        ))}

        <Text style={styles.fieldLabel}>Linked habit</Text>
        <View style={styles.chipRow}>
          {habit ? (
            <>
              <View style={styles.taskChip}>
                <Ionicons name="shield-checkmark-outline" size={iconSize.xs} color={colors.textSecondary} />
                <Text style={styles.taskChipText} numberOfLines={1}>{displayTitleFor(habit)}</Text>
              </View>
              <InlineAction label="Unlink" variant="neutral" onPress={() => { haptics.tap(); set('guardsTaskId', null); }} />
            </>
          ) : (
            <InlineAction label="Choose a habit" icon="shield-checkmark-outline" variant="neutral" onPress={() => { haptics.tap(); setHabitPickerOpen(true); }} />
          )}
        </View>
        <HelpText style={styles.hint}>An “Avoid this” habit for doing it while it’s locked. Logging a slip on it while it’s unlocked asks first.</HelpText>

        <Text style={styles.fieldLabel}>Code</Text>
        <TextField
          style={styles.input}
          value={fields.pin ?? ''}
          onChangeText={t => set('pin', t || null)}
          placeholder="e.g. 4817"
          placeholderTextColor={colors.textTertiary}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Code, such as a parental controls PIN"
        />
        <HelpText style={styles.hint}>Such as a console’s parental controls PIN. Shown only while it’s unlocked.</HelpText>

        {draft?.mode === 'edit' && (() => {
          const editing = unlocks.find(u => u.id === draft.id);
          return editing ? (
            <View style={styles.formActions}>
              <InlineAction label={BUTTON_LABEL.delete} icon="trash-outline" variant="neutral" onPress={() => remove(editing)} accessibilityLabel={`Delete ${editing.title}`} />
            </View>
          ) : null;
        })()}
      </View>
    );
  };

  // ==== a card ====
  const renderCard = (unlock: RewardUnlock) => {
    const { status, required } = statusOfUnlock(unlock, world);
    const open = status.kind !== 'locked';
    const play = playState(unlock, now, todayKey);
    const shown = revealed.has(unlock.id);
    const habit = unlock.guardsTaskId ? taskById.get(unlock.guardsTaskId) : undefined;
    const store = useUnlockStore.getState();
    return (
      <View key={unlock.id} style={styles.card}>
        <View style={styles.head}>
          <View style={styles.glyph}>
            {unlock.glyph
              ? <Text style={styles.glyphText} accessible={false}>{unlock.glyph}</Text>
              : <Ionicons name="lock-open-outline" size={iconSize.md} color={colors.accent} />}
          </View>
          <View style={styles.headText}>
            <Text style={styles.title} numberOfLines={2}>{unlock.title}</Text>
            <Text style={styles.subtitle}>{subtitleFor(unlock, status, play.running)}</Text>
          </View>
          <InlineAction icon="create-outline" variant="neutral" onPress={() => openDraft({ mode: 'edit', id: unlock.id }, unlock)} accessibilityLabel={`Edit ${unlock.title}`} />
        </View>

        {status.kind === 'locked' && (
          <View style={styles.block}>
            <Text style={styles.status}>
              {[
                `${Math.floor(status.share * 100)}% of today’s work done`,
                status.coinsShort > 0 ? `about ${status.coinsShort} more ${status.coinsShort === 1 ? 'coin' : 'coins'}` : null,
              ].filter(Boolean).join(' · ')}
            </Text>
            <ProgressBar progress={Math.min(1, status.share * 100 / unlock.sharePct)} height={6} color={colors.green} decorative />
            {status.pending.length > 0 && (
              <Text style={styles.meta}>{`Still needs ${status.pending.map(t => displayTitleFor(t)).join(', ')}`}</Text>
            )}
          </View>
        )}
        {status.kind === 'open' && !play.running && (
          <Text style={[styles.status, styles.statusOk]}>
            {`${Math.floor(status.share * 100)}% of today’s work done`}
            {required.done.length > 0 ? ` · ${required.done.map(t => displayTitleFor(t)).join(', ')} done` : ''}
          </Text>
        )}

        {open && unlock.pin && (
          <View style={styles.pin}>
            <View style={styles.pinText}>
              <Text style={styles.meta}>Code</Text>
              <Text style={styles.pinValue} selectable={shown}>{shown ? unlock.pin : '• • • •'}</Text>
            </View>
            <InlineAction
              label={shown ? 'Hide' : 'Show'}
              variant="neutral"
              onPress={() => {
                haptics.tap();
                setRevealed(prev => {
                  const next = new Set(prev);
                  if (next.has(unlock.id)) next.delete(unlock.id); else next.add(unlock.id);
                  return next;
                });
              }}
              accessibilityLabel={shown ? `Hide the code for ${unlock.title}` : `Show the code for ${unlock.title}`}
            />
          </View>
        )}

        {open && unlock.playMinutes !== null && (play.running ? (
          <View style={styles.timerBlock}>
            <Text style={styles.timer} accessibilityLabel={`${formatPlayClock(play.remainingMs ?? 0)} left`}>
              {formatPlayClock(play.remainingMs ?? 0)}
            </Text>
            <Text style={styles.timerMeta}>
              {`left of ${describePlayMinutes(Math.round((play.allowanceMs ?? 0) / 60_000))}${play.endsAt ? ` · ends ${format(play.endsAt, 'h:mm a')}` : ''}`}
            </Text>
            <View style={styles.actionsCentered}>
              <InlineAction label="Stop" variant="neutral" onPress={() => { haptics.tap(); store.stopPlay(unlock.id); }} />
              <InlineAction label={`+${PLAY_EXTRA_MINUTES} min`} onPress={() => { haptics.tap(); store.addPlayTime(unlock.id, PLAY_EXTRA_MINUTES); }} />
            </View>
          </View>
        ) : (play.remainingMs ?? 0) > 0 ? (
          <View style={styles.actions}>
            <InlineAction
              label="Start playing"
              icon="play"
              onPress={() => { haptics.success(); store.startPlay(unlock.id); }}
              accessibilityLabel={`Start playing ${unlock.title}`}
            />
            <Text style={styles.meta}>{`${formatPlayClock(play.remainingMs ?? 0)} left today`}</Text>
          </View>
        ) : (
          <View style={styles.actions}>
            <Text style={styles.meta}>Today’s time is used up.</Text>
            <InlineAction label={`+${PLAY_EXTRA_MINUTES} min`} variant="neutral" onPress={() => { haptics.tap(); store.addPlayTime(unlock.id, PLAY_EXTRA_MINUTES); }} />
          </View>
        ))}

        {habit && <Text style={styles.meta}>{`Linked habit: ${displayTitleFor(habit)}`}</Text>}
      </View>
    );
  };

  return (
    <>
      <Text style={styles.sectionHeader}>Unlocks today</Text>
      {unlocks.length === 0 && draft?.mode !== 'new' && (
        <View style={styles.emptyNote}>
          <EmptyNote icon="lock-open-outline">
            Something you get once you’ve done enough of the day’s work, like an hour of a game. It costs no coins.
          </EmptyNote>
        </View>
      )}
      <View style={styles.list}>
        {unlocks.map(u => (u.id === editingId ? <React.Fragment key={u.id}>{renderForm()}</React.Fragment> : renderCard(u)))}
        {draft?.mode === 'new' && renderForm()}
      </View>
      {draft?.mode !== 'new' && (
        <View style={styles.addRow}>
          <InlineAction label="New unlock" icon="add" onPress={() => openDraft({ mode: 'new' })} />
        </View>
      )}
      <HabitPickerSheet
        visible={habitPickerOpen}
        onClose={() => setHabitPickerOpen(false)}
        value={fields.guardsTaskId}
        onSelect={id => set('guardsTaskId', id)}
        excludeIds={habitExcluded}
      />
      <TaskRelationPickerSheet
        visible={taskPickerOpen}
        onClose={() => setTaskPickerOpen(false)}
        relation="unlockNeeds"
        taskId={null}
        excludeIds={fields.requiredTaskIds}
        onSelect={id => set('requiredTaskIds', [...fields.requiredTaskIds, id])}
      />
    </>
  );
}

/** The line under an unlock's name. */
function subtitleFor(unlock: RewardUnlock, status: UnlockStatus, running: boolean): string {
  if (status.kind === 'free') return status.reason === 'weekend' ? 'Unlocked all day: it’s the weekend' : 'Unlocked all day: you’re on vacation';
  if (running && unlock.playStartedAt) return `Playing since ${format(new Date(unlock.playStartedAt), 'h:mm a')}`;
  const cap = unlock.playMinutes !== null ? ` · ${describePlayMinutes(unlock.playMinutes)}` : '';
  if (status.kind === 'open') return `Unlocked for today${cap}`;
  return `Unlocks at ${unlock.sharePct}% of today’s work${cap}`;
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    sectionHeader: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    emptyNote: { marginHorizontal: spacing.md },
    list: { gap: spacing.smd },
    card: {
      marginHorizontal: spacing.md,
      padding: spacing.smd,
      borderRadius: radius.md,
      backgroundColor: colors.bgSecondary,
      gap: spacing.sm,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd },
    glyph: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.accentSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // An emoji sized as an icon, which is what a literal size is for.
    glyphText: { fontSize: 24 },
    headText: { flex: 1 },
    title: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    subtitle: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
    block: { gap: spacing.sm },
    status: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold },
    statusOk: { color: colors.greenText },
    meta: { color: colors.textSecondary, fontSize: font.xs },
    pin: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.smd,
      padding: spacing.smd,
      borderRadius: radius.sm,
      backgroundColor: colors.bgSunken,
    },
    pinText: { flex: 1 },
    pinValue: { color: colors.text, fontSize: font.xl, fontWeight: fontWeight.bold, letterSpacing: 4, fontVariant: ['tabular-nums'] },
    timerBlock: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
    // A hero number, which is one of the things a literal font size is for.
    timer: { color: colors.text, fontSize: 40, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
    timerMeta: { color: colors.textSecondary, fontSize: font.sm },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    actionsCentered: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.sm },
    // The form, matching the reward form's fields.
    draftHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xs, marginBottom: spacing.sm },
    draftHeaderTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    fieldLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      marginTop: spacing.sm,
    },
    hint: { color: colors.textSecondary, fontSize: font.xs, marginTop: -spacing.xs },
    input: {
      color: colors.text,
      fontSize: font.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.smd,
      borderRadius: radius.sm,
      backgroundColor: colors.bgTertiary,
    },
    glyphInput: { alignSelf: 'flex-start', minWidth: 96 },
    presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    presetChip: {
      paddingHorizontal: 14,
      minHeight: interaction.pillHeight,
      justifyContent: 'center',
      borderRadius: radius.full,
      backgroundColor: colors.bgTertiary,
    },
    presetChipActive: { backgroundColor: colors.accentFill },
    glyphChipText: { fontSize: font.md },
    stepRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
    stepUnit: { color: colors.textSecondary, fontSize: font.md },
    stepper: { alignSelf: 'flex-start' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xsm },
    taskChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      maxWidth: '100%',
      paddingHorizontal: spacing.smd,
      minHeight: interaction.pillHeight,
      borderRadius: radius.full,
      backgroundColor: colors.bgTertiary,
    },
    taskChipText: { color: colors.text, fontSize: font.sm, flexShrink: 1 },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
    switchLabel: { color: colors.text, fontSize: font.md },
    formActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  });
}
