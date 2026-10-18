import React, { useMemo, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import type { EditorJumpTracker } from '../utils/editorJump';

export interface JumpSection {
  key: string;
  /** One short word: the bar fits eight of them across a phone. */
  label: string;
  icon: string;
}

/**
 * The question cards the task and template item editors share, in their order,
 * as the bar names them. Each icon is its card's lead row's, so the bar reads as
 * an index of the form below it.
 */
export const EDITOR_CARD_SECTIONS: JumpSection[] = [
  { key: 'when', label: 'When', icon: 'calendar-outline' },
  { key: 'repeat', label: 'Repeat', icon: 'repeat' },
  { key: 'priority', label: 'Priority', icon: 'podium-outline' },
  { key: 'filed', label: 'Filed', icon: 'folder-outline' },
  { key: 'waits', label: 'Waits', icon: 'hourglass-outline' },
  { key: 'who', label: 'Who', icon: 'people-outline' },
  { key: 'opens', label: 'Opens', icon: 'open-outline' },
  { key: 'finish', label: 'Finish', icon: 'checkmark-done-outline' },
];

interface Props {
  tracker: EditorJumpTracker;
  /** Every card the bar can show, in order. Only the ones rendered appear. */
  sections: JumpSection[];
  onJump: (key: string) => void;
}

/**
 * The row of icons pinned under an editor sheet's header, one per card. Tapping
 * one scrolls to that card, the highlight follows the card you're in as you
 * scroll, and a dot marks a card with something set in it.
 *
 * It subscribes to the tracker rather than taking the active card as a prop,
 * so a scroll re-renders this row and nothing else in the sheet.
 */
export function EditorJumpBar({ tracker, sections, onJump }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const snap = useSyncExternalStore(tracker.subscribe, tracker.getSnapshot);
  const shown = sections.filter(s => snap.present.includes(s.key));
  if (shown.length === 0) return null;

  return (
    <View style={styles.bar}>
      {shown.map(s => {
        const active = snap.active === s.key;
        const set = snap.withValue.includes(s.key);
        const tint = active ? colors.accentText : colors.textSecondary;
        return (
          <PressableScale
            key={s.key}
            style={[styles.cell, active && styles.cellActive]}
            onPress={() => onJump(s.key)}
            haptic
            accessibilityRole="button"
            accessibilityLabel={`${s.label}${set ? ', has fields set' : ''}`}
            accessibilityState={{ selected: active }}
          >
            <View>
              {/* 18, the editor rows' own icon size, so the bar reads as their index. */}
              <Ionicons name={s.icon as never} size={18} color={tint} />
              {set && <View style={styles.dot} />}
            </View>
            <Text style={[styles.label, { color: tint }, active && styles.labelActive]} numberOfLines={1}>
              {s.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xs, paddingVertical: spacing.xsm,
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  // Each cell takes its label's width and shares out what's left, rather than
  // an equal eighth: the longer labels ("Priority", "Repeat") ran into each
  // other at equal widths.
  cell: {
    flexGrow: 1, flexShrink: 1, minWidth: 0,
    alignItems: 'center', gap: 3,
    paddingTop: spacing.xsm, paddingBottom: 5, paddingHorizontal: spacing.xxs,
    borderRadius: radius.sm,
  },
  cellActive: { backgroundColor: colors.accentSubtle },
  // On the icon's top-right corner, as a badge sits.
  dot: {
    position: 'absolute', top: -1, right: -4,
    width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent,
  },
  label: { fontSize: font.xxs, fontWeight: fontWeight.medium },
  labelActive: { fontWeight: fontWeight.semibold },
});
