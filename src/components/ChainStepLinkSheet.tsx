import React, { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, useCardSheet } from './CardSheet';
import type { ChainItem } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { KNOWN_LINK_APPS, linkAppsFor } from '../constants/linkApps';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { BUTTON_LABEL } from '../copy/shared';
import { FieldLabel } from './FieldLabel';
import { RotatingChevron } from './RotatingChevron';
import { animateLayout } from '../utils/layoutAnimation';

/**
 * The minimum a list item has to carry to have a link button, satisfied by
 * `ChainItem` and `RotationItem` alike.
 *
 * Widened from `ChainItem` when rotations arrived, rather than copying this
 * sheet: it only ever reads an id, a title and a link, and a second near
 * identical sheet is precisely the drift `SheetHeaderButton` and
 * `InlineAction` exist to undo.
 */
export type LinkableItem = Pick<ChainItem, 'id' | 'title' | 'linkUrl'>;

interface Props {
  visible: boolean;
  /** The step or member being edited; its title is the sheet's subject. */
  step: LinkableItem | null;
  kitchenEnabled: boolean;
  /** Applies the step's new link. `onClose` follows it — the host hides the sheet. */
  onSave: (patch: Pick<LinkableItem, 'linkUrl'>) => void;
  onClose: () => void;
}

/**
 * What one chain step's link button opens — the per-step half of "Link" (see
 * `ChainItem.linkUrl`).
 *
 * A sheet rather than controls unfolding on the step row, for the reason
 * `ChainStepMedicationSheet` beside it gives: the row lives inside a
 * `SortableList`, and a control that expands in place changes the row's
 * height mid-drag, which is the one thing that list's displacement math
 * can't absorb.
 *
 * Shared by the task editor and the template item editor, like that sheet
 * is. Same chips + custom URL shape as the task-level Link row.
 */
export function ChainStepLinkSheet({
  visible, step, kitchenEnabled, onSave, onClose,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const card = useCardSheet();

  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  // Most steps get a web address, so the app pills stay folded until asked
  // for, or until the step already points at one of them.
  const [appsOpen, setAppsOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const initial = step?.linkUrl ?? null;
    setLinkUrl(initial);
    const isApp = !!initial && KNOWN_LINK_APPS.some(app => app.scheme === initial);
    setCustomText(initial && !isApp ? initial : '');
    setAppsOpen(isApp);
  }, [visible, step?.id]);

  const dismiss = (after: () => void) => {
    Keyboard.dismiss();
    card.close(() => {
      after();
    });
  };

  const commitCustomText = () => {
    const trimmed = customText.trim();
    setLinkUrl(trimmed || null);
  };

  const save = () => {
    haptics.success();
    const trimmed = customText.trim();
    const resolved = trimmed || linkUrl;
    dismiss(() => { onSave({ linkUrl: resolved || null }); onClose(); });
  };

  return (
    <CardSheet
      name="ChainStepLinkSheet"
      visible={visible}
      controller={card}
      onRequestClose={() => dismiss(onClose)}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton
            label="Clear"
            role="cancel"
            onPress={() => { setLinkUrl(null); setCustomText(''); }}
            minWidth={56}
          />
          <Text style={styles.heading} numberOfLines={2}>{step?.title ?? 'Step'}</Text>
          <SheetHeaderButton label={BUTTON_LABEL.done} onPress={save} minWidth={56} style={styles.headerRight} />
        </View>

        <Text style={styles.label}>Link</Text>
        <View style={styles.body}>
          <FieldLabel style={styles.webLabel}>Web address</FieldLabel>
          <View style={styles.customRow}>
            <Ionicons name="globe-outline" size={16} color={colors.textSecondary} />
            <TextField
              style={styles.customInput}
              value={customText}
              onChangeText={setCustomText}
              onSubmitEditing={commitCustomText}
              onBlur={commitCustomText}
              placeholder="e.g. https://example.com or app://"
              placeholderTextColor={colors.textTertiary}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="done"
              accessibilityLabel="Custom link URL for this step"
            />
          </View>
          <TouchableOpacity
            style={styles.appsRow}
            onPress={() => { haptics.tap(); animateLayout(); setAppsOpen(v => !v); }}
            accessibilityRole="button"
            accessibilityLabel="Open an app"
            accessibilityState={{ expanded: appsOpen }}
          >
            <Text style={styles.appsLabel}>Or open an app</Text>
            <RotatingChevron open={appsOpen} size={14} color={colors.textSecondary} />
          </TouchableOpacity>
          {appsOpen && (
            <View style={styles.chipRow}>
              {linkAppsFor(kitchenEnabled).map(app => (
                <TouchableOpacity
                  key={app.scheme}
                  style={[styles.chip, linkUrl === app.scheme && styles.chipActive]}
                  onPress={() => { haptics.tap(); setLinkUrl(app.scheme); setCustomText(''); }}
                >
                  <Ionicons
                    name={app.icon as never}
                    size={13}
                    color={linkUrl === app.scheme ? colors.onAccent : colors.textSecondary}
                  />
                  <Text style={[styles.chipText, linkUrl === app.scheme && styles.chipTextActive]}>
                    {app.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: {
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  heading: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  headerRight: { textAlign: 'right' },
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  body: { paddingHorizontal: spacing.md, gap: spacing.sm },
  webLabel: { marginTop: spacing.smd, marginBottom: 0 },
  appsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  appsLabel: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { color: colors.textSecondary, fontSize: font.sm },
  chipTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.smd,
    minHeight: 36,
  },
  customInput: { flex: 1, color: colors.text, fontSize: font.md },
});
