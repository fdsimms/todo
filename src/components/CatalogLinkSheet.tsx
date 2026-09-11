import React, { useMemo } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, spacing, type Colors } from '../theme';
import type { GroceryItem } from '../types';
import { CatalogLinkPicker } from './CatalogLinkPicker';
import { SheetHeaderButton } from './SheetHeaderButton';

/**
 * `CatalogLinkPicker` in a sheet, for a caller with no room to open it in place.
 *
 * The picker itself is a plain view and every surface that asks "which item is
 * this?" reuses it rather than growing a second ranked search — the scan review
 * sheet and the log's own search field both render it inline, under the row
 * being asked about. A list row has nowhere to put it, so this is the same
 * question in the shape a list can ask it.
 *
 * **No unsaved-changes guard, and that is the right answer rather than a
 * missing one.** Picking commits immediately through `onPick`, so a swipe-down
 * has nothing staged to lose — the carve-out CLAUDE.md draws for
 * `GroceryItemSheet` and the plain pickers, not the `handleCancel` case.
 */
interface Props {
  visible: boolean;
  /** What is being filed, named in the sheet so the question is answerable. */
  subject: string;
  items: readonly GroceryItem[];
  /** Seeds the search — usually whatever the thing is already called. */
  initialQuery: string;
  /** The row it already points at, left out of its own results. */
  excludeItemId?: string | null;
  onPick: (item: GroceryItem) => void;
  onClose: () => void;
}

export function CatalogLinkSheet({
  visible, subject, items, initialQuery, excludeItemId, onPick, onClose,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={64} />
          <Text style={styles.title} numberOfLines={1}>Which item is this?</Text>
          {/* Balances the Cancel button so the title stays optically centered. */}
          <View style={styles.spacer} />
        </View>
        <ScrollView
          style={styles.bodyScroll}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.subject} numberOfLines={2}>{subject}</Text>
          <CatalogLinkPicker
            items={items}
            initialQuery={initialQuery}
            excludeItemId={excludeItemId}
            onPick={onPick}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.separator,
    },
    title: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold, flex: 1, textAlign: 'center' },
    spacer: { minWidth: 64 },
    bodyScroll: { flex: 1 },
    body: { padding: spacing.md, paddingBottom: spacing.xl },
    subject: { color: colors.textSecondary, fontSize: font.sm, marginBottom: spacing.md },
  });
}
