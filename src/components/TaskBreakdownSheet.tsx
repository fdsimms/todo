import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, lineHeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useTaskStore } from '../store/useTaskStore';
import { suggestSubtasks, describeAIError, type SubtaskSuggestion } from '../services/aiSuggestions';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';

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
 */
export function TaskBreakdownSheet({ visible, taskId, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const addSubtask = useTaskStore(s => s.addSubtask);
  const task = useTaskStore(s => s.tasks.find(t => t.id === taskId));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SubtaskSuggestion[]>([]);
  // Indices of accepted suggestions; everything starts accepted.
  const [accepted, setAccepted] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    const current = useTaskStore.getState().tasks.find(t => t.id === taskId);
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      const existing = useTaskStore.getState().subtasksOf(current.id).map(t => t.title);
      const result = await suggestSubtasks(current.title, current.notes, existing);
      setSuggestions(result);
      setAccepted(new Set(result.map((_, i) => i)));
    } catch (e) {
      setSuggestions([]);
      setAccepted(new Set());
      setError(describeAIError(e));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  // Fresh steps each time the sheet opens; cleared on close.
  useEffect(() => {
    if (!visible) {
      setSuggestions([]);
      setAccepted(new Set());
      setError(null);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggle = (i: number) => {
    haptics.tap();
    setAccepted(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleAdd = () => {
    if (!task || accepted.size === 0) return;
    let added = 0;
    suggestions.forEach((s, i) => {
      if (!accepted.has(i)) return;
      if (addSubtask(task.id, s.title)) added += 1;
    });
    // Same guard TemplateSuggestionsSheet makes: a generated list is expensive
    // to get back, so a run that stored none of it keeps the sheet open rather
    // than closing on nothing.
    if (added === 0) {
      haptics.error();
      Alert.alert(
        'Couldn’t add these',
        'This task couldn’t be found, so nothing was saved. Close this and open the task again, then retry.',
      );
      return;
    }
    haptics.success();
    onClose();
  };

  // Same guard TemplateSuggestionsSheet makes: a generated batch of steps is
  // expensive to get back, so a swipe-down with one on screen asks first.
  const handleCancel = () => {
    if (suggestions.length === 0) { onClose(); return; }
    Alert.alert(
      'Discard steps?',
      'The suggested steps will be lost.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  const acceptedCount = accepted.size;
  const canAdd = !loading && acceptedCount > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} />
          <View style={styles.headerTitleWrap}>
            <Ionicons name="sparkles" size={14} color={colors.purple} />
            <Text style={styles.headerTitle}>Break it up</Text>
          </View>
          <SheetHeaderButton
            label={acceptedCount > 0 ? `Add ${acceptedCount}` : 'Add'}
            onPress={handleAdd}
            disabled={!canAdd}
          />
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.purple} />
            <Text style={styles.loadingText}>Working out the steps for “{task?.title ?? 'this task'}”…</Text>
          </View>
        ) : error ? (
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn’t work out the steps"
            subtitle={error}
            actionLabel="Try again"
            onAction={load}
          />
        ) : suggestions.length === 0 ? (
          <EmptyState
            icon="sparkles-outline"
            title="No new steps"
            subtitle="Nothing came back beyond the steps already on this task. Try regenerating."
            actionLabel="Regenerate"
            onAction={load}
          />
        ) : (
          <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
            <Text style={styles.intro}>
              Tap to drop any you don’t want, then add the rest as subtasks. The first one is meant to be small
              enough to start now.
            </Text>
            {suggestions.map((s, i) => {
              const isAccepted = accepted.has(i);
              return (
                <TouchableOpacity
                  key={`${s.title}-${i}`}
                  style={[styles.row, !isAccepted && styles.rowRejected]}
                  onPress={() => toggle(i)}
                  activeOpacity={interaction.activeOpacity}
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

            <TouchableOpacity
              style={styles.regenerateBtn}
              onPress={() => { haptics.tap(); load(); }}
              activeOpacity={interaction.activeOpacity}
            >
              <Ionicons name="refresh" size={16} color={colors.purple} />
              <Text style={styles.regenerateText}>Regenerate</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  loadingText: { color: colors.textSecondary, fontSize: font.md, textAlign: 'center' },
  list: { paddingTop: spacing.md, paddingBottom: 120 },
  intro: {
    color: colors.textTertiary, fontSize: font.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm, lineHeight: lineHeight.sm,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md, marginVertical: 2,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  rowRejected: { opacity: 0.55 },
  rowIndex: {
    color: colors.textTertiary, fontSize: font.sm, fontWeight: '600',
    minWidth: 14, textAlign: 'center',
  },
  rowTitle: { flex: 1, color: colors.text, fontSize: font.md },
  rowTextRejected: { textDecorationLine: 'line-through' },
  regenerateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    marginTop: spacing.lg, paddingVertical: spacing.md,
  },
  regenerateText: { color: colors.purple, fontSize: font.md, fontWeight: '500' },
});
