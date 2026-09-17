import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { Calendar as ReminderList } from 'expo-calendar/legacy';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, spacing, type Colors } from '../theme';
import { MEAL_SLOTS, MEAL_SLOT_LABELS, type MealSlot, type ReminderCapture, type ReminderCaptureFiling } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskStore } from '../store/useTaskStore';
import { countImportableReminders } from '../utils/remindersImportSync';
import { findReminderList, reminderListOptions } from '../utils/remindersImport';
import {
  CAPTURE_TITLE_MAX_LENGTH,
  captureListIds,
  describeReminderCaptureFiling,
  makeReminderCapture,
} from '../utils/reminderCaptures';
import { haptics } from '../utils/haptics';
import { PillGroup, type PillGroupOption } from './PillGroup';
import { RuleListSheet } from './RuleListSheet';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';

/**
 * The extra Reminders lists the app drains, each filed somewhere of its own.
 *
 * `RuleListSheet` rather than a third hand-rolled copy of one — see that
 * component's note, and `WeatherRulesSheet`/`ScreenTimeRulesSheet` beside it.
 * The fit is exact: one row per capture, a toggle, a title somebody writes, and
 * a control that unfolds. What this supplies is the two ends, `header` and
 * `renderEditor`.
 *
 * **Picking the list is the one thing here that is not a plain edit**, and it
 * keeps the confirmation the two fixed legs have: importing deletes the user's
 * reminders, so nothing is written until an alert naming the list and the exact
 * count has been accepted. `RuleListSheet` commits every edit straight through
 * `onChange` as it is made, which is why the alert's own button is what calls
 * `update` — the list is not set and then confirmed, it is confirmed and then
 * set. See `docs/arch/reminders-import.md`.
 *
 * **Every destination here files a task.** The food arm stamps
 * `Task.logMealSlot` and lets the tick raise the food log's own prompt; it does
 * not write a `FoodLogEntry`, because an entry with no figures is refused
 * outright (`useFoodLogStore.addEntry`) and one staged unconfirmed would make a
 * day look logged to every nutrition read in the app. `ReminderCaptureFiling`
 * carries the long form of that.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * Every Reminders list on the device, or null while permission is missing or
   * the read hasn't landed. Supplied by the settings screen rather than read
   * again here: it already refreshes them on focus *and* on foreground,
   * because the permission row sends people to the Settings app without
   * unfocusing the screen.
   */
  reminderLists: ReminderList[] | null;
  /** The two fixed legs' lists, which a capture may never also point at. */
  reservedListIds: readonly string[];
}

type FilingKind = ReminderCaptureFiling['kind'];

const FILING_OPTIONS: SegmentOption<FilingKind>[] = [
  { value: 'meal', label: 'Food log' },
  { value: 'project', label: 'Project' },
  { value: 'category', label: 'Category' },
  { value: 'tag', label: 'Tag' },
];

/**
 * The four meals, as a clean 2×2 grid.
 *
 * "Work it out from the time of day" is deliberately *not* a fifth segment.
 * `segmentRows` pads a short last row with empty cells, so five options over
 * three columns leaves a hole, and at 390pt five across a single track is too
 * narrow to read — it is the ragged shape `SegmentedControl` exists to avoid,
 * one step removed. It is a switch above instead, which is also the honest
 * reading: deriving the meal is the default and not pinning it is the absence
 * of a choice, not a fifth kind of choice.
 */
const SLOT_OPTIONS: SegmentOption<MealSlot>[] = MEAL_SLOTS.map(slot => ({
  value: slot,
  label: MEAL_SLOT_LABELS[slot],
}));

export function ReminderCapturesSheet({ visible, onClose, reminderLists, reservedListIds }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const captures = useSettingsStore(useShallow(s => s.reminderCaptures));
  const setCaptures = useSettingsStore(s => s.setReminderCaptures);
  const categories = useCategoryStore(useShallow(s => s.categories));
  const addCategory = useCategoryStore(s => s.addCategory);
  const projects = useProjectStore(useShallow(s => s.projects));
  const createProject = useProjectStore(s => s.createProject);
  const tagRegistry = useTaskStore(useShallow(s => s.tagRegistry));
  const addTag = useTaskStore(s => s.addTag);

  /**
   * Which capture's list picker is open. Separate from `RuleListSheet`'s own
   * expanded row: the pills are a second disclosure inside it, and a list of
   * every Reminders list on the device unfolding the moment a row opens would
   * bury the filing control under it.
   */
  const [listPickerFor, setListPickerFor] = useState<string | null>(null);

  /**
   * A running list, which is what `ProjectKind` `'list'` exists for — a wish
   * list, questions for the doctor. An ordinary dated project is offered too:
   * "add X to my Kitchen Rebuild list" is a reasonable thing to want, and
   * refusing it here would be this sheet second-guessing which of the user's
   * own projects deserve a capture. Lists come first because they are what this
   * is for.
   */
  const projectOptions = useMemo(
    () => [...projects].sort((a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'list' ? -1 : 1) || a.title.localeCompare(b.title)
    ),
    [projects]
  );

  /**
   * The gate in front of everything destructive, and the same one
   * `RemindersCaptureSettings.confirmList` raises for the Inbox leg — naming
   * the count *and* the list is what makes it a decision rather than a dialog
   * to dismiss. Raised at the tap and never from the drain, which can run on a
   * cold launch with no screen mounted to answer it.
   *
   * The count is asked for as `'task'` because every capture files one, so it
   * already excludes whatever the drain would skip on a name it recognises.
   * Without that the one alert that has to be exact over-promises the moment
   * deletion is off.
   */
  const confirmList = async (
    capture: ReminderCapture,
    list: ReminderList,
    update: (patch: Partial<ReminderCapture>) => void
  ) => {
    setListPickerFor(null);
    const count = await countImportableReminders(list.id, 'task');
    if (count === null) {
      Alert.alert('Couldn’t read that list', 'Try again in a moment, or pick a different list.');
      return;
    }
    const where = destinationPhrase(capture.filing, { projects: projectOptions, categories });
    // Nothing is destroyed with deletion off, so the alert stops being a
    // warning and its button stops being destructive — dressing a copy up as a
    // deletion is how a real one stops being read.
    const body = capture.deleteAfterImport
      ? count === 0
        ? `Anything you add to this list will be added to ${where} and then deleted from the Reminders app.`
        : `The ${count} thing${count === 1 ? '' : 's'} already in this list will be added to ${where} and deleted from the Reminders app, along with anything you add later. Completed reminders are left alone.`
      : count === 0
        ? `Anything you add to this list will be added to ${where} and left where it is in the Reminders app. Anything whose name already matches a task is skipped, so nothing comes in twice.`
        : `The ${count} thing${count === 1 ? '' : 's'} already in this list will be added to ${where}, along with anything you add later. Nothing is removed from the Reminders app, and anything whose name already matches a task is skipped so it can’t come in twice. Completed reminders are left alone.`;
    Alert.alert(
      count === 0
        ? `Import from “${list.title}”?`
        : `Import ${count} reminder${count === 1 ? '' : 's'} from “${list.title}”?`,
      body,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          style: capture.deleteAfterImport ? 'destructive' : 'default',
          // Confirmed, *then* set. Both ids together, which is what keeps
          // re-pointing a capture at another list asking again rather than
          // inheriting the answer given for the old one.
          onPress: () => update({ listId: list.id, confirmedListId: list.id }),
        },
      ]
    );
  };

  /**
   * Changing what a capture files strips its confirmation, and this is the
   * non-obvious rule in the sheet.
   *
   * The alert names the destination ("added to your food log"), so an answer
   * given for one destination is not an answer for another: switching a
   * confirmed Food list over to a project would otherwise start filing into
   * that project, and deleting the reminders, on the strength of a sentence
   * about the food log. The list itself is kept, so re-confirming is one tap
   * rather than finding it again.
   */
  const changeFiling = (
    capture: ReminderCapture,
    filing: ReminderCaptureFiling,
    update: (patch: Partial<ReminderCapture>) => void
  ) => {
    haptics.tap();
    update({ filing, confirmedListId: null });
  };

  /**
   * Making the thing a capture files into, from inside the capture editor.
   *
   * **Find-or-create, never a second row with the same name.** A name that is
   * already taken selects what is there rather than being rejected: this is one
   * field doing both jobs (`PillGroup`'s filter is also its create box), so
   * typing a name you already have and being told off for it would be the
   * control fighting itself. `addCategory` and `addTag` already behave this way
   * on their own; the project arm matches them by hand, since `createProject`
   * has no such check and two projects called "Wish List" in a picker is a
   * choice nobody can make.
   *
   * A blank name is the one refusal, and it returns the message rather than
   * creating: `PillGroup` keeps the field open when a string comes back.
   *
   * Creating goes through `changeFiling`, so it clears the confirmation the
   * same way picking an existing one does. The alert named the destination, and
   * a destination that did not exist when it was answered is a different
   * destination.
   */
  const createProjectFiling = (
    capture: ReminderCapture,
    name: string,
    update: (patch: Partial<ReminderCapture>) => void
  ): string | void => {
    const title = name.trim();
    if (!title) return 'Give the project a name.';
    const existing = projectOptions.find(p => p.title.toLowerCase() === title.toLowerCase());
    // kind: 'list' because that is what a capture is for — a running list with
    // no dates, which is exactly what ProjectKind 'list' exists for and what
    // the filing refuses to date. A capture pointed at a dated project is
    // still allowed; it just isn't what creating one from here should make.
    const project = existing ?? createProject(title, { kind: 'list' });
    changeFiling(capture, { kind: 'project', projectId: project.id }, update);
  };

  const createCategoryFiling = (
    capture: ReminderCapture,
    name: string,
    update: (patch: Partial<ReminderCapture>) => void
  ): string | void => {
    const trimmed = name.trim();
    if (!trimmed) return 'Give the category a name.';
    // Returns the existing row when the name is taken, so this is find-or-create
    // without a check of its own.
    const category = addCategory(trimmed);
    changeFiling(capture, { kind: 'category', category: category.name }, update);
  };

  const createTagFiling = (
    capture: ReminderCapture,
    name: string,
    update: (patch: Partial<ReminderCapture>) => void
  ): string | void => {
    // Lowercased to match what addTag stores: it normalises on the way in, so
    // filing under the raw text would point at a tag that isn't in the registry
    // and read as "(deleted)" the moment the sheet re-rendered.
    const tag = name.trim().toLowerCase();
    if (!tag) return 'Give the tag a name.';
    addTag(tag);
    changeFiling(capture, { kind: 'tag', tag }, update);
  };

  const listNameFor = (capture: ReminderCapture): string | null =>
    findReminderList(reminderLists ?? [], capture.listId)?.title ?? null;

  return (
    <RuleListSheet<ReminderCapture>
      visible={visible}
      onClose={onClose}
      title="Capture lists"
      caption={
        'Each capture drains one Apple Reminders list into the app. "Hey Siri, add grilled '
        + 'cheese to my Food list" becomes a task that offers to log the meal when you check it off.'
      }
      rules={captures}
      onChange={setCaptures}
      makeRule={makeReminderCapture}
      describeRule={capture => {
        // One lookup for both names: describeReminderCaptureFiling reads
        // whichever of the two its own arm needs, and a project filing has no
        // category name to give (nor the reverse).
        const name = nameOfFiling(capture.filing, projectOptions, categories);
        const filing = describeReminderCaptureFiling(capture.filing, {
          projectName: name,
          categoryName: name,
        });
        const list = listNameFor(capture);
        if (!list) return `${filing} · No list picked`;
        // A confirmation is the difference between configured and running, so
        // the row says which it is rather than looking identical either way.
        if (capture.confirmedListId !== capture.listId) return `${filing} · “${list}”, not confirmed`;
        return `${filing} · “${list}”`;
      }}
      editorLabel="Where it goes"
      renderEditor={(capture, update) => {
        const listName = listNameFor(capture);
        // Every other list already in use, so two destinations can never read
        // one list — the handled record is one flat set across all of them, so
        // that would be a coin toss between the two. See captureListIds.
        const choices = reminderListOptions(reminderLists ?? [], [
          ...reservedListIds,
          ...captureListIds(captures, capture.id),
        ]);
        const listPills: PillGroupOption[] = choices.map(list => ({
          key: list.id,
          label: list.title,
          selected: list.id === capture.listId,
          accessibilityLabel: `Import from ${list.title}`,
          onPress: () => { haptics.tap(); void confirmList(capture, list, update); },
        }));
        return (
          <View>
            <SegmentedControl<FilingKind>
              options={FILING_OPTIONS}
              value={capture.filing.kind}
              columns={2}
              onChange={kind => changeFiling(capture, defaultFiling(kind, { projectOptions, categories, tagRegistry }), update)}
            />

            {capture.filing.kind === 'meal' && (
              <View style={styles.block}>
                <View style={styles.toggleRowTop}>
                  <View style={styles.toggleText}>
                    <Text style={styles.toggleLabel}>Always the same meal</Text>
                    <Text style={styles.hint}>
                      {capture.filing.slot
                        ? 'Everything from this list logs as that meal, no matter what time you dictated it.'
                        : 'Off, the meal is set by the time of day you dictated it, so one list can log breakfast, lunch, or dinner.'}
                    </Text>
                  </View>
                  <Switch
                    value={capture.filing.slot !== null}
                    onValueChange={next => changeFiling(
                      capture,
                      // Defaulting to lunch rather than breakfast on the way
                      // in: it is the middle of the day, so it is the least
                      // likely to be left wrong by somebody who flipped this
                      // to see what it did.
                      { kind: 'meal', slot: next ? 'lunch' : null },
                      update
                    )}
                    trackColor={{ false: colors.bgTertiary, true: colors.accent }}
                    thumbColor={colors.onAccent}
                    accessibilityLabel="Always log this list as the same meal"
                  />
                </View>
                {capture.filing.slot !== null && (
                  <View style={styles.block}>
                    <Text style={styles.label}>WHICH MEAL</Text>
                    <SegmentedControl<MealSlot>
                      options={SLOT_OPTIONS}
                      value={capture.filing.slot}
                      columns={2}
                      onChange={slot => changeFiling(capture, { kind: 'meal', slot }, update)}
                    />
                  </View>
                )}
              </View>
            )}

            {capture.filing.kind === 'project' && (
              <View style={styles.block}>
                <Text style={styles.label}>WHICH PROJECT</Text>
                <PillGroup
                  noun="project"
                  onCreate={name => createProjectFiling(capture, name, update)}
                  options={projectOptions.map(project => ({
                    key: project.id,
                    label: project.title,
                    selected: capture.filing.kind === 'project' && capture.filing.projectId === project.id,
                    accessibilityLabel: `File into ${project.title}`,
                    onPress: () => changeFiling(capture, { kind: 'project', projectId: project.id }, update),
                  }))}
                />
              </View>
            )}

            {capture.filing.kind === 'category' && (
              <View style={styles.block}>
                <Text style={styles.label}>WHICH CATEGORY</Text>
                <PillGroup
                  noun="category"
                  pluralNoun="categories"
                  onCreate={name => createCategoryFiling(capture, name, update)}
                  options={categories.map(category => ({
                    key: category.name,
                    label: category.name,
                    selected: capture.filing.kind === 'category' && capture.filing.category === category.name,
                    accessibilityLabel: `File under ${category.name}`,
                    onPress: () => changeFiling(capture, { kind: 'category', category: category.name }, update),
                  }))}
                />
              </View>
            )}

            {capture.filing.kind === 'tag' && (
              <View style={styles.block}>
                <Text style={styles.label}>WHICH TAG</Text>
                <PillGroup
                  noun="tag"
                  onCreate={name => createTagFiling(capture, name, update)}
                  options={tagRegistry.map(tag => ({
                    key: tag,
                    label: tag,
                    selected: capture.filing.kind === 'tag' && capture.filing.tag === tag,
                    accessibilityLabel: `Tag with ${tag}`,
                    onPress: () => changeFiling(capture, { kind: 'tag', tag }, update),
                  }))}
                />
              </View>
            )}

            <View style={styles.block}>
              <Text style={styles.label}>REMINDERS LIST</Text>
              {listPills.length === 0 ? (
                <Text style={styles.hint}>
                  No other Reminders lists on this device can be used. A list already feeding
                  somewhere else, and one that can’t be changed from here, are both left out.
                </Text>
              ) : listPickerFor === capture.id ? (
                <PillGroup noun="list" options={listPills} />
              ) : (
                <PillGroup
                  noun="list"
                  options={[{
                    key: '__pick',
                    label: listName ? `“${listName}”` : 'Pick a list',
                    selected: !!listName && capture.confirmedListId === capture.listId,
                    pinned: true,
                    accessibilityLabel: listName ? `Change list, currently ${listName}` : 'Pick a Reminders list',
                    onPress: () => { haptics.tap(); setListPickerFor(capture.id); },
                  }]}
                />
              )}
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.toggleLabel}>Delete after importing</Text>
                <Text style={styles.hint}>
                  {capture.deleteAfterImport
                    ? 'Each reminder is removed from the Reminders app once it is in.'
                    : 'Reminders stay put. Anything whose name already matches a task is skipped.'}
                </Text>
              </View>
              <Switch
                value={capture.deleteAfterImport}
                onValueChange={next => {
                  haptics.tap();
                  // Same reasoning as changeFiling: the alert said whether the
                  // reminders would be deleted, so changing that answer means
                  // the confirmation was given for a different thing.
                  update({ deleteAfterImport: next, confirmedListId: null });
                }}
                trackColor={{ false: colors.bgTertiary, true: colors.accent }}
                thumbColor={colors.onAccent}
                accessibilityLabel="Delete reminders after importing them"
              />
            </View>
          </View>
        );
      }}
      titlePlaceholder="e.g. Food"
      titleMaxLength={CAPTURE_TITLE_MAX_LENGTH}
      emptyIcon="mic-outline"
      emptyTitle="No capture lists"
      emptySubtitle="Add one to send an Apple Reminders list into your food log, a project, a category or a tag."
    />
  );
}

/**
 * "your food log" / "your Wish List project" — how the confirmation alert names
 * where the reminders are about to go.
 *
 * Its own function because the alert is the one piece of copy in this feature
 * that has to be exact: it is what stands between a tap and the deletion of
 * data the user owns in another app, so it says the destination in the words
 * that destination is called rather than "the app".
 */
function destinationPhrase(
  filing: ReminderCaptureFiling,
  lookup: { projects: readonly { id: string; title: string }[]; categories: readonly { name: string }[] }
): string {
  switch (filing.kind) {
    case 'meal':
      return 'your Inbox, each offering to log a meal when you check it off';
    case 'project': {
      const name = lookup.projects.find(p => p.id === filing.projectId)?.title;
      return name ? `the “${name}” project` : 'a project that no longer exists';
    }
    case 'category': {
      const name = lookup.categories.find(c => c.name === filing.category)?.name;
      return name ? `your tasks under “${name}”` : 'a category that no longer exists';
    }
    case 'tag':
      return `your tasks, tagged #${filing.tag}`;
  }
}

/** The name a filing points at, for `describeReminderCaptureFiling`'s two lookups. */
function nameOfFiling(
  filing: ReminderCaptureFiling,
  projects: readonly { id: string; title: string }[],
  categories: readonly { name: string }[]
): string | null {
  if (filing.kind === 'project') return projects.find(p => p.id === filing.projectId)?.title ?? null;
  if (filing.kind === 'category') return categories.find(c => c.name === filing.category)?.name ?? null;
  return null;
}

/**
 * The filing a freshly-picked kind starts as.
 *
 * A kind with nothing to point at yet (no projects, no tags) still switches,
 * carrying an empty target — the pills below it are then the obvious next step,
 * including "+ New {noun}" when there is nothing to pick yet at all, and
 * `activeReminderCaptures` will not drain a capture whose confirmation the
 * switch just cleared. Refusing the tap instead would leave somebody pressing a
 * segment that does nothing, with no way from here to give it something to
 * point at.
 */
function defaultFiling(
  kind: FilingKind,
  lookup: {
    projectOptions: readonly { id: string }[];
    categories: readonly { name: string }[];
    tagRegistry: readonly string[];
  }
): ReminderCaptureFiling {
  switch (kind) {
    case 'meal': return { kind: 'meal', slot: null };
    case 'project': return { kind: 'project', projectId: lookup.projectOptions[0]?.id ?? '' };
    case 'category': return { kind: 'category', category: lookup.categories[0]?.name ?? '' };
    case 'tag': return { kind: 'tag', tag: lookup.tagRegistry[0] ?? '' };
  }
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    block: {
      marginTop: spacing.md,
    },
    label: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      color: colors.textSecondary,
      letterSpacing: 0.8,
      marginBottom: spacing.xs,
    },
    hint: {
      fontSize: font.sm,
      color: colors.textSecondary,
      marginBottom: spacing.xs,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: border.hairline,
      borderTopColor: colors.separator,
    },
    // The same row without the rule above it, for a toggle that sits inside a
    // section rather than closing one off.
    toggleRowTop: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    toggleText: {
      flex: 1,
      marginRight: spacing.md,
    },
    toggleLabel: {
      fontSize: font.md,
      fontWeight: fontWeight.medium,
      color: colors.text,
      marginBottom: spacing.xxs,
    },
  });
}
