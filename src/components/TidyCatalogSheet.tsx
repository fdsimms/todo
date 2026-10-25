import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SheetModal } from './SheetModal';
import { useShallow } from 'zustand/react/shallow';
import { useGroceryStore } from '../store/useGroceryStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { auditCatalog, suggestedName, type AuditFinding } from '../utils/catalogAudit';
import {
  CATALOG_AUDIT_DISMISSED_KEY,
  findingKey,
  parseDismissed,
  visibleFindings,
  withDismissed,
} from '../utils/catalogAuditDismissed';
import { renameClash } from '../utils/groceryItemWrite';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { BUTTON_LABEL } from '../copy/shared';
import { EmptyState } from './EmptyState';
import { InlineAction } from './InlineAction';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';

interface Props {
  visible: boolean;
  onClose: () => void;
}

// ==== groups ====

type Group = 'brand' | 'same' | 'label';

const GROUP_TITLE: Record<Group, string> = {
  brand: 'Brand in the name',
  same: 'Same thing, two names',
  label: 'Reads like a package label',
};
const GROUP_ORDER: Group[] = ['brand', 'same', 'label'];

function groupOf(f: AuditFinding): Group {
  if (f.kind === 'brand_in_name') return 'brand';
  if (f.kind === 'same_words') return 'same';
  return 'label';
}

/** The line under a finding's name, in the words the rest of the app uses. */
function reasonFor(f: AuditFinding): string {
  switch (f.kind) {
    case 'brand_in_name':
      return f.confidence === 'high'
        ? `The name is the brand “${f.brand}”.`
        : `The name contains the brand “${f.brand}”.`;
    case 'same_words':
      return 'These use the same words once small differences are ignored.';
    case 'all_caps':
      return 'The name is in all capitals.';
    case 'size_in_name':
      return 'The name ends with a package size.';
    default:
      return 'The name is long, like a package title.';
  }
}

/**
 * Names in the catalog that look like a brand, a package label or a duplicate,
 * with the three things a person does about each: rename it, merge it into the
 * row it repeats, or leave it.
 *
 * **It reads `auditCatalog` and writes only through the store's own rename and
 * merge**, so a rename here collides, follows the remembered aisle and learns
 * recipe keys exactly as one in the item sheet does. The kind-of pairs the
 * audit can also find ("onion", "white onion") are not listed: most are
 * deliberate, and the item sheet is where a kind is declared.
 *
 * "Leave it" is remembered (`catalogAuditDismissed`, synced) by the finding's
 * kind and name keys, so a renamed row asks again and an untouched one doesn't.
 */
export function TidyCatalogSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const scroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const items = useGroceryStore(useShallow(s => s.items));
  const itemProducts = useGroceryStore(useShallow(s => s.itemProducts));
  const renameItem = useGroceryStore(s => s.renameItem);
  const mergeItems = useGroceryStore(s => s.mergeItems);

  const [dismissed, setDismissed] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ key: string; text: string } | null>(null);

  // Read on open: another device's "leave it" arrives in the settings table
  // while this sheet is closed.
  useEffect(() => {
    if (visible) setDismissed(parseDismissed(dbGetSetting(CATALOG_AUDIT_DISMISSED_KEY)));
    else setEditing(null);
  }, [visible]);

  const findings = useMemo(() => {
    const all = auditCatalog(items, itemProducts).filter(f => f.kind !== 'maybe_kind_of');
    return visibleFindings(all, dismissed);
  }, [items, itemProducts, dismissed]);

  const groups = useMemo(
    () =>
      GROUP_ORDER.map(g => ({ group: g, rows: findings.filter(f => groupOf(f) === g) })).filter(g => g.rows.length > 0),
    [findings]
  );

  const leave = (f: AuditFinding) => {
    haptics.tap();
    animateLayout();
    const next = withDismissed(dismissed, findingKey(f));
    dbSetSetting(CATALOG_AUDIT_DISMISSED_KEY, JSON.stringify(next));
    setDismissed(next);
    setEditing(null);
  };

  const startRename = (f: AuditFinding) => {
    haptics.tap();
    setEditing({ key: findingKey(f), text: suggestedName(f) });
  };

  const merge = (loser: AuditFinding['items'][number], keep: AuditFinding['items'][number]) => {
    Alert.alert(
      'Merge these two?',
      `Everything recorded on “${loser.name}” moves to “${keep.name}”, and “${loser.name}” stays as another name for it.`,
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        {
          text: 'Merge',
          style: 'destructive',
          onPress: () => {
            animateLayout();
            if (mergeItems(loser.id, keep.id)) haptics.success();
          },
        },
      ]
    );
  };

  const saveRename = (row: AuditFinding['items'][number], text: string) => {
    const name = text.trim();
    if (!name) return;
    const clash = renameClash(items, row.id, name);
    if (clash) {
      // The new name is a row that exists, so the honest answer is a merge, and
      // the person decides.
      Alert.alert(
        `“${clash.name}” already exists`,
        `Merge “${row.name}” into it? Everything recorded on “${row.name}” moves over.`,
        [
          { text: BUTTON_LABEL.cancel, style: 'cancel' },
          {
            text: 'Merge',
            style: 'destructive',
            onPress: () => {
              animateLayout();
              if (mergeItems(row.id, clash.id)) {
                haptics.success();
                setEditing(null);
              }
            },
          },
        ]
      );
      return;
    }
    animateLayout();
    if (renameItem(row.id, name)) {
      haptics.success();
      setEditing(null);
    }
  };

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <SheetHeader
          title="Tidy catalog"
          left={<View style={styles.headerSpacer} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.done} onPress={onClose} minWidth={56} />}
        />

        {findings.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="checkmark-circle-outline"
              title="Names look tidy"
              subtitle="Nothing in the catalog looks like a brand name, a package label or a repeat of another item."
            />
          </View>
        ) : (
          <ScrollView ref={scroll.ref} {...scroll.props} contentContainerStyle={styles.list}>
            <Text style={styles.count}>
              {findings.length === 1 ? '1 name to look at' : `${findings.length} names to look at`}
            </Text>
            {groups.map(({ group, rows }) => (
              <View key={group}>
                <Text style={styles.groupLabel}>{`${GROUP_TITLE[group]} (${rows.length})`}</Text>
                {rows.map(f => {
                  const key = findingKey(f);
                  const open = editing?.key === key;
                  const [first, second] = f.items;
                  return (
                    <View key={key} style={styles.card}>
                      <Text style={styles.name}>{f.items.map(i => i.name).join('  ·  ')}</Text>
                      <Text style={styles.reason}>{reasonFor(f)}</Text>
                      {open ? (
                        <View style={styles.editRow}>
                          <TextField
                            style={styles.input}
                            value={editing.text}
                            onChangeText={t => setEditing({ key, text: t })}
                            placeholder="New name"
                            placeholderTextColor={colors.textTertiary}
                            autoFocus
                            returnKeyType="done"
                            onSubmitEditing={() => saveRename(first, editing.text)}
                            accessibilityLabel={`New name for ${first.name}`}
                          />
                          <View style={styles.actions}>
                            <InlineAction label={BUTTON_LABEL.save} onPress={() => saveRename(first, editing.text)} />
                            <InlineAction label={BUTTON_LABEL.cancel} variant="neutral" onPress={() => setEditing(null)} />
                          </View>
                        </View>
                      ) : (
                        <View style={styles.actions}>
                          {f.kind === 'same_words' && second ? (
                            <>
                              <InlineAction label={`Keep “${first.name}”`} onPress={() => merge(second, first)} />
                              <InlineAction label={`Keep “${second.name}”`} variant="neutral" onPress={() => merge(first, second)} />
                            </>
                          ) : (
                            <InlineAction label="Rename" onPress={() => startRename(f)} />
                          )}
                          <InlineAction label="Leave it" variant="neutral" onPress={() => leave(f)} />
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    headerSpacer: { width: 56 },
    emptyWrap: { flex: 1, paddingHorizontal: spacing.md },
    list: { padding: spacing.md, paddingBottom: spacing.xl },
    count: { color: colors.textSecondary, fontSize: font.sm, marginBottom: spacing.xs },
    groupLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.smd,
      marginBottom: spacing.sm,
    },
    name: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    reason: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
    editRow: { marginTop: spacing.sm },
    input: {
      color: colors.text,
      fontSize: font.md,
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.smd,
      paddingVertical: spacing.sm,
    },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  });
}
