import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { useCopyFlagStore } from '../store/useCopyFlagStore';
import { navigationRef } from '../navigation/navigationRef';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import {
  getFlagModeVersion,
  isFlagMode,
  setCaptureListener,
  setFlagMode,
  setFlaggedTexts,
  subscribeFlagMode,
} from '../utils/copyFlagMode';

/**
 * TEMPORARY dev tooling (see `CopyFlag`), mounted once at the app's root.
 * While flag mode is on (Settings › About), a long-press on any text opens this
 * card with the string and the screen it was on, and Save files a flag that
 * Claude reads over MCP. A second long-press on already-flagged text reopens
 * its flag, with a way to remove it.
 */
export function FlagCopyHost() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const card = useCardSheet();

  // Re-renders on a mode change, which is all this host reads from the module.
  useSyncExternalStore(subscribeFlagMode, getFlagModeVersion);
  const modeOn = isFlagMode();

  const flags = useCopyFlagStore(s => s.flags);
  const addFlag = useCopyFlagStore(s => s.addFlag);
  const updateNote = useCopyFlagStore(s => s.updateNote);
  const removeFlag = useCopyFlagStore(s => s.removeFlag);

  const [capture, setCapture] = useState<{ text: string; screen: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');

  const existing = capture
    ? flags.find(f => f.status === 'open' && f.text === capture.text && f.screen === capture.screen)
    : undefined;

  useEffect(() => {
    setFlaggedTexts(flags.filter(f => f.status === 'open').map(f => f.text));
  }, [flags]);

  useEffect(() => {
    setCaptureListener(text => {
      if (open) return;
      const screen = navigationRef.getCurrentRoute()?.name ?? 'Unknown';
      const found = useCopyFlagStore.getState().flags.find(
        f => f.status === 'open' && f.text === text && f.screen === screen,
      );
      haptics.tap();
      setCapture({ text, screen });
      setNote(found?.note ?? '');
      setOpen(true);
    });
    return () => setCaptureListener(null);
  }, [open]);

  const dismiss = (after?: () => void) => card.close(() => { after?.(); setOpen(false); });

  const save = () => {
    if (!capture) return;
    haptics.success();
    dismiss(() => {
      if (existing) updateNote(existing.id, note);
      else addFlag(capture.text, capture.screen, note);
    });
  };

  const remove = () => {
    if (!existing) return;
    haptics.tap();
    dismiss(() => removeFlag(existing.id));
  };

  return (
    <>
      {modeOn && (
        <View pointerEvents="box-none" style={[styles.bannerWrap, { top: insets.top + spacing.xs }]}>
          <TouchableOpacity
            style={styles.banner}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Stop flagging copy"
            onPress={() => setFlagMode(false)}
          >
            <Text style={styles.bannerText}>Long-press text to flag it. Tap to stop.</Text>
          </TouchableOpacity>
        </View>
      )}
      <CardSheet
        name="FlagCopyHost"
        visible={open}
        controller={card}
        onClose={() => setCapture(null)}
        onRequestClose={() => dismiss()}
      >
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <SheetHeaderButton label="Cancel" role="cancel" onPress={() => dismiss()} minWidth={56} />
            <Text style={styles.heading}>{existing ? 'Flagged copy' : 'Flag copy'}</Text>
            <SheetHeaderButton label="Save" onPress={save} minWidth={56} style={styles.headerRight} />
          </View>
          <View style={styles.body}>
            <Text style={styles.label}>Text</Text>
            <Text style={styles.quote}>{capture?.text}</Text>
            <Text style={styles.hint}>On screen: {capture?.screen}</Text>
            <TextField
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder="What is wrong with it (optional)"
              placeholderTextColor={colors.textTertiary}
              multiline
            />
            {existing && (
              <TouchableOpacity
                onPress={remove}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Remove flag"
              >
                <Text style={styles.remove}>Remove flag</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </CardSheet>
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  bannerWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  banner: {
    backgroundColor: colors.accentFill,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xsm,
  },
  bannerText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.semibold },
  card: { paddingBottom: spacing.md },
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
  body: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.xs },
  label: { color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, letterSpacing: 0.8, textTransform: 'uppercase' },
  quote: { color: colors.text, fontSize: font.md, marginBottom: spacing.xs },
  hint: { color: colors.textSecondary, fontSize: font.sm, marginBottom: spacing.sm },
  input: {
    minHeight: 64,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.smd,
    color: colors.text,
    fontSize: font.md,
  },
  remove: { color: colors.redText, fontSize: font.md, paddingTop: spacing.smd },
});
