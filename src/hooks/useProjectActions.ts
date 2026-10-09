import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { templateFromProject } from '../utils/projectTemplate';
import { haptics } from '../utils/haptics';
import type { Project } from '../types';

interface Options {
  /** The name as it reads on screen right now (the editor's title may be mid-edit). */
  displayTitle?: () => string;
  /**
   * Runs before an action reads or changes the project. The editor passes its
   * `commitEdits` so what is reused or filed away is what is on its screen.
   */
  prepare?: () => void;
  /** After Mark complete, Archive or Start a fresh copy. The editor closes here. */
  onEnded?: () => void;
  /** After a delete. The editor closes; the project page leaves on its own. */
  onDeleted?: () => void;
}

/**
 * The one-shot actions on a project: finish it, file it away, reuse it, delete
 * it. Both homes call this (the editor's action cards and the project page's
 * "..." menu), so the confirms and what each one does can't drift apart.
 */
export function useProjectActions(project: Project | null, options: Options = {}) {
  const navigation = useNavigation();
  const archiveProject = useTaskStore(s => s.archiveProject);
  const unarchiveProject = useTaskStore(s => s.unarchiveProject);
  const completeProject = useTaskStore(s => s.completeProject);
  const uncompleteProject = useTaskStore(s => s.uncompleteProject);
  const deleteProject = useTaskStore(s => s.deleteProject);
  const startFreshFromProject = useTaskStore(s => s.startFreshFromProject);
  const addTemplateFromProject = useTemplateStore(s => s.addTemplateFromProject);

  const isList = project?.kind === 'list';
  const { prepare, onEnded, onDeleted } = options;
  const displayTitle = () =>
    options.displayTitle?.() || project?.title || (isList ? 'this list' : 'this project');

  const confirmDelete = () => {
    if (!project) return;
    Alert.alert(
      `Delete "${displayTitle()}"?`,
      isList
        ? 'Its items can stay as tasks without a list, or be deleted with it.'
        : 'Its tasks can stay in your list without a project, or be deleted with it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: isList ? 'Delete list only' : 'Delete project only', onPress: () => { deleteProject(project.id, { cascade: false }); onDeleted?.(); } },
        {
          text: isList ? 'Delete list and items' : 'Delete project and tasks',
          style: 'destructive',
          onPress: () => { deleteProject(project.id, { cascade: true }); onDeleted?.(); },
        },
      ],
    );
  };

  const complete = () => {
    if (!project) return;
    // Read at the moment of asking rather than subscribed to: nothing here
    // needs the task list, and a subscription re-rendered the host on every
    // task write anywhere in the app.
    const remaining = useTaskStore.getState().tasks.filter(
      t => t.projectId === project.id && t.parentId === null && !t.completed && !t.archived
    );
    const finish = (archiveRemaining: boolean) => {
      haptics.success();
      prepare?.();
      completeProject(project.id, { archiveRemaining });
      onEnded?.();
    };
    if (remaining.length === 0) {
      finish(false);
      return;
    }
    Alert.alert(
      `Complete "${displayTitle()}"?`,
      `It still has ${remaining.length} open ${remaining.length === 1 ? 'task' : 'tasks'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave remaining tasks', onPress: () => finish(false) },
        { text: 'Archive remaining tasks', onPress: () => finish(true) },
      ],
    );
  };

  const archive = () => {
    if (!project) return;
    haptics.success();
    prepare?.();
    archiveProject(project.id);
    onEnded?.();
  };

  // Reopening and unarchiving only flip the flag underneath; the host stays.
  const reopen = () => {
    if (!project) return;
    haptics.tap();
    uncompleteProject(project.id);
  };

  const unarchive = () => {
    if (!project) return;
    haptics.tap();
    unarchiveProject(project.id);
  };

  // Reusing a project, for the next party or the next trip: as a template to
  // apply whenever, or as a fresh copy straight away. Both save what's on
  // screen first (`prepare`), so what's reused is what the person sees.
  const saveAsTemplate = () => {
    if (!project) return;
    prepare?.();
    const saved = useProjectStore.getState().getProjectById(project.id) ?? project;
    const draft = templateFromProject(
      saved,
      useTaskStore.getState().tasks,
      useTaskGroupStore.getState().groups,
      useSettingsStore.getState().dayResetTime,
    );
    addTemplateFromProject(draft);
    haptics.success();
    Alert.alert(
      'Saved as a template',
      `"${draft.name}" is in Templates with its ${draft.items.length} ${draft.items.length === 1 ? 'task' : 'tasks'}${
        saved.awayStart ? ', dated from the day you leave' : saved.eventDate ? ', dated from the event date' : saved.deadline ? ', dated from the deadline' : ''
      }. Apply it from any project's add button, or from Templates.`,
    );
  };

  const startFresh = () => {
    if (!project) return;
    Alert.alert(
      'Start a fresh copy?',
      isList
        ? 'Makes a new list with the same items, all unchecked. This one stays as it is.'
        : 'Makes a new project with the same tasks and sections, all open again and with no dates. This one stays as it is.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start fresh',
          onPress: () => {
            prepare?.();
            const copy = startFreshFromProject(project.id);
            if (!copy) return;
            haptics.success();
            onEnded?.();
            (navigation as any).navigate('ProjectDetail', { projectId: copy.id });
          },
        },
      ],
    );
  };

  return { complete, archive, reopen, unarchive, saveAsTemplate, startFresh, confirmDelete };
}
