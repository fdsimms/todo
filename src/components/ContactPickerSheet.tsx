import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator, ScrollView,
  StyleSheet, Linking,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { EditorSheet } from './EditorSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import {
  canSearchContacts,
  contactPersonDraft,
  describeCandidateBirthday,
  filterBrowsableContacts,
  rankContacts,
  type ContactCandidate,
  type ContactPersonDraft,
} from '../utils/contactsImport';
import {
  fetchLimitedContacts,
  getContactsAccessScope,
  getContactsPermission,
  requestContactsPermission,
  searchContacts,
  type ContactsAccessScope,
  type ContactsPermission,
} from '../utils/contactsAccess';
import { usePersonStore } from '../store/usePersonStore';
import { useShallow } from 'zustand/react/shallow';

/** How long the field sits still before a search runs. */
const SEARCH_DEBOUNCE_MS = 250;

interface Props {
  visible: boolean;
  /** Called once per pick. The sheet stays open so a run of them is possible. */
  onPick: (draft: ContactPersonDraft) => void;
  onClose: () => void;
}

/**
 * Filling one person in from the contact book — see `docs/arch/people.md`,
 * "Where the two lines actually fall", and `contactsImport.ts` for the rules.
 *
 * **For a full grant it opens on a focused search field with nothing under it,
 * and there is no "select all" at any point.** That is the whole design rather
 * than a layout choice: the objection to an address book import was never to
 * the contact book itself, it was to *a list you did not write* — 400 people
 * you do not think about, which then has to be sorted somehow. You cannot
 * bulk-select a book you are never shown, and `searchContacts` refuses an
 * empty query outright rather than falling back to everyone, so the book is
 * never even read.
 *
 * **A `'limited'` grant is the opposite case**, and gets the opposite default
 * view: iOS's own picker is how the user chose that set, so it is already a
 * list they wrote rather than the address book this feature otherwise refuses
 * to show. `fetchLimitedContacts` reads it once on open and the sheet shows it
 * straight away, search field still there to narrow it further. See
 * `contactsImport.ts` and `contactsAccess.ts` for where that split is drawn.
 *
 * **One tap adds one person and the sheet stays open**, so adding three people
 * is three taps without the picker ever becoming a checklist of everybody.
 *
 * **The feature is entirely optional.** Refused or unavailable falls back to
 * the ordinary "type a name" path with one line saying so and no nagging: the
 * People screen's own add field is right behind this sheet.
 */
export function ContactPickerSheet({ visible, onPick, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const inputRef = useRef<TextInput>(null);

  // Everybody, archived included: a contact already on file as an archived
  // person is still already on file, and offering them again would mint the
  // duplicate this check exists to prevent.
  const people = usePersonStore(useShallow(s => s.people));

  const [permission, setPermission] = useState<ContactsPermission | null>(null);
  const [scope, setScope] = useState<ContactsAccessScope | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContactCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [limited, setLimited] = useState<ContactCandidate[]>([]);
  const [limitedLoading, setLimitedLoading] = useState(false);
  const [added, setAdded] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setResults([]);
    setAdded([]);
    setScope(null);
    setLimited([]);
    let live = true;
    getContactsPermission().then(p => { if (live) setPermission(p); });
    return () => { live = false; };
  }, [visible]);

  // Once permission is settled, find out whether it's a full or a limited
  // grant, then — only for a limited one — read the pre-selected set once up
  // front, since it's small and already curated rather than a book to guard.
  useEffect(() => {
    if (!visible || permission !== 'granted') return;
    let live = true;
    getContactsAccessScope().then(async s => {
      if (!live) return;
      setScope(s);
      if (s !== 'limited') return;
      setLimitedLoading(true);
      const all = await fetchLimitedContacts();
      if (live) { setLimited(all); setLimitedLoading(false); }
    });
    return () => { live = false; };
  }, [visible, permission]);

  // Debounced, and the token guards against an earlier search landing after a
  // later one: the field is typed into fast and the native read is async, so
  // without it "dus" can overwrite the results for "dustin". Full access
  // only — a limited grant filters the set it already fetched, locally.
  const searchToken = useRef(0);
  useEffect(() => {
    if (!visible || permission !== 'granted' || scope !== 'all') return;
    if (!canSearchContacts(query)) { setResults([]); setSearching(false); return; }
    const token = ++searchToken.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      const found = await searchContacts(query);
      if (searchToken.current !== token) return;
      setResults(found);
      setSearching(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, visible, permission, scope]);

  const shown = useMemo(
    () => (
      scope === 'limited'
        ? filterBrowsableContacts(limited, query, people)
        : rankContacts(results, query, people)
    ).filter(c => !added.includes(c.id)),
    [scope, limited, results, query, people, added]
  );

  const pick = (candidate: ContactCandidate) => {
    haptics.success();
    animateLayout();
    // Remembered by id rather than removed from `results`, so the row leaves
    // without the search having to run again — and a re-search that turns it
    // up again still hides it, since `alreadyAdded` can only see the person
    // once the store has caught up.
    setAdded(prev => [...prev, candidate.id]);
    onPick(contactPersonDraft(candidate));
  };

  const askPermission = async () => {
    haptics.tap();
    const granted = await requestContactsPermission();
    setPermission(granted ? 'granted' : 'denied');
    if (granted) inputRef.current?.focus();
  };

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={onClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <>
          <SheetHeaderButton label="Done" onPress={onClose} />
          <Text style={styles.headerTitle}>From contacts</Text>
          <View style={styles.headerSpacer} />
        </>
      }
    >
      {permission === 'granted' && scope === null ? (
        // Scope not resolved yet — one more async step past "granted" — so
        // there's nothing to commit to rendering (search-only vs. browsable)
        // until it lands.
        <View style={styles.spinner}><ActivityIndicator color={colors.textTertiary} /></View>
      ) : permission === 'granted' ? (
        <>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={iconSize.sm} color={colors.textTertiary} style={styles.searchIcon} />
            <TextInput
              ref={inputRef}
              style={styles.field}
              value={query}
              onChangeText={setQuery}
              placeholder={scope === 'limited' ? 'Search shared contacts' : 'Search your contacts'}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="words"
              autoCorrect={false}
              spellCheck={false}
              autoFocus
              returnKeyType="search"
              accessibilityLabel={scope === 'limited' ? 'Search or browse the contacts you shared' : 'Search your contacts'}
            />
          </View>

          {/* A full grant shows nothing under the field until somebody types
              — see the note at the top. A limited grant shows its (already
              curated) set straight away instead. */}
          {scope === 'all' && !canSearchContacts(query) ? (
            <Text style={styles.note}>
              Type a name to find somebody. Nothing is read from your contacts until you do.
            </Text>
          ) : (scope === 'limited' ? limitedLoading : searching) ? (
            <View style={styles.spinner}><ActivityIndicator color={colors.textTertiary} /></View>
          ) : shown.length === 0 ? (
            <Text style={styles.note}>
              {scope === 'limited' && !query.trim()
                ? (limited.length === 0
                    ? 'None of the contacts you shared have a name to add.'
                    : 'Everyone you shared is already added.')
                : `Nobody new matches “${query.trim()}”.`}
            </Text>
          ) : (
            <View style={styles.card}>
              {shown.map((candidate, i) => {
                const birthday = describeCandidateBirthday(candidate);
                const meta = [birthday, candidate.phoneNumber].filter(Boolean).join(' · ');
                return (
                  <View key={candidate.id}>
                    {i > 0 && <View style={styles.sep} />}
                    <TouchableOpacity
                      style={styles.row}
                      onPress={() => pick(candidate)}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${candidate.name}${meta ? `, ${meta}` : ''}`}
                    >
                      <View style={styles.rowText}>
                        <Text style={styles.rowName} numberOfLines={1}>{candidate.name}</Text>
                        {!!meta && <Text style={styles.rowMeta} numberOfLines={1}>{meta}</Text>}
                      </View>
                      <Ionicons name="add-circle-outline" size={iconSize.md} color={colors.accent} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </>
      ) : permission === null ? (
        <View style={styles.spinner}><ActivityIndicator color={colors.textTertiary} /></View>
      ) : (
        // One line and one button, then nothing. Refused access means the
        // ordinary "type a name" path, which is the field right behind this
        // sheet — so there is nothing here worth nagging about.
        <View style={styles.card}>
          <Text style={styles.permissionText}>
            {permission === 'denied'
              ? 'Contacts access is turned off for this app. You can still add somebody by typing their name.'
              : permission === 'unsupported'
                ? 'Contacts are only available on iOS. You can still add somebody by typing their name.'
                : "Find somebody in your contacts and their name, number and birthday are filled in for you. Nothing is copied until you pick a person."}
          </Text>
          {permission === 'denied' && (
            <TouchableOpacity
              style={styles.permissionBtn}
              onPress={() => Linking.openSettings()}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel="Open Settings"
            >
              <Text style={styles.permissionBtnText}>Open Settings</Text>
            </TouchableOpacity>
          )}
          {permission === 'undetermined' && (
            <TouchableOpacity
              style={styles.permissionBtn}
              onPress={askPermission}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel="Allow contacts access"
            >
              <Text style={styles.permissionBtnText}>Allow</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </EditorSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // `flex: 1` is load-bearing, not decoration: EditorSheet's root is a plain
  // View, so without it the root sizes to its content, the scroll's own
  // `flex: 1` resolves against an auto height and collapses to nothing, and the
  // sheet opens as a header over an empty screen. Same reason the header needs
  // `flexDirection: 'row'` — a title with `flex: 1` in a column measures zero.
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  headerTitle: {
    flex: 1, textAlign: 'center', color: colors.text,
    fontSize: font.md, fontWeight: fontWeight.semibold,
  },
  // Matches "Done" so the title stays optically centred, the same job
  // SheetHeaderButton's own minWidth does on the other side.
  headerSpacer: { width: 48 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  searchWrap: { justifyContent: 'center', marginBottom: spacing.md },
  searchIcon: { position: 'absolute', left: spacing.sm + 2, zIndex: 1 },
  field: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingLeft: spacing.sm + 2 + iconSize.sm + spacing.sm,
    paddingRight: spacing.sm + 2,
    fontSize: font.md,
    color: colors.text,
    // A height rather than a lineHeight: RN maps lineHeight straight onto the
    // iOS paragraph style with no baseline compensation, so the glyphs sit low
    // in the box while the caret stays centred.
    height: 44,
  },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  rowText: { flex: 1, gap: 2 },
  rowName: { color: colors.text, fontSize: font.md },
  rowMeta: { color: colors.textTertiary, fontSize: font.xs },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: spacing.md },
  note: {
    color: colors.textTertiary, fontSize: font.sm, lineHeight: 20,
    paddingHorizontal: spacing.sm,
  },
  spinner: { paddingVertical: spacing.lg, alignItems: 'center' },
  permissionText: {
    color: colors.textSecondary, fontSize: font.sm, lineHeight: 20,
    paddingHorizontal: spacing.md, paddingTop: 14, paddingBottom: spacing.sm,
  },
  permissionBtn: { paddingHorizontal: spacing.md, paddingBottom: 14, alignSelf: 'flex-start' },
  permissionBtnText: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.medium },
});
