import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, lineHeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useTaskStore } from '../store/useTaskStore';
import { dbTransaction } from '../db/database';
import { EmptyState } from './EmptyState';
import { suggestProjectTasks, describeAIError, type ProjectTaskSuggestion } from '../services/aiSuggestions';
import { SheetHeaderButton } from './SheetHeaderButton';

interface Props {
  visible: boolean;
  projectId: string | null;
  projectTitle: string;
  /** The project's own notes field, sent as the project's description. */
  projectNotes: string;
  /** Titles already in the project, so the AI doesn't suggest duplicates. */
  existingTitles: string[];
  onClose: () => void;
}

/**
 * AI-assisted task picker for a project: generates a list of candidate tasks
 * from the project's title and notes (its description), lets the user toggle
 * each one accepted or rejected, then adds the accepted ones to the project.
 * Modelled directly on TemplateSuggestionsSheet.
 */
export function ProjectTaskSuggestionsSheet({ visible, projectId, projectTitle, projectNotes, existingTitles, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const addTask = useTaskStore(s => s.addTask);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ProjectTaskSuggestion[]>([]);
  // Indices of accepted suggestions; everything starts accepted.
  const [accepted, setAccepted] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await suggestProjectTasks(projectTitle, projectNotes, existingTitles);
      setSuggestions(result);
      setAccepted(new Set(result.map((_, i) => i)));
    } catch (e) {
      setSuggestions([]);
      setAccepted(new Set());
      setError(describeAIError(e));
    } finally {
      setLoading(false);
    }
    // projectTitle/projectNotes/existingTitles are read at call time; the
    // sheet only fires this when it opens or on an explicit regenerate, so
    // they need not be deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectTitle]);

  // Generate fresh suggestions each time the sheet opens; clear on close.
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
    if (!projectId || accepted.size === 0) return;
    dbTransaction(() => {
      suggestions.forEach((s, i) => {
        if (!accepted.has(i)) return;
        addTask({ title: s.title, notes: s.notes, projectId });
      });
    });
    haptics.success();
    onClose();
  };

  const acceptedCount = accepted.size;
  const canAdd = !loading && acceptedCount > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} />
          <View style={styles.headerTitleWrap}>
            <Ionicons name="sparkles" size={14} color={colors.purple} />
            <Text style={styles.headerTitle}>Suggested tasks</Text>
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
            <Text style={styles.loadingText}>Generating tasks for “{projectTitle}”…</Text>
          </View>
        ) : error ? (
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn’t generate suggestions"
            subtitle={error}
            actionLabel="Try again"
            onAction={load}
          />
        ) : suggestions.length === 0 ? (
          <EmptyState
            icon="sparkles-outline"
            title="No new suggestions"
            subtitle="The AI didn’t come up with anything beyond what’s already here. Try regenerating."
            actionLabel="Regenerate"
            onAction={load}
          />
        ) : (
          <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
            <Text style={styles.intro}>
              Tap to deselect any you don’t want, then add the rest to your project.
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
                  <View style={styles.rowInfo}>
                    <Text style={[styles.rowTitle, !isAccepted && styles.rowTextRejected]} numberOfLines={2}>
                      {s.title}
                    </Text>
                    {!!s.notes && (
                      <Text style={[styles.rowNotes, !isAccepted && styles.rowTextRejected]} numberOfLines={2}>
                        {s.notes}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity style={styles.regenerateBtn} onPress={() => { haptics.tap(); load(); }} activeOpacity={interaction.activeOpacity}>
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
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md, marginVertical: 2,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  rowRejected: { opacity: 0.55 },
  rowInfo: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontSize: font.md },
  rowNotes: { color: colors.textTertiary, fontSize: font.sm },
  rowTextRejected: { textDecorationLine: 'line-through' },
  regenerateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    marginTop: spacing.lg, paddingVertical: spacing.md,
  },
  regenerateText: { color: colors.purple, fontSize: font.md, fontWeight: '500' },
});
