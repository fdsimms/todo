import React, { useRef, useState, useMemo } from 'react';
import {
  Alert,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore, projectProgress, isProjectPastWindow } from '../store/useProjectStore';
import { useProjectCategoryStore } from '../store/useProjectCategoryStore';
import { groupProjectsByCategory, resolveProjectDrop, type ProjectListItem } from '../utils/projectGrouping';
import { ProjectEditor } from '../components/ProjectEditor';
import { QuickAddProjectModal, type ProjectDraft } from '../components/QuickAddProjectModal';
import { ScreenHeader } from '../components/ScreenHeader';
import { TipHost } from '../components/TipHost';
import { EmptyState } from '../components/EmptyState';
import { Fab, FAB_SIZE, type FabDragHandlers } from '../components/Fab';
import {
  FabDropZone,
  FabDropZoneProvider,
  useFabIntentChannel,
  useFabIntentSelector,
  type FabDropZonesHandle,
  type FabIntentChannel,
} from '../components/FabDropZones';
import {
  categoriesByIndex,
  type DragScroller,
  type DropZone,
  type FabDropIntent,
} from '../utils/fabDrop';
import { ReorderableList, type RowScroller } from '../components/ReorderableList';
import { useScrollToTopOnTabPress } from '../hooks/useScrollToTopOnTabPress';
import { ProgressBar } from '../components/ProgressBar';
import { ProjectsOptionsMenu, type ProjectFilter } from '../components/ProjectsOptionsMenu';
import { ProjectCategoriesSheet } from '../components/ProjectCategoriesSheet';
import { ListBulkBar } from '../components/ListBulkBar';
import { SelectionDot } from '../components/SelectionDot';
import { SwipeableRow } from '../components/SwipeableRow';
import { PaintSelectionProvider, usePaintSelectionRow } from '../components/PaintSelection';
import { useRowSelection } from '../hooks/useRowSelection';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { formatDeadlineDate } from '../utils/dateUtils';
import type { Project } from '../types';

// One date, one shape. This used to render a range and both of its halves
// separately, because a project carried a start date as well — see
// Project.deadline for why the start half is gone.
function deadlineLabel(project: Project): string | null {
  return project.deadline ? `By ${formatDeadlineDate(project.deadline)}` : null;
}

// The add button, naming what a release right now would do.
function AddProjectFabWithDropLabel({
  channel,
  ...props
}: {
  channel: FabIntentChannel;
} & Omit<React.ComponentProps<typeof Fab>, 'dragLabel'>) {
  const label = useFabIntentSelector(channel, intent => {
    if (intent?.kind === 'cancel') return 'Cancel';
    if (intent?.kind !== 'insert') return null;
    return intent.category ? `New project in ${intent.category}` : 'New project here';
  });
  return <Fab {...props} dragLabel={label} />;
}

export function ProjectsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const navigation = useNavigation();
  const projects = useProjectStore(useShallow(s => s.projects));
  const createProject = useProjectStore(s => s.createProject);
  const updateProject = useProjectStore(s => s.updateProject);
  const removeProjectRow = useProjectStore(s => s.removeProjectRow);
  const reorderProjectsWithCategoryUpdates = useProjectStore(s => s.reorderProjectsWithCategoryUpdates);
  const bulkSetProjectCategory = useProjectStore(s => s.bulkSetProjectCategory);
  const bulkDeleteProjects = useTaskStore(s => s.bulkDeleteProjects);
  const bulkSetProjectArchived = useTaskStore(s => s.bulkSetProjectArchived);
  const unarchiveProject = useTaskStore(s => s.unarchiveProject);
  const uncompleteProject = useTaskStore(s => s.uncompleteProject);
  const completeProject = useTaskStore(s => s.completeProject);
  const allTasks = useTaskStore(s => s.tasks);
  const projectCategories = useProjectCategoryStore(useShallow(s => s.categories));
  const addProjectCategory = useProjectCategoryStore(s => s.addCategory);

  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('active');
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [optionsMenuVisible, setOptionsMenuVisible] = useState(false);
  const [categoriesSheetVisible, setCategoriesSheetVisible] = useState(false);
  const [bulkBarHeight, setBulkBarHeight] = useState(0);

  // Also reachable from the header, since both of a project row's own
  // gestures are already spoken for — tap opens the project, long press
  // starts a reorder drag — but swiping a row is the normal entry point
  // every other bulk-selecting list in the app uses, and there's no reason
  // this one should be the odd one out.
  const {
    selectionMode,
    selectedIds,
    enterSelectionMode,
    toggleSelection,
    exitSelection,
    selectAll,
    deselectAll,
    painting,
    paintProps,
  } = useRowSelection();

  // Set while editingProject is one freshly created from quick add's "More
  // details" — discarded on close if it was never given a name.
  const newProjectIdRef = useRef<string | null>(null);

  // A project that's both completed and archived reads as archived — archiving
  // is always the final resting state, so it can't show in two lists at once.
  const visibleProjects = useMemo(
    () => projects.filter(p => {
      if (projectFilter === 'archived') return p.archived;
      if (projectFilter === 'completed') return p.completed && !p.archived;
      return !p.archived && !p.completed;
    }),
    [projects, projectFilter]
  );

  const projectCategoryOrder = useMemo(
    () => [...projectCategories].sort((a, b) => a.sortOrder - b.sortOrder).map(c => c.name),
    [projectCategories]
  );
  const projectListItems = useMemo(
    () => groupProjectsByCategory(visibleProjects, projectCategoryOrder),
    [visibleProjects, projectCategoryOrder]
  );
  const archivedCount = useMemo(() => projects.filter(p => p.archived).length, [projects]);
  const completedCount = useMemo(() => projects.filter(p => p.completed && !p.archived).length, [projects]);

  // Every visible project's progress, computed once per store change rather
  // than once per row per render. `renderRow` called projectProgress inline,
  // and each call filters the whole task list, builds a Map and walks a
  // previousOccurrenceId chain per member — so the list was O(projects × tasks)
  // on every render of the list, not just when the tasks actually moved.
  const progressByProject = useMemo(() => {
    const map = new Map<string, { done: number; total: number }>();
    visibleProjects.forEach(p => map.set(p.id, projectProgress(p.id, allTasks)));
    return map;
  }, [visibleProjects, allTasks]);

  // What the bulk bar offers to file into: the registered categories, plus any
  // name a project still carries that was never registered — the list shows a
  // section for those (see groupProjectsByCategory), so the picker has to name
  // them too or moving a project back into one would mean retyping it.
  const bulkCategoryOptions = useMemo(
    () => Array.from(new Set([
      ...projectCategoryOrder,
      ...projects.map(p => p.category).filter((c): c is string => !!c).sort(),
    ])),
    [projects, projectCategoryOrder]
  );

  // Extra bottom padding so the last rows aren't hidden behind the floating
  // bulk bar, same as the other bulk-selecting screens.
  const selectionListPadding = tabBarHeight + spacing.sm + bulkBarHeight + spacing.sm;

  const handleBulkSetCategory = (category: string | null) => {
    animateLayout();
    bulkSetProjectCategory(Array.from(selectedIds), category);
    exitSelection();
  };

  // Archiving is the reversible half of filing a batch away, so it needs no
  // confirmation — a shake undoes it. In the archived list the same button
  // means the other direction.
  const handleBulkArchive = () => {
    animateLayout();
    bulkSetProjectArchived(Array.from(selectedIds), projectFilter !== 'archived');
    exitSelection();
  };

  // The same question ProjectEditor's own delete asks, and for the same reason:
  // a project's tasks are not the project, and deleting the row is not a
  // request to lose the work filed under it.
  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    const plural = ids.length === 1 ? 'project' : 'projects';
    haptics.warning();
    const run = (cascade: boolean) => {
      animateLayout();
      bulkDeleteProjects(ids, { cascade });
      exitSelection();
    };
    Alert.alert(
      `Delete ${ids.length} ${plural}?`,
      `Their tasks can stay in your list without a project, or be deleted with them. You can undo this by shaking your phone right after.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete projects only', onPress: () => run(false) },
        { text: 'Delete projects and tasks', style: 'destructive', onPress: () => run(true) },
      ],
    );
  };

  // ——— Dragging the add button into the list ———————————————————————————
  //
  // Same gesture as Today's, over the shape this list actually has: no stacks
  // and nothing pinned, so a drop means a category section and a spot in it.
  // The button reports raw pointer positions, FabDropZoneProvider turns those
  // into an intent, and everything below is what each intent means here.

  const dropZonesRef = useRef<FabDropZonesHandle>(null);
  const [fabDragging, setFabDragging] = useState(false);
  // Lets the drag scroll the list once it reaches either end of the screen.
  const scrollControl = useRef<DragScroller | null>(null);
  // Separate from the drag scroller above: this one backs the tab-press
  // gesture, not autoscroll.
  const rowScroller = useRef<RowScroller | null>(null);
  useScrollToTopOnTabPress(rowScroller);
  // What the drag is aimed at goes through a channel rather than state: it
  // changes as the finger crosses each row, and re-rendering this screen
  // re-runs every row's renderItem. Only the button's label reads it.
  const fabIntentChannel = useFabIntentChannel();
  const [quickAddSeed, setQuickAddSeed] = useState<{ category?: string | null } | undefined>(undefined);
  const [quickAddSeedLabel, setQuickAddSeedLabel] = useState<string | null>(null);
  // The drop that opened the sheet, read once when the project comes back.
  const pendingDropRef = useRef<FabDropIntent | null>(null);

  /**
   * Close the quick-add sheet and forget the placement it was opened with.
   * Every path out of the sheet goes through here — cancel, create, and "More
   * details", which closes it without going through onClose. Missing one leaves
   * the placement armed for the next plain tap on the button.
   */
  const closeQuickAdd = () => {
    setQuickAddVisible(false);
    setQuickAddSeed(undefined);
    setQuickAddSeedLabel(null);
    pendingDropRef.current = null;
  };

  const zoneByKey = useMemo(() => {
    const categoriesFor = categoriesByIndex(
      projectListItems.map(item => (item.type === 'header' ? item.label : null)),
    );
    const map = new Map<string, DropZone>();
    projectListItems.forEach((item, i) => {
      map.set(
        item.key,
        item.type === 'header'
          ? { kind: 'header', key: item.key, category: item.label }
          : { kind: 'task', key: item.key, category: categoriesFor[i] ?? null },
      );
    });
    return map;
  }, [projectListItems]);

  /**
   * Give the freshly created project the position it was dropped at.
   *
   * Deliberately the same placement pass a finished row drag runs: splicing the
   * new row into the list at the drop point and handing the result to
   * resolveProjectDrop means the category-from-nearest-header rule and the
   * sortOrder renumber are the ones already in use, not a second copy of them.
   */
  const placeCreatedProject = (project: Project, intent: Extract<FabDropIntent, { kind: 'insert' }>) => {
    // The category the sheet actually committed wins: changing it there means
    // the row belongs in that section, wherever the button happened to land.
    if ((project.category ?? null) !== intent.category) return;
    // projectListItems is this render's grouping, from before the project was
    // created — but drop it if it's there, so splicing can't duplicate the row.
    const base = projectListItems.filter(item => item.type === 'header' || item.project.id !== project.id);
    const anchor = base.findIndex(item => item.key === intent.anchorKey);
    if (anchor < 0) return;

    const spliced: ProjectListItem[] = [...base];
    spliced.splice(intent.before ? anchor : anchor + 1, 0, { type: 'project', project, key: project.id });
    const { projectIds, categoryUpdates } = resolveProjectDrop(spliced, projectCategoryOrder);
    reorderProjectsWithCategoryUpdates(projectIds, categoryUpdates);
  };

  const openQuickAddForDrop = (intent: FabDropIntent) => {
    // Dropped back on the button: the drag is the whole of what happened, so
    // no sheet, and nothing left armed for the next tap (see closeQuickAdd).
    if (intent.kind === 'cancel') {
      pendingDropRef.current = null;
      haptics.tap();
      return;
    }
    pendingDropRef.current = intent;
    if (intent.kind === 'insert') {
      setQuickAddSeed({ category: intent.category });
      setQuickAddSeedLabel(intent.category ?? 'This spot');
    } else {
      setQuickAddSeed(undefined);
      setQuickAddSeedLabel(null);
    }
    setQuickAddVisible(true);
  };

  const handleProjectCreated = (project: Project, placed: boolean) => {
    // A drag of the add button chose where this goes; a plain tap didn't, and
    // shaking the chip off in the sheet takes the choice back.
    const dropped = pendingDropRef.current;
    pendingDropRef.current = null;
    if (placed && dropped?.kind === 'insert') placeCreatedProject(project, dropped);
  };

  // Rebuilt each render so it closes over fresh state; the button reads it
  // through a ref, and its responder is built once regardless.
  const fabDrag: FabDragHandlers = {
    onStart: () => {
      setFabDragging(true);
      dropZonesRef.current?.begin();
    },
    onMove: (pageY, home) => dropZonesRef.current?.moveTo(pageY, home),
    onEnd: (pageY, home) => {
      setFabDragging(false);
      // end()/cancel() publish a null intent themselves, which is what clears
      // the label.
      openQuickAddForDrop(dropZonesRef.current?.end(pageY, home) ?? { kind: 'plain' });
    },
    onCancel: () => {
      setFabDragging(false);
      dropZonesRef.current?.cancel();
    },
  };

  // "More details" hands the draft over to the full editor. Projects have no
  // draft state of their own, so the row is created up front and discarded on
  // close if it never got a name — same trick TodayScreen uses for new stacks.
  const handleQuickAddOpenFull = (draft: ProjectDraft) => {
    // The draft carries the seeded category; only the placement is let go of.
    closeQuickAdd();
    animateLayout();
    const project = createProject(draft.title, draft.deadline);
    if (draft.category) updateProject(project.id, { category: draft.category });
    newProjectIdRef.current = project.id;
    setEditingProject({ ...project, category: draft.category });
  };

  const handleEditorClose = () => {
    const id = newProjectIdRef.current;
    newProjectIdRef.current = null;
    if (id) {
      const current = useProjectStore.getState().getProjectById(id);
      if (current && current.title.trim() === '') {
        animateLayout();
        removeProjectRow(id);
      }
    }
    setEditingProject(null);
  };

  const handleQuickUnarchive = (project: Project) => {
    haptics.tap();
    animateLayout();
    unarchiveProject(project.id);
  };

  const handleQuickUncomplete = (project: Project) => {
    haptics.tap();
    animateLayout();
    uncompleteProject(project.id);
  };

  // Only reachable when projectProgress already reads every member done, so
  // there's nothing left open to ask about archiving — see ProjectEditor's
  // handleComplete for the version that has to.
  const handleQuickComplete = (project: Project) => {
    haptics.success();
    animateLayout();
    completeProject(project.id, { archiveRemaining: false });
  };

  const renderRow = (item: ProjectListItem, drag?: () => void, isActive?: boolean) => {
    if (item.type === 'header') {
      return (
        <View style={styles.categorySectionHeader}>
          <Text style={styles.categorySectionHeaderText}>{item.label}</Text>
        </View>
      );
    }
    const project = item.project;
    const progress = progressByProject.get(project.id) ?? { done: 0, total: 0 };
    const pastWindow = isProjectPastWindow(project, progress);
    const deadlineText = deadlineLabel(project);
    const selected = selectedIds.has(project.id);
    // Only the active list needs this — completed projects already show their
    // own restore affordance, and an archived one is filed away regardless.
    const allDone = projectFilter === 'active' && progress.total > 0 && progress.done === progress.total;
    return (
      <ProjectRow
        project={project}
        progress={progress}
        pastWindow={pastWindow}
        deadlineText={deadlineText}
        projectFilter={projectFilter}
        allDone={allDone}
        selectionMode={selectionMode}
        selected={selected}
        isActive={isActive}
        drag={drag}
        colors={colors}
        styles={styles}
        onPress={() =>
          selectionMode
            ? toggleSelection(project.id)
            : (navigation as any).navigate('ProjectDetail', { projectId: project.id })
        }
        onToggleSelect={() => toggleSelection(project.id)}
        onSwipeSelect={() => enterSelectionMode(project.id)}
        onQuickUnarchive={() => handleQuickUnarchive(project)}
        onQuickUncomplete={() => handleQuickUncomplete(project)}
        onQuickComplete={() => handleQuickComplete(project)}
        onEdit={() => setEditingProject(project)}
      />
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Projects"
        subtitle={visibleProjects.length > 0
          ? projectFilter === 'archived'
            ? `${visibleProjects.length} archived`
            : projectFilter === 'completed'
              ? `${visibleProjects.length} completed`
              : `${visibleProjects.length} active ${visibleProjects.length === 1 ? 'project' : 'projects'}`
          : undefined}
        actions={[
          // Selecting is reached by swiping a row now, same as every other
          // bulk-selecting list — no header button needed.
          // Hidden while selecting: the menu switches which list is on
          // screen, and a selection built from one list committing against
          // another is the one way this bar could act on rows nobody picked.
          ...(selectionMode
            ? []
            : [{
                icon: 'ellipsis-horizontal' as const,
                onPress: () => setOptionsMenuVisible(true),
                active: projectFilter !== 'active',
                accessibilityLabel: 'Project options',
              }]),
        ]}
      />

      <TipHost screen="projects" />

      <PaintSelectionProvider {...paintProps}>
      <FabDropZoneProvider
        ref={dropZonesRef}
        onIntentChange={fabIntentChannel.publish}
        scroller={scrollControl}
      >
      {visibleProjects.length === 0 ? (
        <EmptyState
          icon={projectFilter === 'archived' ? 'archive-outline' : projectFilter === 'completed' ? 'checkmark-circle-outline' : 'briefcase-outline'}
          title={projectFilter === 'archived' ? 'No archived projects' : projectFilter === 'completed' ? 'No completed projects' : 'No projects yet'}
          subtitle={
            projectFilter === 'archived'
              ? 'Projects you archive will show up here'
              : projectFilter === 'completed'
                ? 'Projects you mark complete will show up here'
                : 'Start a themed collection, like a summer bucket list, and pick tasks off it over time'
          }
          actionLabel={projectFilter === 'active' ? 'New project' : undefined}
          onAction={projectFilter === 'active' ? () => setQuickAddVisible(true) : undefined}
          bottomOffset={tabBarHeight}
        />
      ) : (
        <ReorderableList
          data={projectListItems}
          keyExtractor={item => item.key}
          // The user can't scroll during an add-button drag (the button's
          // responder has the touch); the drag scrolls it instead, through the
          // control below. Same while a paint gesture owns the touch — see
          // PaintSelectionProvider.
          scrollEnabled={!fabDragging && !painting}
          scrollControlRef={scrollControl}
          rowScrollerRef={rowScroller}
          contentContainerStyle={styles.list}
          ListFooterComponent={
            <View style={{ height: selectionMode ? selectionListPadding : tabBarHeight + FAB_SIZE + spacing.xl }} />
          }
          placeholderStyle={styles.dropSlot}
          onHoverChange={haptics.dragTick}
          onReorder={reordered => {
            const { projectIds, categoryUpdates } = resolveProjectDrop(reordered, projectCategoryOrder);
            reorderProjectsWithCategoryUpdates(projectIds, categoryUpdates);
          }}
          // Every row doubles as a target for the add button being dragged in.
          // The wrapper only measures — it adds no styling and claims no
          // touches — so a row behaves exactly as it did without one, and the
          // dragged row's floating copy registers nothing (a null zone) rather
          // than claiming the real row's slot under the same key.
          renderItem={({ item, drag, isActive }) => (
            <FabDropZone zone={isActive ? null : zoneByKey.get(item.key) ?? null}>
              {renderRow(item, drag, isActive)}
            </FabDropZone>
          )}
        />
      )}
      </FabDropZoneProvider>
      </PaintSelectionProvider>

      {/* The bulk bar sits where the button does, and adding a project isn't
          something you're doing mid-selection anyway. */}
      {projectFilter === 'active' && !selectionMode && (
        <AddProjectFabWithDropLabel
          channel={fabIntentChannel}
          onPress={() => setQuickAddVisible(true)}
          accessibilityLabel="Add project"
          bottom={insets.bottom + tabBarHeight + spacing.md}
          drag={fabDrag}
          dragHint="Drag onto the list to add a project there, or back to the button to cancel"
        />
      )}

      {selectionMode && (
        <ListBulkBar
          selectedCount={selectedIds.size}
          totalCount={visibleProjects.length}
          category={{
            title: 'Move to Category',
            options: bulkCategoryOptions,
            onSet: handleBulkSetCategory,
            onCreate: name => addProjectCategory(name),
          }}
          actions={[
            {
              key: 'archive',
              icon: projectFilter === 'archived' ? 'arrow-undo' : 'archive',
              label: projectFilter === 'archived' ? 'Restore' : 'Archive',
              onPress: handleBulkArchive,
            },
            { key: 'delete', icon: 'trash', label: 'Delete', tone: 'destructive', onPress: handleBulkDelete },
          ]}
          onSelectAll={() => selectAll(visibleProjects.map(p => p.id))}
          onDeselectAll={deselectAll}
          onCancel={exitSelection}
          bottomInset={tabBarHeight}
          onHeightChange={setBulkBarHeight}
        />
      )}

      <ProjectsOptionsMenu
        visible={optionsMenuVisible}
        onClose={() => setOptionsMenuVisible(false)}
        filter={projectFilter}
        onFilterChange={setProjectFilter}
        completedCount={completedCount}
        archivedCount={archivedCount}
        categoryCount={projectCategories.length}
        onManageCategories={() => setCategoriesSheetVisible(true)}
      />

      <ProjectCategoriesSheet
        visible={categoriesSheetVisible}
        onClose={() => setCategoriesSheetVisible(false)}
      />

      <QuickAddProjectModal
        visible={quickAddVisible}
        onClose={closeQuickAdd}
        onOpenFull={handleQuickAddOpenFull}
        onCreated={handleProjectCreated}
        seed={quickAddSeed}
        seedLabel={quickAddSeedLabel}
      />

      <ProjectEditor
        visible={editingProject !== null}
        project={editingProject}
        isNew={newProjectIdRef.current !== null}
        onClose={handleEditorClose}
      />
    </View>
  );
}

/**
 * Project list row. Swipe left enters bulk selection, same contract as every
 * other list in the app; long press still reorders, and swiping is disabled
 * while a selection is already in progress so it can't fight the drag or the
 * dot. Nothing to reschedule here (a project's deadline isn't a "when" in the
 * SwipeableRow sense — there's no single date being moved), so no
 * `whenAction`.
 */
function ProjectRow({
  project, progress, pastWindow, deadlineText, projectFilter, allDone,
  selectionMode, selected, isActive, drag, colors, styles,
  onPress, onToggleSelect, onSwipeSelect, onQuickUnarchive, onQuickUncomplete, onQuickComplete, onEdit,
}: {
  project: Project;
  progress: { done: number; total: number };
  pastWindow: boolean;
  deadlineText: string | null;
  projectFilter: ProjectFilter;
  allDone: boolean;
  selectionMode: boolean;
  selected: boolean;
  isActive?: boolean;
  drag?: () => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  onPress: () => void;
  onToggleSelect: () => void;
  onSwipeSelect: () => void;
  onQuickUnarchive: () => void;
  onQuickUncomplete: () => void;
  onQuickComplete: () => void;
  onEdit: () => void;
}) {
  // Excluded for the floating drag overlay's copy — it shares the dragged
  // row's id, and registering both would leave the real row's slot evicted
  // the moment the overlay unmounts.
  const paintRef = usePaintSelectionRow(isActive ? null : project.id);

  return (
    <SwipeableRow
      style={styles.projectCard}
      enabled={!selectionMode}
      selectAction={{ onSelect: onSwipeSelect, accessibilityLabel: `Select ${project.title}` }}
    >
      <View ref={paintRef}>
        <TouchableOpacity
          style={[
            styles.projectRow,
            isActive && styles.projectRowActive,
            selectionMode && selected && styles.projectRowSelected,
          ]}
          onPress={onPress}
          // Reordering is off while selecting: the long press that would start a
          // drag is how a mis-tapped row gets picked up instead.
          onLongPress={selectionMode ? undefined : drag}
          delayLongPress={interaction.delayLongPress}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole={selectionMode ? 'checkbox' : 'button'}
          accessibilityState={selectionMode ? { checked: selected } : undefined}
          accessibilityLabel={`${project.title}, ${progress.done} of ${progress.total} done`}
          accessibilityHint={
            selectionMode
              ? 'Double tap to select project'
              : 'Double tap to view tasks in this project. Long press to reorder.'
          }
        >
          <View style={styles.projectInfo}>
            <View style={styles.projectTitleRow}>
              {/* No list/project glyph here — Project.kind is a view filter on
                  the project's own screen, not something worth surfacing on
                  this list. Lists and projects still share the category order
                  the user arranged. */}
              <Text style={styles.projectName} numberOfLines={1}>{project.title}</Text>
              {/* Nothing a row can do to itself while a selection is being
                  built — each of these acts on one project and would fight the
                  bar. The dot takes the slot they vacate, which is the trailing
                  edge every selectable row in the app puts it on. */}
              {selectionMode ? (
                <SelectionDot selected={selected} onPress={onToggleSelect} />
              ) : (
                <>
                {projectFilter === 'archived' && (
                  <TouchableOpacity
                    onPress={onQuickUnarchive}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Unarchive ${project.title}`}
                  >
                    <Ionicons name="arrow-undo-outline" size={16} color={colors.accent} />
                  </TouchableOpacity>
                )}
                {projectFilter === 'completed' && (
                  <TouchableOpacity
                    onPress={onQuickUncomplete}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Restore ${project.title} to active`}
                  >
                    <Ionicons name="arrow-undo-outline" size={16} color={colors.accent} />
                  </TouchableOpacity>
                )}
                {allDone && (
                  <TouchableOpacity
                    onPress={onQuickComplete}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Mark ${project.title} complete: every task is done`}
                  >
                    <Ionicons name="checkmark-circle" size={16} color={colors.green} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={onEdit}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${project.title}`}
                >
                  <Ionicons name="ellipsis-horizontal" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
                </>
              )}
            </View>
            {progress.total > 0 && (
              <View style={styles.progressRow}>
                <View style={styles.progressBarWrap}>
                  <ProgressBar progress={progress.done / progress.total} />
                </View>
                <Text style={styles.progressText}>{progress.done}/{progress.total}</Text>
              </View>
            )}
            {deadlineText && (
              <Text style={[styles.rangeText, pastWindow && { color: colors.orange }]} numberOfLines={1}>
                {pastWindow ? `Overdue · ${deadlineText}` : deadlineText}
              </Text>
            )}
          </View>
        </TouchableOpacity>
      </View>
    </SwipeableRow>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  list: {
    paddingTop: spacing.sm,
  },
  categorySectionHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  categorySectionHeaderText: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  // The card's margin and radius live here, on SwipeableRow's own `style`
  // prop, rather than on the row below — see the note on SwipeableRow for why
  // a rounded row leaves its revealed panel square-cornered behind it.
  projectCard: {
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
  },
  // Flush, so it slides over the swipe panel rather than beside it.
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: spacing.md,
  },
  projectRowActive: {
    backgroundColor: colors.bgTertiary,
  },
  projectRowSelected: {
    backgroundColor: colors.accentSubtle,
  },
  dropSlot: {
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    opacity: 0.55,
  },
  projectInfo: {
    flex: 1,
    gap: 6,
  },
  projectTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  projectName: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressBarWrap: {
    flex: 1,
  },
  progressText: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  rangeText: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  detailRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  detailTitleText: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  detailFooter: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  completedSection: {
    paddingBottom: spacing.sm,
  },
  completedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  completedToggleText: {
    color: colors.textTertiary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    paddingVertical: 0,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  pickerRowText: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
  },
});
