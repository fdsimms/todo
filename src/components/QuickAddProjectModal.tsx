import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Alert,
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Keyboard,
  Platform,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeBlurView } from './SafeBlurView';
import { CalendarPicker } from './CalendarPicker';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectCategoryStore } from '../store/useProjectCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { formatDueDate, formatStartDate } from '../utils/dateUtils';
import { findArchivedMatch } from '../utils/archiveMatch';
import { TITLE_MAX_LENGTH, type Project } from '../types';

/** The in-progress project the quick-add hands off to the full editor. */
export interface ProjectDraft {
  title: string;
  category: string | null;
  targetStartDate: string | null;
  targetEndDate: string | null;
}

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
  const updateProject = useProjectStore(s => s.updateProject);
  const unarchiveProject = useTaskStore(s => s.unarchiveProject);
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
  const [targetStartDate, setTargetStartDate] = useState<Date | null>(null);
  const [targetEndDate, setTargetEndDate] = useState<Date | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [startPickerVisible, setStartPickerVisible] = useState(false);
  const [endPickerVisible, setEndPickerVisible] = useState(false);
  const [seedActive, setSeedActive] = useState(false);
  // Read only when the sheet opens: a seed that changes identity mid-edit must
  // not reset the fields under the person typing.
  const seedRef = useRef(seed);
  seedRef.current = seed;

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
    setTitle('');
    setCategory(seedRef.current?.category ?? null);
    setSeedActive(!!seedRef.current);
    setTargetStartDate(null);
    setTargetEndDate(null);
    setActivePanel(null);
    setAddingCategory(false);
    setNewCategory('');
    setStartPickerVisible(false);
    setEndPickerVisible(false);
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
    ]).start(() => {
      // Focus is deferred until the sheet has settled so the keyboard's own
      // slide-up doesn't fight the sheet's entrance.
      inputRef.current?.focus();
    });
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: 120, useNativeDriver: true }),
      Animated.timing(sheetOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => { scaleAnim.setValue(0.95); sheetOpacity.setValue(0); onClose(); });
  };

  const archivedProjects = useMemo(() => projects.filter(p => p.archived), [projects]);

  const create = (finalTitle: string) => {
    haptics.success();
    animateLayout();
    const project = createProject(
      finalTitle,
      targetStartDate ? targetStartDate.toISOString() : null,
      targetEndDate ? targetEndDate.toISOString() : null,
    );
    if (category) updateProject(project.id, { category });
    // createProject doesn't take a category, so hand the caller the row as it
    // now stands rather than the one it returned a line ago.
    onCreated?.({ ...project, category }, seedActive);
    dismiss();
  };

  const handleAdd = () => {
    const finalTitle = title.trim();
    if (!finalTitle) return;

    const archivedMatch = findArchivedMatch(archivedProjects, finalTitle);
    if (archivedMatch) {
      Alert.alert(
        'Restore archived project?',
        `You archived "${archivedMatch.title}" a while back. Restore it instead of starting a new one? Its tasks and progress come back with it.`,
        [
          { text: 'Create New', onPress: () => create(finalTitle) },
          {
            text: 'Restore',
            style: 'default',
            onPress: () => {
              haptics.success();
              animateLayout();
              unarchiveProject(archivedMatch.id);
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
      category,
      targetStartDate: targetStartDate ? targetStartDate.toISOString() : null,
      targetEndDate: targetEndDate ? targetEndDate.toISOString() : null,
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

  const commitNewCategory = () => {
    const c = newCategory.trim();
    setNewCategory('');
    setAddingCategory(false);
    if (!c) return;
    addCategory(c);
    pickCategory(c);
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={dismiss} />
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
            <TouchableOpacity
              style={[styles.addBtn, !title.trim() && styles.addBtnDisabled]}
              onPress={handleAdd}
              disabled={!title.trim()}
              accessibilityRole="button"
              accessibilityLabel="Create project"
            >
              <Ionicons name="arrow-up" size={18} color={colors.onAccent} />
            </TouchableOpacity>
          </View>

          {/* Attribute toolbar */}
          <View style={styles.toolbar}>
            <TouchableOpacity
              style={[styles.toolChip, activePanel === 'category' && styles.toolChipActive, category !== null && styles.toolChipSet]}
              onPress={() => togglePanel('category')}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={category !== null ? `Category: ${category}` : 'Set category'}
            >
              <Ionicons name="folder-outline" size={13} color={category ? colors.accent : colors.textTertiary} />
              {category !== null && <Text style={[styles.toolChipText, styles.toolChipTextSet]}>{category}</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.toolChip, targetStartDate != null && styles.toolChipSet]}
              onPress={() => setStartPickerVisible(true)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={targetStartDate ? `Start date: ${formatStartDate(targetStartDate.toISOString())}` : 'Set start date'}
            >
              <Ionicons name="play-outline" size={13} color={targetStartDate ? colors.accent : colors.textTertiary} />
              {targetStartDate != null && (
                <Text style={[styles.toolChipText, styles.toolChipTextSet]}>
                  {formatStartDate(targetStartDate.toISOString())}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.toolChip, targetEndDate != null && styles.toolChipSet]}
              onPress={() => setEndPickerVisible(true)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={targetEndDate ? `Target date: ${formatDueDate(targetEndDate.toISOString())}` : 'Set target date'}
            >
              <Ionicons name="flag-outline" size={13} color={targetEndDate ? colors.accent : colors.textTertiary} />
              {targetEndDate != null && (
                <Text style={[styles.toolChipText, styles.toolChipTextSet]}>
                  {formatDueDate(targetEndDate.toISOString())}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {activePanel === 'category' && (
            <View style={styles.panel}>
              <View style={styles.presetRow}>
                <TouchableOpacity
                  style={[styles.presetChip, category === null && styles.presetChipActive]}
                  onPress={() => pickCategory(null)}
                  activeOpacity={interaction.activeOpacity}
                >
                  <Text style={[styles.presetChipText, category === null && styles.presetChipTextActive]}>None</Text>
                </TouchableOpacity>
                {categories.map(cat => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.presetChip, category === cat.name && styles.presetChipActive]}
                    onPress={() => pickCategory(category === cat.name ? null : cat.name)}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Text style={[styles.presetChipText, category === cat.name && styles.presetChipTextActive]}>
                      {cat.name}
                    </Text>
                  </TouchableOpacity>
                ))}
                {addingCategory ? (
                  <TextInput
                    autoFocus
                    style={styles.categoryInput}
                    value={newCategory}
                    onChangeText={setNewCategory}
                    onSubmitEditing={commitNewCategory}
                    onBlur={commitNewCategory}
                    placeholder="category name"
                    placeholderTextColor={colors.textTertiary}
                    returnKeyType="done"
                    autoCapitalize="words"
                  />
                ) : (
                  <TouchableOpacity
                    style={styles.addCategoryBtn}
                    onPress={() => setAddingCategory(true)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel="New category"
                  >
                    <Ionicons name="add" size={14} color={colors.accent} />
                    <Text style={styles.addCategoryText}>New</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          <TouchableOpacity style={styles.moreBtn} onPress={handleOpenFull} activeOpacity={interaction.activeOpacity}>
            <Ionicons name="create-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.moreBtnText}>More details</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>

      <CalendarPicker
        visible={startPickerVisible}
        value={targetStartDate}
        mode="date"
        title="Start Date"
        onConfirm={date => { setTargetStartDate(date); setStartPickerVisible(false); }}
        onCancel={() => setStartPickerVisible(false)}
      />
      <CalendarPicker
        visible={endPickerVisible}
        value={targetEndDate}
        mode="date"
        title="Target Date"
        onConfirm={date => { setTargetEndDate(date); setEndPickerVisible(false); }}
        onCancel={() => setEndPickerVisible(false)}
      />
    </Modal>
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
    backgroundColor: colors.accent,
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
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
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
  },
  toolChipTextSet: {
    color: colors.accent,
  },
  panel: {
    marginBottom: spacing.sm,
    paddingTop: spacing.xs,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    alignItems: 'center',
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
  },
  presetChipActive: {
    backgroundColor: colors.accent,
  },
  presetChipText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  presetChipTextActive: {
    color: colors.onAccent,
    fontWeight: fontWeight.semibold,
  },
  categoryInput: {
    color: colors.text,
    fontSize: font.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
    paddingVertical: 4,
    paddingHorizontal: 4,
    minWidth: 80,
  },
  addCategoryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.bgQuaternary,
    borderStyle: 'dashed',
  },
  addCategoryText: {
    color: colors.accent,
    fontSize: font.sm,
  },
  moreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
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
