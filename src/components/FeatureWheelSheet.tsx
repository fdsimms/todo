import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SortableList } from './SortableList';
import { EmptyNote } from './EmptyNote';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { usePersonStore } from '../store/usePersonStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useMoodStore } from '../store/useMoodStore';
import { useMedicationStore } from '../store/useMedicationStore';
import { menuDestinations, type NavSearchResult } from '../utils/navHubs';
import {
  WHEEL_MAX_SLOTS,
  addWheelRoute,
  removeWheelRoute,
} from '../utils/featureWheel';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface Row {
  id: string;
}

/**
 * What the feature wheel holds, and in what order.
 *
 * Two lists: the slots, orderable, and everything else, addable. The cap is
 * `WHEEL_MAX_SLOTS` and it is a property of the geometry rather than a product
 * decision — see `featureWheel.ts` — so a full wheel says so and refuses,
 * rather than dropping somebody's slot to make room for the new one.
 *
 * **Order is the whole feature**, which is why the top list drags rather than
 * sorting itself: a slot's angle is what somebody learns, so nothing may
 * re-rank it by recency or by anything else. Same call `PillGroup` and
 * `CategoryPicker` already make about a user's own order.
 *
 * `fullScreen`, not a page sheet, because it holds a drag: a page sheet's own
 * pull-down pan cancels the touches the drag runs on (#1182, and
 * `SortableList`'s own `onDragStateChange` note). Every edit commits straight
 * through to the store as it's made, so there is nothing staged to lose and no
 * `handleCancel` to write.
 */
export function FeatureWheelSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [dragging, setDragging] = useState(false);

  const routes = useSettingsStore(useShallow(s => s.featureWheelRoutes));
  const setRoutes = useSettingsStore(s => s.setFeatureWheelRoutes);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const stacks = useTaskGroupStore(s => s.groups.length);
  const templates = useTemplateStore(s => s.templates.length);
  const people = usePersonStore(s => s.people.length);
  const mood = useMoodStore(s => s.logs.length);
  const medications = useMedicationStore(s => s.logs.length);
  const foodLog = useFoodLogStore(s => s.totalCount);

  // Every destination the menu can reach, under the same gates — so a screen
  // simplified mode has taken away can't be put on the wheel either.
  const available = useMemo(
    () => menuDestinations({
      kitchenEnabled,
      simpleMode,
      counts: { stacks, templates, people, mood, medications, foodLog },
    }),
    [kitchenEnabled, simpleMode, stacks, templates, people, mood, medications, foodLog],
  );
  const byRoute = useMemo(
    () => new Map(available.map(d => [d.route, d])),
    [available],
  );

  // A stored route the menu can't currently reach keeps its place in the list
  // rather than being dropped, so switching a feature area back on returns the
  // wheel as it was. It just has nothing to draw until then.
  const chosen = routes.filter(route => byRoute.has(route)).slice(0, WHEEL_MAX_SLOTS);
  const rest = available.filter(d => !routes.includes(d.route));
  const full = chosen.length >= WHEEL_MAX_SLOTS;

  const rows: Row[] = chosen.map(route => ({ id: route }));

  const handleReorder = (next: Row[]) => {
    haptics.tap();
    setRoutes(next.map(row => row.id));
  };

  const add = (route: string) => {
    const next = addWheelRoute(routes, route, WHEEL_MAX_SLOTS);
    if (next === routes) return;
    haptics.tap();
    setRoutes(next);
  };

  const remove = (route: string) => {
    const next = removeWheelRoute(routes, route);
    if (next === routes) return;
    haptics.tap();
    setRoutes(next);
  };

  const subtitleFor = (destination: NavSearchResult | undefined) =>
    destination?.hubLabel ?? null;

  return (
    <SheetModal
      name="FeatureWheelSheet"
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <SheetHeader
          title="Feature wheel"
          left={<View style={styles.headerSpacer} />}
          right={<SheetHeaderButton label="Done" onPress={onClose} minWidth={64} />}
        />

        <ScrollView
          contentContainerStyle={styles.list}
          scrollEnabled={!dragging}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.intro}>
            Press the More tab and drag to open the wheel, then let go over one of these.
            The first slot is nearest straight up, so put the one you open most at the top.
            Up to {WHEEL_MAX_SLOTS}.
          </Text>

          <Text style={styles.sectionLabel}>ON THE WHEEL</Text>
          {chosen.length === 0 ? (
            <EmptyNote icon="radio-button-off-outline">
              Nothing on the wheel yet. Add a screen below and the gesture starts working.
            </EmptyNote>
          ) : (
            <SortableList<Row>
              data={rows}
              onReorder={handleReorder}
              onDragStateChange={setDragging}
              renderItem={(row, index, drag) => {
                const destination = byRoute.get(row.id);
                const hub = subtitleFor(destination);
                return (
                  <View style={styles.row}>
                    <View style={[styles.rowIcon, { backgroundColor: colors.accentSubtle }]}>
                      <Ionicons
                        name={(destination?.icon ?? 'ellipse-outline') as React.ComponentProps<typeof Ionicons>['name']}
                        size={16}
                        color={colors.accent}
                      />
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowLabel} numberOfLines={1}>
                        {destination?.label ?? row.id}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {hub ? `Slot ${index + 1} · ${hub}` : `Slot ${index + 1}`}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => remove(row.id)}
                      hitSlop={8}
                      style={styles.iconButton}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel={`Take ${destination?.label ?? row.id} off the wheel`}
                    >
                      <Ionicons name="close" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onLongPress={drag}
                      delayLongPress={interaction.delayLongPress}
                      hitSlop={8}
                      style={styles.iconButton}
                      accessibilityRole="button"
                      accessibilityLabel={`Reorder ${destination?.label ?? row.id}`}
                    >
                      <Ionicons name="reorder-three" size={20} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                );
              }}
            />
          )}

          <Text style={styles.sectionLabel}>NOT ON THE WHEEL</Text>
          {full && (
            <Text style={styles.capNote}>
              The wheel is full. Take one off to add another.
            </Text>
          )}
          {rest.length === 0 ? (
            <EmptyNote icon="checkmark-circle-outline">
              Every screen the menu can reach is already on the wheel.
            </EmptyNote>
          ) : (
            rest.map(destination => (
              <TouchableOpacity
                key={destination.route}
                style={[styles.row, full && styles.rowDisabled]}
                onPress={() => add(destination.route)}
                disabled={full}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityState={{ disabled: full }}
                accessibilityLabel={`Add ${destination.label} to the wheel`}
              >
                <View style={[styles.rowIcon, { backgroundColor: colors.bgTertiary }]}>
                  <Ionicons
                    name={destination.icon as React.ComponentProps<typeof Ionicons>['name']}
                    size={16}
                    color={colors.textSecondary}
                  />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowLabel} numberOfLines={1}>{destination.label}</Text>
                  {destination.hubLabel && (
                    <Text style={styles.rowMeta} numberOfLines={1}>{destination.hubLabel}</Text>
                  )}
                </View>
                <View style={styles.iconButton}>
                  <Ionicons
                    name="add"
                    size={20}
                    color={full ? colors.textTertiary : colors.accent}
                  />
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerSpacer: { width: 64 },
  list: { paddingTop: spacing.sm, paddingBottom: spacing.xl },
  intro: {
    color: colors.textTertiary,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  capNote: {
    color: colors.textTertiary,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  // Same inset-grouped card footprint the category order sheet's rows use.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: spacing.xxs,
    borderRadius: radius.md,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.md,
  },
  rowDisabled: { opacity: 0.45 },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: { flex: 1, gap: spacing.xxs },
  rowLabel: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
  rowMeta: { color: colors.textTertiary, fontSize: font.xs },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
