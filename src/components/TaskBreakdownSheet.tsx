import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { SheetModal } from './SheetModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useTaskStore } from '../store/useTaskStore';
import { suggestSubtasks, describeAIError } from '../services/aiSuggestions';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyNote } from './EmptyNote';
import { TextField } from './TextField';
import { InlineAction } from './InlineAction';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { TITLE_MAX_LENGTH } from '../types';

interface Props {
  visible: boolean;
  /** The task being broken up. Null closes the sheet without a request. */
  taskId: string | null;
  onClose: () => void;
}

/**
 * "I can't even think about splitting this up — just do it for me."
 *
 * Reached from the postpone prompt's "Break it up" pill, for a task that has
 * been pushed enough times that its size is the likely reason. Drafts the steps
 * with AI, lets the user drop any they don't want, and adds the rest as
 * subtasks.
 *
 * Modelled directly on TemplateSuggestionsSheet — same generate → review → add
 * shape, and suggestions start accepted for the same reason, so the common case
 * is two taps. The differences are that it reads its task from the store rather
 * than taking the content as props (it's opened from a picker that only knows
 * an id), and that it commits through addSubtask rather than addItem.
 *
 * A short title is often ambiguous ("Clean bags": which bags?), so the sheet
 * also takes the two things the model can't guess: what the task means, which
 * is sent with Regenerate, and steps typed by hand, which sit in the same list
 * as the drafted ones and survive a regenerate. Typing steps works even when
 * the request fails, so the sheet is never a dead end.
 */

/** One row in the list: a drafted step, or one the person typed. */
interface Step {
  key: string;
  title: string;
  own: boolean;
}

let stepSeq = 0;
const stepKey = () => `step-${++stepSeq}`;
export function TaskBreakdownSheet({ visible, taskId, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const addSubtask = useTaskStore(s => s.addSubtask);
  const task = useTaskStore(s => s.tasks.find(t => t.id === taskId));
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True once a request has come back with nothing new, so the list can say so.
  const [cameBackEmpty, setCameBackEmpty] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  // Keys of accepted steps; everything starts accepted.
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [context, setContext] = useState('');
  const [newStep, setNewStep] = useState('');
  // Read inside `load` without making it a dependency, so a regenerate sends
  // what's in the fields now rather than what was there when it was built.
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const contextRef = useRef(context);
  contextRef.current = context;
  // A response landing after the sheet closed, or after a newer request, is dropped.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const current = useTaskStore.getState().tasks.find(t => t.id === taskId);
    if (!current) return;
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    setCameBackEmpty(false);
    // Typed steps are kept across a regenerate, so the model is told about them
    // the same way it's told about subtasks already on the task.
    const own = stepsRef.current.filter(s => s.own);
    try {
      const existing = [
        ...useTaskStore.getState().subtasksOf(current.id).map(t => t.title),
        ...own.map(s => s.title),
      ];
      const result = await suggestSubtasks(current.title, current.notes, existing, contextRef.current);
      if (request !== requestRef.current) return;
      const drafted = result.map(r => ({ key: stepKey(), title: r.title, own: false }));
      setSteps(prev => [...drafted, ...prev.filter(s => s.own)]);
      setAccepted(prev => {
        const next = new Set(own.filter(s => prev.has(s.key)).map(s => s.key));
        drafted.forEach(d => next.add(d.key));
        return next;
      });
      setCameBackEmpty(drafted.length === 0);
    } catch (e) {
      if (request !== requestRef.current) return;
      setSteps(prev => prev.filter(s => s.own));
      setError(describeAIError(e));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [taskId]);

  // Fresh steps each time the sheet opens; cleared on close.
  useEffect(() => {
    if (!visible) {
      requestRef.current += 1;
      setLoading(false);
      setSteps([]);
      setAccepted(new Set());
      setError(null);
      setCameBackEmpty(false);
      setContext('');
      setNewStep('');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggle = (key: string) => {
    haptics.tap();
    setAccepted(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const addOwnStep = () => {
    const title = newStep.trim();
    if (!title) return;
    haptics.tap();
    const step = { key: stepKey(), title, own: true };
    setSteps(prev => [...prev, step]);
    setAccepted(prev => new Set(prev).add(step.key));
    setNewStep('');
  };

  const handleAdd = () => {
    if (!task || accepted.size === 0) return;
    let added = 0;
    steps.forEach(s => {
      if (!accepted.has(s.key)) return;
      if (addSubtask(task.id, s.title)) added += 1;
    });
    // Same guard TemplateSuggestionsSheet makes: a generated list is expensive
    // to get back, so a run that stored none of it keeps the sheet open rather
    // than closing on nothing.
    if (added === 0) {
      haptics.error();
      Alert.alert(
        'Couldn’t add these',
        'This task couldn’t be found, so nothing was saved. Close this, reopen the task and try again.',
      );
      return;
    }
    haptics.success();
    onClose();
  };

  // Same guard TemplateSuggestionsSheet makes: a generated batch of steps is
  // expensive to get back, and typed steps or details are the user's own work,
  // so a swipe-down with any of them on screen asks first.
  const handleCancel = () => {
    const dirty = steps.length > 0 || context.trim() !== '' || newStep.trim() !== '';
    if (!dirty) { onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  const acceptedCount = accepted.size;
  const canAdd = !loading && acceptedCount > 0;
  const hasContext = context.trim() !== '';

  return (
    <SheetModal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={styles.root}>
        <SheetHeader
          title="Break it up"
          icon="sparkles"
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} />}
          right={
            <SheetHeaderButton
              label={acceptedCount > 0 ? `Add ${acceptedCount}` : 'Add'}
              onPress={handleAdd}
              disabled={!canAdd}
            />
          }
        />

        <ScrollView
          ref={keyboardScroll.ref}
          style={styles.scroll}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={colors.purple} />
              <Text style={styles.loadingText}>Working out the steps for “{task?.title ?? 'this task'}”…</Text>
            </View>
          ) : error ? (
            <View style={styles.note}>
              <EmptyNote icon="cloud-offline-outline">
                {`Couldn’t suggest steps. ${error} You can still type your own below.`}
              </EmptyNote>
            </View>
          ) : cameBackEmpty ? (
            <View style={styles.note}>
              <EmptyNote icon="sparkles-outline">
                No new steps came back. Add details below and regenerate, or type your own steps.
              </EmptyNote>
            </View>
          ) : steps.length > 0 ? (
            <Text style={styles.intro}>
              Tap to deselect any you don’t want, then add the rest as subtasks. The first one is meant to be small
              enough to start now.
            </Text>
          ) : null}

          {steps.map((s, i) => {
            const isAccepted = accepted.has(s.key);
            return (
              <TouchableOpacity
                key={s.key}
                style={[styles.row, !isAccepted && styles.rowRejected]}
                onPress={() => toggle(s.key)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isAccepted }}
                accessibilityLabel={s.title}
              >
                <Ionicons
                  name={isAccepted ? 'checkmark-circle' : 'ellipse-outline'}
                  size={24}
                  color={isAccepted ? colors.accent : colors.textTertiary}
                />
                {/* The steps come back in the order they'd be done, so the
                    number is information rather than decoration. */}
                <Text style={styles.rowIndex}>{i + 1}</Text>
                <Text style={[styles.rowTitle, !isAccepted && styles.rowTextRejected]} numberOfLines={2}>
                  {s.title}
                </Text>
              </TouchableOpacity>
            );
          })}

          {/* Typing a step works whatever the request did, so a breakdown the
              model got wrong can be finished by hand. */}
          <View style={styles.addRow}>
            <TextField
              style={[styles.input, styles.addInput]}
              value={newStep}
              onChangeText={setNewStep}
              placeholder="Add your own step"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              blurOnSubmit={false}
              onSubmitEditing={addOwnStep}
              maxLength={TITLE_MAX_LENGTH}
              accessibilityLabel="Add your own step"
            />
            <InlineAction
              label="Add"
              icon="add"
              onPress={addOwnStep}
              disabled={newStep.trim() === ''}
              haptic={false}
            />
          </View>

          <Text style={styles.label}>WHAT THIS TASK MEANS</Text>
          <TextField
            style={[styles.input, styles.contextInput]}
            value={context}
            onChangeText={setContext}
            placeholder="e.g. the reusable grocery bags in the trunk, they smell"
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={500}
            accessibilityLabel="What this task means"
          />
          <Text style={styles.hint}>Sent with Regenerate so the steps match what you mean.</Text>

          <TouchableOpacity
            style={[styles.regenerateBtn, loading && styles.regenerateDisabled]}
            onPress={() => { haptics.tap(); load(); }}
            disabled={loading}
            activeOpacity={interaction.activeOpacity}
          >
            <Ionicons name="refresh" size={16} color={colors.purple} />
            <Text style={styles.regenerateText}>{hasContext ? 'Regenerate with these details' : 'Regenerate'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  scroll: { flex: 1 },
  loading: { alignItems: 'center', padding: spacing.xl, gap: spacing.md },
  note: { paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  loadingText: { color: colors.textSecondary, fontSize: font.md, textAlign: 'center' },
  list: { paddingTop: spacing.md, paddingBottom: 120 },
  intro: {
    color: colors.textTertiary, fontSize: font.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm, lineHeight: lineHeight.sm,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md, marginVertical: spacing.xxs,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  rowRejected: { opacity: 0.55 },
  rowIndex: {
    color: colors.textTertiary, fontSize: font.sm, fontWeight: '600',
    minWidth: 14, textAlign: 'center',
  },
  rowTitle: { flex: 1, color: colors.text, fontSize: font.md },
  rowTextRejected: { textDecorationLine: 'line-through' },
  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.md, marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.bgSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    color: colors.text, fontSize: font.md,
  },
  addInput: { flex: 1 },
  contextInput: { marginHorizontal: spacing.md, minHeight: 72, textAlignVertical: 'top' },
  label: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, letterSpacing: 0.8,
    paddingHorizontal: spacing.md, marginTop: spacing.lg, marginBottom: spacing.xs,
  },
  hint: {
    color: colors.textSecondary, fontSize: font.sm, lineHeight: lineHeight.sm,
    paddingHorizontal: spacing.md, marginTop: spacing.xs,
  },
  regenerateDisabled: { opacity: 0.4 },
  regenerateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    marginTop: spacing.md, paddingVertical: spacing.md,
  },
  regenerateText: { color: colors.purpleText, fontSize: font.md, fontWeight: '500' },
});
