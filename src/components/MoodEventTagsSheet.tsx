import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useCalendarStore } from '../store/useCalendarStore';
import { useDemoStore } from '../store/useDemoStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, spacing, radius, type Colors } from '../theme';
import { useFilterField } from '../hooks/useFilterField';
import { generateId } from '../utils/id';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { EVENT_MATCH_MIN_LENGTH } from '../utils/eventTasks';
import { MOOD_EVENT_TAG_MAX_LENGTH, type MoodEventTag } from '../utils/moodContextSources';
import {
  describeMoodEventTagOffer,
  filterMoodEventTagOffers,
  moodEventTagOffers,
  ruleFromOffer,
} from '../utils/moodEventTagOffers';
import { EmptyNote } from './EmptyNote';
import { HelpText } from './HelpText';
import { InlineAction } from './InlineAction';
import { KeywordMatchEditor } from './KeywordMatchEditor';
import { RuleListSheet } from './RuleListSheet';
import { SearchField } from './SearchField';

/** Offers shown before the rest fold behind Show all. */
const OFFERS_SHOWN = 5;
/** Past this many offers, a find field goes above them. */
const FIND_FIELD_FROM = 15;

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** “a”, “a” or “b”, the way a rule's keywords read back under its tag. */
function describeRule(rule: MoodEventTag): string {
  const cues = rule.matches.filter(Boolean).map(m => `“${m}”`);
  if (cues.length === 0) return 'No keyword yet';
  return `Events with ${cues.length === 1 ? cues[0] : `${cues.slice(0, -1).join(', ')} or ${cues[cues.length - 1]}`}`;
}

/**
 * The person's calendar keyword -> mood tag rules (`MoodEventTag`), on the
 * `RuleListSheet` shell every rule list uses, with the event names from two
 * weeks either side of today listed above them so a rule can be made from one
 * tap rather than typed. The list is an offer: an event becomes a rule only
 * when the person taps it, and the rule opens so its tag can be shortened.
 *
 * Event names come from their own calendar read (`refreshRecent`), made when
 * the sheet opens and never otherwise.
 */
export function MoodEventTagsSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const rules = useSettingsStore(useShallow(s => s.moodEventTags));
  const setRules = useSettingsStore(s => s.setMoodEventTags);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const calendarReadEnabled = useSettingsStore(s => s.calendarReadEnabled);
  const recentEvents = useCalendarStore(s => s.recentEvents);
  const recentLoaded = useCalendarStore(s => s.recentLoaded);
  const demoActive = useDemoStore(s => s.active);
  const filter = useFilterField();
  const [showAll, setShowAll] = useState(false);
  const [openRuleId, setOpenRuleId] = useState<string | null>(null);

  useEffect(() => {
    if (visible) useCalendarStore.getState().refreshRecent();
    else {
      setShowAll(false);
      setOpenRuleId(null);
    }
  }, [visible]);

  const offers = useMemo(
    () => moodEventTagOffers(recentEvents, rules, new Date(), dayResetTime),
    [recentEvents, rules, dayResetTime],
  );
  const matching = filterMoodEventTagOffers(offers, filter.query);
  const shown = showAll || filter.query.trim() ? matching : matching.slice(0, OFFERS_SHOWN);
  const now = new Date();

  const tagOffer = (index: number) => {
    const offer = shown[index];
    if (!offer) return;
    haptics.tap();
    animateLayout();
    const rule = ruleFromOffer(offer, generateId());
    setRules([...rules, rule]);
    setOpenRuleId(rule.id);
  };

  const header = !calendarReadEnabled || demoActive ? (
    <View style={styles.block}>
      <EmptyNote icon="calendar-outline">
        {demoActive
          ? 'Your calendar isn’t read in demo mode, so its events aren’t listed here.'
          : 'Turn on calendar reading in Settings › Calendar to pick from your events here.'}
      </EmptyNote>
    </View>
  ) : (
    <>
      {recentLoaded && offers.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.sectionTitle}>FROM YOUR CALENDAR</Text>
          {offers.length > FIND_FIELD_FROM && (
            <SearchField field={filter} placeholder="Find an event" style={styles.find} />
          )}
          {shown.length > 0 ? (
            <View style={styles.card}>
              {shown.map((offer, i) => (
                <React.Fragment key={offer.title}>
                  {i > 0 && <View style={styles.sep} />}
                  <View style={styles.row}>
                    <View style={styles.body}>
                      <Text style={styles.name}>{offer.title}</Text>
                      <Text style={styles.sub}>{describeMoodEventTagOffer(offer, now, dayResetTime)}</Text>
                    </View>
                    <InlineAction
                      icon="add"
                      label="Tag it"
                      onPress={() => tagOffer(i)}
                      haptic={false}
                      accessibilityLabel={`Make a mood tag rule from ${offer.title}`}
                    />
                  </View>
                </React.Fragment>
              ))}
            </View>
          ) : (
            <EmptyNote icon="search-outline">No events match that.</EmptyNote>
          )}
          {!filter.query.trim() && matching.length > OFFERS_SHOWN && (
            <View style={styles.showAll}>
              <InlineAction
                variant="neutral"
                surface="page"
                icon={showAll ? 'chevron-up' : 'chevron-down'}
                label={showAll ? 'Show fewer' : `Show all ${matching.length}`}
                onPress={() => { animateLayout(); setShowAll(v => !v); }}
              />
            </View>
          )}
          <HelpText style={styles.note}>
            Events from the last two weeks and the next two that no rule covers yet. Tagging one makes a
            rule from its name, which you can change.
          </HelpText>
        </View>
      )}
      {rules.length > 0 && <Text style={styles.sectionTitle}>YOUR RULES</Text>}
    </>
  );

  return (
    <RuleListSheet<MoodEventTag>
      visible={visible}
      onClose={onClose}
      title="Calendar keywords"
      caption="A rule picks its tag in a new mood entry when that day has an event with one of its keywords in the title."
      rules={rules}
      onChange={setRules}
      makeRule={() => ({ id: generateId(), title: '', enabled: true, matches: [] })}
      describeRule={describeRule}
      editorLabel="When an event’s title has"
      renderEditor={(rule, update) => (
        <>
          <KeywordMatchEditor matches={rule.matches} onChange={matches => update({ matches })} />
          <HelpText style={styles.hint}>
            {`At least ${EVENT_MATCH_MIN_LENGTH} letters each. Matches whole words, so “Gym” matches `
            + '“Gym class” but not “Gymnastics”.'}
          </HelpText>
        </>
      )}
      titleLabel="Tag"
      titlePlaceholder="e.g. Therapy"
      titleMaxLength={MOOD_EVENT_TAG_MAX_LENGTH}
      openRuleId={openRuleId}
      header={header}
      emptyIcon="pricetag-outline"
      emptyTitle="No keywords yet"
      emptySubtitle="Tag an event above, or add a rule that picks a tag when an event’s title has a word you choose."
    />
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    block: { marginBottom: spacing.lg },
    sectionTitle: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      color: colors.textSecondary,
      letterSpacing: 0.8,
      marginBottom: spacing.sm,
      marginLeft: spacing.md,
    },
    find: { marginBottom: spacing.sm },
    card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md },
    sep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.md },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.smd,
    },
    // No numberOfLines: the event's name is what the row is for, so it wraps
    // rather than giving way to the button beside it.
    body: { flex: 1 },
    name: { color: colors.text, fontSize: font.md },
    sub: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
    showAll: { flexDirection: 'row', marginTop: spacing.sm },
    note: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.sm, marginHorizontal: spacing.md },
    hint: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xs },
  });
}
