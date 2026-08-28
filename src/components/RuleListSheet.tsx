import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { EmptyState } from './EmptyState';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';

/** Same constraint EmptyState puts on its own icon. */
type IoniconName = keyof typeof Ionicons.glyphMap;

/**
 * The sheet a list of user-authored "when X, add this task" rules is edited
 * in — the shell behind `WeatherRulesSheet` and `ScreenTimeRulesSheet`.
 *
 * Those two shipped as near-identical copies: one card, one row per rule with
 * a title, a secondary line, a hand-rolled toggle and a chevron; tap to expand
 * into a control, a title field and a delete row; an `InlineAction` to add one;
 * an `EmptyState` when there are none. Sixty lines of styles were identical
 * character for character. That is the drift `SheetHeaderButton` and
 * `InlineAction` were created to undo, one level up.
 *
 * **What varies is the two ends, not the middle**, which is what makes this
 * worth sharing rather than a config object pretending to be a component:
 *
 * - `header` is anything above the list — a permission card, an app picker.
 *   Rendered inside the scroll view, above both the empty state and the card,
 *   because a sheet that can't fire yet needs to say so whether or not any
 *   rules exist.
 * - `renderEditor` is the rule-specific control in the expanded row: a
 *   segmented control of weather conditions, a stepper of minutes. Everything
 *   below it (the title field, the delete row) is the same in both.
 *
 * Expansion state lives here rather than in the caller: it's chrome, it resets
 * when the sheet closes, and both copies had written the same three lines of
 * it.
 */

/** The least a rule has to be for this sheet to render it. */
export interface EditableRule {
  id: string;
  title: string;
  enabled: boolean;
}

interface Props<T extends EditableRule> {
  visible: boolean;
  onClose: () => void;
  /** The sheet's own title, e.g. "Weather rules". */
  title: string;
  /** One line under the header saying what a rule does. Hidden with help text. */
  caption: string;
  rules: readonly T[];
  /** Called with the whole list, the way both settings setters take it. */
  onChange: (rules: T[]) => void;
  /** A fresh rule, already carrying its own id. */
  makeRule: () => T;
  /** The secondary line under a rule's title, e.g. "After 30 min". */
  describeRule: (rule: T) => string;
  /** Uppercase label above `renderEditor`'s control. */
  editorLabel: string;
  renderEditor: (rule: T, update: (patch: Partial<T>) => void) => ReactNode;
  titlePlaceholder: string;
  titleMaxLength: number;
  emptyIcon: IoniconName;
  emptyTitle: string;
  emptySubtitle: string;
  /** Above the list. A permission card, a picker, or nothing. */
  header?: ReactNode;
  /**
   * The colour a rule's toggle takes when on. Defaults to the accent; weather
   * passes its own, which it had before this component existed.
   */
  toggleOnColor?: string;
}

export function RuleListSheet<T extends EditableRule>({
  visible,
  onClose,
  title,
  caption,
  rules,
  onChange,
  makeRule,
  describeRule,
  editorLabel,
  renderEditor,
  titlePlaceholder,
  titleMaxLength,
  emptyIcon,
  emptyTitle,
  emptySubtitle,
  header,
  toggleOnColor,
}: Props<T>) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hideHelpText = useSettingsStore(s => s.hideHelpText);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Closing forgets which row was open, so reopening the sheet doesn't hand
  // somebody a half-expanded form with no visible reason why — the same call
  // TaskEditor's field search makes about its own query.
  //
  // Both here and on `visible` going false: the button and the iOS swipe-down
  // both route through `close`, but a parent that hides the sheet by any other
  // means would otherwise leave the row open for next time.
  const close = () => {
    setExpandedId(null);
    onClose();
  };
  useEffect(() => {
    if (!visible) setExpandedId(null);
  }, [visible]);

  // No unsaved-changes guard, and none is needed: every edit below commits
  // straight through `onChange` to the settings store as it's made, so a
  // swipe-down has nothing staged to lose. That's the other valid answer to
  // the pageSheet `onRequestClose` rule in CLAUDE.md, not a workaround.

  const update = (id: string, patch: Partial<T>) => {
    onChange(rules.map(r => (r.id === id ? { ...r, ...patch } : r)));
  };

  const remove = (id: string) => {
    animateLayout();
    onChange(rules.filter(r => r.id !== id));
    setExpandedId(current => (current === id ? null : current));
  };

  const addRule = () => {
    haptics.tap();
    animateLayout();
    const rule = makeRule();
    onChange([...rules, rule]);
    setExpandedId(rule.id);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>{title}</Text>
          <SheetHeaderButton label="Done" onPress={close} minWidth={56} />
        </View>

        <ScrollView contentContainerStyle={rules.length === 0 ? styles.listEmpty : styles.list}>
          {!hideHelpText && <Text style={styles.caption}>{caption}</Text>}

          {header}

          {rules.length === 0 ? (
            <EmptyState
              icon={emptyIcon}
              title={emptyTitle}
              subtitle={emptySubtitle}
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
                        accessibilityLabel={`Edit rule: ${describeRule(rule)}, ${rule.title || 'no title yet'}`}
                      >
                        <Text style={[styles.name, !rule.enabled && styles.nameOff]} numberOfLines={1}>
                          {rule.title || 'Untitled rule'}
                        </Text>
                        <Text style={styles.meta} numberOfLines={1}>{describeRule(rule)}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.toggle,
                          rule.enabled && { backgroundColor: toggleOnColor ?? colors.accent },
                        ]}
                        activeOpacity={interaction.activeOpacity}
                        onPress={() => { haptics.tap(); update(rule.id, { enabled: !rule.enabled } as Partial<T>); }}
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
                        <Text style={styles.editorLabel}>{editorLabel}</Text>
                        {renderEditor(rule, patch => update(rule.id, patch))}
                        <Text style={[styles.editorLabel, styles.editorLabelSpaced]}>Add this task</Text>
                        <TextInput
                          style={styles.titleInput}
                          value={rule.title}
                          onChangeText={text => update(rule.id, { title: text.slice(0, titleMaxLength) } as Partial<T>)}
                          placeholder={titlePlaceholder}
                          placeholderTextColor={colors.textTertiary}
                          maxLength={titleMaxLength}
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
    // center below the caption and header, instead of collapsing to its
    // natural height at the top of the scroll view.
    listEmpty: { flexGrow: 1, padding: spacing.md, paddingBottom: spacing.xl },
    caption: { color: colors.textSecondary, fontSize: font.sm, marginBottom: spacing.md },
    card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md },
    sep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
    body: { flex: 1 },
    name: { color: colors.text, fontSize: font.md },
    nameOff: { color: colors.textSecondary },
    meta: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
    toggle: { width: 46, height: 27, borderRadius: 14, backgroundColor: colors.bgQuaternary, justifyContent: 'center', paddingHorizontal: 3 },
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

/**
 * The card shape both sheets use above their rule list — a permission notice,
 * or the app picker. Exported so the two callers can't drift apart on the one
 * bit of `header` they have in common.
 */
export function RuleSheetNoticeCard({
  icon,
  iconColor,
  title,
  hint,
  value,
  action,
  onPress,
  accessibilityLabel,
}: {
  icon: IoniconName;
  iconColor: string;
  title: string;
  hint: string;
  /** Right-aligned current value, for a card that opens something. */
  value?: string;
  /** Trailing button, for a card that asks for something. */
  action?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeNoticeStyles(colors), [colors]);
  const content = (
    <>
      <Ionicons name={icon} size={iconSize.sm} color={iconColor} />
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      {value !== undefined && <Text style={styles.value}>{value}</Text>}
      {action}
      {onPress && <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />}
    </>
  );

  if (!onPress) return <View style={styles.card}>{content}</View>;
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={interaction.activeOpacity}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
    >
      {content}
    </TouchableOpacity>
  );
}

function makeNoticeStyles(colors: Colors) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    body: { flex: 1 },
    title: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
    hint: { color: colors.textSecondary, fontSize: font.xs, marginTop: 2, lineHeight: 16 },
    value: { color: colors.accent, fontSize: font.sm },
  });
}
