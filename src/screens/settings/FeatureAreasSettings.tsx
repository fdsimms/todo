import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useColors } from '../../theme/ThemeContext';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';
import { SIMPLE_AREAS, SIMPLE_AREA_LABELS, SIMPLE_FEATURES, simpleFeaturesIn } from '../../utils/simpleMode';

/**
 * The two switches that reshape the rest of the app: `kitchenEnabled` (the
 * whole groceries/recipes/meal-plan area, its tab and its drawer hub) and
 * `simpleMode` (every advanced feature `SIMPLE_FEATURES` names).
 *
 * This used to be the last section of Tasks & projects, the group that was
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
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const setSimpleMode = useSettingsStore(s => s.setSimpleMode);

  return (
    <SettingsSection
      label="Feature areas"
      footer="Neither switch deletes anything. Your tasks, lists, recipes and planned meals are kept exactly as they are, and turning either back on returns every feature as you left it. A task or item that already uses a hidden feature keeps showing it, so nothing you have set can go missing."
    >
      <SettingsRow
        entryId="kitchenEnabled"
        icon="cart-outline"
        iconColor={kitchenEnabled ? colors.accent : undefined}
        label="Groceries & meals"
        hint={kitchenEnabled ? 'Shown in the tab bar' : 'Hidden from the tab bar'}
        toggle={kitchenEnabled}
        onPress={() => setKitchenEnabled(!kitchenEnabled)}
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
  );
}
