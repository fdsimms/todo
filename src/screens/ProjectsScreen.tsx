import React, { useRef, useState, useMemo, useCallback } from 'react';
import {
  Alert,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  type GestureResponderEvent,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore, projectProgress, isProjectPastWindow } from '../store/useProjectStore';
import { useProjectCategoryStore } from '../store/useProjectCategoryStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
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
import type { CardAnchor } from '../components/CardSheet';
import { ProjectCategoriesSheet } from '../components/ProjectCategoriesSheet';
import { ListBulkBar } from '../components/ListBulkBar';
import { SelectionDot } from '../components/SelectionDot';
import { SwipeableRow } from '../components/SwipeableRow';
import { SwipeActionButtons } from '../components/SwipeActionButtons';
import { PaintSelectionProvider, usePaintSelectionRow } from '../components/PaintSelection';
import { useRowSelection } from '../hooks/useRowSelection';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, flattenOverlay, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { ScreenSettingsSheet } from '../components/ScreenSettingsSheet';
import { useScreenSettings } from '../hooks/useScreenSettings';
import { animateLayout } from '../utils/layoutAnimation';
import {
  projectCardCaption,
  projectMatchesQuery,
  projectNextStepTitle,
  projectListPreview,
  projectProgressNote,
  sortProjects,
} from '../utils/projectList';
import { useSettingsStore } from '../store/useSettingsStore';
import { SearchField } from '../components/SearchField';
import { useFilterField } from '../hooks/useFilterField';
import { useLogicalDayKey } from '../hooks/useLogicalDayKey';
import type { Project } from '../types';
import { LazySheet } from '../components/LazySheet';

/**
 * How many projects a list holds before it grows a search bar. Below this the
 * whole list fits on a screen or two and a bar is one more thing to scroll
 * past; the bar also stays while a query is typed, however few are left.
 */
const SEARCH_BAR_MIN_PROJECTS = 8;

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
  // The page's own settings, from the last row of its "…" menu. See SCREEN_SETTINGS.
  const screenSettings = useScreenSettings('Projects', 'Project settings');
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const navigation = useNavigation();
  const projects = useProjectStore(useShallow(s => s.projects));
  const createProject = useProjectStore(s => s.createProject);
  const removeProjectRow = useProjectStore(s => s.removeProjectRow);
  const reorderProjectsWithCategoryUpdates = useProjectStore(s => s.reorderProjectsWithCategoryUpdates);
  const bulkSetProjectCategory = useProjectStore(s => s.bulkSetProjectCategory);
  const bulkDeleteProjects = useTaskStore(s => s.bulkDeleteProjects);
  const bulkSetProjectArchived = useTaskStore(s => s.bulkSetProjectArchived);
  const unarchiveProject = useTaskStore(s => s.unarchiveProject);
  const uncompleteProject = useTaskStore(s => s.uncompleteProject);
  const completeProject = useTaskStore(s => s.completeProject);
  const allTasks = useTaskStore(s => s.tasks);
  const taskGroups = useTaskGroupStore(useShallow(s => s.groups));
  const projectCategories = useProjectCategoryStore(useShallow(s => s.categories));
  const addProjectCategory = useProjectCategoryStore(s => s.addCategory);
  const projectSort = useSettingsStore(s => s.projectSortOption);
  const setProjectSort = useSettingsStore(s => s.setProjectSortOption);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const hideListPreviews = useSettingsStore(s => s.hideListPreviews);
  const hideNextStep = useSettingsStore(s => s.hideNextStep);
  // Re-renders the list when the day rolls over, so a card's "Due tomorrow"
  // becomes "Due today" without waiting for some unrelated store write.
  useLogicalDayKey();
  const search = useFilterField();
  const query = search.query.trim();

  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('active');
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [optionsMenuVisible, setOptionsMenuVisible] = useState(false);
  const [optionsMenuAnchor, setOptionsMenuAnchor] = useState<CardAnchor | null>(null);
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
  const listProjects = useMemo(
    () => projects.filter(p => {
      if (projectFilter === 'archived') return p.archived;
      if (projectFilter === 'completed') return p.completed && !p.archived;
      return !p.archived && !p.completed;
    }),
    [projects, projectFilter]
  );

  // Every listed project's progress, computed once per store change rather
  // than once per row per render. `renderRow` called projectProgress inline,
  // and each call filters the whole task list, builds a Map and walks a
  // previousOccurrenceId chain per member — so the list was O(projects × tasks)
  // on every render of the list, not just when the tasks actually moved. The
  // next step's title rides the same pass.
  const cardFactsByProject = useMemo(() => {
    const map = new Map<string, { progress: { done: number; total: number }; next: string | null; preview: string | null }>();
    listProjects.forEach(p => map.set(p.id, {
      progress: projectProgress(p.id, allTasks),
      // Not for a list: "Next" reads as an order to work in, and a list of
      // books or gift ideas has none.
      next: projectFilter === 'active' && p.kind !== 'list' && !hideNextStep ? projectNextStepTitle(p.id, allTasks, taskGroups, p.inOrder) : null,
      // A list shows its first lines instead, which is what it's for.
      preview: projectFilter === 'active' && p.kind === 'list' && !hideListPreviews
        ? projectListPreview(p.id, allTasks, taskGroups).join(', ') || null
        : null,
    }));
    return map;
  }, [listProjects, allTasks, projectFilter, taskGroups, hideListPreviews, hideNextStep]);
  const progressByProject = useMemo(
    () => new Map(Array.from(cardFactsByProject, ([id, facts]) => [id, facts.progress])),
    [cardFactsByProject]
  );

  // Searched, then sorted, then grouped. The search reads open task titles
  // too, so "passport" finds the trip it's filed under.
  const visibleProjects = useMemo(() => {
    let matched = listProjects;
    if (query) {
      const openTitles = new Map<string, string[]>();
      for (const t of allTasks) {
        if (!t.projectId || t.parentId !== null || t.completed || t.archived) continue;
        const titles = openTitles.get(t.projectId);
        if (titles) titles.push(t.title);
        else openTitles.set(t.projectId, [t.title]);
      }
      matched = listProjects.filter(p => projectMatchesQuery(p, openTitles.get(p.id) ?? [], query));
    }
    return sortProjects(matched, projectSort, progressByProject);
  }, [listProjects, query, allTasks, projectSort, progressByProject]);

  // A drag writes the hand-set order, so it's only offered while that's the
  // order on screen and nothing is filtered out of it: dropping a row between
  // two search results, or into a list sorted by name, would put it somewhere
  // the person can't see.
  const canReorder = projectSort === 'manual' && !query;
  const showSearch = listProjects.length >= SEARCH_BAR_MIN_PROJECTS || search.query.length > 0;

  const projectCategoryOrder = useMemo(
    () => [...projectCategories].sort((a, b) => a.sortOrder - b.sortOrder).map(c => c.name),
    [projectCategories]
  );
  const projectListItems = useMemo(
    () => groupProjectsByCategory(visibleProjects, projectCategoryOrder),
    [visibleProjects, projectCategoryOrder]
  );
  // How many projects sit under each heading, as listed right now (the search
  // and the list filter included), for the count beside it.
  const sectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let heading: string | null = null;
    for (const item of projectListItems) {
      if (item.type === 'header') { heading = item.label; continue; }
      if (heading !== null) counts.set(heading, (counts.get(heading) ?? 0) + 1);
    }
    return counts;
  }, [projectListItems]);
  const archivedCount = useMemo(() => projects.filter(p => p.archived).length, [projects]);
  const completedCount = useMemo(() => projects.filter(p => p.completed && !p.archived).length, [projects]);

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
    const their = ids.length === 1 ? 'Its' : 'Their';
    const them = ids.length === 1 ? 'it' : 'them';
    haptics.warning();
    const run = (cascade: boolean) => {
      animateLayout();
      bulkDeleteProjects(ids, { cascade });
      exitSelection();
    };
    Alert.alert(
      `Delete ${ids.length} ${plural}?`,
      `${their} tasks can stay in your list without a project, or be deleted with ${them}. You can undo this by shaking your phone right after.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Delete ${plural} only`, onPress: () => run(false) },
        { text: `Delete ${plural} and tasks`, style: 'destructive', onPress: () => run(true) },
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
    (navigation as any).navigate('ProjectDetail', { projectId: project.id });
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
    const created = createProject(draft.title, {
      deadline: draft.deadline,
      category: draft.category,
      awayStart: draft.awayStart ?? null,
      kind: draft.asList ? 'list' : 'project',
      planning: draft.planning,
    });
    const project = useProjectStore.getState().getProjectById(created.id) ?? created;
    newProjectIdRef.current = project.id;
    setEditingProject(project);
  };

  // A project made for "More details" is kept only if it was saved with a
  // name. When it was, the project opens, the same place the quick add's own
  // Add button takes you; Done used to leave you on the list instead.
  const handleEditorClose = (outcome?: 'discarded') => {
    const id = newProjectIdRef.current;
    newProjectIdRef.current = null;
    setEditingProject(null);
    if (!id) return;
    const current = useProjectStore.getState().getProjectById(id);
    if (!current) return;
    if (outcome === 'discarded' || current.title.trim() === '') {
      animateLayout();
      removeProjectRow(id);
      return;
    }
    (navigation as any).navigate('ProjectDetail', { projectId: id });
  };

  // The row handlers are memoized and take the project they act on, rather
  // than the screen closing over it once per row — see `ProjectRow`'s own note.
  const handleQuickUnarchive = useCallback((project: Project) => {
    haptics.tap();
    animateLayout();
    unarchiveProject(project.id);
  }, [unarchiveProject]);

  const handleQuickUncomplete = useCallback((project: Project) => {
    haptics.tap();
    animateLayout();
    uncompleteProject(project.id);
  }, [uncompleteProject]);

  // Only reachable when projectProgress already reads every member done, so
  // there's nothing left open to ask about archiving — see ProjectEditor's
  // handleComplete for the version that has to.
  const handleQuickComplete = useCallback((project: Project) => {
    haptics.success();
    animateLayout();
    completeProject(project.id, { archiveRemaining: false });
  }, [completeProject]);

  const handleOpenProject = useCallback((project: Project) => {
    if (selectionMode) { toggleSelection(project.id); return; }
    (navigation as any).navigate('ProjectDetail', { projectId: project.id });
  }, [selectionMode, toggleSelection, navigation]);

  // Stable, like the other row callbacks, so ProjectRow's memo holds.
  const handleAddLine = useCallback((project: Project) => {
    haptics.tap();
    (navigation as any).navigate('ProjectDetail', { projectId: project.id, addLine: Date.now() });
  }, [navigation]);

  const handleEditProject = useCallback((project: Project) => setEditingProject(project), []);

  const renderRow = (item: ProjectListItem, drag?: () => void, isActive?: boolean) => {
    if (item.type === 'header') {
      return (
        <View style={styles.categorySectionHeader}>
          <Text style={styles.categorySectionHeaderText} numberOfLines={1}>
            {item.label}
            <Text style={styles.categorySectionCount}> · {sectionCounts.get(item.label) ?? 0}</Text>
          </Text>
        </View>
      );
    }
    const project = item.project;
    const facts = cardFactsByProject.get(project.id);
    const progress = facts?.progress ?? { done: 0, total: 0 };
    const pastWindow = isProjectPastWindow(project, progress);
    const caption = projectCardCaption(project, pastWindow, projectFilter, dayResetTime);
    const selected = selectedIds.has(project.id);
    // Only the active list needs this — completed projects already show their
    // own restore affordance, and an archived one is filed away regardless.
    // An ongoing project (see Project.ongoing) never reads as done here
    // either, however many of its current tasks are — it has no finish line
    // for "every task done" to mean anything against.
    const allDone = projectFilter === 'active' && !project.ongoing
      && progress.total > 0 && progress.done === progress.total;
    return (
      <ProjectRow
        project={project}
        progress={progress}
        pastWindow={pastWindow}
        captionText={caption?.text ?? null}
        captionOverdue={caption?.overdue ?? false}
        captionSoon={caption?.soon ?? false}
        progressNote={projectProgressNote(project, progress)}
        nextStep={facts?.next ?? null}
        preview={facts?.preview ?? null}
        projectFilter={projectFilter}
        allDone={allDone}
        selectionMode={selectionMode}
        selected={selected}
        isActive={isActive}
        drag={canReorder ? drag : undefined}
        colors={colors}
        styles={styles}
        onPress={handleOpenProject}
        onToggleSelect={toggleSelection}
        onSwipeSelect={enterSelectionMode}
        onQuickUnarchive={handleQuickUnarchive}
        onQuickUncomplete={handleQuickUncomplete}
        onQuickComplete={handleQuickComplete}
        onEdit={handleEditProject}
        onAddLine={handleAddLine}
      />
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Projects"
        subtitle={listProjects.length > 0
          ? `${listProjects.length} ${projectFilter} ${listProjects.length === 1 ? 'project' : 'projects'}`
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
                onPress: (e: GestureResponderEvent) => {
                  setOptionsMenuAnchor({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
                  setOptionsMenuVisible(true);
                },
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
      {showSearch && (
        <SearchField
          field={search}
          placeholder="Search projects and their tasks"
          style={styles.searchBar}
          accessibilityLabel="Search projects"
        />
      )}
      {visibleProjects.length === 0 ? (
        query ? (
          <EmptyState
            icon="search-outline"
            title="No matches"
            subtitle={`No ${projectFilter} project or open task mentions “${query}”`}
            actionLabel="Clear search"
            onAction={search.clear}
            bottomOffset={tabBarHeight}
          />
        ) : projectFilter === 'active' && archivedCount + completedCount > 0 ? (
          // Everything has been finished or filed away. "No projects yet" was
          // untrue here, and hid that the rest are one menu away.
          <EmptyState
            icon="briefcase-outline"
            title="No active projects"
            subtitle={`You have ${[
              completedCount > 0 ? `${completedCount} completed` : null,
              archivedCount > 0 ? `${archivedCount} archived` : null,
            ].filter(Boolean).join(' and ')}. Switch lists from the menu at the top.`}
            actionLabel="New project"
            onAction={() => setQuickAddVisible(true)}
            bottomOffset={tabBarHeight}
          />
        ) : (
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
            // The button is hidden on these two lists, so this is the way back.
            actionLabel={projectFilter === 'active' ? 'New project' : 'Show active projects'}
            onAction={projectFilter === 'active' ? () => setQuickAddVisible(true) : () => setProjectFilter('active')}
            bottomOffset={tabBarHeight}
          />
        )
      ) : (
        <ReorderableList
          data={projectListItems}
          keyExtractor={item => item.key}
          scrollToTop={{ bottom: insets.bottom + tabBarHeight + spacing.md }}
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
          // Placing a new project by hand is a hand-set order, so it goes
          // wherever a row drag does (see canReorder).
          drag={canReorder ? fabDrag : undefined}
          dragHint="Drag onto the list to add a project at that spot. Drop it back on the button to cancel."
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

      <LazySheet open={optionsMenuVisible}>
        <ProjectsOptionsMenu
          visible={optionsMenuVisible}
          onClose={() => setOptionsMenuVisible(false)}
          filter={projectFilter}
          onFilterChange={setProjectFilter}
          completedCount={completedCount}
          archivedCount={archivedCount}
          categoryCount={projectCategories.length}
          onManageCategories={() => setCategoriesSheetVisible(true)}
          sort={projectSort}
          onSortChange={setProjectSort}
          anchor={optionsMenuAnchor}
          onOpenSettings={screenSettings.hasSettings ? () => screenSettings.open(optionsMenuAnchor) : undefined}
          settingsHint={screenSettings.sheet.entries.map(e => e.label).join(', ')}
        />
      </LazySheet>
      <ScreenSettingsSheet {...screenSettings.sheet} />

      <LazySheet open={categoriesSheetVisible}>
        <ProjectCategoriesSheet
          visible={categoriesSheetVisible}
          onClose={() => setCategoriesSheetVisible(false)}
        />
      </LazySheet>

      <LazySheet open={quickAddVisible}>
        <QuickAddProjectModal
          visible={quickAddVisible}
          onClose={closeQuickAdd}
          onOpenFull={handleQuickAddOpenFull}
          onCreated={handleProjectCreated}
          seed={quickAddSeed}
          seedLabel={quickAddSeedLabel}
        />
      </LazySheet>

      <LazySheet open={editingProject !== null}>
        <ProjectEditor
          visible={editingProject !== null}
          project={editingProject}
          isNew={newProjectIdRef.current !== null}
          onClose={handleEditorClose}
        />
      </LazySheet>
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
/**
 * Memoized, and every handler takes the project it acts on rather than the
 * screen closing over it once per row. An inline arrow is a fresh identity per
 * render and defeats the memo outright, which is the same rule `renderTaskRow`
 * follows on Today.
 */
const ProjectRow = React.memo(function ProjectRow({
  project, progress, pastWindow, captionText, captionOverdue, captionSoon, progressNote, nextStep, preview, projectFilter, allDone,
  selectionMode, selected, isActive, drag, colors, styles,
  onPress, onToggleSelect, onSwipeSelect, onQuickUnarchive, onQuickUncomplete, onQuickComplete, onEdit, onAddLine,
}: {
  project: Project;
  progress: { done: number; total: number };
  pastWindow: boolean;
  // Two primitives rather than the caption object, which is rebuilt on every
  // render of the list and would defeat the memo on its own.
  captionText: string | null;
  captionOverdue: boolean;
  captionSoon: boolean;
  /** Said in place of the bar: an empty project, or an ongoing one's open count. */
  progressNote: string | null;
  /** The top of the project's own order, named so the card says what's up. */
  nextStep: string | null;
  /** A list's first open lines, joined, in place of a "Next". */
  preview: string | null;
  projectFilter: ProjectFilter;
  allDone: boolean;
  selectionMode: boolean;
  selected: boolean;
  isActive?: boolean;
  drag?: () => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  onPress: (project: Project) => void;
  onToggleSelect: (projectId: string) => void;
  onSwipeSelect: (projectId: string) => void;
  onQuickUnarchive: (project: Project) => void;
  onQuickUncomplete: (project: Project) => void;
  onQuickComplete: (project: Project) => void;
  onEdit: (project: Project) => void;
  onAddLine: (project: Project) => void;
}) {
  // Excluded for the floating drag overlay's copy — it shares the dragged
  // row's id, and registering both would leave the real row's slot evicted
  // the moment the overlay unmounts.
  const paintRef = usePaintSelectionRow(isActive ? null : project.id);
  // Bound once per row rather than once per render of the list above it.
  const press = () => onPress(project);
  const toggleSelect = () => onToggleSelect(project.id);
  // Shared by the swipe and the iPhone Mirroring button.
  const swipeSelect = { onSelect: () => onSwipeSelect(project.id), accessibilityLabel: `Select ${project.title}` };

  return (
    <SwipeableRow
      style={styles.projectCard}
      enabled={!selectionMode}
      selectAction={swipeSelect}
    >
      <View ref={paintRef}>
        <TouchableOpacity
          style={[
            styles.projectRow,
            isActive && styles.projectRowActive,
            selectionMode && selected && styles.projectRowSelected,
          ]}
          onPress={press}
          // Reordering is off while selecting: the long press that would start a
          // drag is how a mis-tapped row gets picked up instead.
          onLongPress={selectionMode ? undefined : drag}
          delayLongPress={interaction.delayLongPress}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole={selectionMode ? 'checkbox' : 'button'}
          accessibilityState={selectionMode ? { checked: selected } : undefined}
          accessibilityLabel={
            // The list glyph beside the title is decorative, so the kind has to
            // be said here or a screen reader can't tell the two apart. The
            // caption and next step are read too: they're the rest of what the
            // card shows.
            [
              project.title + (project.kind === 'list' ? ', list' : ''),
              progressNote ?? `${progress.done} of ${progress.total} done`,
              nextStep ? `next: ${nextStep}` : null,
              preview,
              captionText,
            ].filter(Boolean).join(', ')
          }
          accessibilityHint={
            selectionMode
              ? 'Double tap to select project'
              : drag
                ? `Double tap to view ${project.kind === 'list' ? 'this list' : 'tasks in this project'}. Long press to reorder.`
                : `Double tap to view ${project.kind === 'list' ? 'this list' : 'tasks in this project'}.`
          }
        >
          <View style={styles.projectInfo}>
            <View style={styles.projectTitleRow}>
              {/* A glyph rather than a separate section: lists and projects sit
                  in the same category order the user arranged, and splitting
                  them would make that order answer to something they didn't
                  choose. See Project.kind. */}
              {project.kind === 'list' && (
                <Ionicons name="list-outline" size={14} color={colors.textTertiary} />
              )}
              <Text style={styles.projectName} numberOfLines={1}>{project.title}</Text>
              {/* Nothing a row can do to itself while a selection is being
                  built — each of these acts on one project and would fight the
                  bar. The dot takes the slot they vacate, which is the trailing
                  edge every selectable row in the app puts it on. */}
              {selectionMode ? (
                <SelectionDot selected={selected} onPress={toggleSelect} />
              ) : (
                <>
                {projectFilter === 'archived' && (
                  <TouchableOpacity
                    onPress={() => onQuickUnarchive(project)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Unarchive ${project.title}`}
                  >
                    <Ionicons name="arrow-undo-outline" size={16} color={colors.accent} />
                  </TouchableOpacity>
                )}
                {projectFilter === 'completed' && (
                  <TouchableOpacity
                    onPress={() => onQuickUncomplete(project)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Restore ${project.title} to active`}
                  >
                    <Ionicons name="arrow-undo-outline" size={16} color={colors.accent} />
                  </TouchableOpacity>
                )}
                {allDone && (
                  <TouchableOpacity
                    onPress={() => onQuickComplete(project)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Mark ${project.title} complete: ${project.kind === 'list' ? 'every item is checked' : 'every task is done'}`}
                  >
                    <Ionicons name="checkmark-circle" size={16} color={colors.done} />
                  </TouchableOpacity>
                )}
                {/* Add to a list without hunting for its field: opens the
                    list with the add field open. */}
                {project.kind === 'list' && projectFilter === 'active' && (
                  <TouchableOpacity
                    onPress={() => onAddLine(project)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Add an item to ${project.title}`}
                  >
                    <Ionicons name="add-circle-outline" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => onEdit(project)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${project.title}`}
                >
                  {/* A pencil, like the project page's own: this opens the
                      editor straight away rather than a menu. Nudged up a point:
                      the glyph's square sits low in its box, so its ink reads
                      lower than the add circle's beside it. */}
                  <Ionicons name="create-outline" size={16} color={colors.textTertiary} style={{ marginTop: -1 }} />
                </TouchableOpacity>
                <SwipeActionButtons enabled={!selectionMode} selectAction={swipeSelect} />
                </>
              )}
            </View>
            {progressNote ? (
              <Text style={styles.rangeText} numberOfLines={1}>{progressNote}</Text>
            ) : (
              <View style={styles.progressRow}>
                <View style={styles.progressBarWrap}>
                  <ProgressBar progress={progress.done / progress.total} />
                </View>
                <Text style={styles.progressText}>{progress.done}/{progress.total}</Text>
              </View>
            )}
            {preview && (
              <Text style={styles.nextText} numberOfLines={1}>{preview}</Text>
            )}
            {nextStep && (
              <Text style={styles.nextText} numberOfLines={1}>
                <Text style={styles.nextLabel}>Next: </Text>
                {nextStep}
              </Text>
            )}
            {captionText && (
              <Text
                style={[
                  styles.rangeText,
                  captionSoon && styles.rangeTextSoon,
                  captionOverdue && pastWindow && { color: colors.orangeText },
                ]}
                numberOfLines={1}
              >
                {captionText}
              </Text>
            )}
          </View>
        </TouchableOpacity>
      </View>
    </SwipeableRow>
  );
});

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
  // Same grey as the heading, a weight lighter, so it reads as a note on the
  // heading rather than part of the name.
  categorySectionCount: {
    fontWeight: fontWeight.regular,
  },
  // The card's margin and radius live here, on SwipeableRow's own `style`
  // prop, rather than on the row below — see the note on SwipeableRow for why
  // a rounded row leaves its revealed panel square-cornered behind it.
  projectCard: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.xxs,
    borderRadius: radius.md,
  },
  // Flush, so it slides over the swipe panel rather than beside it.
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    gap: spacing.md,
  },
  projectRowActive: {
    backgroundColor: colors.bgTertiary,
  },
  // Opaque, not `colors.accentSubtle` directly: this can be applied the
  // instant a swipe-select commits, while SwipeableRow's own panel is still
  // open behind this row mid-close-animation — see the note on
  // `flattenOverlay`.
  projectRowSelected: {
    backgroundColor: flattenOverlay(colors.accentSubtle, colors.bgSecondary),
  },
  dropSlot: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.xxs,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    opacity: 0.55,
  },
  projectInfo: {
    flex: 1,
    gap: spacing.xsm,
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
  rangeTextSoon: {
    color: colors.text,
    fontWeight: fontWeight.medium,
  },
  nextText: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  nextLabel: {
    color: colors.textTertiary,
    fontWeight: fontWeight.medium,
  },
  searchBar: {
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
});
