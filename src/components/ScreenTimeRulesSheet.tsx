import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Linking, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { ScreenTimeRule } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { generateId } from '../utils/id';
import {
  SCREEN_TIME_RULE_TITLE_MAX_LENGTH,
  SCREEN_TIME_THRESHOLD_DEFAULT,
  SCREEN_TIME_THRESHOLD_MAX,
  SCREEN_TIME_THRESHOLD_MIN,
} from '../utils/screenTimeRules';
import { screenTimeBridge } from '../utils/screenTimeBridge';
import type { ScreenTimeAuthorization } from 'todo-screentime-bridge';
import { EmptyState } from './EmptyState';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { CountStepper } from './CountStepper';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Every screen-time rule, in one list — the same job `WeatherRulesSheet` does
 * for weather rules, and built the same way for the same reasons: rules edited
 * inline rather than through a second stacked sheet, one card, one row each.
 *
 * Two things here that the weather sheet doesn't have, both from the same
 * source — the app cannot see usage:
 *
 * - **The app picker is above the rules, not inside one.** iOS hands back
 *   opaque tokens, so there is one selection shared by every rule rather than
 *   a per-rule set of apps. Putting it in the header is the honest layout:
 *   it's a property of the feature, not of a rule.
 * - **A rule with no apps picked does nothing at all**, and says so, because
 *   nothing else on this screen would give that away — the rules look
 *   perfectly well formed.
 */
export function ScreenTimeRulesSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const rules = useSettingsStore(useShallow(s => s.screenTimeRules));
  const setRules = useSettingsStore(s => s.setScreenTimeRules);
  const hideHelpText = useSettingsStore(s => s.hideHelpText);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [authorization, setAuthorization] = useState<ScreenTimeAuthorization | null>(null);
  const [selection, setSelection] = useState({ applications: 0, categories: 0 });

  const refreshNativeState = useCallback(() => {
    const bridge = screenTimeBridge();
    if (!bridge) {
      setAuthorization('unavailable');
      return;
    }
    setAuthorization(bridge.screenTimeAuthorizationStatus());
    setSelection(bridge.screenTimeSelectionCount());
  }, []);

  // Authorization can be revoked while the user is off in the system Settings
  // app, so it is re-read on every foreground while this sheet is open — the
  // same shape WeatherRulesSheet uses for location, scoped to visibility
  // rather than navigation focus since this is a Modal, not a screen.
  useEffect(() => {
    if (!visible) { setExpandedId(null); return; }
    refreshNativeState();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refreshNativeState();
    });
    return () => subscription.remove();
  }, [visible, refreshNativeState]);

  const update = (id: string, patch: Partial<ScreenTimeRule>) => {
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
    const rule: ScreenTimeRule = {
      id: generateId(),
      thresholdMinutes: SCREEN_TIME_THRESHOLD_DEFAULT,
      title: '',
      enabled: true,
      lastFiredDayKey: null,
    };
    setRules([...rules, rule]);
    setExpandedId(rule.id);
  };

  const chooseApps = async () => {
    haptics.tap();
    const bridge = screenTimeBridge();
    if (!bridge) return;
    if (await bridge.presentAppPicker()) setSelection(bridge.screenTimeSelectionCount());
  };

  const totalPicked = selection.applications + selection.categories;
  const selectionLabel = totalPicked === 0
    ? 'None yet'
    : [
      selection.applications > 0
        ? `${selection.applications} ${selection.applications === 1 ? 'app' : 'apps'}`
        : null,
      selection.categories > 0
        ? `${selection.categories} ${selection.categories === 1 ? 'category' : 'categories'}`
        : null,
    ].filter(Boolean).join(', ');

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Screen time rules</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={56} />
        </View>

        <ScrollView contentContainerStyle={rules.length === 0 ? styles.listEmpty : styles.list}>
          {!hideHelpText && (
            <Text style={styles.caption}>
              A rule adds its task once you have spent that long on the apps you picked, counted
              across the day. Each rule adds its task at most once a day.
            </Text>
          )}

          {authorization !== null && authorization !== 'approved' && (
            <View style={styles.permissionCard}>
              <Ionicons
                name="hourglass-outline"
                size={iconSize.sm}
                color={authorization === 'denied' ? colors.warning : colors.textSecondary}
              />
              <View style={styles.permissionBody}>
                <Text style={styles.permissionTitle}>Screen Time access</Text>
                <Text style={styles.permissionHint}>
                  {authorization === 'denied'
                    ? "Blocked. Rules can't see your app usage until you turn this back on for this app."
                    : authorization === 'notDetermined'
                    ? "Not allowed yet. Rules can't see your app usage until you allow it."
                    : 'Not available on this device.'}
                </Text>
              </View>
              {(authorization === 'denied' || authorization === 'notDetermined') && (
                <InlineAction
                  label={authorization === 'denied' ? 'Open Settings' : 'Allow'}
                  onPress={async () => {
                    haptics.tap();
                    if (authorization === 'denied') { Linking.openSettings(); return; }
                    const bridge = screenTimeBridge();
                    if (bridge) await bridge.requestScreenTimeAuthorization();
                    refreshNativeState();
                  }}
                />
              )}
            </View>
          )}

          {/*
            Above the rules rather than inside one: iOS gives the app opaque
            tokens for the apps somebody picked, so there is one selection every
            rule shares. A per-rule picker isn't a design choice that was
            passed over, it isn't available.
          */}
          {authorization === 'approved' && (
            <TouchableOpacity
              style={styles.selectionCard}
              activeOpacity={interaction.activeOpacity}
              onPress={chooseApps}
              accessibilityRole="button"
              accessibilityLabel={`Apps to watch: ${selectionLabel}`}
            >
              <Ionicons name="apps-outline" size={iconSize.sm} color={colors.accent} />
              <View style={styles.permissionBody}>
                <Text style={styles.permissionTitle}>Apps to watch</Text>
                <Text style={styles.permissionHint}>
                  {totalPicked === 0
                    ? 'No apps picked yet, so no rule below can fire.'
                    : 'Every rule below counts time across these.'}
                </Text>
              </View>
              <Text style={styles.selectionValue}>{selectionLabel}</Text>
              <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
          )}

          {rules.length === 0 ? (
            <EmptyState
              icon="phone-portrait-outline"
              title="No screen time rules"
              subtitle="Add a rule to get a task once you've spent a while on the apps you picked."
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
                        accessibilityLabel={`Edit rule: after ${rule.thresholdMinutes} minutes, ${rule.title || 'no title yet'}`}
                      >
                        <Text style={[styles.name, !rule.enabled && styles.nameOff]} numberOfLines={1}>
                          {rule.title || 'Untitled rule'}
                        </Text>
                        <Text style={styles.meta} numberOfLines={1}>
                          After {rule.thresholdMinutes} min
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
                        <Text style={styles.editorLabel}>After this much use</Text>
                        <View style={styles.stepperRow}>
                          <CountStepper
                            value={rule.thresholdMinutes}
                            onChange={next => update(rule.id, {
                              thresholdMinutes: next ?? SCREEN_TIME_THRESHOLD_DEFAULT,
                            })}
                            min={SCREEN_TIME_THRESHOLD_MIN}
                            max={SCREEN_TIME_THRESHOLD_MAX}
                            step={5}
                            format={n => `${n} min`}
                            label="Usage threshold"
                            describeValue={n => `${n} minutes`}
                          />
                        </View>
                        <Text style={[styles.editorLabel, styles.editorLabelSpaced]}>Add this task</Text>
                        <TextInput
                          style={styles.titleInput}
                          value={rule.title}
                          onChangeText={title => update(rule.id, {
                            title: title.slice(0, SCREEN_TIME_RULE_TITLE_MAX_LENGTH),
                          })}
                          placeholder="e.g. Take a walk"
                          placeholderTextColor={colors.textTertiary}
                          maxLength={SCREEN_TIME_RULE_TITLE_MAX_LENGTH}
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
    // center below the caption, instead of collapsing to its natural height at
    // the top of the scroll view.
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
    selectionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    selectionValue: { color: colors.accent, fontSize: font.sm },
    card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md },
    sep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
    body: { flex: 1 },
    name: { color: colors.text, fontSize: font.md },
    nameOff: { color: colors.textSecondary },
    meta: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
    toggle: { width: 46, height: 27, borderRadius: 14, backgroundColor: colors.bgQuaternary, justifyContent: 'center', paddingHorizontal: 3 },
    toggleOn: { backgroundColor: colors.accent },
    toggleKnob: { width: 21, height: 21, borderRadius: 11, backgroundColor: colors.bg },
    toggleKnobOn: { backgroundColor: colors.bg, alignSelf: 'flex-end' },
    editor: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.xs },
    editorLabel: { color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.8 },
    editorLabelSpaced: { marginTop: spacing.sm },
    stepperRow: { alignItems: 'flex-start' },
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
