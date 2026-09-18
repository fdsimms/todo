import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SheetModal } from './SheetModal';
import type { ChainItem } from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, animation, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { KNOWN_LINK_APPS, linkAppsFor } from '../constants/linkApps';
import { SafeBlurView } from './SafeBlurView';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetScrim } from './SheetScrim';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';

interface Props {
  visible: boolean;
  /** The step being edited; its title is the sheet's subject. */
  step: ChainItem | null;
  /** What the task itself opens, named in the hint so the empty state can say what leaving it empty actually does. */
  taskLinkUrl: string | null;
  kitchenEnabled: boolean;
  /** Applies the step's new link. `onClose` follows it — the host hides the sheet. */
  onSave: (patch: Pick<ChainItem, 'linkUrl'>) => void;
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
  visible, step, taskLinkUrl, kitchenEnabled, onSave, onClose,
}: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const hiddenY = useSheetHiddenOffset();
  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(hiddenY);
    backdropOpacity.setValue(0);
    const initial = step?.linkUrl ?? null;
    setLinkUrl(initial);
    setCustomText(initial && !KNOWN_LINK_APPS.some(app => app.scheme === initial) ? initial : '');
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
  }, [visible, step?.id]);

  const dismiss = (after: () => void) => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
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
    <SheetModal visible={visible} animationType="none" transparent onRequestClose={() => dismiss(onClose)}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <SheetScrim onPress={() => dismiss(onClose)} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.avoider}
        pointerEvents="box-none"
      >
        <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
          <View style={styles.card}>
            <View style={styles.headerRow}>
              <SheetHeaderButton
                label="Clear"
                role="cancel"
                onPress={() => { setLinkUrl(null); setCustomText(''); }}
                minWidth={56}
              />
              <Text style={styles.heading} numberOfLines={2}>{step?.title ?? 'Step'}</Text>
              <SheetHeaderButton label="Done" onPress={save} minWidth={56} style={styles.headerRight} />
            </View>

            <Text style={styles.label}>Link</Text>
            <View style={styles.body}>
              <Text style={styles.hint}>
                {taskLinkUrl
                  ? "Leave it empty and this step opens the task's link."
                  : 'Leave it empty and this step opens nothing.'}
              </Text>
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
              <View style={styles.customRow}>
                <Ionicons name="globe-outline" size={16} color={colors.textSecondary} />
                <TextInput
                  style={styles.customInput}
                  value={customText}
                  onChangeText={setCustomText}
                  onSubmitEditing={commitCustomText}
                  onBlur={commitCustomText}
                  placeholder="e.g. https://... or app://"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  returnKeyType="done"
                  accessibilityLabel="Custom link URL for this step"
                />
              </View>
            </View>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  avoider: { flex: 1, justifyContent: 'flex-end' },
  sheetOuter: {
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
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
  hint: { color: colors.textSecondary, fontSize: font.sm },
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
    height: 36,
  },
  customInput: { flex: 1, color: colors.text, fontSize: font.md },
});
