import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, useCardSheet, type CardAnchor } from './CardSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useProjectActions } from '../hooks/useProjectActions';
import { useProjectStore } from '../store/useProjectStore';
import type { Project } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Where the "..." was tapped, so the menu opens from it. See `CardSheet`. */
  anchor?: CardAnchor | null;
  project: Project;
  onConvert: () => void;
}

interface MenuRowProps {
  card: ReturnType<typeof useCardSheet>;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint?: string;
  onPress: () => void;
  destructive?: boolean;
  checked?: boolean;
  accessibilityRole?: 'button' | 'switch';
}

function MenuRow({ card, icon, label, hint, onPress, destructive, checked, accessibilityRole = 'button' }: MenuRowProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => {
        haptics.tap();
        card.close(onPress);
      }}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={label}
      accessibilityState={checked === undefined ? undefined : { checked }}
    >
      <Ionicons name={icon} size={18} color={destructive ? colors.red : colors.textSecondary} />
      <View style={styles.content}>
        <Text style={[styles.label, destructive && { color: colors.redText }]}>{label}</Text>
        {!!hint && <Text style={styles.hint}>{hint}</Text>}
      </View>
      {checked && <Ionicons name="checkmark" size={18} color={colors.accent} />}
    </TouchableOpacity>
  );
}

/**
 * The project page's overflow ("...") menu: the one-shot actions on the page
 * itself. Whether it is a project or a list is chosen when one is made (quick
 * add's Project/List control), so converting is rare and lives here rather than
 * as a header toggle that made a list look like a project with a switch on. The
 * rest (finish, file away, reuse, delete) are the same actions the editor's
 * bottom cards run, through `useProjectActions`.
 */
export function ProjectPageMenu({ visible, onClose, anchor, project, onConvert }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const updateProject = useProjectStore(s => s.updateProject);
  const actions = useProjectActions(project);
  const isList = project.kind === 'list';
  const keepChecked = project.showChecked ?? false;

  return (
    <CardSheet
      name="ProjectPageMenu"
      visible={visible}
      onClose={onClose}
      controller={card}
      anchor={anchor}
      popoverWidth={300}
      scrimLabel="Close menu"
    >
      <MenuRow card={card}
        icon={isList ? 'briefcase-outline' : 'list-outline'}
        label={isList ? 'Convert to project' : 'Convert to list'}
        hint={isList
          ? 'Adds a finish line and a progress bar'
          : 'No finish line or progress bar. Items are checked off and reused'}
        onPress={onConvert}
      />
      {isList && (
        <>
          <View style={styles.sep} />
          <MenuRow card={card}
            icon="checkmark-done-outline"
            label="Keep checked items in view"
            hint="Checked items stay at the bottom, crossed out"
            checked={keepChecked}
            accessibilityRole="switch"
            onPress={() => updateProject(project.id, { showChecked: !keepChecked })}
          />
        </>
      )}
      <View style={styles.sep} />
      <MenuRow card={card}
        icon={project.completed ? 'refresh-outline' : 'checkmark-circle-outline'}
        label={project.completed ? 'Reopen' : 'Mark complete'}
        hint={project.completed ? 'Moves it back to the active list' : 'Moves it to the Completed list'}
        onPress={project.completed ? actions.reopen : actions.complete}
      />
      <View style={styles.sep} />
      <MenuRow card={card}
        icon="archive-outline"
        label={project.archived ? 'Unarchive' : 'Archive'}
        hint={project.archived ? 'Moves it back out of the Archived list' : 'Moves it to the Archived list'}
        onPress={project.archived ? actions.unarchive : actions.archive}
      />
      <View style={styles.sep} />
      <MenuRow card={card}
        icon="copy-outline"
        label="Save as template"
        hint="Keeps it to apply again later"
        onPress={actions.saveAsTemplate}
      />
      <View style={styles.sep} />
      <MenuRow card={card}
        icon="duplicate-outline"
        label="Start a fresh copy"
        hint={isList ? 'A new list with the same items, all unchecked' : 'A new project with the same tasks, all open and undated'}
        onPress={actions.startFresh}
      />
      <View style={styles.sep} />
      <MenuRow card={card}
        icon="trash-outline"
        label={isList ? 'Delete list' : 'Delete project'}
        destructive
        onPress={actions.confirmDelete}
      />
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    minHeight: 56,
  },
  content: { flex: 1 },
  label: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: spacing.md + 18 + spacing.sm },
  hint: { color: colors.textTertiary, fontSize: font.sm, marginTop: spacing.xxs },
});
