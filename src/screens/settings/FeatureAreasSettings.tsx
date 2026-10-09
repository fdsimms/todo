import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useColors } from '../../theme/ThemeContext';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';
import { SIMPLE_AREAS, SIMPLE_AREA_LABELS, SIMPLE_FEATURES, simpleFeaturesIn } from '../../utils/simpleMode';
import { DEFAULT_TAB_ROUTES, NAV_MENU_ROWS, type NavDestination } from '../../utils/navHubs';
import { TabSlotPickerSheet, TAB_SLOT_NAMES } from '../../components/TabSlotPickerSheet';
import { haptics } from '../../utils/haptics';
import { COIN_ICON } from '../../constants/coinIcon';
import { FirstRunSheet } from '../../components/FirstRunSheet';

const DESTINATION_BY_ROUTE: ReadonlyMap<string, NavDestination> = new Map(
  NAV_MENU_ROWS.flatMap(row => row.kind === 'screen' ? [row.destination] : row.hub.members)
    .map(d => [d.route, d] as const)
);

/**
 * The two switches that reshape the rest of the app: `kitchenEnabled` (the
 * whole groceries/recipes/meal-plan area, its tab and its drawer hub) and
 * `simpleMode` (every advanced feature `SIMPLE_FEATURES` names), plus
 * `rewardsEnabled` (coins, bounties and the difficulty field), which had no way
 * off once the Rewards screen's own Turn on button was pressed.
 *
 * This used to be the last section of Tasks and projects, the group that was
 * already the widest in Settings — eleven sections deep, so the two controls
 * that decide what the rest of the app even shows sat behind more scrolling
 * than the housekeeping around them. A dedicated group puts them where their
 * reach argues they belong: found first, not found last.
 */
export function FeatureAreasSettings() {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const setKitchenEnabled = useSettingsStore(s => s.setKitchenEnabled);
  const rewardsEnabled = useSettingsStore(s => s.rewardsEnabled);
  const setRewardsEnabled = useSettingsStore(s => s.setRewardsEnabled);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const setSimpleMode = useSettingsStore(s => s.setSimpleMode);
  const tabRoutes = useSettingsStore(s => s.tabRoutes);
  const setTabSlot = useSettingsStore(s => s.setTabSlot);
  const clearTabSlot = useSettingsStore(s => s.clearTabSlot);
  const resetTabRoutes = useSettingsStore(s => s.resetTabRoutes);
  const [pickingSlot, setPickingSlot] = useState<number | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const isDefaultTabs = tabRoutes.length === DEFAULT_TAB_ROUTES.length
    && tabRoutes.every((route, i) => route === DEFAULT_TAB_ROUTES[i]);
  /** One tab slot's row: the screen it holds, opening the picker for that slot. */
  const slotRow = (slot: number) => {
    const destination = DESTINATION_BY_ROUTE.get(tabRoutes[slot]);
    return {
      icon: destination?.icon ?? 'ellipse-outline',
      iconColor: colors.accent,
      label: TAB_SLOT_NAMES[slot],
      value: destination?.label ?? 'None',
      chevron: true,
      onPress: () => { haptics.tap(); setPickingSlot(slot); },
    };
  };

  return (
    <>
    <SettingsSection
      label="Feature areas"
      footer="Turning a switch off deletes nothing, and turning it back on restores every feature as you left it. A task or item that already uses a hidden feature keeps showing it."
    >
      <SettingsRow
        entryId="kitchenEnabled"
        icon="cart-outline"
        iconColor={kitchenEnabled ? colors.accent : undefined}
        label="Groceries and meals"
        hint={!kitchenEnabled
          ? 'Hidden from the menu and the tab bar'
          : tabRoutes.includes('Groceries') ? 'Shown in the menu and the tab bar' : 'Shown in the menu'}
        toggle={kitchenEnabled}
        onPress={() => setKitchenEnabled(!kitchenEnabled)}
      />
      <View style={styles.sep} />
      <SettingsRow
        entryId="rewardsEnabled"
        icon={COIN_ICON}
        iconColor={rewardsEnabled ? colors.accent : undefined}
        label="Coins and rewards"
        hint={rewardsEnabled
          ? 'Finishing a task earns coins you can spend on rewards you set'
          : 'Off. No coins are earned or shown'}
        toggle={rewardsEnabled}
        onPress={() => setRewardsEnabled(!rewardsEnabled)}
      />
      <View style={styles.sep} />
      <SettingsRow
        entryId="simpleMode"
        icon="contract-outline"
        iconColor={simpleMode ? colors.accent : undefined}
        label="Simplified mode"
        hint={simpleMode
          ? `${SIMPLE_FEATURES.length} advanced features are hidden`
          : 'Every feature is available'}
        toggle={simpleMode}
        onPress={() => setSimpleMode(!simpleMode)}
      />
      <View style={styles.sep} />
      <SettingsRow
        entryId="firstRunSetup"
        icon="help-circle-outline"
        label="Run setup again"
        hint="Asks the three first-launch questions again: groceries and meals, simplified mode and reminders."
        onPress={() => { haptics.tap(); setSetupOpen(true); }}
      />
      <View style={styles.sep} />
      {/* The list is the setting's only honest description: "hides advanced
          features" is not something anyone can act on without knowing which. */}
      <SettingsRow icon="list-outline" label="What simplified mode hides" />
      <View style={styles.simpleList}>
        {SIMPLE_AREAS.map(area => (
          <View key={area} style={styles.simpleArea}>
            <Text style={styles.simpleAreaLabel}>{SIMPLE_AREA_LABELS[area]}</Text>
            <Text style={styles.simpleAreaFeatures}>
              {simpleFeaturesIn(area).map(f => f.label).join(', ')}
            </Text>
          </View>
        ))}
      </View>
    </SettingsSection>

    {/* Which screens have a button of their own along the bottom. Any screen
        the menu reaches can be one; see normalizeTabRoutes for the rules. */}
    <SettingsSection
      label="Tab bar"
      footer="Choose three to five screens to show beside More in the bottom bar. More opens the menu, which lists every screen."
    >
      <SettingsRow entryId="tabRoutes" {...slotRow(0)} />
      <View style={styles.sep} />
      <SettingsRow {...slotRow(1)} />
      <View style={styles.sep} />
      <SettingsRow {...slotRow(2)} />
      <View style={styles.sep} />
      <SettingsRow {...slotRow(3)} />
      <View style={styles.sep} />
      <SettingsRow {...slotRow(4)} />
      {!isDefaultTabs && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="refresh-outline"
            label="Use the default tabs"
            labelColor={colors.accent}
            hint="Today, Groceries and Projects"
            onPress={() => { haptics.tap(); resetTabRoutes(); }}
          />
        </>
      )}
    </SettingsSection>
    <FirstRunSheet visible={setupOpen} onClose={() => setSetupOpen(false)} rerun />
    <TabSlotPickerSheet
      visible={pickingSlot !== null}
      onClose={() => setPickingSlot(null)}
      slot={pickingSlot ?? 0}
      tabRoutes={tabRoutes}
      onSelect={route => { if (pickingSlot !== null) setTabSlot(pickingSlot, route); }}
      onClear={() => { if (pickingSlot !== null) clearTabSlot(pickingSlot); }}
    />
    </>
  );
}
