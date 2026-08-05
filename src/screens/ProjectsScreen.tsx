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
import { groupProjectsByCategory, resolveProjectDrop } from '../utils/projectGrouping';
import { ProjectEditor } from '../components/ProjectEditor';
import { QuickAddProjectModal, type ProjectDraft } from '../components/QuickAddProjectModal';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { PressableScale } from '../components/PressableScale';
import { ReorderableList } from '../components/ReorderableList';
import { ProgressBar } from '../components/ProgressBar';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { formatDueDate, formatStartDate } from '../utils/dateUtils';
import type { Project } from '../types';

const FAB_SIZE = 56;

function dateRangeLabel(project: Project): string | null {
  if (project.targetStartDate && project.targetEndDate) {
    return `${formatStartDate(project.targetStartDate)} – ${formatDueDate(project.targetEndDate)}`;
  }
  if (project.targetEndDate) return `By ${formatDueDate(project.targetEndDate)}`;
  if (project.targetStartDate) return `From ${formatStartDate(project.targetStartDate)}`;
  return null;
}

export function ProjectsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const { shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const navigation = useNavigation();
  const projects = useProjectStore(useShallow(s => s.projects));
  const createProject = useProjectStore(s => s.createProject);
  const updateProject = useProjectStore(s => s.updateProject);
  const removeProjectRow = useProjectStore(s => s.removeProjectRow);
  const reorderProjectsWithCategoryUpdates = useProjectStore(s => s.reorderProjectsWithCategoryUpdates);
  const allTasks = useTaskStore(useShallow(s => s.tasks));
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

  // "More details" hands the draft over to the full editor. Projects have no
  // draft state of their own, so the row is created up front and discarded on
  // close if it never got a name — same trick TodayScreen uses for new stacks.
  const handleQuickAddOpenFull = (draft: ProjectDraft) => {
    setQuickAddVisible(false);
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

      {visibleProjects.length === 0 ? (
        <EmptyState
          icon={showArchived ? 'archive-outline' : 'briefcase-outline'}
          title={showArchived ? 'No archived projects' : 'No projects yet'}
          subtitle={showArchived ? 'Projects you archive will show up here' : 'Tap + to start a themed collection, like a summer bucket list'}
          bottomOffset={tabBarHeight}
        />
      ) : (
        <ReorderableList
          data={projectListItems}
          keyExtractor={item => item.key}
          contentContainerStyle={styles.list}
          ListFooterComponent={<View style={{ height: tabBarHeight + FAB_SIZE + spacing.xl }} />}
          placeholderStyle={styles.dropSlot}
          onHoverChange={haptics.tap}
          onReorder={reordered => {
            const { projectIds, categoryUpdates } = resolveProjectDrop(reordered, projectCategoryOrder);
            reorderProjectsWithCategoryUpdates(projectIds, categoryUpdates);
          }}
          renderItem={({ item, drag, isActive }) => {
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
          }}
        />
      )}

      {!showArchived && (
        <View style={[styles.fabContainer, { bottom: insets.bottom + tabBarHeight + spacing.md }]}>
          <PressableScale
            style={[styles.fab, shadows.fab]}
            pressScale={0.9}
            onPress={() => { haptics.impactLight(); setQuickAddVisible(true); }}
            accessibilityLabel="Add project"
          >
            <Ionicons name="add" size={28} color={colors.onAccent} />
          </PressableScale>
        </View>
      )}

      <QuickAddProjectModal
        visible={quickAddVisible}
        onClose={() => setQuickAddVisible(false)}
        onOpenFull={handleQuickAddOpenFull}
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
  fabContainer: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 20,
  },
  fab: {
    width: FAB_SIZE, height: FAB_SIZE, borderRadius: FAB_SIZE / 2,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent,
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
