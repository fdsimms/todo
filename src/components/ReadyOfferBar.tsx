import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../store/useTaskStore';
import { useSheetMount } from '../hooks/useSheetMount';
import { useSettingsStore } from '../store/useSettingsStore';
import { InlineAction } from './InlineAction';
import { WhenPicker } from './WhenPicker';
import { TAB_BAR_HEIGHT } from './DemoBanner';
import { FAB_SIZE } from './Fab';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { getLogicalToday } from '../utils/dateUtils';
import { displayTitleFor } from '../utils/visibilityUtils';

// Longer than the undo bar's six seconds: this one asks a question with two
// answers rather than offering one button.
const VISIBLE_MS = 8000;

/**
 * "Paint the hallway is ready: Today / Pick a day", after finishing the last
 * thing a task was waiting on.
 *
 * A task waiting on another reappears where its date puts it once the wait is
 * over, which for a task with no date is nowhere: it moved to Unscheduled or
 * stayed on a project page, and "ready" happened with nothing on screen to
 * say so. `completeTask` notes which tasks that was (`readyOffer`), and this
 * offers them a day. Ignoring it changes nothing, same as the undo bar it sits
 * where; the tasks stay undated exactly as they would have.
 *
 * Mounted once at the navigator root beside UndoBar, for the same reason:
 * it's a few seconds the app is in after a tap, not a place.
 */
export function ReadyOfferBar() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const offer = useTaskStore(s => s.readyOffer);
  const titles = useTaskStore(useShallow(s =>
    offer ? s.tasks.filter(t => offer.taskIds.includes(t.id) && !t.completed).map(t => displayTitleFor(t)) : []
  ));
  const clearReadyOffer = useTaskStore(s => s.clearReadyOffer);
  const placeReadyTasks = useTaskStore(s => s.placeReadyTasks);

  const [picking, setPicking] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!offer) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => clearReadyOffer(), VISIBLE_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [offer?.at]);

  const shown = !!offer && titles.length > 0;
  // Mounted on first use and kept (see useSheetMount): an idle WhenPicker
  // still subscribes to the task list, and this bar lives for the session.
  const mountPicker = useSheetMount(shown && picking);

  const place = (date: Date) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    haptics.success();
    setPicking(false);
    placeReadyTasks(date);
  };

  const label = titles.length === 1 ? `“${titles[0]}” is ready` : `${titles.length} tasks are ready`;
  const bottom = insets.bottom + TAB_BAR_HEIGHT + FAB_SIZE + spacing.lg;

  return (
    <>
      {shown && !picking && (
        <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
          {/* The name gets its own line: it's the one thing to read, and two
              buttons beside it would cut it short. */}
          <View style={[styles.bar, shadows.fab]}>
            <Text style={styles.label} numberOfLines={2}>{label}</Text>
            <View style={styles.actions}>
              <InlineAction
                label="Today"
                onPress={() => place(getLogicalToday(dayResetTime))}
                accessibilityLabel={`Do ${titles.length === 1 ? 'it' : 'them'} today`}
              />
              <InlineAction
                label="Pick a day"
                variant="neutral"
                onPress={() => {
                  haptics.tap();
                  if (timerRef.current) clearTimeout(timerRef.current);
                  setPicking(true);
                }}
              />
            </View>
          </View>
        </View>
      )}
      {mountPicker && (
        <WhenPicker
          visible={shown && picking}
          value={null}
          title="Pick a day"
          showTimeOfDay={false}
          showSuggest={false}
          allowPast={false}
          onConfirm={date => { if (date) place(date); }}
          onCancel={() => { setPicking(false); clearReadyOffer(); }}
        />
      )}
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
  },
  bar: {
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: border.md,
    borderColor: colors.separator,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.md,
  },
  label: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
