import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Alert,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Keyboard,
  Platform,
} from 'react-native';
import { SheetModal } from './SheetModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeBlurView } from './SafeBlurView';
import { WhenPicker } from './WhenPicker';
import { PillGroup, type PillGroupOption } from './PillGroup';
import { SheetScrim } from './SheetScrim';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { useProjectStore } from '../store/useProjectStore';
import { nudgeFieldsFor } from '../utils/nudgeCadence';
import { awayNoonIso } from '../utils/awayDates';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectCategoryStore } from '../store/useProjectCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { formatDeadlineDate } from '../utils/dateUtils';
import { findArchivedMatch } from '../utils/archiveMatch';
import { TITLE_MAX_LENGTH, type Project } from '../types';

/** The in-progress project the quick-add hands off to the full editor. */
export interface ProjectDraft {
  title: string;
  category: string | null;
  deadline: string | null;
  /** The "List" chip was on: a running list rather than work with an end. */
  asList?: boolean;
  /** The "Trip" chip's departure, stored the way the editor stores it. */
  awayStart?: string | null;
}

/**
 * What a project made as a list starts with, beyond its kind: no finish line
 * (Project.ongoing) and left out of Pull from projects, since a list of books
 * or gift ideas has no next task to pull and never gets "done". Both can be
 * changed in the editor afterwards.
 */
export const LIST_PROJECT_FIELDS = {
  kind: 'list' as const,
  ongoing: true,
  ...nudgeFieldsFor('never', 0),
};

interface Props {
  visible: boolean;
  onClose: () => void;
  onOpenFull: (draft: ProjectDraft) => void;
  /**
   * Called right after a new project is created (not on the "restore archived"
   * path). `placed` is false when there was no seed, or when the chip shook it
   * off — a caller that also wanted to position the row shouldn't.
   */
  onCreated?: (project: Project, placed: boolean) => void;
  /**
   * Placement handed in by a drag of the add button onto the list. `category`
   * seeds the form's own category field, so it shows and can be changed like
   * any other.
   */
  seed?: { category?: string | null };
  /** Names the seed on a removable chip, e.g. "Home". No chip without one. */
  seedLabel?: string | null;
}

type ActivePanel = 'category' | null;

/**
 * Projects' answer to QuickAddModal: same centered sheet, same name-then-chips
 * shape, with the three fields worth setting before a project exists (category,
 * start date, target date). Anything else is a trip to the full editor.
 */
export function QuickAddProjectModal({
  visible, onClose, onOpenFull, onCreated, seed, seedLabel,
}: Props) {
  const colors = useColors();
  const { isDark, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const projects = useProjectStore(useShallow(s => s.projects));
  const createProject = useProjectStore(s => s.createProject);
  const unarchiveProject = useTaskStore(s => s.unarchiveProject);
  const uncompleteProject = useTaskStore(s => s.uncompleteProject);
  const startFreshFromProject = useTaskStore(s => s.startFreshFromProject);
  const categories = useProjectCategoryStore(useShallow(s => s.categories));
  const addCategory = useProjectCategoryStore(s => s.addCategory);

  const inputRef = useRef<TextInput>(null);
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const translateYAnim = useRef(new Animated.Value(16)).current;
  const sheetOpacity = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  // Same treatment as QuickAddModal: the sheet glides to its new centered
  // resting spot on its own spring rather than tracking the keyboard 1:1.
  const keyboardOffsetAnim = useRef(new Animated.Value(0)).current;

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [asList, setAsList] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [deadlinePickerVisible, setDeadlinePickerVisible] = useState(false);
  // A trip's departure. Offered here because the only date this sheet had was
  // Deadline, and a flight date typed there reaches none of the trip features
  // (vacation mode, Look ahead, moving the trip's tasks), which all read
  // the departure. The return and the rest are in the editor.
  const [leaving, setLeaving] = useState<Date | null>(null);
  const [leavingPickerVisible, setLeavingPickerVisible] = useState(false);
  const [seedActive, setSeedActive] = useState(false);
  // Read only when the sheet opens: a seed that changes identity mid-edit must
  // not reset the fields under the person typing.
  const seedRef = useRef(seed);
  seedRef.current = seed;
  // Set once the sheet has created or restored something. The add button and
  // the title's return key both stay live through the dismiss animation, so a
  // second tap inside it created a second project with the same name.
  const submittedRef = useRef(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => {
      const height = e.endCoordinates?.height ?? 0;
      Animated.spring(keyboardOffsetAnim, {
        toValue: -height / 2,
        ...animation.spring.smooth,
        useNativeDriver: true,
      }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      Animated.spring(keyboardOffsetAnim, {
        toValue: 0,
        ...animation.spring.smooth,
        useNativeDriver: true,
      }).start();
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    submittedRef.current = false;
    setTitle('');
    setCategory(seedRef.current?.category ?? null);
    setSeedActive(!!seedRef.current);
    setDeadline(null);
    setLeaving(null);
    setLeavingPickerVisible(false);
    setAsList(false);
    setActivePanel(null);
    setDeadlinePickerVisible(false);
    scaleAnim.setValue(0.95);
    translateYAnim.setValue(16);
    sheetOpacity.setValue(0);
    backdropOpacity.setValue(0);
    keyboardOffsetAnim.setValue(0);
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.spring(translateYAnim, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(sheetOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
    // Focus (and the keyboard's own slide-up) starts alongside the sheet
    // animation rather than after it, so the keyboard is up sooner — same
    // fix as QuickAddModal's (#1210).
    inputRef.current?.focus();
  }, [visible]);

  const dismiss = () => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: animation.duration.dismiss, useNativeDriver: true }),
      Animated.timing(sheetOpacity, { toValue: 0, duration: animation.duration.dismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => { scaleAnim.setValue(0.95); sheetOpacity.setValue(0); onClose(); });
  };

  // Archived and finished projects both: last year's party is usually just
  // marked complete, and a second copy of its name beside it was the result.
  const pastProjects = useMemo(() => projects.filter(p => p.archived || p.completed), [projects]);

  // A new category is created and picked the moment it's submitted in the
  // pill grid below, so there's no half-typed name left to resolve here.
  const resolveCategory = () => category;

  const create = (finalTitle: string) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    haptics.success();
    animateLayout();
    const resolvedCategory = resolveCategory();
    const created = createProject(finalTitle, {
      deadline: deadline ? deadline.toISOString() : null,
      category: resolvedCategory,
      awayStart: leaving ? awayNoonIso(leaving) : null,
    });
    if (asList) useProjectStore.getState().updateProject(created.id, LIST_PROJECT_FIELDS);
    const project = useProjectStore.getState().getProjectById(created.id) ?? created;
    onCreated?.(project, seedActive);
    dismiss();
  };

  const handleAdd = () => {
    const finalTitle = title.trim();
    if (!finalTitle || submittedRef.current) return;

    const archivedMatch = findArchivedMatch(pastProjects, finalTitle);
    if (archivedMatch) {
      const wasArchived = archivedMatch.archived;
      Alert.alert(
        wasArchived ? 'Restore archived project?' : 'Reopen finished project?',
        wasArchived
          ? `You archived "${archivedMatch.title}" a while ago. Restore it as it was, or start a fresh copy with the same tasks, all open and undated?`
          : `You finished "${archivedMatch.title}" already. Reopen it as it was, or start a fresh copy with the same tasks, all open and undated?`,
        [
          // The match is fuzzy, so a wrong guess has to be escapable without
          // either answer: Cancel leaves the typed name in the field.
          { text: 'Cancel', style: 'cancel' },
          { text: 'Create new', onPress: () => create(finalTitle) },
          // Last year's party again: restoring brought back last year's
          // ticks and dates, which is the one thing not wanted.
          {
            text: 'Start fresh from it',
            onPress: () => {
              if (submittedRef.current) return;
              submittedRef.current = true;
              haptics.success();
              animateLayout();
              const copy = startFreshFromProject(archivedMatch.id);
              if (copy) onCreated?.(copy, false);
              dismiss();
            },
          },
          {
            text: wasArchived ? 'Restore' : 'Reopen',
            style: 'default',
            onPress: () => {
              if (submittedRef.current) return;
              submittedRef.current = true;
              haptics.success();
              animateLayout();
              if (wasArchived) unarchiveProject(archivedMatch.id);
              // Unarchiving alone sent a project that was also completed to
              // the Completed list, so Restore appeared to do nothing on the
              // Active list the person was looking at.
              if (archivedMatch.completed) uncompleteProject(archivedMatch.id);
              dismiss();
            },
          },
        ],
      );
      return;
    }

    create(finalTitle);
  };

  const handleOpenFull = () => {
    onOpenFull({
      title: title.trim(),
      category: resolveCategory(),
      deadline: deadline ? deadline.toISOString() : null,
      asList,
      awayStart: leaving ? awayNoonIso(leaving) : null,
    });
  };

  const togglePanel = (panel: ActivePanel) => {
    haptics.tap();
    animateLayout();
    setActivePanel(prev => (prev === panel ? null : panel));
  };

  const pickCategory = (value: string | null) => {
    haptics.tap();
    animateLayout();
    setCategory(value);
    setActivePanel(null);
  };

  // The category pool is one the user builds and has no ceiling, so it's a
  // PillGroup: past eight it folds behind "N more" and grows a find-or-add
  // field, where a hand-rolled row of chips took the sheet over. "None" is
  // pinned so it's never the one buried.
  const categoryOptions: PillGroupOption[] = [
    { key: '__none__', label: 'None', pinned: true, selected: category === null, onPress: () => pickCategory(null) },
    ...[...categories].sort((a, b) => a.sortOrder - b.sortOrder).map(cat => ({
      key: cat.id,
      label: cat.name,
      selected: category === cat.name,
      onPress: () => pickCategory(category === cat.name ? null : cat.name),
    })),
  ];
  // addCategory answers a taken name with the existing row, so creating one
  // that exists just picks it, in the stored case.
  const createCategory = (name: string) => {
    pickCategory(addCategory(name).name);
  };

  return (
    <SheetModal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <SheetScrim onPress={dismiss} label="Close without adding" />
      <View style={styles.centeredContainer} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheet,
            shadows.sheet,
            {
              opacity: sheetOpacity,
              transform: [{ scale: scaleAnim }, { translateY: Animated.add(translateYAnim, keyboardOffsetAnim) }],
            },
          ]}
        >
          {/* Where the button was dropped. Removable: the drop chose a place,
              it didn't commit you to one. */}
          {seedActive && seedLabel ? (
            <View style={styles.seedRow}>
              <View style={styles.seedChip}>
                <Ionicons name="return-down-forward" size={13} color={colors.accent} />
                <Text style={styles.seedChipText} numberOfLines={1}>{seedLabel}</Text>
                <TouchableOpacity
                  onPress={() => {
                    haptics.tap();
                    if (seed?.category && category === seed.category) setCategory(null);
                    setSeedActive(false);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove placement ${seedLabel}`}
                >
                  <Ionicons name="close" size={13} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {/* Name input row */}
          <View style={styles.row}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="New project…"
              placeholderTextColor={colors.textTertiary}
              value={title}
              onChangeText={setTitle}
              onSubmitEditing={handleAdd}
              returnKeyType="done"
              maxLength={TITLE_MAX_LENGTH}
              blurOnSubmit={false}
            />
            <TouchableOpacity hitSlop={8}
              style={[styles.addBtn, !title.trim() && styles.addBtnDisabled]}
              onPress={handleAdd}
              disabled={!title.trim()}
              accessibilityRole="button"
              accessibilityLabel="Create project"
            >
              <Ionicons name="arrow-up" size={18} color={colors.onAccent} />
            </TouchableOpacity>
          </View>

          {/* Attribute toolbar. Every chip always carries its label — an
              icon alone doesn't say what tapping it does. Same shape as
              QuickAddModal's own toolbar: label until there's a value, then
              the value replaces it.

              Whether the new project is a list isn't asked here any more —
              that's a toggle on the project's own screen now (Project.kind),
              set after creation rather than as a question every new project
              answers up front. The List chip below is the opt-in exception:
              a chip nobody has to touch, for the person who already knows,
              who otherwise had to find an unlabeled icon on the next screen. */}
          <View style={styles.toolbar}>
            <TouchableOpacity
              style={[styles.toolChip, activePanel === 'category' && styles.toolChipActive, category !== null && styles.toolChipSet]}
              onPress={() => togglePanel('category')}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={category !== null ? `Category: ${category}` : 'Set category'}
            >
              <Ionicons name="folder-outline" size={13} color={category ? colors.accent : colors.textTertiary} />
              <Text style={[styles.toolChipText, category !== null && styles.toolChipTextSet]} numberOfLines={1}>
                {category ?? 'Category'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.toolChip, deadline != null && styles.toolChipSet]}
              onPress={() => setDeadlinePickerVisible(true)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={deadline ? `Deadline: ${formatDeadlineDate(deadline.toISOString())}` : 'Set deadline'}
            >
              <Ionicons name="flag-outline" size={13} color={deadline ? colors.accent : colors.textTertiary} />
              <Text style={[styles.toolChipText, deadline != null && styles.toolChipTextSet]} numberOfLines={1}>
                {deadline != null ? formatDeadlineDate(deadline.toISOString()) : 'Deadline'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.toolChip, leaving != null && styles.toolChipSet]}
              onPress={() => setLeavingPickerVisible(true)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={leaving ? `Trip, leaving ${formatDeadlineDate(leaving.toISOString())}` : 'Set trip dates'}
            >
              <Ionicons name="airplane-outline" size={13} color={leaving ? colors.accent : colors.textTertiary} />
              <Text style={[styles.toolChipText, leaving != null && styles.toolChipTextSet]} numberOfLines={1}>
                {leaving != null ? `Leaves ${formatDeadlineDate(leaving.toISOString())}` : 'Trip'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.toolChip, asList && styles.toolChipSet]}
              onPress={() => { haptics.tap(); setAsList(v => !v); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="switch"
              accessibilityState={{ checked: asList }}
              accessibilityLabel="List, with no dates or finish line"
            >
              <Ionicons name="list-outline" size={13} color={asList ? colors.accent : colors.textTertiary} />
              <Text style={[styles.toolChipText, asList && styles.toolChipTextSet]} numberOfLines={1}>List</Text>
            </TouchableOpacity>
          </View>

          {activePanel === 'category' && (
            <View style={styles.panel}>
              <PillGroup
                options={categoryOptions}
                noun="category"
                pluralNoun="categories"
                onCreate={createCategory}
              />
            </View>
          )}

          <TouchableOpacity style={styles.moreBtn} onPress={handleOpenFull} activeOpacity={interaction.activeOpacity}>
            <Ionicons name="create-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.moreBtnText}>More details</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/*
        The same two fields ProjectEditor asks for, so the same picker: these
        were CalendarPicker, which is only for the two things WhenPicker can't
        do (a completion timestamp, a set of dates). Neither applies to a
        project's own start or target, and having the quick sheet and the full
        editor ask for one field two different ways is the drift the rule
        exists to stop. Time of day and Suggest are off because neither date is
        a task's own schedule.
      */}
      <WhenPicker
        visible={deadlinePickerVisible}
        value={deadline}
        title="Deadline"
        showTimeOfDay={false}
        showSuggest={false}
        onConfirm={date => { setDeadline(date); setDeadlinePickerVisible(false); }}
        onClear={() => { setDeadline(null); setDeadlinePickerVisible(false); }}
        onCancel={() => setDeadlinePickerVisible(false)}
      />
      <WhenPicker
        visible={leavingPickerVisible}
        value={leaving}
        title="Leaving"
        showTimeOfDay={false}
        showSuggest={false}
        onConfirm={date => { setLeaving(date); setLeavingPickerVisible(false); }}
        onClear={() => { setLeaving(null); setLeavingPickerVisible(false); }}
        onCancel={() => setLeavingPickerVisible(false)}
      />
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  seedRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  seedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: colors.accent + '1A',
    maxWidth: '100%',
  },
  seedChipText: {
    color: colors.accent,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    flexShrink: 1,
  },
  input: {
    flex: 1,
    fontSize: font.md,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: {
    backgroundColor: colors.bgTertiary,
  },
  toolbar: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
    flexWrap: 'wrap',
  },
  toolChip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  toolChipActive: {
    backgroundColor: colors.bgQuaternary,
  },
  toolChipSet: {
    backgroundColor: colors.accentSubtle,
  },
  toolChipText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
    flexShrink: 1,
  },
  toolChipTextSet: {
    color: colors.accent,
  },
  panel: {
    marginBottom: spacing.sm,
    paddingTop: spacing.xs,
  },
  moreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xsm,
    paddingVertical: 10,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    marginTop: spacing.xs,
  },
  moreBtnText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
});
