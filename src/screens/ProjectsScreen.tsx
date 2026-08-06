import React, { useRef, useState, useMemo } from 'react';
import {
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
import { categoriesByIndex, type DropZone, type FabDropIntent } from '../utils/fabDrop';
import { ReorderableList } from '../components/ReorderableList';
import { ProgressBar } from '../components/ProgressBar';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { formatDueDate, formatStartDate } from '../utils/dateUtils';
import type { Project } from '../types';

function dateRangeLabel(project: Project): string | null {
  if (project.targetStartDate && project.targetEndDate) {
    return `${formatStartDate(project.targetStartDate)} – ${formatDueDate(project.targetEndDate)}`;
  }
  if (project.targetEndDate) return `By ${formatDueDate(project.targetEndDate)}`;
  if (project.targetStartDate) return `From ${formatStartDate(project.targetStartDate)}`;
  return null;
}

// The add button, naming what a release right now would do.
function AddProjectFabWithDropLabel({
  channel,
  ...props
}: {
  channel: FabIntentChannel;
} & Omit<React.ComponentProps<typeof Fab>, 'dragLabel'>) {
  const label = useFabIntentSelector(channel, intent =>
    intent?.kind === 'insert'
      ? (intent.category ? `New project in ${intent.category}` : 'New project here')
      : null,
  );
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
  const allTasks = useTaskStore(s => s.tasks);
  const projectCategories = useProjectCategoryStore(useShallow(s => s.categories));

  const [showArchived, setShowArchived] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  // Set while editingProject is one freshly created from quick add's "More
  // details" — discarded on close if it was never given a name.
  const newProjectIdRef = useRef<string | null>(null);

  const visibleProjects = useMemo(
    () => projects.filter(p => p.archived === showArchived),
    [projects, showArchived]
  );

  const projectCategoryOrder = useMemo(
    () => [...projectCategories].sort((a, b) => a.sortOrder - b.sortOrder).map(c => c.name),
    [projectCategories]
  );
  const projectListItems = useMemo(
    () => groupProjectsByCategory(visibleProjects, projectCategoryOrder),
    [visibleProjects, projectCategoryOrder]
  );

  // ——— Dragging the add button into the list ———————————————————————————
  //
  // Same gesture as Today's, over the shape this list actually has: no stacks
  // and nothing pinned, so a drop means a category section and a spot in it.
  // The button reports raw pointer positions, FabDropZoneProvider turns those
  // into an intent, and everything below is what each intent means here.

  const dropZonesRef = useRef<FabDropZonesHandle>(null);
  const [fabDragging, setFabDragging] = useState(false);
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
    onMove: pageY => dropZonesRef.current?.moveTo(pageY),
    onEnd: pageY => {
      setFabDragging(false);
      // end()/cancel() publish a null intent themselves, which is what clears
      // the label.
      openQuickAddForDrop(dropZonesRef.current?.end(pageY) ?? { kind: 'plain' });
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
    const project = createProject(draft.title, draft.targetStartDate, draft.targetEndDate);
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

  const renderRow = (item: ProjectListItem, drag?: () => void, isActive?: boolean) => {
    if (item.type === 'header') {
      return (
        <View style={styles.categorySectionHeader}>
          <Text style={styles.categorySectionHeaderText}>{item.label}</Text>
        </View>
      );
    }
    const project = item.project;
    const progress = projectProgress(project.id, allTasks);
    const pastWindow = isProjectPastWindow(project, progress);
    const rangeLabel = dateRangeLabel(project);
    return (
      <TouchableOpacity
        style={[styles.projectRow, isActive && styles.projectRowActive]}
        onPress={() => (navigation as any).navigate('ProjectDetail', { projectId: project.id })}
        onLongPress={drag}
        delayLongPress={interaction.delayLongPress}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={`${project.title}, ${progress.done} of ${progress.total} done`}
        accessibilityHint="Double tap to view tasks in this project. Long press to reorder."
      >
        <Ionicons name="reorder-three" size={18} color={colors.textTertiary} />
        <View style={styles.projectInfo}>
          <View style={styles.projectTitleRow}>
            <Text style={styles.projectName} numberOfLines={1}>{project.title}</Text>
            <TouchableOpacity
              onPress={() => setEditingProject(project)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${project.title}`}
            >
              <Ionicons name="ellipsis-horizontal" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
          {progress.total > 0 && (
            <View style={styles.progressRow}>
              <View style={styles.progressBarWrap}>
                <ProgressBar progress={progress.done / progress.total} />
              </View>
              <Text style={styles.progressText}>{progress.done}/{progress.total}</Text>
            </View>
          )}
          {rangeLabel && (
            <Text style={[styles.rangeText, pastWindow && { color: colors.orange }]} numberOfLines={1}>
              {pastWindow ? `Past window · ${rangeLabel}` : rangeLabel}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Projects"
        actions={[
          {
            icon: 'archive-outline',
            onPress: () => setShowArchived(v => !v),
            active: showArchived,
            accessibilityLabel: showArchived ? 'Show active projects' : 'Show archived projects',
          },
        ]}
      />

      <FabDropZoneProvider ref={dropZonesRef} onIntentChange={fabIntentChannel.publish}>
      {visibleProjects.length === 0 ? (
        <EmptyState
          icon={showArchived ? 'archive-outline' : 'briefcase-outline'}
          title={showArchived ? 'No archived projects' : 'No projects yet'}
          subtitle={showArchived ? 'Projects you archive will show up here' : 'Start a themed collection, like a summer bucket list, and pick tasks off it over time'}
          actionLabel={showArchived ? undefined : 'New project'}
          onAction={showArchived ? undefined : () => setQuickAddVisible(true)}
          bottomOffset={tabBarHeight}
        />
      ) : (
        <ReorderableList
          data={projectListItems}
          keyExtractor={item => item.key}
          // The zone snapshot is taken once as the drag arms, so the list must
          // hold still for it.
          scrollEnabled={!fabDragging}
          contentContainerStyle={styles.list}
          ListFooterComponent={<View style={{ height: tabBarHeight + FAB_SIZE + spacing.xl }} />}
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

      {!showArchived && (
        <AddProjectFabWithDropLabel
          channel={fabIntentChannel}
          onPress={() => setQuickAddVisible(true)}
          accessibilityLabel="Add project"
          bottom={insets.bottom + tabBarHeight + spacing.md}
          drag={fabDrag}
          dragHint="Drag onto the list to add a project there"
        />
      )}

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
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: spacing.md,
  },
  projectRowActive: {
    backgroundColor: colors.bgTertiary,
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
  headerBtnText: {
    color: colors.accent,
    fontSize: font.md,
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
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    paddingVertical: 10,
  },
  footerBtnText: {
    color: colors.accent,
    fontSize: font.md,
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
