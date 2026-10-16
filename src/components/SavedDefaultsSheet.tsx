import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { useProjectStore } from '../store/useProjectStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { GENERATED_KIND_SPECS } from '../utils/generatedTasks';
import { savedDefaultRows, type SavedDefaultRow } from '../utils/savedDefaults';
import type { GeneratedKind } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Every answer the Backfill screen (or an editor) has kept as the starting
 * value for new tasks, with a way to take each one back.
 *
 * The defaults are not stored here: a project's lives on the project and an
 * automatic task's in Settings (`savedDefaultRows` just reads both). Clearing
 * one changes what new tasks start with and nothing else, so tasks that already
 * took the value keep it. Every edit commits as it is made, so there is no
 * unsaved-changes guard to write.
 */
export function SavedDefaultsSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const projects = useProjectStore(useShallow(s => s.projects));
  const updateProject = useProjectStore(s => s.updateProject);
  const generatedDefaults = useSettingsStore(useShallow(s => s.generatedTaskDefaults));
  const setGeneratedTaskDefaults = useSettingsStore(s => s.setGeneratedTaskDefaults);
  const hideHelpText = useSettingsStore(s => s.hideHelpText);

  const rows = useMemo(
    () => savedDefaultRows(projects, generatedDefaults, kind => GENERATED_KIND_SPECS[kind as GeneratedKind]?.label ?? null),
    [projects, generatedDefaults],
  );
  const empty = rows.projects.length === 0 && rows.automatic.length === 0;

  const clear = (row: SavedDefaultRow) => {
    haptics.tap();
    animateLayout();
    if (row.home === 'project') updateProject(row.id, { taskDefaults: null });
    else setGeneratedTaskDefaults(row.id as GeneratedKind, null);
  };

  const renderGroup = (title: string, group: SavedDefaultRow[]) => group.length === 0 ? null : (
    <>
      <Text style={styles.groupLabel}>{title}</Text>
      <View style={styles.card}>
        {group.map((row, i) => (
          <View key={row.key}>
            {i > 0 && <View style={styles.sep} />}
            <View style={styles.row}>
              {/* The name gets the full width and wraps, with the button on its
                  own line below: beside it, the button would claim its width
                  first and truncate the one thing the row exists to show. */}
              <Text style={styles.name}>{row.label}</Text>
              <Text style={styles.meta}>{row.summary}</Text>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.clear}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => clear(row)}
                  accessibilityRole="button"
                  accessibilityLabel={`Clear the saved default for ${row.label}`}
                  accessibilityHint="New tasks stop starting with these answers. Existing tasks keep theirs."
                >
                  <Text style={styles.clearText}>Clear</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}
      </View>
    </>
  );

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <SheetHeader
          title="Defaults you've set"
          left={<View style={styles.headerSpacer} />}
          right={<SheetHeaderButton label="Done" onPress={onClose} minWidth={56} />}
        />
        {empty ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="options-outline"
              title="No defaults yet"
              subtitle="When you answer for a whole project or kind of automatic task in Backfill, you can keep the answer for new tasks. It will be listed here."
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {!hideHelpText && (
              <Text style={styles.caption}>
                New tasks added to these start with the answers below, so they skip Backfill.
                Clearing one leaves existing tasks alone.
              </Text>
            )}
            {renderGroup('PROJECTS', rows.projects)}
            {renderGroup('AUTOMATIC TASKS', rows.automatic)}
            <Text style={styles.footnote}>
              To change an answer instead of clearing it, open the project&apos;s “New task defaults”
              or the automatic task&apos;s settings in Automations.
            </Text>
          </ScrollView>
        )}
      </View>
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    // Matches Done's own minWidth, so the title stays optically centered.
    headerSpacer: { width: 56 },
    emptyWrap: { flex: 1, paddingHorizontal: spacing.md },
    list: { padding: spacing.md, paddingBottom: spacing.xl },
    caption: { color: colors.textSecondary, fontSize: font.sm, marginBottom: spacing.xs },
    groupLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md },
    sep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.md },
    row: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
    name: { color: colors.text, fontSize: font.md },
    meta: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
    actions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
    clear: {
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    clearText: { color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.medium },
    footnote: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.md },
  });
}
