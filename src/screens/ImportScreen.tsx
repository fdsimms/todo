import React, { useState, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, type Colors } from '../theme';
import { parseTaskPaper, type ParsedTask, type ParsedProject } from '../utils/taskpaperParser';
import { generateId } from '../utils/id';
import type { Task } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type ScreenState = 'idle' | 'loading' | 'preview' | 'importing' | 'success' | 'error';

interface ImportSummary {
  projectCount: number;
  taskCount: number;
  completedCount: number;
  recurringCount: number;
}

interface ImportResult {
  insertedTaskIds: string[];
  insertedProjectIds: string[];
  skippedCount: number;
  importedCount: number;
}

function buildSummary(
  projects: ParsedProject[],
  inboxTasks: ParsedTask[],
  skipCompleted: boolean,
): ImportSummary {
  let taskCount = 0;
  let completedCount = 0;
  let recurringCount = 0;

  const countTask = (t: ParsedTask) => {
    if (t.completedAt) completedCount++;
    if (t.isRecurring) recurringCount++;
    if (!skipCompleted || !t.completedAt) {
      taskCount++;
      taskCount += t.checklistItems.length;
    }
  };

  for (const p of projects) p.tasks.forEach(countTask);
  inboxTasks.forEach(countTask);

  return { projectCount: projects.length, taskCount, completedCount, recurringCount };
}

export function ImportScreen({ visible, onClose }: Props) {
  const [state, setState] = useState<ScreenState>('idle');
  const [skipCompleted, setSkipCompleted] = useState(true);
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<{ projects: ParsedProject[]; inboxTasks: ParsedTask[] } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const { tasks: existingTasks, bulkInsertTasks } = useTaskStore();
  const { projects: existingProjects, addProject } = useProjectStore();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const summary = useMemo(() => {
    if (!parsed) return null;
    return buildSummary(parsed.projects, parsed.inboxTasks, skipCompleted);
  }, [parsed, skipCompleted]);

  function reset() {
    setState('idle');
    setParsed(null);
    setResult(null);
    setError('');
  }

  async function pickFile() {
    setState('loading');
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['public.plain-text', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) {
        setState('idle');
        return;
      }
      const uri = res.assets[0].uri;
      const content = await FileSystem.readAsStringAsync(uri);
      const { projects, inboxTasks } = parseTaskPaper(content);
      setParsed({ projects, inboxTasks });
      setState('preview');
    } catch (e) {
      setError(String(e));
      setState('error');
    }
  }

  function doImport() {
    if (!parsed) return;
    setState('importing');

    try {
      const now = new Date().toISOString();
      const insertedTaskIds: string[] = [];
      const insertedProjectIds: string[] = [];
      let skippedCount = 0;

      // Build a set of (title, projectId) for duplicate detection
      const existingKey = (title: string, projectId: string | null) =>
        `${projectId ?? ''}::${title.toLowerCase()}`;
      const existingKeys = new Set(
        existingTasks.map(t => existingKey(t.title, t.projectId))
      );

      // Resolve or create a project by name; returns projectId
      const maxProjectOrder = existingProjects.reduce((m, p) => Math.max(m, p.order), 0);
      const projectMap = new Map<string, string>(); // name → id

      function resolveProject(name: string, idx: number): string {
        if (projectMap.has(name)) return projectMap.get(name)!;
        const existing = existingProjects.find(
          p => p.name.toLowerCase() === name.toLowerCase()
        );
        if (existing) {
          projectMap.set(name, existing.id);
          return existing.id;
        }
        const created = addProject({
          name,
          notes: '',
          dueDate: null,
          color: '#0A84FF',
          order: maxProjectOrder + idx + 1,
        });
        projectMap.set(name, created.id);
        insertedProjectIds.push(created.id);
        return created.id;
      }

      const maxTaskOrder = existingTasks.reduce((m, t) => Math.max(m, t.sortOrder), 0);
      let orderCounter = maxTaskOrder;

      function buildTask(
        pt: ParsedTask,
        projectId: string | null,
        parentId: string | null,
      ): Task {
        orderCounter += 1;
        return {
          id: generateId(),
          title: pt.title,
          notes: pt.notes,
          completed: !!pt.completedAt,
          completedAt: pt.completedAt ?? null,
          createdAt: now,
          dueDate: pt.dueDate ?? null,
          deferUntil: pt.deferUntil ?? null,
          timeOfDay: pt.timeOfDay ?? null,
          recurrenceType: 'none',
          recurrenceInterval: 1,
          recurrenceDays: [],
          recurrenceEndDate: null,
          recurrenceFromCompletion: false,
          tags: [
            ...pt.tags,
            ...(pt.areaTag ? [pt.areaTag] : []),
          ],
          sortOrder: orderCounter,
          focused: false,
          someday: pt.someday,
          priority: 0,
          effort: 0,
          streakCount: 0,
          streakDate: null,
          parentId,
          reminderTime: null,
          cycleEnabled: false,
          cycleIndex: 0,
          cycleItems: [],
          projectId,
          heading: pt.heading ?? null,
          needsReview: true,
        };
      }

      const tasksToInsert: Task[] = [];

      function processTask(pt: ParsedTask, projectId: string | null) {
        if (skipCompleted && pt.completedAt) { skippedCount++; return; }
        const key = existingKey(pt.title, projectId);
        if (existingKeys.has(key)) { skippedCount++; return; }
        existingKeys.add(key);

        const task = buildTask(pt, projectId, null);
        tasksToInsert.push(task);
        insertedTaskIds.push(task.id);

        for (const ci of pt.checklistItems) {
          const subtask = buildTask({ ...ci, tags: [], dueDate: null, deferUntil: null,
            completedAt: null, someday: false, timeOfDay: null, isRecurring: false,
            heading: null, checklistItems: [], notes: '', areaTag: null }, projectId, task.id);
          tasksToInsert.push(subtask);
          insertedTaskIds.push(subtask.id);
        }
      }

      parsed.projects.forEach((p, idx) => {
        const projectId = resolveProject(p.name, idx);
        p.tasks.forEach(t => processTask(t, projectId));
      });
      parsed.inboxTasks.forEach(t => processTask(t, null));

      bulkInsertTasks(tasksToInsert);

      setResult({
        insertedTaskIds,
        insertedProjectIds,
        skippedCount,
        importedCount: tasksToInsert.length,
      });
      setState('success');
    } catch (e) {
      setError(String(e));
      setState('error');
    }
  }

  function undoImport() {
    if (!result) return;
    const { bulkDeleteTasks } = useTaskStore.getState();
    const { deleteProject } = useProjectStore.getState();
    bulkDeleteTasks(result.insertedTaskIds);
    result.insertedProjectIds.forEach(id => deleteProject(id));
    reset();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => { reset(); onClose(); }}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={{ width: 44 }} />
          <Text style={styles.title}>Import</Text>
          <TouchableOpacity
            onPress={() => { reset(); onClose(); }}
            hitSlop={8}
            style={styles.doneBtn}
          >
            <Text style={styles.done}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {(state === 'idle' || state === 'loading') && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Things 3</Text>
              <View style={styles.card}>
                <TouchableOpacity
                  style={styles.row}
                  onPress={pickFile}
                  disabled={state === 'loading'}
                >
                  <Ionicons name="download-outline" size={20} color={colors.accent} />
                  <Text style={styles.rowLabel}>Import from Things 3…</Text>
                  {state === 'loading'
                    ? <ActivityIndicator size="small" color={colors.accent} />
                    : <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                  }
                </TouchableOpacity>
              </View>
              <Text style={styles.hint}>
                Export from Things 3 on Mac via File › Export › TaskPaper, then transfer the file to your device via AirDrop or iCloud Drive.
              </Text>
            </View>
          )}

          {state === 'preview' && summary && (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Preview</Text>
                <View style={styles.card}>
                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>Projects</Text>
                    <Text style={styles.statValue}>{summary.projectCount}</Text>
                  </View>
                  <View style={styles.sep} />
                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>Tasks to import</Text>
                    <Text style={styles.statValue}>{summary.taskCount}</Text>
                  </View>
                  {summary.completedCount > 0 && (
                    <>
                      <View style={styles.sep} />
                      <View style={styles.statRow}>
                        <Text style={styles.statLabel}>Completed tasks</Text>
                        <Text style={styles.statValue}>{summary.completedCount}</Text>
                      </View>
                    </>
                  )}
                  {summary.recurringCount > 0 && (
                    <>
                      <View style={styles.sep} />
                      <View style={styles.statRow}>
                        <Text style={[styles.statLabel, { flex: 1 }]}>Recurring tasks</Text>
                        <Text style={[styles.statValue, { color: colors.textSecondary, fontSize: font.sm }]}>
                          needs review
                        </Text>
                      </View>
                    </>
                  )}
                </View>
              </View>

              {summary.completedCount > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Options</Text>
                  <View style={styles.card}>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>Skip completed tasks</Text>
                      <Switch
                        value={skipCompleted}
                        onValueChange={setSkipCompleted}
                        trackColor={{ true: colors.accent }}
                      />
                    </View>
                  </View>
                </View>
              )}

              <View style={styles.section}>
                <TouchableOpacity style={[styles.btn, { backgroundColor: colors.accent }]} onPress={doImport}>
                  <Text style={[styles.btnText, { color: '#fff' }]}>Import {summary.taskCount} Tasks</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={reset}>
                  <Text style={[styles.btnText, { color: colors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {state === 'importing' && (
            <View style={styles.centred}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>Importing…</Text>
            </View>
          )}

          {state === 'success' && result && (
            <>
              <View style={styles.centred}>
                <Ionicons name="checkmark-circle" size={56} color={colors.accent} />
                <Text style={styles.successTitle}>Import complete</Text>
                <Text style={styles.successSub}>
                  {result.importedCount} task{result.importedCount !== 1 ? 's' : ''} imported
                  {result.skippedCount > 0 ? `, ${result.skippedCount} skipped` : ''}
                </Text>
                {result.insertedProjectIds.length > 0 && (
                  <Text style={styles.successSub}>
                    {result.insertedProjectIds.length} new project{result.insertedProjectIds.length !== 1 ? 's' : ''} created
                  </Text>
                )}
              </View>
              <View style={styles.section}>
                <Text style={styles.hint}>
                  Each imported task has an "Imported" badge — tap it to dismiss once you've reviewed the task. Recurring tasks will need their recurrence schedule set manually.
                </Text>
              </View>
              <View style={styles.section}>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: colors.accent }]}
                  onPress={() => { reset(); onClose(); }}
                >
                  <Text style={[styles.btnText, { color: '#fff' }]}>Done</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnDestructive]}
                  onPress={undoImport}
                >
                  <Text style={[styles.btnText, { color: colors.red }]}>Undo Import</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {state === 'error' && (
            <>
              <View style={styles.centred}>
                <Ionicons name="alert-circle" size={56} color={colors.red} />
                <Text style={styles.successTitle}>Import failed</Text>
                <Text style={[styles.successSub, { color: colors.textSecondary }]}>{error}</Text>
              </View>
              <View style={styles.section}>
                <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={reset}>
                  <Text style={[styles.btnText, { color: colors.textSecondary }]}>Try again</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
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
  title: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  doneBtn: { width: 44, alignItems: 'flex-end' },
  done: { color: colors.accent, fontSize: font.md, fontWeight: '600' },
  body: { paddingBottom: spacing.xl * 2 },
  section: { paddingHorizontal: spacing.md, marginTop: spacing.xl },
  sectionLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: spacing.sm, paddingHorizontal: spacing.sm,
  },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  rowLabel: { color: colors.text, fontSize: font.md, flex: 1 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  hint: {
    color: colors.textTertiary, fontSize: font.sm, lineHeight: 19,
    paddingHorizontal: spacing.sm, marginTop: spacing.sm,
  },
  statRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: 13,
  },
  statLabel: { color: colors.text, fontSize: font.md },
  statValue: { color: colors.accent, fontSize: font.md, fontWeight: '600' },
  btn: {
    borderRadius: radius.md, paddingVertical: 14,
    alignItems: 'center', marginBottom: spacing.sm,
  },
  btnSecondary: { backgroundColor: colors.bgSecondary },
  btnDestructive: { backgroundColor: colors.bgSecondary },
  btnText: { fontSize: font.md, fontWeight: '600' },
  centred: { alignItems: 'center', paddingVertical: spacing.xl * 2, gap: spacing.sm },
  successTitle: { color: colors.text, fontSize: font.lg, fontWeight: '700', marginTop: spacing.sm },
  successSub: { color: colors.textSecondary, fontSize: font.md },
  loadingText: { color: colors.textSecondary, fontSize: font.md, marginTop: spacing.md },
});
