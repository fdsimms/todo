import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Person } from '../types';
import { TITLE_MAX_LENGTH } from '../types';
import { usePersonStore } from '../store/usePersonStore';
import { WhenPicker } from './WhenPicker';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorRow } from './EditorRow';
import { EditorSheet } from './EditorSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { formatPhoneInput } from '../utils/phone';
import { birthdayInYear, hasBirthday } from '../utils/birthdayTasks';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { CountStepper } from './CountStepper';
import { describeCadence } from '../utils/nudgeCadence';
import { personHistory } from '../utils/personHistory';
import { describeObservedCadence, observedCadenceDays } from '../utils/reachOutTasks';

interface Props {
  visible: boolean;
  person: Person | null;
  /** Titles the sheet "New Person" — set when arriving from the list's add field. */
  isNew?: boolean;
  onClose: () => void;
}

/** "March 14", the way the birthday row reads back what's on file. */
function describeBirthday(month: number | null, day: number | null): string | undefined {
  if (month === null || day === null) return undefined;
  const date = birthdayInYear({ birthdayMonth: month, birthdayDay: day }, 2024);
  if (!date) return undefined;
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

/**
 * The person sheet.
 *
 * Built on the same `EditorSheet` shape as `ProjectEditor` and following the
 * same progressive-disclosure rule the other editors do: name and notes, then
 * cards under uppercase group labels, rarely-changed rows last.
 *
 * **What is deliberately not in here** is as much the point as what is. There
 * is no closeness, no tier, no "how often should I see them" beyond the plain
 * cadence the nudge will read (#2046), and nothing that renders a judgment
 * about the relationship. See `docs/arch/people.md`; the shape of this form is
 * what stops the feature reading as a filing system for your friends.
 */
export function PersonEditor({ visible, person, isNew, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const updatePerson = usePersonStore(s => s.updatePerson);
  const applyPersonArchived = usePersonStore(s => s.applyPersonArchived);
  const removePersonRow = usePersonStore(s => s.removePersonRow);
  // `person` is a snapshot handed down when the sheet opened, so it never sees
  // its own archived flag flip back — read that one field live instead, the
  // same fix ProjectEditor makes for the same reason.
  const liveArchived = usePersonStore(s => s.people.find(p => p.id === person?.id)?.archived);

  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [notes, setNotes] = useState('');
  const [birthdayMonth, setBirthdayMonth] = useState<number | null>(null);
  const [birthdayDay, setBirthdayDay] = useState<number | null>(null);
  const [birthdayTaskOptOut, setBirthdayTaskOptOut] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [showBirthdayPicker, setShowBirthdayPicker] = useState(false);
  const [cadenceDays, setCadenceDays] = useState(0);
  const [askAbout, setAskAbout] = useState('');

  // Read here so the cadence offer can be built from this person's own history
  // — the number in the offer has to come from what actually happened, which is
  // the whole reason it is not the app's opinion (rule 5).
  const allTasks = useTaskStore(useShallow(s => s.tasks));
  const observed = useMemo(() => {
    if (!person) return null;
    const theirs = allTasks.filter(t => t.personIds.includes(person.id));
    return observedCadenceDays(personHistory(theirs));
  }, [allTasks, person]);

  useEffect(() => {
    if (!person || !visible) return;
    setName(person.name);
    setNickname(person.nickname);
    setNotes(person.notes);
    setBirthdayMonth(person.birthdayMonth);
    setBirthdayDay(person.birthdayDay);
    setBirthdayTaskOptOut(person.birthdayTaskOptOut);
    setPhoneNumber(formatPhoneInput(person.phoneNumber ?? ''));
    setEmail(person.email ?? '');
    setLinkUrl(person.linkUrl ?? '');
    setCadenceDays(person.cadenceDays);
    setAskAbout(person.askAbout);
    setShowBirthdayPicker(false);
  }, [person, visible]);

  if (!person) return null;
  const archived = liveArchived ?? person.archived;

  const saveAndClose = () => {
    const trimmedName = name.trim();
    updatePerson(person.id, {
      // An empty name would leave an unidentifiable row, so the previous one
      // stands — the same refusal the other editors make about their titles.
      name: trimmedName || person.name,
      nickname: nickname.trim(),
      notes: notes.trim(),
      birthdayMonth,
      birthdayDay,
      birthdayTaskOptOut,
      phoneNumber: phoneNumber.trim() || null,
      email: email.trim() || null,
      linkUrl: linkUrl.trim() || null,
      cadenceDays,
      // The opt-in is the cadence: there is no separate switch to forget to
      // flip, and clearing the cadence is how somebody stops being nudged.
      nudgeOptIn: cadenceDays > 0,
      askAbout: askAbout.trim(),
    });
    onClose();
  };

  const handleDelete = () => {
    Alert.alert(
      `Delete ${person.name}?`,
      'Anything you wrote about them is deleted. Tasks that name them are kept, and stop showing their name.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => { removePersonRow(person.id); onClose(); },
        },
      ]
    );
  };

  const toggleArchived = () => {
    haptics.tap();
    applyPersonArchived(person.id, !archived);
  };

  const birthdaySet = hasBirthday({ birthdayMonth, birthdayDay });

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={saveAndClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <>
          <SheetHeaderButton label="Done" onPress={saveAndClose} />
          <Text style={styles.headerTitle}>{isNew ? 'New Person' : 'Edit Person'}</Text>
          <TouchableOpacity onPress={handleDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete person">
            <Ionicons name="trash-outline" size={20} color={colors.red} />
          </TouchableOpacity>
        </>
      }
      footer={
        <WhenPicker
          visible={showBirthdayPicker}
          // The year shown is this year's, and it is thrown away — only the
          // month and the day are kept (see Person.birthdayMonth). That is what
          // makes paging sane: a birth *date* would mean paging back thirty
          // years a month at a time, where a birth *day* is at most eleven taps
          // from wherever the grid opens.
          value={birthdaySet ? birthdayInYear({ birthdayMonth, birthdayDay }, new Date().getFullYear()) : null}
          title="Birthday"
          showTimeOfDay={false}
          showSuggest={false}
          onConfirm={(date) => {
            if (date) {
              setBirthdayMonth(date.getMonth() + 1);
              setBirthdayDay(date.getDate());
            }
            setShowBirthdayPicker(false);
          }}
          onClear={() => {
            // Both halves together, always: a month with no day is not a date
            // anything can be computed from.
            setBirthdayMonth(null);
            setBirthdayDay(null);
            setShowBirthdayPicker(false);
          }}
          onCancel={() => setShowBirthdayPicker(false)}
        />
      }
    >
      <TextInput
        style={styles.titleInput}
        value={name}
        onChangeText={setName}
        placeholder="Name"
        placeholderTextColor={colors.textTertiary}
        maxLength={TITLE_MAX_LENGTH}
      />
      <TextInput
        style={styles.notesInput}
        value={notes}
        onChangeText={setNotes}
        placeholder="Notes"
        placeholderTextColor={colors.textTertiary}
        multiline
      />

      <Text style={styles.groupLabel}>BIRTHDAY</Text>
      <View style={styles.sectionCard}>
        <EditorRow
          icon="gift-outline"
          label="Birthday"
          value={describeBirthday(birthdayMonth, birthdayDay)}
          hint="Adds a task a few days before it, every year."
          onPress={() => setShowBirthdayPicker(true)}
          onClear={birthdaySet ? () => { setBirthdayMonth(null); setBirthdayDay(null); } : undefined}
        />
        {birthdaySet && (
          <>
            <View style={styles.sep} />
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => { haptics.tap(); animateLayout(); setBirthdayTaskOptOut(v => !v); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="switch"
              accessibilityState={{ checked: !birthdayTaskOptOut }}
              accessibilityLabel="Remind me about this birthday"
            >
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Remind me</Text>
                <Text style={styles.optionHint}>Adds a task before this birthday each year.</Text>
              </View>
              <View style={[styles.toggle, !birthdayTaskOptOut && styles.toggleOn]}>
                <View style={[styles.toggleKnob, !birthdayTaskOptOut && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
          </>
        )}
      </View>

      <Text style={styles.groupLabel}>KEEPING IN TOUCH</Text>
      <View style={styles.sectionCard}>
        <View style={styles.optionRow}>
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Remind me if we haven't talked in a while</Text>
            <Text style={styles.optionHint}>
              {cadenceDays > 0
                ? `Adds a task when it has been ${describeCadence(cadenceDays).toLowerCase()}.`
                : 'Off. Nothing about them shows up unless you ask for it.'}
            </Text>
          </View>
        </View>
        <View style={styles.cadenceRow}>
          <CountStepper
            value={cadenceDays > 0 ? cadenceDays : null}
            onChange={next => setCadenceDays(next ?? 0)}
            min={1}
            max={365}
            allowNull
            format={n => `${n}d`}
            label="Days before a reminder"
            describeValue={n => (n === null ? 'No reminder' : describeCadence(n))}
          />
        </View>
        {/* The offer, and it only ever appears once there is enough history to
            say so honestly — see observedCadenceDays. Declaring a frequency for
            somebody you love is the coldest interaction in the feature, and a
            number that came out of your own history is not that. */}
        {observed !== null && cadenceDays !== observed && (
          <TouchableOpacity
            style={styles.offerRow}
            onPress={() => { haptics.tap(); animateLayout(); setCadenceDays(observed); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`Use every ${observed} days`}
          >
            <Ionicons name="sparkles-outline" size={14} color={colors.accent} />
            <Text style={styles.offerText}>
              {describeObservedCadence(observed)}. Use that?
            </Text>
          </TouchableOpacity>
        )}
        <View style={styles.sep} />
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabelWide}>Ask about</Text>
          <TextInput
            style={styles.fieldInput}
            value={askAbout}
            onChangeText={setAskAbout}
            placeholder="e.g. the new job"
            placeholderTextColor={colors.textTertiary}
          />
        </View>
        <Text style={styles.cardFooter}>
          When this is filled in, the reminder says to ask about it instead of just saying to catch up.
        </Text>
      </View>

      <Text style={styles.groupLabel}>GETTING HOLD OF THEM</Text>
      <View style={styles.sectionCard}>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Phone</Text>
          <TextInput
            style={styles.fieldInput}
            value={phoneNumber}
            // Formatted as typed but stored verbatim, the decision
            // Task.phoneNumber documents: there is no canonical dial string
            // without a country the app never asks for.
            onChangeText={text => setPhoneNumber(formatPhoneInput(text))}
            placeholder="e.g. 555 123 4567"
            placeholderTextColor={colors.textTertiary}
            keyboardType="phone-pad"
          />
        </View>
        <View style={styles.sep} />
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Email</Text>
          <TextInput
            style={styles.fieldInput}
            value={email}
            onChangeText={setEmail}
            placeholder="e.g. ansley@example.com"
            placeholderTextColor={colors.textTertiary}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>
        <View style={styles.sep} />
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Link</Text>
          <TextInput
            style={styles.fieldInput}
            value={linkUrl}
            onChangeText={setLinkUrl}
            placeholder="e.g. a chat app or a profile"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
          />
        </View>
      </View>
      <Text style={styles.sectionFooter}>
        A birthday task carries their number, so you can call or text from the task itself.
      </Text>

      <Text style={styles.groupLabel}>MORE</Text>
      <View style={styles.sectionCard}>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Nickname</Text>
          <TextInput
            style={styles.fieldInput}
            value={nickname}
            onChangeText={setNickname}
            placeholder="e.g. Ans"
            placeholderTextColor={colors.textTertiary}
            maxLength={TITLE_MAX_LENGTH}
          />
        </View>
        <Text style={styles.cardFooter}>Shown instead of their name, everywhere.</Text>
        <View style={styles.sep} />
        <TouchableOpacity
          style={styles.optionRow}
          onPress={toggleArchived}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityState={{ checked: archived }}
          accessibilityLabel="Archive person"
        >
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Archive</Text>
            <Text style={styles.optionHint}>Hides them from the list and stops their birthday task.</Text>
          </View>
          <View style={[styles.toggle, archived && styles.toggleOn]}>
            <View style={[styles.toggleKnob, archived && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
      </View>
    </EditorSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  titleInput: {
    color: colors.text, fontSize: font.xl, fontWeight: fontWeight.medium,
    paddingVertical: spacing.sm, minHeight: 44,
  },
  notesInput: {
    color: colors.textSecondary, fontSize: font.md,
    paddingBottom: spacing.lg, minHeight: 44,
    // No lineHeight on a TextInput — see the note in ProjectEditor's styles.
  },
  // textSecondary rather than textTertiary: these are the app's repeated
  // section headers, and textTertiary measures under the large-text contrast
  // bar on bgSecondary in dark.
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  sectionCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  fieldLabel: { color: colors.text, fontSize: font.md, width: 92 },
  fieldLabelWide: { color: colors.text, fontSize: font.md, width: 84 },
  cadenceRow: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  offerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.md, marginBottom: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.md,
  },
  offerText: { flex: 1, color: colors.accent, fontSize: font.xs, lineHeight: 17 },
  fieldInput: {
    flex: 1, color: colors.text, fontSize: font.md, textAlign: 'right',
    // A fixed height rather than a lineHeight keeps the row from resizing as
    // the field goes from empty to filled.
    height: 24,
  },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
  // Outside a card, so it lines up with the uppercase group label above it.
  sectionFooter: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  // Inside a card, so it lines up with the *rows* rather than with the label:
  // spacing.md is the rows' own horizontal padding, and at spacing.sm this sat
  // eight points to the left of everything it explains. Bottom padding because
  // a separator follows it, and a caption touching a hairline reads as part of
  // the next row rather than as a note on the last one.
  cardFooter: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  optionContent: { flex: 1 },
  optionLabel: { color: colors.text, fontSize: font.md },
  optionHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
  toggle: {
    width: 44, height: 26, borderRadius: radius.full,
    backgroundColor: colors.bgQuaternary, padding: 2, justifyContent: 'center',
  },
  toggleOn: { backgroundColor: colors.accent },
  toggleKnob: {
    width: 22, height: 22, borderRadius: radius.full, backgroundColor: colors.bg,
  },
  toggleKnobOn: { alignSelf: 'flex-end' },
});
