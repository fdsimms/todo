import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Linking, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { WeatherCondition, WeatherRule } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { generateId } from '../utils/id';
import {
  WEATHER_CONDITIONS,
  WEATHER_RULE_TITLE_MAX_LENGTH,
  weatherConditionLabel,
} from '../utils/weatherTasks';
import {
  getLocationPermission,
  requestLocationPermission,
  type LocationPermission,
} from '../utils/weatherLocation';
import { EmptyState } from './EmptyState';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const CONDITION_OPTIONS: SegmentOption<WeatherCondition>[] =
  WEATHER_CONDITIONS.map(c => ({ value: c, label: weatherConditionLabel(c) }));

/**
 * Every weather rule, in one list — the same job `TitleRulesSheet` does for
 * title rules, and the only home a rule has: unlike a title rule (which can
 * point at an existing category or project), a weather rule is nothing but
 * itself, so there's no second surface it could be edited from.
 *
 * Rules are edited inline (tap to expand) rather than through a second sheet
 * the way `TitleRuleSheet` does — a rule here has three fields, not eight,
 * and a second page-sheet stacked over this one for that little would be
 * more chrome than form.
 */
export function WeatherRulesSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const rules = useSettingsStore(useShallow(s => s.weatherRules));
  const setRules = useSettingsStore(s => s.setWeatherRules);
  const hideHelpText = useSettingsStore(s => s.hideHelpText);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [permission, setPermission] = useState<LocationPermission | null>(null);

  const refreshPermission = useCallback(() => {
    getLocationPermission().then(setPermission).catch(() => setPermission(null));
  }, []);

  // Permission can change while the user is off in the system Settings app,
  // so it's re-read on every foreground while this sheet is open — same
  // shape CalendarSettings' own permission row uses, scoped to visibility
  // rather than navigation focus since this is a Modal, not a screen.
  useEffect(() => {
    if (!visible) { setExpandedId(null); return; }
    refreshPermission();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refreshPermission();
    });
    return () => subscription.remove();
  }, [visible, refreshPermission]);

  const update = (id: string, patch: Partial<WeatherRule>) => {
    setRules(rules.map(r => (r.id === id ? { ...r, ...patch } : r)));
  };

  const remove = (id: string) => {
    animateLayout();
    setRules(rules.filter(r => r.id !== id));
    setExpandedId(current => (current === id ? null : current));
  };

  const addRule = () => {
    haptics.tap();
    animateLayout();
    const rule: WeatherRule = {
      id: generateId(),
      condition: 'sunny',
      title: '',
      enabled: true,
      lastFiredDayKey: null,
    };
    setRules([...rules, rule]);
    setExpandedId(rule.id);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Weather rules</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={56} />
        </View>

        <ScrollView contentContainerStyle={rules.length === 0 ? styles.listEmpty : styles.list}>
          {!hideHelpText && (
            <Text style={styles.caption}>
              A rule adds its task on any day the weather matches, checked once a day using your
              location. It never applies to a day that's already passed.
            </Text>
          )}

          {permission !== null && permission !== 'granted' && (
            <View style={styles.permissionCard}>
              <Ionicons
                name="location-outline"
                size={iconSize.sm}
                color={permission === 'denied' ? colors.warning : colors.textSecondary}
              />
              <View style={styles.permissionBody}>
                <Text style={styles.permissionTitle}>Location access</Text>
                <Text style={styles.permissionHint}>
                  {permission === 'denied'
                    ? "Blocked. Rules can't check the weather until you turn this back on for this app."
                    : permission === 'undetermined'
                    ? "Not allowed yet. Rules can't check the weather until you allow it."
                    : 'Not available on this platform.'}
                </Text>
              </View>
              {(permission === 'denied' || permission === 'undetermined') && (
                <InlineAction
                  label={permission === 'denied' ? 'Open Settings' : 'Allow'}
                  onPress={async () => {
                    haptics.tap();
                    if (permission === 'denied') { Linking.openSettings(); return; }
                    await requestLocationPermission();
                    refreshPermission();
                  }}
                />
              )}
            </View>
          )}

          {rules.length === 0 ? (
            <EmptyState
              icon="partly-sunny-outline"
              title="No weather rules"
              subtitle="Add a rule to get a task on a day the weather matches, like sunscreen on a sunny day."
              actionLabel="New rule"
              onAction={addRule}
            />
          ) : (
            <View style={styles.card}>
              {rules.map((rule, i) => {
                const expanded = expandedId === rule.id;
                return (
                  <View key={rule.id}>
                    {i > 0 && <View style={styles.sep} />}
                    <View style={styles.row}>
                      <TouchableOpacity
                        style={styles.body}
                        activeOpacity={interaction.activeOpacity}
                        onPress={() => {
                          haptics.tap();
                          animateLayout();
                          setExpandedId(expanded ? null : rule.id);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit rule: ${weatherConditionLabel(rule.condition)}, ${rule.title || 'no title yet'}`}
                      >
                        <Text style={[styles.name, !rule.enabled && styles.nameOff]} numberOfLines={1}>
                          {rule.title || 'Untitled rule'}
                        </Text>
                        <Text style={styles.meta} numberOfLines={1}>
                          {weatherConditionLabel(rule.condition)}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.toggle, rule.enabled && styles.toggleOn]}
                        activeOpacity={interaction.activeOpacity}
                        onPress={() => { haptics.tap(); update(rule.id, { enabled: !rule.enabled }); }}
                        accessibilityRole="switch"
                        accessibilityLabel={`${rule.title || 'This rule'} is on`}
                        accessibilityState={{ checked: rule.enabled }}
                      >
                        <View style={[styles.toggleKnob, rule.enabled && styles.toggleKnobOn]} />
                      </TouchableOpacity>
                      <Ionicons
                        name={expanded ? 'chevron-up' : 'chevron-down'}
                        size={iconSize.sm}
                        color={colors.textTertiary}
                      />
                    </View>
                    {expanded && (
                      <View style={styles.editor}>
                        <Text style={styles.editorLabel}>On a day that's</Text>
                        <SegmentedControl
                          options={CONDITION_OPTIONS}
                          value={rule.condition}
                          onChange={condition => update(rule.id, { condition })}
                          columns={3}
                          label="Weather condition"
                          surface="card"
                        />
                        <Text style={[styles.editorLabel, styles.editorLabelSpaced]}>Add this task</Text>
                        <TextInput
                          style={styles.titleInput}
                          value={rule.title}
                          onChangeText={title => update(rule.id, { title: title.slice(0, WEATHER_RULE_TITLE_MAX_LENGTH) })}
                          placeholder="e.g. Put on sunscreen"
                          placeholderTextColor={colors.textTertiary}
                          maxLength={WEATHER_RULE_TITLE_MAX_LENGTH}
                          returnKeyType="done"
                        />
                        <TouchableOpacity
                          style={styles.deleteRow}
                          activeOpacity={interaction.activeOpacity}
                          onPress={() => remove(rule.id)}
                          accessibilityRole="button"
                          accessibilityLabel="Delete rule"
                        >
                          <Ionicons name="trash-outline" size={iconSize.sm} color={colors.red} />
                          <Text style={styles.deleteLabel}>Delete rule</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
          <InlineAction icon="add" label="New rule" onPress={addRule} style={styles.addBtn} />
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
      paddingVertical: spacing.md,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.separator,
    },
    headerTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    headerSpacer: { width: 56 },
    list: { padding: spacing.md, paddingBottom: spacing.xl },
    // Full-height content container so EmptyState's own `flex: 1` has room to
    // center below the caption/permission card, instead of collapsing to its
    // natural height at the top of the scroll view.
    listEmpty: { flexGrow: 1, padding: spacing.md, paddingBottom: spacing.xl },
    caption: { color: colors.textSecondary, fontSize: font.sm, marginBottom: spacing.md },
    permissionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    permissionBody: { flex: 1 },
    permissionTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
    permissionHint: { color: colors.textSecondary, fontSize: font.xs, marginTop: 2, lineHeight: 16 },
    card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md },
    sep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
    body: { flex: 1 },
    name: { color: colors.text, fontSize: font.md },
    nameOff: { color: colors.textSecondary },
    meta: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
    toggle: { width: 46, height: 27, borderRadius: 14, backgroundColor: colors.bgQuaternary, justifyContent: 'center', paddingHorizontal: 3 },
    toggleOn: { backgroundColor: colors.orange },
    toggleKnob: { width: 21, height: 21, borderRadius: 11, backgroundColor: colors.bg },
    toggleKnobOn: { backgroundColor: colors.bg, alignSelf: 'flex-end' },
    editor: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.xs },
    editorLabel: { color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.8 },
    editorLabelSpaced: { marginTop: spacing.sm },
    titleInput: {
      color: colors.text,
      fontSize: font.md,
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    deleteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
    deleteLabel: { color: colors.red, fontSize: font.sm },
    addBtn: { marginTop: spacing.md, alignSelf: 'flex-start' },
  });
}
