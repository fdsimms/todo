import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Person } from '../types';
import { TITLE_MAX_LENGTH } from '../types';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { usePersonGroupStore } from '../store/usePersonGroupStore';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorSheet } from './EditorSheet';
import { PillGroup } from './PillGroup';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  person: Person | null;
  onClose: () => void;
}

/**
 * A couple or a household, hand-named and hand-picked — see the "Groups"
 * section of `docs/arch/people.md`. Opened from `PersonEditor`'s own "Group"
 * row for the person it was opened on, so it always shows one of two shapes:
 * this person already has a group (rename it, manage who's in it), or they
 * don't (join an existing one, or start a new one).
 *
 * Same "plain title TextInput at the top of an EditorSheet" idiom
 * `PersonEditor` and `TaskGroupEditor` both already use for their own name
 * field — a group's name is exactly as ordinary a thing to edit as a
 * person's or a stack's.
 */
export function PersonGroupEditor({ visible, person, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const people = usePersonStore(s => s.people);
  const updatePerson = usePersonStore(s => s.updatePerson);
  const groups = usePersonGroupStore(s => s.groups);
  const createGroup = usePersonGroupStore(s => s.createGroup);
  const updateGroup = usePersonGroupStore(s => s.updateGroup);
  const removeGroupRow = usePersonGroupStore(s => s.removeGroupRow);

  const [name, setName] = useState('');
  const [newGroupName, setNewGroupName] = useState('');

  const currentGroup = person?.groupId ? groups.find(g => g.id === person.groupId) ?? null : null;

  useEffect(() => {
    if (!visible) return;
    setName(currentGroup?.name ?? '');
    setNewGroupName('');
    // Only re-hydrate when the sheet opens or the group identity changes —
    // not on every keystroke into `name` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, currentGroup?.id]);

  if (!person) return null;

  const saveAndClose = () => {
    const trimmed = name.trim();
    if (currentGroup && trimmed && trimmed !== currentGroup.name) {
      updateGroup(currentGroup.id, { name: trimmed });
    }
    onClose();
  };

  const handleDeleteGroup = () => {
    if (!currentGroup) return;
    Alert.alert(
      `Delete ${currentGroup.name}?`,
      'Nobody in it is deleted. They just stop sharing one reminder and one tag.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => { removeGroupRow(currentGroup.id); onClose(); },
        },
      ]
    );
  };

  const startNewGroup = () => {
    const trimmed = newGroupName.trim();
    if (!trimmed) return;
    const group = createGroup(trimmed);
    updatePerson(person.id, { groupId: group.id });
    onClose();
  };

  const joinGroup = (groupId: string) => {
    haptics.tap();
    updatePerson(person.id, { groupId });
    onClose();
  };

  // Already grouped: rename, and pick who else is in it.
  if (currentGroup) {
    const activePeople = people.filter(p => !p.archived);
    return (
      <EditorSheet
        visible={visible}
        onRequestClose={saveAndClose}
        rootStyle={styles.root}
        headerStyle={styles.header}
        scrollStyle={styles.scroll}
        scrollContentStyle={styles.scrollContent}
        header={
          <>
            <SheetHeaderButton label="Done" onPress={saveAndClose} />
            <Text style={styles.headerTitle}>Group</Text>
            <TouchableOpacity onPress={handleDeleteGroup} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete group">
              <Ionicons name="trash-outline" size={20} color={colors.red} />
            </TouchableOpacity>
          </>
        }
      >
        <TextInput
          style={styles.titleInput}
          value={name}
          onChangeText={setName}
          placeholder="Group name"
          placeholderTextColor={colors.textTertiary}
          maxLength={TITLE_MAX_LENGTH}
        />
        <Text style={styles.groupLabel}>MEMBERS</Text>
        <View style={styles.pillWrap}>
          <PillGroup
            noun="member"
            surface="page"
            options={activePeople.map(p => ({
              key: p.id,
              label: displayNameOf(p),
              selected: p.groupId === currentGroup.id,
              accessibilityLabel: `${displayNameOf(p)} is in ${currentGroup.name || 'this group'}`,
              onPress: () => {
                haptics.tap();
                updatePerson(p.id, { groupId: p.groupId === currentGroup.id ? null : currentGroup.id });
              },
            }))}
          />
        </View>
        <Text style={styles.sectionFooter}>
          Everyone here shares one reach-out reminder and can be tagged together with a single "@" mention.
        </Text>
      </EditorSheet>
    );
  }

  // Not grouped yet: start one, or join one that already exists.
  return (
    <EditorSheet
      visible={visible}
      onRequestClose={onClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} />
          <Text style={styles.headerTitle}>Group</Text>
          <View style={{ minWidth: 44 }} />
        </>
      }
    >
      <Text style={styles.groupLabel}>NEW GROUP</Text>
      <View style={styles.sectionCard}>
        <View style={styles.fieldRow}>
          <TextInput
            style={styles.newGroupInput}
            value={newGroupName}
            onChangeText={setNewGroupName}
            placeholder="e.g. The Ortegas"
            placeholderTextColor={colors.textTertiary}
            maxLength={TITLE_MAX_LENGTH}
            autoFocus
          />
        </View>
      </View>
      <TouchableOpacity
        style={[styles.createButton, !newGroupName.trim() && styles.createButtonDisabled]}
        onPress={startNewGroup}
        disabled={!newGroupName.trim()}
        accessibilityRole="button"
        accessibilityLabel={`Add ${displayNameOf(person)} to a new group`}
      >
        <Text style={styles.createButtonText}>Create & add {displayNameOf(person)}</Text>
      </TouchableOpacity>

      {groups.length > 0 && (
        <>
          <Text style={styles.groupLabel}>OR JOIN AN EXISTING GROUP</Text>
          <View style={styles.sectionCard}>
            {groups.map((g, i) => (
              <React.Fragment key={g.id}>
                {i > 0 && <View style={styles.sep} />}
                <TouchableOpacity
                  style={styles.existingRow}
                  onPress={() => joinGroup(g.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${displayNameOf(person)} to ${g.name}`}
                >
                  <Text style={styles.existingLabel}>{g.name}</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
                </TouchableOpacity>
              </React.Fragment>
            ))}
          </View>
        </>
      )}
    </EditorSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  titleInput: {
    color: colors.text, fontSize: font.xl, fontWeight: fontWeight.medium,
    paddingVertical: spacing.sm, minHeight: 44,
  },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  pillWrap: { paddingHorizontal: spacing.xs },
  sectionCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  newGroupInput: { flex: 1, color: colors.text, fontSize: font.md, height: 24 },
  createButton: {
    marginTop: spacing.md,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
  },
  createButtonDisabled: { opacity: 0.5 },
  createButtonText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
  existingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: 13,
  },
  existingLabel: { color: colors.text, fontSize: font.md },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
  sectionFooter: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
  },
});
