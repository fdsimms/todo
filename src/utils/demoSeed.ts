import { addDays } from 'date-fns/addDays';
import { subDays } from 'date-fns/subDays';
import { setHours } from 'date-fns/setHours';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { usePersonStore } from '../store/usePersonStore';
import { usePersonNoteStore } from '../store/usePersonNoteStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useSettingsStore, type WeekStart } from '../store/useSettingsStore';
import { supplyReorderTitle } from './supply';
import { useTemplateStore } from '../store/useTemplateStore';
import { useFocusStore } from '../store/useFocusStore';
import { useSharedLinkStore } from '../store/useSharedLinkStore';
import type { DeliverableKind, GroceryItem, MealSlot, Recipe, Shop, TemplateItem } from '../types';
import { buildWeekDays } from './calendarGrid';
import { getCurrentDayStart, dayKeyOf } from './dateUtils';
import { generatedBy } from './generatedTasks';
import { focusPlanOptionsFrom } from './focusSettings';
import { projectReviewLinkUrl, projectReviewTitle } from './projectReviewTasks';
import { pantryCheckLinkUrl, pantryCheckTitle } from './pantryCheckTasks';
import { birthdayGiftTitle, personLinkUrl } from './birthdayTasks';
import { giftIdeasText } from './personNotes';
import { mealShortfallLinkUrl, mealShortfallTitle } from './mealShortfallTasks';
import { CALENDAR_REVIEW_TITLE } from './calendarReviewTasks';
import { dueMealPlanNudge, mealPlanNudgeLinkUrl } from './mealPlanNudge';
import { groceryNameKey } from './groceryParse';
import { OUT_OF_IT_UNTIL, defaultOnHandUntil } from './grocerySuggest';
import { generateId } from './id';

// Seeds a whole plausible-looking task list into whatever database is
// currently active. Demo mode points the db at a throwaway file first (see
// useDemoStore), so this only ever writes to that file — it must never be
// called against the user's real data.
//
// Everything goes through the normal store actions rather than raw db
// inserts, so seeded rows get exactly the same defaults, sort orders and
// derived fields a hand-created task would, and can't drift from the Task
// type as fields are added.
//
// The shape of the list matters as much as the contents: the demo is the
// whole app now, not one screen, so every view needs something in it —
// Today, Later, Unscheduled, Inbox, Projects, Logbook and Stats, plus the
// groceries/recipes/meal-plan hub and the fridge.
//
// **A feature with no demo data is a feature the demo says the app doesn't
// have.** Empty states are their own thing to show, but only for genuinely
// empty-by-default surfaces — an unused capability (composed recipes, choice
// groups, per-store links, leftovers) reads as missing rather than unused. So
// a change that adds a user-facing capability should add the one row here that
// makes it visible, in the same PR.
export function seedDemoData(): void {
  const {
    addTask,
    addSubtask,
    updateTask,
    completeTask,
    addNewGroupedTask,
    addExistingToProject,
    addTag,
    archiveTask,
    pinGroup,
    completeProject,
  } = useTaskStore.getState();
  const { addCategory, setCategoryEmoji } = useCategoryStore.getState();
  const { createProject, updateProject, removeProjectRow, restoreProject } = useProjectStore.getState();
  const { createGroup } = useTaskGroupStore.getState();

  const today = getCurrentDayStart();

  // --- Categories & tags ---------------------------------------------------
  const CATEGORIES: Array<[string, string]> = [
    ['Work', '💼'],
    ['Home', '🏠'],
    ['Health', '🌱'],
    ['Errands', '🛒'],
  ];
  CATEGORIES.forEach(([name, emoji]) => {
    addCategory(name);
    setCategoryEmoji(name, emoji);
  });
  ['bills', 'quick', 'reading', 'admin'].forEach(addTag);

  // --- Title rules ---------------------------------------------------------
  // Seeded before the tasks on purpose: the "Expense the client lunch" task
  // below names no category and no tag, so what files it under Work is the
  // rule itself. A seeded rule with nothing visibly filed by it would read as
  // a settings row rather than as a thing the app does.
  useSettingsStore.getState().setTitleRules([
    {
      id: 'demo-rule-expense',
      keywords: ['expense', 'reimburse'],
      match: 'startsWith',
      category: 'Work',
      projectId: null,
      tags: ['admin'],
      priority: 0,
      effort: 1,
      stripKeyword: false,
      enabled: true,
    },
  ]);

  // --- Today ---------------------------------------------------------------
  const roadmap = addTask({
    title: 'Send the Q3 roadmap to Priya',
    notes: 'Draft is in the shared folder, just needs the headcount slide.',
    category: 'Work',
    priority: 4,
    effort: 2,
    dueDate: today.toISOString(),
    deadline: addDays(today, 2).toISOString(),
    tags: ['admin'],
    pinned: true,
    // This is also the first task the seeded focus session below queues up —
    // notes and a link only show on that screen once a task in the plan
    // actually carries one.
    linkUrl: 'https://example.com/q3-roadmap-draft',
  });

  // Nothing here says Work, #admin or XXS — the seeded title rule above does,
  // the same way it would if this were typed into quick add.
  addTask({
    title: 'Expense the client lunch',
    notes: 'Receipt photo is in the shared album.',
    dueDate: today.toISOString(),
  });

  addTask({
    title: 'Pay the electricity bill',
    category: 'Home',
    priority: 3,
    effort: 1,
    dueDate: today.toISOString(),
    tags: ['bills', 'quick'],
  });

  const standup = addTask({
    title: 'Morning standup',
    notes: "Fifteen minutes, camera optional. The streak only counts if it's actually done in the morning.",
    category: 'Work',
    recurrenceType: 'weekly',
    recurrenceDays: [1, 2, 3, 4, 5],
    timeSegments: ['morning'],
    streakRequiresWindow: true,
    effort: 1,
  });
  updateTask(standup.id, { streakCount: 9, streakDate: subDays(today, 1).toISOString() });

  const meditate = addTask({
    title: 'Ten minutes of quiet',
    notes: 'Streaks survive a vacation. This one is paused while Vacation mode is on.',
    category: 'Health',
    recurrenceType: 'daily',
    vacationPause: true,
    effort: 1,
  });
  updateTask(meditate.id, { streakCount: 23, streakDate: subDays(today, 1).toISOString() });

  addTask({
    title: 'Read a chapter of the Le Guin',
    category: 'Health',
    timeSegments: ['evening'],
    tags: ['reading'],
    effort: 2,
  });

  // The postpone check has nothing to show until a task has actually been
  // ducked a few times, and a fresh demo database has no history — so the count
  // is stamped on directly. Opening this one's date picker is the whole feature:
  // it's the classic put-off-able errand, and the banner offers a way out.
  // (updateTask honours an explicit postponeCount instead of re-deriving one,
  // which is the same door every undo goes through.)
  const dentist = addTask({
    title: 'Book the dentist',
    notes: 'Been meaning to do this since the reminder card arrived.',
    category: 'Errands',
    dueDate: today.toISOString(),
    priority: 2,
    effort: 1,
    tags: ['admin'],
  });
  // driftingSince is stamped alongside for the same reason the count is: a
  // demo database has no history for the real rule to have derived one from.
  // Six weeks back, so the Drift screen's "first put off" line has something to
  // say rather than falling back to the bare count.
  updateTask(dentist.id, {
    postponeCount: 5,
    driftingSince: subDays(today, 42).toISOString(),
  });

  // A second drifter, so Drift reads as the list it is rather than a single
  // row — and so the ranking is visible: fewer moves, and a more recent start.
  const gutters = addTask({
    title: 'Clear the gutters',
    notes: 'Before the fall rain, ideally.',
    category: 'Home',
    dueDate: today.toISOString(),
    priority: 1,
    effort: 3,
    tags: ['home'],
  });
  updateTask(gutters.id, {
    postponeCount: 3,
    driftingSince: subDays(today, 11).toISOString(),
  });

  addTask({
    title: 'Swing by the farmers market',
    notes: 'Only worth doing between 8 and 1, after that the good stalls are gone.',
    category: 'Errands',
    dueDate: today.toISOString(),
    windowStart: '08:00',
    windowEnd: '13:00',
    effort: 2,
  });

  const morningRoutine = addTask({
    title: 'Morning routine',
    notes: 'A chain: finishing one step immediately hands you the next.',
    category: 'Health',
    chainEnabled: true,
    chainIndex: 0,
    chainItems: [
      { id: generateId(), title: 'Make the bed', estimatedMinutes: null },
      { id: generateId(), title: 'Stretch for five minutes', estimatedMinutes: null },
      { id: generateId(), title: 'Glass of water', estimatedMinutes: null },
    ],
  });
  updateTask(morningRoutine.id, { effort: 1 });

  // A chain step that asks a question and *places the next step with the
  // answer* — the one thing a chain can do with a deliverable that a plain
  // task can't. Left live on its first step so the tap does the whole thing:
  // tick "Book haircut", pick the appointment, and "Get haircut" turns up on
  // that day rather than today.
  addTask({
    title: 'Haircut',
    notes: 'Booking it is a step of its own. The date you give lands on the next step.',
    category: 'Errands',
    dueDate: today.toISOString(),
    chainEnabled: true,
    chainIndex: 0,
    chainItems: [
      {
        id: generateId(), title: 'Book haircut', estimatedMinutes: 5,
        deliverableKind: 'date', deliverableDatesNextStep: true,
      },
      { id: generateId(), title: 'Get haircut', estimatedMinutes: 40 },
    ],
  });

  // A number on a task is what puts the call/text button on its row — with no
  // row carrying one, that button and the Phone field both read as features
  // the app doesn't have.
  addTask({
    title: 'Call the dentist about the crown',
    notes: 'Ask whether the temporary needs replacing before the trip.',
    category: 'Health',
    dueDate: today.toISOString(),
    phoneNumber: '(555) 123-4567',
    effort: 1,
  });

  // The other two kinds the editor's Kind picker offers. Without a row apiece
  // the picker names two features demo mode can't show you.
  const piano = addTask({
    title: 'Practice the piano',
    notes: 'A timed task: the row counts down once you start it.',
    category: 'Health',
    dueDate: today.toISOString(),
    timedMinutes: 25,
    estimatedMinutes: 25,
    effort: 2,
  });
  // The countdown split across its subtasks — the 25 minutes above is the sum
  // of these, and the row names whichever stretch the clock is in. Without a
  // task carrying one, apportioning reads as a feature the app hasn't got.
  ([['Scales', 5], ['Pieces I know', 10], ['The new one', 10]] as const).forEach(([title, minutes]) => {
    const step = addSubtask(piano.id, title);
    updateTask(step.id, { timedMinutes: minutes });
  });

  const water = addTask({
    title: 'Drink a glass of water',
    notes: 'A daily target: log it through the day, and it only surfaces when you fall behind.',
    category: 'Health',
    dueDate: today.toISOString(),
    targetCount: 6,
    targetUnit: 'glasses',
    // A target resets by spawning its next occurrence, so it always repeats.
    recurrenceType: 'daily',
    recurrenceInterval: 1,
  });
  // Part-done, so the meter on the row reads as a meter rather than an empty bar.
  updateTask(water.id, { progressCount: 2 });

  // An extra-task rule. Invisible until it fires, so the seed carries a tally
  // partway through the cycle: the editor's caption then reads as a rule in
  // progress rather than one nobody has started.
  const violin = addTask({
    title: 'Practice the violin',
    notes: 'Every fourth session adds a one-off task to rosin the bow.',
    category: 'Health',
    dueDate: today.toISOString(),
    recurrenceType: 'daily',
    recurrenceInterval: 1,
    extraTaskEveryN: 4,
    extraTaskTitle: 'Rosin the bow',
    // The rule says more than the name — the added task is filed, ranked,
    // sized and given its own checklist. Invisible until it fires like the
    // rest of the rule, so the seed's job is the editor's Details row: with
    // no draft it reads "just the title", which is a capability nobody would
    // know to look for.
    extraTaskDraft: {
      notes: 'The tin lives in the case pocket.',
      category: 'Home',
      projectId: null,
      tags: ['upkeep'],
      priority: 1,
      effort: 1,
      estimatedMinutes: 5,
      timeSegments: ['evening'],
      subtasks: [
        { id: 'demo-rosin-1', title: 'Wipe the strings' },
        { id: 'demo-rosin-2', title: 'Loosen the bow' },
      ],
    },
    effort: 2,
  });
  updateTask(violin.id, { extraTaskTally: 2 });

  // A decision task — one that completes by recording an answer rather than
  // just being ticked. Seeded live so its checkbox shows the "?" that says it
  // will ask; the answered half is in the history below, since an answer only
  // exists on a completed row.
  addTask({
    title: 'Pick a date for the trip',
    notes: 'Checking this off asks for the date and keeps it with the task.',
    category: 'Errands',
    dueDate: today.toISOString(),
    deliverableKind: 'date',
    effort: 1,
  });

  // --- Waiting on / Blocks (one task held back by another) -----------------
  // Blocking is invisible until two tasks use it: the blocker's row carries a
  // "1 waiting" chip, the waiter is what the Waiting screen lists, and the
  // pair is what either editor's Waiting on / Blocks rows name.
  const cancelPlan = addTask({
    title: 'Cancel the internet plan',
    category: 'Errands',
    dueDate: today.toISOString(),
    effort: 1,
  });
  addTask({
    title: 'Return the router',
    notes: 'Held back until the plan is cancelled. Set from either task.',
    category: 'Errands',
    effort: 1,
    blockedById: cancelPlan.id,
  });

  // --- Archived (a recurring task paused indefinitely) ---------------------
  // The Archived screen is empty by default on a fresh install and reads as a
  // feature that does nothing without a row in it. Recurring on purpose: the
  // row names the schedule it's paused from, which is the thing you need to
  // decide whether to bring it back.
  const swim = addTask({
    title: 'Swim before work',
    notes: 'Paused while the pool is closed for refurbishment.',
    category: 'Health',
    recurrenceType: 'weekly',
    recurrenceDays: [2, 4],
    timeSegments: ['morning'],
    effort: 2,
  });
  archiveTask(swim.id);
  // Backdated so the row doesn't read as having been paused this morning —
  // archiveTask stamps the moment it runs, which is the seed's own runtime.
  updateTask(swim.id, { archivedAt: subDays(today, 26).toISOString() });

  // --- A stack (three independently-scheduled tasks under one label) --------
  const supplements = createGroup('Supplements', 'Health');
  const vitaminD = addNewGroupedTask(supplements.id, 'Vitamin D');
  const omega3 = addNewGroupedTask(supplements.id, 'Omega-3');
  const iron = addNewGroupedTask(supplements.id, 'Iron');
  // pinGroup only pins members due today (see the Pinning note in CLAUDE.md),
  // so all three need a date signal today for the pin-all demo below to
  // actually catch all three rather than leaving some unpinned. Plain
  // dueDates rather than a time segment, since an 'evening' segment would
  // make the demo's own pin-all miss Iron until that time of day arrives.
  updateTask(vitaminD.id, { dueDate: today.toISOString() });
  updateTask(omega3.id, { dueDate: today.toISOString() });
  updateTask(iron.id, { dueDate: today.toISOString() });
  // Pinned as a whole via the stack editor's pin button, so the Pinned Tasks
  // block shows a copy of all three alongside the lone pinned task above.
  pinGroup(supplements.id);

  // --- Later (deferred / future-dated) -------------------------------------
  addTask({
    title: 'Renew the passport',
    notes: 'Six weeks of processing time, so this needs starting well before the trip.',
    category: 'Errands',
    priority: 4,
    effort: 3,
    dueDate: addDays(today, 9).toISOString(),
    deadline: addDays(today, 21).toISOString(),
    // An estimate as well as a deadline, which is the pair Look ahead needs
    // before it will say anything about whether the work still fits: a task
    // carrying only one of the two is deliberately never judged.
    estimatedMinutes: 90,
  });

  // Look ahead needs something on the *far* side of a fortnight to have
  // anything to say: with a return date set, this is what "due while you are
  // away" is about, and without one it is simply past the default cutoff. A
  // seed that stopped at two weeks would make the sheet look like a second
  // Later list.
  addTask({
    title: 'Pay the car insurance',
    notes: 'Renews automatically, but the card on file expired.',
    category: 'Home',
    tags: ['bills'],
    dueDate: addDays(today, 16).toISOString(),
    deadline: addDays(today, 18).toISOString(),
    estimatedMinutes: 15,
    // Reminder as a "days before due" offset (Task.reminderOffsetDays) rather
    // than a fixed instant, so it keeps meaning "a couple of days' notice"
    // however far the due date itself ends up moving.
    reminderTime: setHours(addDays(today, 14), 9).toISOString(),
    reminderOffsetDays: 2,
  });

  addTask({
    title: 'Draft the quarterly report',
    notes: 'Nothing to do until the numbers land on Thursday.',
    category: 'Work',
    deferUntil: addDays(today, 3).toISOString(),
    effort: 4,
    priority: 2,
  });

  addTask({
    title: 'Water the plants',
    category: 'Home',
    recurrenceType: 'weekly',
    recurrenceDays: [1, 4],
    dueDate: addDays(today, 1).toISOString(),
    effort: 1,
  });

  // Two hours on a day that already holds a couple of things, which is what
  // puts the calendar's weight cue on a day *ahead* of today. Seeding only a
  // busy today would show half the feature: the cue is for the day you're
  // about to schedule onto, not the one you're standing in.
  addTask({
    title: 'Prep the offsite deck',
    notes: 'Needs a clear couple of hours, not the gaps between things.',
    category: 'Work',
    priority: 3,
    dueDate: addDays(today, 2).toISOString(),
    estimatedMinutes: 120,
  });

  addTask({
    title: 'Dentist at 2:40pm',
    category: 'Health',
    dueDate: addDays(today, 5).toISOString(),
    reminderTime: setHours(addDays(today, 5), 13).toISOString(),
    effort: 1,
  });

  // The reminder kind that keeps ringing until the task is ticked off. Seeded
  // because a reminder kind is invisible until something uses it — the editor
  // shows 'Until done' as one pill of three, and nothing else says the app can
  // do this. It rings as a real alarm only on iOS 26+; elsewhere the row still
  // reads correctly, it just falls back to one notification.
  addTask({
    title: 'Take antibiotics',
    notes: 'Set to keep ringing until it is checked off.',
    category: 'Health',
    dueDate: addDays(today, 1).toISOString(),
    reminderTime: setHours(addDays(today, 1), 8).toISOString(),
    reminderKind: 'persistent',
    effort: 1,
  });

  // --- Unscheduled (organized, but no date) --------------------------------
  addTask({
    title: 'Deep clean the garage',
    notes: 'Effort is a size, not a time estimate. This one is an XL.',
    category: 'Home',
    effort: 6,
    priority: 1,
  });

  addTask({
    title: 'Find a decent standing desk',
    category: 'Work',
    tags: ['admin'],
    effort: 3,
  });

  addTask({
    title: 'Reread the Vonnegut essays',
    category: 'Health',
    tags: ['reading'],
    effort: 2,
  });

  // --- Inbox (captured, not yet filed — no metadata at all) ----------------
  addTask({ title: 'Look into the bike repair place on 4th' });
  addTask({ title: 'Ask Sam about the cabin in October' });
  // Two rows sharing a marker word no seeded rule claims. A title rule's
  // catch-up offer (see titleRuleBacklog) only appears for a rule someone
  // writes, so the seed can't hold one — what it can hold is a backlog for
  // that rule to find, which is the half of the feature a screenshot shows.
  addTask({ title: 'Invoice the workshop day' });
  addTask({ title: 'Invoice the Ferndale rebrand' });

  // --- A project -----------------------------------------------------------
  const kitchen = createProject(
    'Kitchen refresh',
    today.toISOString(),
    addDays(today, 45).toISOString(),
  );
  // Two of these are decisions — they completed by recording an answer, and
  // the project's Decisions block reads those answers back above the tasks.
  // Without a project holding one, that block never appears in demo mode and
  // the feature reads as one the app doesn't have.
  // The two live steps carry dates, and different ones: the project screen
  // shows each row's own date, and a project whose tasks were all undated
  // would render that chip nowhere.
  const projectTasks: Array<{
    title: string;
    effort: 1 | 2 | 3;
    done: boolean;
    deliverableKind?: DeliverableKind;
    answer?: string;
    dueDate?: string;
    deferUntil?: string;
  }> = [
    { title: 'Measure the counters', effort: 1, done: true },
    { title: 'Pick a tile', effort: 2, done: true, deliverableKind: 'text', answer: 'Matte white 4x12' },
    { title: 'Set the budget', effort: 1, done: true, deliverableKind: 'number', answer: '6500' },
    { title: 'Get three quotes', effort: 3, done: false, dueDate: addDays(today, 2).toISOString() },
    { title: 'Book the installer', effort: 2, done: false, deferUntil: addDays(today, 9).toISOString() },
  ];
  projectTasks.forEach(({ title, effort, done, deliverableKind, answer, dueDate, deferUntil }) => {
    const t = addTask({
      title,
      category: 'Home',
      effort,
      deliverableKind: deliverableKind ?? null,
      dueDate: dueDate ?? null,
      deferUntil: deferUntil ?? null,
    });
    addExistingToProject(t.id, kitchen.id);
    if (done) completeTask(t.id, answer !== undefined ? { deliverableValue: answer } : undefined);
  });

  // A reference list, not a to-do list: nothing here ever gets a date, and
  // nudgeOptIn defaults to false, so it never trips the gone-quiet nudge or
  // shows up in "Pull from projects" the way an ordinary undated project
  // would. See Project.nudgeOptIn.
  const giftIdeas = createProject('Gift ideas', null, null);
  ['Something for Mom\'s birthday', 'Housewarming idea for the Chens', 'Stocking stuffers'].forEach(title => {
    const t = addTask({ title });
    addExistingToProject(t.id, giftIdeas.id);
  });

  // A project that has gone quiet, and the task the app writes about it.
  //
  // Opted in and past its cadence with nothing scheduled, which is the exact
  // state utils/projectReviewTasks.ts exists for — and the state that used to
  // be invisible everywhere, since an undated project task appears in no list
  // at all. Seeded rather than left to `checkProjectReviewTasks`: that reads
  // the *real* install's settings, and demo mode swaps the database rather
  // than the preferences (same reasoning as the kitchen categories below).
  //
  // Its one completed member is back-dated three weeks, which is what makes
  // the project read as quiet — quiet is measured from the last completion, so
  // a project created seconds ago with no history would render "Quiet 0 days"
  // and demonstrate nothing.
  const garage = createProject('Garage shelving', null, null);
  updateProject(garage.id, { nudgeOptIn: true, nudgeCadenceDays: 14 });
  // Quiet is measured from the project's own creation until something in it
  // is completed, so a project minted seconds ago is never quiet however long
  // its members have sat there — the seeded task would be swept away by the
  // first foreground as describing a project that isn't stalled at all.
  // createdAt has no setter of its own (and shouldn't: it's a fact about when
  // the row was made), so the back-date goes through the delete/undo pair,
  // which is a real store action writing a real Project.
  removeProjectRow(garage.id);
  restoreProject({ ...garage, nudgeOptIn: true, nudgeCadenceDays: 14, createdAt: subDays(today, 28).toISOString() });
  const measured = addTask({ title: 'Measure the wall', category: 'Home' });
  addExistingToProject(measured.id, garage.id);
  completeTask(measured.id);
  updateTask(measured.id, { completedAt: setHours(subDays(today, 21), 11).toISOString() });
  // Undated on purpose — one dated member and the project isn't quiet.
  ['Price out brackets', 'Cut the shelves to length'].forEach(title => {
    const t = addTask({ title, category: 'Home' });
    addExistingToProject(t.id, garage.id);
  });
  addCategory('Projects');
  setCategoryEmoji('Projects', '📁');
  useSettingsStore.getState().setProjectReviewTaskCategory('Projects');
  addTask({
    title: projectReviewTitle({ title: 'Garage shelving' }),
    dueDate: today.toISOString(),
    linkUrl: projectReviewLinkUrl(garage.id),
    category: 'Projects',
    ...generatedBy('projectReview', garage.id),
  });

  // The daily "review tomorrow's calendar" task — off by default, same
  // reasoning as the pantry check above, so it's seeded directly rather than
  // left to checkCalendarReviewTasks: that pass reads the real device
  // calendar, which the demo must never touch (see isDemoModeActive in
  // checkCalendarReviewTasks), and the real install's own settings, neither of
  // which this fictional day should depend on.
  //
  // Filed under calendarEventCategory itself rather than a category of its
  // own — this generator has none (see GeneratedKindSpec.categorized) — named
  // here for the same reason projectReviewTaskCategory is above: the demo
  // swaps the database, not the preferences.
  addCategory('Calendar Events');
  setCategoryEmoji('Calendar Events', '📅');
  useSettingsStore.getState().setCalendarEventCategory('Calendar Events');
  addTask({
    title: CALENDAR_REVIEW_TITLE,
    dueDate: today.toISOString(),
    category: 'Calendar Events',
    ...generatedBy('calendarReview', dayKeyOf(addDays(today, 1))),
  });

  // Marked complete rather than archived — demonstrates Project.completed,
  // which has its own Completed list (see ProjectEditor's Mark complete row)
  // instead of disappearing into Archived the way finishing a project used to.
  const hallway = createProject('Repaint the hallway', null, null);
  ['Buy paint and tape', 'Tape the trim', 'Two coats, let dry between'].forEach(title => {
    const t = addTask({ title, category: 'Home' });
    addExistingToProject(t.id, hallway.id);
    completeTask(t.id);
  });
  completeProject(hallway.id, { archiveRemaining: false });

  // Every task done but the project itself left active — the state the
  // "Mark complete" affordance on the Projects list and the project detail
  // screen exists for. Left uncompleted on purpose, unlike the hallway
  // above: that one demonstrates Project.completed, this one demonstrates
  // the nudge to reach it.
  const gate = createProject('Fix the back gate', null, null);
  ['Buy a new hinge', 'Sand and repaint'].forEach(title => {
    const t = addTask({ title, category: 'Home' });
    addExistingToProject(t.id, gate.id);
    completeTask(t.id);
  });

  // --- Subtasks ------------------------------------------------------------
  const trip = addTask({
    title: 'Plan the Japan trip',
    notes: 'Subtasks track their own progress count without cluttering Today.',
    category: 'Errands',
    effort: 4,
    deferUntil: addDays(today, 2).toISOString(),
  });
  ['Book flights', 'Reserve the ryokan', 'Sort a JR pass'].forEach(title => {
    addSubtask(trip.id, title);
  });

  // --- A focus session, mid-stretch ----------------------------------------
  // Started through the real store action, so the plan is whatever
  // buildFocusPlan makes of these two tasks under the shipped settings rather
  // than a hand-written run that could drift from it. These two are chosen for
  // what the plan does to them: the roadmap fits in one stretch, the gutters
  // are estimated past the work cap and so get split in half with a break in
  // the middle. Both of those are invisible until something is actually
  // queued, which is exactly the kind of capability this seed exists for.
  //
  // It runs rather than sits paused: a session on a demo phone should look
  // like one in progress, and the clock is stamped at seed time, so entering
  // demo mode always starts it from the top rather than showing something that
  // ran out days ago.
  useFocusStore.getState().startSession(
    [roadmap, gutters],
    focusPlanOptionsFrom(useSettingsStore.getState()),
  );

  // --- History, so Logbook and Stats aren't empty --------------------------
  const HISTORY: Array<[string, string, number]> = [
    ['Reply to the landlord', 'Home', 0],
    ['Ship the pricing changes', 'Work', 0],
    ['Pick up the dry cleaning', 'Errands', 1],
    ['Weekly review', 'Work', 1],
    ['Call Mom', 'Home', 2],
    ['Refill the prescription', 'Health', 2],
    ['Cancel the unused subscription', 'Home', 3],
    ['Fix the flaky login test', 'Work', 4],
  ];
  HISTORY.forEach(([title, category, daysAgo]) => {
    const t = addTask({ title, category, effort: 2 });
    completeTask(t.id);
    // completeTask stamps "now"; back-date it so the Logbook shows several
    // days of history and Stats has a real streak/trend to draw.
    const at = subDays(today, daysAgo);
    updateTask(t.id, { completedAt: setHours(at, 17).toISOString() });
  });

  // The other half of the decision task above: one already answered, so the
  // Logbook shows what an answer actually looks like on the row. Completed
  // through the real action with the value, exactly as the prompt does it.
  const budget = addTask({
    title: 'Decide on the trip budget',
    category: 'Errands',
    effort: 1,
    deliverableKind: 'number',
  });
  completeTask(budget.id, { deliverableValue: '2400' });
  updateTask(budget.id, { completedAt: setHours(subDays(today, 1), 9).toISOString() });

  // --- Supplies: a countdown of a thing, and the order it asks for ---------
  // Two, because the feature has two halves and only one of them is visible at
  // rest. A supply with plenty left is a chip on a row; a supply that has run
  // low is a task the app wrote — and with only the healthy one seeded, the
  // half that does the work would read as something the app can't do.
  const waterFilter = addTask({
    title: 'Change the water filter',
    notes: 'A supply: one filter goes every time this is done, and the app asks for more before the box runs out.',
    category: 'Home',
    dueDate: addDays(today, 3).toISOString(),
    recurrenceType: 'monthly',
    recurrenceInterval: 1,
    supplyCount: 2,
    supplyUnit: 'filters',
    supplyRefillCount: 6,
    supplyReorderAt: 2,
    supplyLeadDays: 5,
    // Where you actually buy it — inherited by the reorder task below, which
    // is most of what makes that row one tap rather than a errand to
    // remember. A real link rather than a placeholder, because a dead one on
    // the demo's own row is worse than none.
    linkUrl: 'https://www.google.com/search?q=fridge+water+filter',
  });
  // The order the app wrote about it. Seeded rather than left to
  // `checkSupplyReorderTasks`, for the reason the pantry check and the quiet
  // project's review task are: that pass runs on Today's focus, so a demo
  // relying on it would show the row in a different place depending on the
  // person's own preferences.
  addTask({
    title: supplyReorderTitle(waterFilter),
    dueDate: today.toISOString(),
    // The day the last filter gets used, worked out from the repeat — this is
    // what the lead time buys, and it reads on the row as a deadline countdown
    // like any other.
    deadline: addDays(today, 33).toISOString(),
    linkUrl: waterFilter.linkUrl,
    // Inherited from the task above, same as linkUrl — a reorder task files
    // wherever the task its supply is on files, not into a category of its
    // own. See GeneratedKindSpec.categorized.
    category: waterFilter.category,
    // Completing it asks how many arrived, pre-filled with the pack size, and
    // the answer is what puts the count back up.
    deliverableKind: 'number',
    ...generatedBy('supplyReorder', waterFilter.id),
  });
  // The at-rest half: nowhere near needing anything, so the row just says how
  // many are left.
  addTask({
    title: 'Swap contact lenses',
    category: 'Health',
    dueDate: addDays(today, 1).toISOString(),
    recurrenceType: 'weekly',
    recurrenceInterval: 2,
    supplyCount: 9,
    supplyUnit: 'pairs',
    supplyRefillCount: 12,
    supplyReorderAt: 2,
  });

  // --- A template, and the blanks it fills in at apply time ----------------
  seedTemplates();

  // --- Groceries, recipes, the week's meals and the fridge -----------------
  // Ordered by what points at what: recipes first (grocery rows can be
  // attributed to the recipe that put them on the list), then the catalog,
  // then the plan that references both, then the leftovers a cooked meal left.
  //
  // Skipped wholesale when the area is off. Demo mode is what someone handed
  // the phone actually sees, and seeding a shop, a week of dinners and a
  // fridge that none of them can reach is worse than seeding nothing: the
  // hub isn't in the menu, so it would only surface as cook tasks on Today
  // for meals there's no way to open.
  if (useSettingsStore.getState().kitchenEnabled) {
    const recipes = seedRecipes();
    seedGroceries(recipes, today);
    seedMealPlanAndFridge(recipes, today);
  }

  seedPeople(today);
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * A handful of people, hand-added, which is the whole shape of the feature:
 * not an address book, just the people you want to keep up with. Three, because
 * a list of thirty would be exactly the cold thing `docs/arch/people.md` is
 * about, and the seed is what someone handed the phone actually sees.
 */
function seedPeople(today: Date): void {
  const { createPerson, updatePerson } = usePersonStore.getState();
  const { addTask, updateTask, completeTask } = useTaskStore.getState();

  // One birthday inside the lead window so the generated task is genuinely on
  // Today when demo mode opens — this generator is invisible until a birthday
  // is close enough to fire, and a feature with no row in the seed reads as a
  // feature the app doesn't have. One months off, so the list shows both.
  const bdayNear = addDays(today, 2);
  const bdayFar = addDays(today, 154);

  const dustin = createPerson('Dustin');
  updatePerson(dustin.id, {
    birthdayMonth: bdayNear.getMonth() + 1,
    birthdayDay: bdayNear.getDate(),
    // A year on one of the two, so the seed shows the field exists without
    // implying everybody's is worth knowing — it's never read back to say
    // what age he's turning (#2083 removed that; this is a separate field).
    birthYear: bdayNear.getFullYear() - 34,
    phoneNumber: '555 0148',
    notes: 'Climbs on Wednesdays. Allergic to shellfish.',
  });

  const ansley = createPerson('Ansley');
  updatePerson(ansley.id, {
    birthdayMonth: bdayFar.getMonth() + 1,
    birthdayDay: bdayFar.getDate(),
    nickname: 'Ans',
    phoneNumber: '555 0172',
  });

  // No birthday at all, which is the state most people are added in: a name is
  // enough and everything else is optional. She is the one person opted into a
  // reminder, because the generator is invisible until somebody is — and she
  // carries an "ask about" note, so the seeded row reads "Ask Mom about her
  // garden" rather than the plain "Catch up with Mom". That is rule 7 in one
  // row: the clock decides when to speak, the note decides what it says.
  const mom = createPerson('Mom');
  updatePerson(mom.id, {
    cadenceDays: 14,
    nudgeOptIn: true,
    askAbout: 'her garden',
    phoneNumber: '555 0106',
  });

  // Tasks that name people, which is what a shared history is made of (#2045).
  // One planned and one already done, so the link reads both ways rather than
  // only as something upcoming.
  const beach = addTask({ title: 'Beach day', dueDate: addDays(today, 5).toISOString() });
  updateTask(beach.id, { personIds: [dustin.id, ansley.id] });

  const coffee = addTask({ title: 'Coffee with Mom' });
  updateTask(coffee.id, { personIds: [mom.id] });
  completeTask(coffee.id);
  // Backdated past her cadence, which is what makes the reminder below actually
  // fire. Written straight onto the row rather than through a store action
  // because nothing completes a task *in the past* — the honest alternative
  // would be seeding no reminder at all, and then the feature reads as absent.
  updateTask(coffee.id, { completedAt: addDays(today, -20).toISOString() });

  // Something you're waiting on somebody for (#2087). It hides from Today the
  // way a task blocked on another task does, so without a seeded one the
  // Waiting screen's person sections read as a feature the app doesn't have —
  // and unlike a task blocker, nothing ends this on its own.
  const photos = addTask({ title: 'Photos from the trip' });
  updateTask(photos.id, { waitingOnPersonId: dustin.id });

  // Two of them are coming for dinner tomorrow (#2077). Guests are the tie-in
  // that makes the kitchen half and the people half one app, and a meal with
  // nobody on it reads as a feature this app doesn't have — so one seeded meal
  // carries them, which is also what puts a row under COMING UP on Ansley's and
  // Mom's own screens without anything having been ticked off.
  if (seededSalmonNightId) {
    useMealPlanStore.getState().setMealGuests(seededSalmonNightId, [ansley.id, mom.id]);
  }
  // Cooked for eight, so a guest already fits the plan without inventing a
  // new meal — and it's the one that gives the year-in-review stat something
  // to count, since the salmon dinner above deliberately isn't cooked yet.
  if (seededSteakNightId) {
    useMealPlanStore.getState().setMealGuests(seededSteakNightId, [dustin.id]);
  }

  // The memory layer (#2047), which is rule 7 and the part that makes this a
  // feature you like rather than one you tolerate. Every kind gets one, and
  // each one lands somewhere: the gift ideas ride onto Dustin's birthday task
  // (his birthday is two days away, so that task genuinely exists), the food
  // notes show on the salmon dinner those two are guests at, and the dated one
  // is what a note able to go stale actually looks like.
  const { addNote } = usePersonNoteStore.getState();
  addNote(dustin.id, 'gift', 'The bouldering gym membership');
  addNote(dustin.id, 'gift', 'A proper chalk bag');
  addNote(dustin.id, 'food', 'No shellfish');
  addNote(ansley.id, 'note', 'Starts the new job in September, ask how it went', addDays(today, 16).toISOString());
  addNote(ansley.id, 'food', "Doesn't drink");
  addNote(mom.id, 'food', 'No shellfish');
  // Its day has been and gone, which is the other half of the treatment: shown
  // quieter, sunk below the live ones, and never deleted by the app.
  addNote(mom.id, 'note', 'Ask how the hospital appointment went', subDays(today, 9).toISOString());

  // The birthday task comes from the same pass the app runs at launch rather
  // than from a row written by hand here: a seeded row that skipped the
  // generator could drift from what the generator actually produces.
  useTaskStore.getState().checkBirthdayTasks();
  // The gift task is written by hand instead, for pantryCheck's reason: that
  // pass reads the real install's own settings, and this generator ships off,
  // so a demo relying on it would show the feature only to people who had
  // already found it. Its source id is copied off the birthday task's own
  // rather than recomputed, so the two can never disagree about which year.
  const dustinBirthdayTask = useTaskStore.getState().tasks
    .find(t => t.generatedKind === 'birthday' && t.generatedSourceId?.startsWith(`${dustin.id}#`));
  if (dustinBirthdayTask?.generatedSourceId) {
    addTask({
      title: birthdayGiftTitle(dustin),
      dueDate: today.toISOString(),
      linkUrl: personLinkUrl(dustin.id),
      category: dustinBirthdayTask.category,
      notes: giftIdeasText(usePersonNoteStore.getState().notes, dustin.id, today),
      ...generatedBy('birthdayGift', dustinBirthdayTask.generatedSourceId),
    });
  }
  // And the reminder, through the same pass the app runs at launch. It finds
  // exactly one person opted in, so demo mode opens with one catch-up row
  // rather than a screen of them.
  useTaskStore.getState().checkReachOutTasks();
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * One template, with two blanks and three questions in it.
 *
 * The blanks are half the reason this exists: `{destination}` is asked for once
 * in the apply sheet and lands in three item titles, and `{run}` inlines the
 * name given to the run itself.
 *
 * The questions are the other half, and they're the same argument one layer up
 * — a template that asks nothing looks exactly like an app that can't ask. So
 * this one asks all three kinds: `{nights}` reads itself off the two anchor
 * dates and counts the shirts (and, halved, the jeans), "What kind of trip?"
 * decides whether the laptop arrives ticked, and "Who's coming?" is the
 * `'people'` kind (#2090) — answered by nobody here, same as the other two are
 * never actually run from this seed. All three are invisible anywhere until a
 * template declares one.
 */
function seedTemplates(): void {
  const { addTemplate, addItem, addQuestion } = useTemplateStore.getState();
  const template = addTemplate('Trip prep');
  // Referenced by the item titles below rather than by an item field, so its
  // id is never needed here.
  addQuestion(template.id, {
    prompt: 'How many nights?',
    name: 'nights',
    kind: 'number',
    fromDates: 'nights',
  });
  const tripType = addQuestion(template.id, {
    prompt: 'What kind of trip?',
    name: 'trip type',
    kind: 'choice',
    options: ['Vacation', 'Work'],
  })!;
  // No options, no name, no default to seed — a 'people' question has none of
  // those, its answer set is read live off the People screen at apply time.
  addQuestion(template.id, { prompt: "Who's coming?", kind: 'people' });
  const ITEMS: Partial<TemplateItem>[] = [
    // The decision item: applying the template produces a task that asks for
    // the dates when it's ticked, rather than one someone has to convert to a
    // decision by hand every trip.
    { title: 'Pick dates for {destination}', dueOffsetDays: -28, deliverableKind: 'date' },
    { title: 'Put in for PTO for {run}', category: 'Work', dueOffsetDays: -21, priority: 3 },
    { title: 'Book flights to {destination}', dueOffsetDays: -14, priority: 4, effort: 2 },
    { title: 'Somewhere to stay in {destination}', dueOffsetDays: -14, effort: 2 },
    {
      title: 'Pack for {destination}',
      dueOffsetDays: -1,
      category: 'Home',
      subtasks: [
        { id: generateId(), title: 'Passport' },
        { id: generateId(), title: 'Chargers' },
        { id: generateId(), title: 'Meds' },
      ],
    },
    // A count off the dates, and the same count halved — one shirt a day, one
    // pair of jeans per two.
    { title: 'Pack {nights} shirts', dueOffsetDays: -1, category: 'Home' },
    { title: 'Pack {nights / 2} pairs of jeans', dueOffsetDays: -1, category: 'Home' },
    // And the conditioned one: ticked for a work trip, left off for a vacation.
    {
      title: 'Pack laptop and charger',
      dueOffsetDays: -1,
      category: 'Home',
      conditions: [{ questionId: tripType.id, values: ['Work'] }],
    },
    // Anchored to the end date instead, and optional — the two item settings
    // that are otherwise only described in the editor's own hints.
    { title: 'Unpack and put a wash on', anchor: 'end', dueOffsetDays: 1, optional: true },
  ];
  ITEMS.forEach(item => addItem(template.id, item));

  // A second template, and the only one that carries a schedule (#1781). A
  // template that applies itself is invisible until one does — the Applies
  // itself row reads "Never" on every other template in the app, which is
  // exactly what a capability nobody has switched on looks like.
  //
  // Its *run* isn't seeded, and can't be: the only thing that could stamp a
  // period key without also firing is checkScheduledTemplates, and the demo
  // database is swapped in by initTasks rather than by the launch sequence
  // that calls it. So this one fires for real the next time the app comes to
  // the foreground, which is the honest demonstration anyway.
  const reset = addTemplate('Sunday reset');
  const RESET_ITEMS: Partial<TemplateItem>[] = [
    { title: 'Sheets and towels', category: 'Home', dueOffsetDays: 0, effort: 2 },
    { title: 'Bins out', category: 'Home', dueOffsetDays: 0, timeSegments: ['evening'] },
    { title: 'Plan the week', category: 'Work', dueOffsetDays: 0, priority: 3 },
    { title: 'Water the plants', category: 'Home', dueOffsetDays: 0, optional: true },
  ];
  RESET_ITEMS.forEach(item => addItem(reset.id, item));
  useTemplateStore.getState().setTemplateContainer(reset.id, 'stack');
  useTemplateStore.getState().setSchedule(reset.id, {
    frequency: 'weekly',
    weekday: 0,
    monthDay: 1,
    month: 1,
    time: '09:00',
    anchorSpanDays: null,
  });
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

/** The recipe ids the plan and the fridge below need to point at. */
interface DemoRecipes {
  mash: string;
  roasties: string;
  salad: string;
  oats: string;
  sandwich: string;
  stirFry: string;
  salmon: string;
  steak: string;
  cake: string;
  tea: string;
  snacks: string;
}

/**
 * addRecipe refuses a name the box already holds. Every name below is distinct
 * and the demo database is wiped before seeding, so the fallback is
 * unreachable — it's there so a duplicate introduced later degrades to a
 * shared recipe rather than throwing out of enterDemoMode.
 */
function newRecipe(name: string): Recipe {
  const created = useRecipeStore.getState().addRecipe(name);
  if (created) return created;
  const key = groceryNameKey(name);
  return useRecipeStore.getState().recipes.find(r => r.nameKey === key)!;
}

/** An ingredient row's id, by the name it was parsed down to. Null if the line didn't take. */
function ingredientIdNamed(recipeId: string, name: string): string | null {
  const key = groceryNameKey(name);
  return (
    useRecipeStore.getState().recipeById(recipeId)?.ingredients.find(i => i.nameKey === key)?.id ??
    null
  );
}

/** A component *link's* id (not the recipe it points at) — what recipeChoices names. */
function componentIdFor(parentId: string, childRecipeId: string): string | null {
  return (
    useRecipeStore.getState().recipeById(parentId)?.components.find(c => c.recipeId === childRecipeId)
      ?.id ?? null
  );
}

/**
 * The recipe box. Deliberately covers every RecipeMealType, since the box
 * groups by it and a missing type reads as a missing section, and one instance
 * of each of the features that are otherwise invisible: components (shared and
 * either/or), ingredient alternatives, sections, prep tasks, both duration
 * fields, a live cook timer, cook history, and all three attribution shapes.
 */
function seedRecipes(): DemoRecipes {
  const {
    addIngredientsFromText,
    updateIngredient,
    addEmptySection,
    addComponent,
    addPrepTask,
    updatePrepTask,
    setMealType,
    setVote,
    setTags,
    setNotes,
    setServings,
    setRecipeYield,
    setSourceUrl,
    setAuthor,
    setSource,
    setSourceType,
    setSourcePage,
    setEstimatedMinutes,
    setPrepMinutes,
    setLeftoverKeepDays,
    toggleFavorite,
    markCooked,
    startCookTimer,
    addStep,
  } = useRecipeStore.getState();

  // --- Sides, first: the two dinners below reference them as components ----
  const mash = newRecipe('Mashed potatoes');
  addIngredientsFromText(
    mash.id,
    ['2 lb potatoes, peeled and quartered', '4 tbsp butter', '1/2 cup milk', '1 tsp salt'].join('\n')
  );
  setMealType(mash.id, 'side');
  setServings(mash.id, 4);
  setEstimatedMinutes(mash.id, 25);
  setPrepMinutes(mash.id, 10);
  // Keeps longer than the standard three days, so the tub of mash in the fridge
  // below is on the window its own recipe asked for. The salmon takes the other
  // end of the dial — a dish can say either.
  setLeftoverKeepDays(mash.id, 5);
  // The per-line exception to a standing swap (#1571). Milk → oat milk is
  // marked "always use this instead" further down, so every seeded recipe
  // calling for milk reads and shops as oat milk — except this one line, which
  // is exactly what RecipeIngredient.noSwap is for. Seeded because the escape
  // hatch is otherwise a toggle nobody ever sees: with it, the same rule
  // visibly reaches Overnight oats and visibly doesn't reach the mash.
  const mashMilk = ingredientIdNamed(mash.id, 'milk');
  if (mashMilk) updateIngredient(mash.id, mashMilk, { noSwap: true });
  // A component with a written method, so cook mode on the steak below reads
  // the meal's own steps and then these under a "Mashed potatoes" heading —
  // which is the only way the attribution half of that screen is visible at all.
  [
    'Cover the potatoes with cold salted water and bring to a boil.',
    'Simmer for 20 minutes, until a knife slides in with no resistance.',
    'Drain well, then mash with the butter and milk and season.',
  ].forEach(text => addStep(mash.id, text));

  const roasties = newRecipe('Roast potatoes');
  addIngredientsFromText(
    roasties.id,
    ['2 lb potatoes, peeled and halved', '3 tbsp olive oil', '1 bunch rosemary', '1 tsp salt'].join('\n')
  );
  setMealType(roasties.id, 'side');
  setServings(roasties.id, 4);
  setEstimatedMinutes(roasties.id, 45);

  const salad = newRecipe('Simple green salad');
  addIngredientsFromText(
    salad.id,
    ['1 head lettuce', '1 shallot, thinly sliced', '1 lemon for the dressing', '3 tbsp olive oil'].join('\n')
  );
  setMealType(salad.id, 'side');
  setServings(salad.id, 4);
  setEstimatedMinutes(salad.id, 10);
  // A real "vegetarian" tag alongside the flavour/occasion ones above, so the
  // excluded-tags picker (#1693) has something a household would actually
  // exclude on, not just cooking-style labels.
  setTags(salad.id, ['vegetarian']);

  const salsaVerde = newRecipe('Salsa verde');
  addIngredientsFromText(
    salsaVerde.id,
    ['6 tomatillos, husked', '1 jalapeno', '1/2 white onion', '1 bunch cilantro', '1 clove garlic'].join('\n')
  );
  setMealType(salsaVerde.id, 'condiment');
  setRecipeYield(salsaVerde.id, '2 cups');
  setEstimatedMinutes(salsaVerde.id, 15);

  // --- Breakfast, lunch, snack, dessert, beverage --------------------------
  const oats = newRecipe('Overnight oats');
  addIngredientsFromText(
    oats.id,
    ['1 cup rolled oats', '1 cup milk', '1 tbsp honey', '1/2 cup blueberries'].join('\n')
  );
  setMealType(oats.id, 'breakfast');
  setTags(oats.id, ['make ahead']);
  setNotes(oats.id, 'Assembles in about five minutes the night before. Keeps three days in a jar.');
  setServings(oats.id, 2);
  setPrepMinutes(oats.id, 10);
  toggleFavorite(oats.id);

  const sandwich = newRecipe('Turkey and avocado sandwich');
  addIngredientsFromText(
    sandwich.id,
    ['2 slices sourdough', '4 slices sliced turkey', '1 avocado', '1 tbsp mayonnaise', '1 cup spinach'].join('\n')
  );
  setMealType(sandwich.id, 'lunch');
  setTags(sandwich.id, ['quick', 'no cook']);
  setServings(sandwich.id, 1);
  setEstimatedMinutes(sandwich.id, 10);

  const snacks = newRecipe('Hummus snack plate');
  addIngredientsFromText(
    snacks.id,
    ['1 cup hummus', '1 cucumber, sliced', '2 carrots, cut into sticks', '1 pita bread'].join('\n')
  );
  setMealType(snacks.id, 'snack');
  setTags(snacks.id, ['no cook', 'vegetarian']);
  setServings(snacks.id, 2);

  const cake = newRecipe('Carrot cake with cream cheese frosting');
  addIngredientsFromText(
    cake.id,
    // The one recipe written in metric, and it's the one copied out of a
    // British cookbook — which is also how a real library ends up mixed. It's
    // what the Units setting has to convert *from* when it's set to US; every
    // other recipe here covers the other direction.
    [
      '250 g flour',
      '3 carrots, grated',
      '200 g brown sugar',
      '3 eggs',
      '1 tsp cinnamon',
      '225 g cream cheese',
      '115 g butter',
      '400 g sugar',
    ].join('\n')
  );
  setMealType(cake.id, 'dessert');
  setTags(cake.id, ['baking', 'make ahead']);
  // Sections — a label on the flat ingredient list, not a nested type.
  ([
    ['flour', 'For the cake'],
    ['carrots', 'For the cake'],
    ['brown sugar', 'For the cake'],
    ['eggs', 'For the cake'],
    ['cinnamon', 'For the cake'],
    ['cream cheese', 'For the frosting'],
    ['butter', 'For the frosting'],
    ['sugar', 'For the frosting'],
  ] as const).forEach(([name, section]) => {
    const id = ingredientIdNamed(cake.id, name);
    if (id) updateIngredient(cake.id, id, { section });
  });
  // Nobody's decided on a garnish yet — a heading declared ahead of anything
  // filed under it (Recipe.emptySections), so it shows up on the recipe with
  // nothing under it until something is.
  addEmptySection(cake.id, 'For serving');
  setRecipeYield(cake.id, '1 9-inch cake');
  setServings(cake.id, 12);
  setEstimatedMinutes(cake.id, 45);
  setPrepMinutes(cake.id, 30);
  // The cookbook attribution shape — the only one a page number means anything for.
  setAuthor(cake.id, 'Yotam Ottolenghi');
  setSource(cake.id, 'Sweet');
  setSourceType(cake.id, 'cookbook');
  setSourcePage(cake.id, '148');

  const tea = newRecipe('Iced mint tea');
  addIngredientsFromText(tea.id, ['4 tea bags', '1 bunch mint', '2 lemons', '1/4 cup honey'].join('\n'));
  setMealType(tea.id, 'beverage');
  setRecipeYield(tea.id, '2 quarts');
  setEstimatedMinutes(tea.id, 10);

  // --- Dinners -------------------------------------------------------------
  const stirFry = newRecipe('Weeknight chicken stir-fry');
  addIngredientsFromText(
    stirFry.id,
    [
      '2 chicken breasts',
      '1 red bell pepper',
      '2 tbsp soy sauce',
      '2 cloves garlic, peeled and sliced',
      '2 cups rice',
      '1 serrano chile',
      '1 jalapeno',
    ].join('\n')
  );
  setMealType(stirFry.id, 'dinner');
  // Two recipes share "weeknight" so the box's tag filter has something to
  // actually narrow, and one carries a second tag so combining two chips has a
  // visible effect.
  setTags(stirFry.id, ['weeknight', 'quick']);
  // Either/or ingredients — two rows sharing a group, never one line reading
  // "serrano or jalapeño" (see RecipeIngredient.choiceGroup).
  ['serrano chile', 'jalapeno'].forEach(name => {
    const id = ingredientIdNamed(stirFry.id, name);
    if (id) updateIngredient(stirFry.id, id, { choiceGroup: 'Chile' });
  });
  setServings(stirFry.id, 4, 6);
  setEstimatedMinutes(stirFry.id, 20);
  setPrepMinutes(stirFry.id, 15);
  setSourceType(stirFry.id, 'homeRecipe');
  const marinate = addPrepTask(stirFry.id, 'Slice the chicken and marinate');
  if (marinate) updatePrepTask(stirFry.id, marinate.id, { offsetDays: 0, reminderOffsetMinutes: 60 });
  // A written-out method (Recipe.steps), on the one recipe that's mid-cook
  // below — so cook mode opens here with the timer already running, which is
  // the state the whole screen was built for.
  [
    'Slice the chicken thin and toss it with the soy sauce.',
    'Get the pan as hot as it goes, then sear the chicken in one layer.',
    'Add the pepper, garlic and chile and stir-fry for two minutes.',
    'Serve over the rice.',
  ].forEach(text => addStep(stirFry.id, text));
  // Cooked often enough to have a history worth reading.
  [0, 1, 2, 3, 4].forEach(() => markCooked(stirFry.id));
  // Tonight's dinner, mid-cook — the one place a live timer shows up.
  startCookTimer(stirFry.id);

  const salmon = newRecipe('Lemon garlic salmon');
  addIngredientsFromText(
    salmon.id,
    ['2 salmon fillets', '1 lemon', '2 cloves garlic', '2 tbsp butter', '1 bunch asparagus'].join('\n')
  );
  setMealType(salmon.id, 'dinner');
  setTags(salmon.id, ['weeknight']);
  setServings(salmon.id, 2);
  setEstimatedMinutes(salmon.id, 25);
  // Fish, so the log sheet opens on one day rather than three.
  setLeftoverKeepDays(salmon.id, 1);
  // The website attribution shape: a person and a publication, independently.
  // It's also what a link import leaves behind — url, site, author, and the
  // method taken verbatim off the page's own markup — so this is the recipe
  // that shows what "From a link" actually produces, which is otherwise a
  // capability with nothing in the box to point at.
  setSourceUrl(salmon.id, 'https://www.example-recipes.com/lemon-garlic-salmon');
  setAuthor(salmon.id, 'Alison Roman');
  setSource(salmon.id, 'NYT Cooking');
  setSourceType(salmon.id, 'website');
  [
    'Heat the oven to 425°F and pat the fillets dry.',
    'Toss the asparagus with olive oil and spread it on a sheet pan.',
    'Sit the salmon on top, dot with butter and the sliced garlic, and squeeze over half the lemon.',
    'Roast for 12 minutes, until the salmon flakes. Serve with the rest of the lemon.',
  ].forEach(text => addStep(salmon.id, text));
  const defrost = addPrepTask(salmon.id, 'Move the salmon to the fridge to defrost');
  if (defrost) updatePrepTask(salmon.id, defrost.id, { offsetDays: -1, reminderOffsetMinutes: 120 });
  [0, 1].forEach(() => markCooked(salmon.id));
  // Cooked it twice and decided against a third — the down side of the vote,
  // set the same way the post-cook sheet's "How was it?" section sets it. The
  // stir-fry below is deliberately left unrated, so cooking tonight's dinner in
  // the demo is what shows that section being asked.
  setVote(salmon.id, 'down');
  // The shared component — the same mash inside two different dinners, which
  // is the whole point of a reference rather than a copy.
  addComponent(salmon.id, mash.id);

  const steak = newRecipe('Seared steak with potatoes');
  addIngredientsFromText(
    steak.id,
    ['2 lb steak', '2 tbsp butter', '1 bunch thyme', '1 tsp salt'].join('\n')
  );
  setMealType(steak.id, 'dinner');
  setTags(steak.id, ['weekend']);
  setServings(steak.id, 2);
  setEstimatedMinutes(steak.id, 20);
  // Deliberately left as a notes blob rather than given steps: cook mode's
  // fallback (a recipe whose method predates Recipe.steps) is otherwise
  // invisible, and this is the recipe that shows both halves at once — its own
  // lines split out of notes, then the mash's real steps after them.
  setNotes(
    steak.id,
    [
      'Get a cast iron pan screaming hot and salt the steak on both sides.',
      'Sear three minutes a side, then add the butter and thyme and baste.',
      'Rest it as long as it cooked before slicing against the grain.',
    ].join('\n')
  );
  // Either/or components: one of the two potatoes gets cooked, never both.
  // The default is the group's first link in list order, so mash is the usual.
  addComponent(steak.id, mash.id, 'Potatoes');
  addComponent(steak.id, roasties.id, 'Potatoes');
  // ...and one unconditional component alongside them.
  addComponent(steak.id, salad.id);
  const rest = addPrepTask(steak.id, 'Take the steak out of the fridge');
  if (rest) updatePrepTask(steak.id, rest.id, { offsetDays: 0, reminderOffsetMinutes: 45 });
  markCooked(steak.id);
  toggleFavorite(steak.id);
  setVote(steak.id, 'up');

  // A recipe page saved from another app's share sheet, still waiting to be
  // imported — the banner at the top of Recipes. Seeded because the share
  // extension is invisible until something has used it: with an empty queue the
  // Recipes screen looks exactly like a build that can't be shared to at all,
  // which is the case demo mode exists to avoid. One is enough to show both the
  // row and the "+N" it grows.
  useSharedLinkStore.getState().enqueue([
    'https://cooking.nytimes.com/recipes/1022674-sheet-pan-chicken-with-shallots',
  ]);

  return {
    mash: mash.id,
    roasties: roasties.id,
    salad: salad.id,
    oats: oats.id,
    sandwich: sandwich.id,
    stirFry: stirFry.id,
    salmon: salmon.id,
    steak: steak.id,
    cake: cake.id,
    tea: tea.id,
    snacks: snacks.id,
  };
}

// ---------------------------------------------------------------------------
// Groceries
// ---------------------------------------------------------------------------

/** Same unreachable-fallback shape as newRecipe, for the shops. */
function newShop(name: string): Shop {
  const created = useGroceryStore.getState().addShop(name);
  if (created) return created;
  const key = groceryNameKey(name);
  return useGroceryStore.getState().shops.find(s => s.nameKey === key)!;
}

function itemNamed(name: string): GroceryItem {
  const key = groceryNameKey(name);
  return useGroceryStore.getState().items.find(i => i.nameKey === key)!;
}

function idsNamed(names: readonly string[]): string[] {
  return names.map(n => itemNamed(n).id);
}

/**
 * The catalog, three trips' worth of purchase history, a walk order the user
 * has clearly edited, and a list that's mid-trip.
 *
 * Most names are ones the offline lexicon (groceryAisles.ts) already places, so
 * the sections fill themselves; the hand-filed ones exist precisely to show
 * that a filing by hand outranks the lexicon and is remembered.
 */
function seedGroceries(recipes: DemoRecipes, today: Date): void {
  const { addTask } = useTaskStore.getState();
  const { addCategory, setCategoryEmoji } = useCategoryStore.getState();
  const {
    addByName,
    addExistingMany,
    addFromPlan,
    setCheckedMany,
    clearList,
    setQuantity,
    setNote,
    addProduct,
    updateProduct,
    setPreferredProduct,
    setProductFrozen,
    setProductOnHandUntil,
    linkScannedGtins,
    setProductStrict,
    setProductUnavailable,
    setAisle,
    setAisleOrder,
    setOnHandUntil,
    addToPantry,
    setStaple,
    setFrozen,
    setOpened,
    setRunningLow,
    recordDisposal,
    dismissDisposalOffer,
    setExpiresAt,
    setShelfLifeDays,
    setUseUpTask,
    finishShopping,
    addAisle,
    deleteAisle,
    linkItemShop,
    linkItemShopMany,
    markItemsUnavailable,
    ensureCatalogItem,
    linkItemSub,
    setShopExcludedFromSuggestions,
    startTrip,
    itemById,
  } = useGroceryStore.getState();

  const CATALOG = [
    // Dairy & Eggs
    'Milk', 'Eggs', 'Greek yogurt', 'Butter', 'Cheddar', 'Cottage cheese',
    // Produce
    'Spinach', 'Bananas', 'Tomatoes', 'Onions', 'Garlic', 'Lemons', 'Potatoes',
    // Meat & Seafood
    'Chicken breast', 'Ground beef',
    // Pantry / Canned
    'Pasta', 'Rice', 'Olive oil', 'Peanut butter', 'Black beans', 'Salt', 'Black pepper',
    // Bakery
    'Bread', 'Tortillas',
    // Beverages / Breakfast
    'Coffee', 'Sparkling water', 'Rolled oats',
    // Frozen / Snacks
    'Frozen peas', 'Ice cream', 'Almonds', 'Chips',
    // Household
    'Paper towels', 'Toilet paper', 'Dish soap',
  ];
  CATALOG.forEach(name => addByName(name, undefined, undefined, { registerUndo: false }));

  // Quantities and notes — free text. The only thing that reads a quantity as a
  // number is the per-unit price comparison, and only when every price in a set
  // names one it can measure: "a bunch" below is the demo's example of the
  // refusal, "5 lb" of Rice further down the example of the comparison.
  setQuantity(itemNamed('Milk').id, '2 gal');
  setQuantity(itemNamed('Ground beef').id, '2 lb');
  setQuantity(itemNamed('Bananas').id, 'a bunch');
  setQuantity(itemNamed('Rice').id, '5 lb');
  // Priced in the same unit family the mashed potatoes recipe measures it in
  // (mass), which is what makes it — alongside the milk above — the demo's
  // example of a recipe cost actually clearing recipeCost.ts's coverage floor
  // (see estimateRecipeCost in useDemoStore.test.ts).
  setQuantity(itemNamed('Potatoes').id, '5 lb');
  // Lemon garlic salmon calls for a lemon, and without a fact of its own here
  // Lemons is a bare CATALOG name — nothing else in the seed ever touches it —
  // so clearList below sweeps it and the recipe's own "lemon" line reads as an
  // ingredient nobody has ever catalogued. A quantity is the same minimal fact
  // Bananas and Rice get for the same reason.
  setQuantity(itemNamed('Lemons').id, '4');
  setNote(itemNamed('Black beans').id, 'The low-sodium ones');
  setNote(itemNamed('Bread').id, 'Seeded, from the back shelf');
  // A product is a clause beside the name, so this row is still plain "cottage
  // cheese" to a recipe that calls for it and to its own purchase history —
  // the caption only says which one to pick up. Seeded on a row that also
  // carries no note, so the list shows the product caption on its own rather
  // than stacked under one.
  //
  // Brand *and* variant, which is the pairing worth showing: a brand alone
  // doesn't finish the job, since one dairy makes several tubs. The two
  // compose into the single caption "Good Culture low fat". One product, so
  // this is also the demo's example of the ordinary case — an item where you
  // know which one you want and have never bothered to record an alternative.
  addProduct(itemNamed('Cottage cheese').id, { brand: 'Good Culture', variant: 'low fat' });
  // A second box on the same row, and the only reason it's here: the shelf
  // caption for a store that hasn't got your one can only offer an
  // alternative if the item has one on record. Trader Joe's is where the
  // seeded trip runs and is marked as not having the Good Culture below, so
  // this is what makes "No Good Culture low fat here · try Nancy's" appear in
  // the demo rather than the bare refusal.
  //
  // Unrated on purpose: an `avoid` box is never offered (see
  // alternativeProductAt), so rating this one would seed the feature and hide
  // it in the same stroke.
  addProduct(itemNamed('Cottage cheese').id, { brand: "Nancy's", variant: 'whole milk' });

  // Bread is the demo's example of the other shape: an item you've tried
  // several of and have opinions about. Three boxes, one preferred and one
  // marked never again, which is the whole reason products are rows rather
  // than a pair of strings — a single brand field could hold only the first of
  // these, and trying the second would have erased it.
  const bread = itemNamed('Bread').id;
  const arnolds = addProduct(bread, { brand: "Arnold's", variant: 'whole wheat' });
  const daves = addProduct(bread, { brand: "Dave's Killer", variant: '21 whole grains' });
  // A rating is never inferred from a purchase, so the seed has to say it —
  // and it's said on a box that isn't the preferred one, since "the one I
  // avoid" and "the one I want" being the same row would read as a bug.
  if (daves) updateProduct(daves.id, { rating: 'avoid', note: 'Too sweet' });
  // The brandless case, in the one place it's ordinary: a store's own label
  // has a variant worth naming and no maker worth naming.
  const sourdough = addProduct(bread, { brand: null, variant: 'seeded sourdough' });
  // Already the preference by virtue of being added first — set explicitly so
  // the seed says what it means rather than depending on insertion order.
  if (arnolds) setPreferredProduct(bread, arnolds.id);

  // A box with the barcode that names it, which is invisible until something
  // uses it: the demo has no camera, so without a seeded link "scanning this
  // again lands on the row you filed it under" reads as a feature the app
  // hasn't got. Put on the box the demo already tells the longest story about,
  // and deliberately on one whose row name ("Bread") shares nothing with what
  // a barcode database would call it — which is the case the link exists for,
  // and the one name matching cannot do.
  //
  // A real GTIN-14 for Dave's Killer Bread 21 Whole Grains, check digit and
  // all, so it round-trips through normalizeGtin exactly as a scan would.
  if (daves) {
    linkScannedGtins([
      { gtin: '00013764000315', itemId: bread, brand: "Dave's Killer", variant: '21 whole grains' },
    ]);
  }

  const traderJoes = newShop("Trader Joe's");
  const costco = newShop('Costco');
  // "It has everything, but don't send me there" — kept fully available for
  // linking by hand while being pulled out of every suggestion.
  const amazon = newShop('Amazon');
  setShopExcludedFromSuggestions(amazon.id, true);

  // Three finished trips, so the catalog and the autocomplete ranking have a
  // real spread of purchase counts to sort by rather than a flat list of ones.
  // Finishing a trip promotes what was on it into the catalog, records the
  // purchase against the store, and takes it off the list.
  const WEEKLY_SHOP = ['Milk', 'Eggs', 'Spinach', 'Bananas', 'Bread', 'Chicken breast', 'Tomatoes', 'Coffee'];
  const BULK_RUN = ['Paper towels', 'Toilet paper', 'Olive oil', 'Rice', 'Frozen peas', 'Potatoes'];

  // Prices, in minor units, keyed by the name the seed already uses. Recorded
  // through a finished trip rather than written onto rows, like everything else
  // here — which is also the only way they *can* be recorded, since a price is
  // paired with the quantity the trip bought (see GroceryItem.lastPriceQuantity).
  const priced = (byName: Record<string, number>): Record<string, number> =>
    Object.fromEntries(Object.entries(byName).map(([name, minor]) => [itemNamed(name).id, minor]));

  setCheckedMany(idsNamed(WEEKLY_SHOP), true);
  finishShopping(traderJoes.id);

  addExistingMany(idsNamed(BULK_RUN));
  setCheckedMany(idsNamed(BULK_RUN), true);
  finishShopping(costco.id, priced({ 'Olive oil': 1299, 'Paper towels': 1849, Rice: 799, Potatoes: 599 }));

  addExistingMany(idsNamed(WEEKLY_SHOP));
  setCheckedMany(idsNamed(WEEKLY_SHOP), true);
  finishShopping(
    traderJoes.id,
    priced({ Milk: 429, Eggs: 599, Spinach: 349, Bread: 449, Coffee: 1099 })
  );

  // The same item bought at a second store for more — the whole point of
  // keeping a price per (item, store), and the only shape "cheapest at Costco"
  // can be said about. One item rather than several: a comparison needs two
  // prices, not a priced catalog.
  addExistingMany(idsNamed(['Olive oil']));
  setCheckedMany(idsNamed(['Olive oil']), true);
  finishShopping(traderJoes.id, priced({ 'Olive oil': 1599 }));

  // …and the same again for an item bought in *different sizes*, which is the
  // only shape a per-unit comparison can be shown in: 5 lb of rice for $7.99 at
  // Costco against 1 lb for $2.49 here. The bigger number is the better deal,
  // which is exactly the reading the rate exists to correct. The quantity has
  // to be set before the trip that prices it, since a price is paired with what
  // the trip bought.
  setQuantity(itemNamed('Rice').id, '1 lb');
  addExistingMany(idsNamed(['Rice']));
  setCheckedMany(idsNamed(['Rice']), true);
  finishShopping(traderJoes.id, priced({ Rice: 249 }));

  // A trip with no store named — a first-class answer, and the reason an
  // item's own purchaseCount runs ahead of the sum of its per-store links. Its
  // prices land on the items and on no link at all, which is that same split
  // one field over.
  const CORNER_SHOP = ['Greek yogurt', 'Butter'];
  addExistingMany(idsNamed(CORNER_SHOP));
  setCheckedMany(idsNamed(CORNER_SHOP), true);
  finishShopping(null, priced({ 'Greek yogurt': 549, Butter: 479 }));

  // Salt and pepper get a trip too, so they read like everything else here:
  // a staple with no purchase behind it is a legal row but a strange one to
  // hand someone as demo data.
  const STAPLES = ['Salt', 'Black pepper'];
  addExistingMany(idsNamed(STAPLES));
  setCheckedMany(idsNamed(STAPLES), true);
  finishShopping(null);

  // An item whose pantry guess has quietly run out — the state
  // utils/pantryCheckTasks.ts exists for, and the one thing about the kitchen
  // nobody can watch happen: no row changes and nothing is written, the item
  // simply stops being read as on hand. Three trips, because the check is
  // gated on MIN_PURCHASES_FOR_CADENCE — a row bought once or twice has a
  // window the app has already admitted it made up.
  //
  // All three are back-dated through finishShopping's own `purchasedAt`
  // argument rather than a raw row write, like everything else here. A trip
  // finished this second is the one shape that can never lapse, so without the
  // back-date this is the feature the demo couldn't show at all. Twenty days
  // for the last one, against the flat fortnight a demo row falls back to (its
  // createdAt is seconds old, so there is no cadence to divide out) — which
  // leaves it six days lapsed and comfortably inside PANTRY_CHECK_GRACE_DAYS.
  //
  // Rolled oats because the shelf-life lexicon doesn't recognise it: a use-by
  // date on the same row would spawn a "Use up" task beside the check, and one
  // item carrying two of the app's own tasks demonstrates them fighting rather
  // than either of them working.
  [70, 45, 20].forEach(daysBack => {
    addExistingMany(idsNamed(['Rolled oats']));
    setCheckedMany(idsNamed(['Rolled oats']), true);
    finishShopping(traderJoes.id, {}, subDays(new Date(), daysBack).toISOString());
  });

  // Two names for one thing (#1570) — nameKey doesn't stem or synonymise, so
  // "cilantro" and "coriander" sit as two catalog rows until someone merges
  // them. Left unmerged on purpose, as the demo's one example of what "Merge
  // with another item" on the item sheet is for. Cilantro gets a real trip
  // so it has a purchase behind it; Coriander is added fresh after the clear
  // below, on the list and unbought — the shape an imported recipe's own
  // wording would add, and exactly the case the issue that added merging
  // describes: neither name alone ever earns the pantry guess.
  addByName('Cilantro');
  setCheckedMany(idsNamed(['Cilantro']), true);
  finishShopping(traderJoes.id);

  // "I can get this here" with no trip behind it — an assertion, not an
  // observation. Almonds are linked to Costco alone, so they read as available
  // at exactly one store. A store link is a user fact, so it keeps its row
  // through the clear below (see hasUserFacts) — which is why this runs first:
  // afterwards these never-bought names wouldn't be here to link.
  linkItemShop(itemNamed('Almonds').id, costco.id);
  linkItemShopMany(idsNamed(['Peanut butter', 'Ground beef']), costco.id);
  linkItemShopMany(idsNamed(['Dish soap', 'Toilet paper']), amazon.id);

  // And the opposite claim, which is the only thing that can tell "never
  // bought here" from "they don't stock it". Tortillas are marked absent at
  // Trader Joe's — a store with plenty else on record, so the trip planner has
  // to route round one item rather than write the shop off — and Almonds at
  // Trader Joe's too, where Costco is the answer. Same promotion as above.
  markItemsUnavailable(idsNamed(['Tortillas', 'Almonds']), traderJoes.id);

  // ...and the store that closes that gap, which is what makes
  // ShoppingTripSheet's second-stop suggestion exist at all. With Peanut
  // butter and Cottage cheese below, Costco ends up carrying three things
  // Trader Joe's can't, so opening the sheet offers it by name rather than
  // showing the one-store case with nothing else to say.
  linkItemShop(itemNamed('Tortillas').id, costco.id);

  // The third claim a store can carry: it stocks the thing, just not the one
  // you want. Cottage cheese already names a product above; switching the rule
  // on is what makes that product filter store coverage rather than merely
  // caption the row.
  //
  // Trader Joe's is the store the seeded trip below runs at, so this is also
  // the only way the shelf caption for it ("No Good Culture here") appears in
  // the demo at all — the same reason the trip is at Trader Joe's and the other
  // two stores supply the `only`/`usually` markers.
  //
  // Costco is deliberately left unmarked rather than confirmed: an unmarked
  // store counts, and the seed has to show that reading as "still counts" or
  // the rule looks like it needs a verdict on every shop before it works.
  setProductStrict(itemNamed('Cottage cheese').id, true);
  setProductUnavailable(itemNamed('Cottage cheese').id, traderJoes.id, true);
  // Costco is linked but deliberately *not* ruled out, which is the half that
  // shows the rule is narrow: only what you've marked drops out, so a store you
  // haven't checked still counts as somewhere you can get this.
  linkItemShop(itemNamed('Cottage cheese').id, costco.id);

  // Substitutes, both shapes. Nothing infers one of these, so a demo with none
  // reads as an app that hasn't got the feature — and they're invisible until
  // something is linked, since a substitute is never captioned speculatively.
  //
  // Butter → margarine is the asymmetric case *and* the reason the note field
  // exists: the swap is right in a pan and wrong in laminated pastry, and
  // that's a caveat rather than a per-recipe scope. Milk ↔ oat milk is the
  // symmetric one, which is two rows and not a flag.
  //
  // Both stand-ins are minted off-list rather than added to the CATALOG list
  // above: naming a substitute is not a plan to buy it, and the clear below
  // only ever touches rows that are on the list.
  const margarine = ensureCatalogItem('Margarine');
  const oatMilk = ensureCatalogItem('Oat milk');
  if (margarine) {
    linkItemSub(itemNamed('Butter').id, margarine.id, {
      note: 'Fine for frying, not for baking',
    });
    // ...and the state that makes the link *say* something. The caption on an
    // add-to-list row needs both halves known — the original wanted, the
    // substitute on hand — and the seeded trips leave Butter bought, so
    // without these two lines four recipes call for butter and nothing ever
    // reads "you have margarine". Marked out of it rather than left to the
    // cadence guess, which needs a row older than its purchases and so can't
    // be seeded at all (same reason the pantry's own seed is all assertions).
    setOnHandUntil(itemNamed('Butter').id, OUT_OF_IT_UNTIL);
    setOnHandUntil(margarine.id, defaultOnHandUntil(margarine, new Date()));
  }
  if (oatMilk) {
    // ...and the standing swap (#1571), on the issue's own example. This is
    // the one substitute setting that changes what lands in the trolley, so a
    // demo without one shows only half the feature: with it, Overnight oats
    // reads "Oat milk · instead of milk" on the recipe and adds oat milk to
    // the list, while Mashed potatoes' own milk line (marked "keep as
    // written" above) is left alone. Standing rides on the forward row only —
    // the both-ways reverse row is never standing, or the pair would swap
    // into itself.
    linkItemSub(itemNamed('Milk').id, oatMilk.id, { bothWays: true, standing: true });
  }

  // A ratio (#1573) — the issue's own motivating example, and a natural fit:
  // several seeded recipes already call for garlic in cloves ("2 cloves
  // garlic"), so this is a link whose ratio a demo user can actually see work
  // by adding one of those recipes to the list.
  const garlicPowder = ensureCatalogItem('Garlic powder');
  if (garlicPowder) {
    linkItemSub(itemNamed('Garlic').id, garlicPowder.id, {
      ratioFrom: '1 clove',
      ratioTo: '1/4 tsp',
    });
  }

  // The shelf caption (#1567): Tortillas is already marked unavailable at
  // Trader Joe's and already on the list, so a substitute here is the one
  // link that makes "Not here · or Corn tortillas" — and its
  // tap-to-swap — visible in the demo at all, rather than just the plain
  // "Not at Trader Joe's" every other unavailable row still shows.
  const cornTortillas = ensureCatalogItem('Corn tortillas');
  if (cornTortillas) {
    linkItemSub(itemNamed('Tortillas').id, cornTortillas.id);
  }

  // Everything else typed above is still sitting on the list, since only what
  // a trip actually bought — or a link/unavailable claim above — came off it
  // or promoted it. Clearing parks what's already catalog and drops the rest,
  // same as removing an untouched name from the list by hand, so what's on
  // the list below is the list someone chose rather than the leavings of the
  // seed order.
  clearList();

  // The pantry override, both directions. "Got it" parks an item as on hand
  // for a while; "Out of it" is the user overruling the purchase-history guess
  // with their own hands.
  const rice = itemById(itemNamed('Rice').id);
  if (rice) setOnHandUntil(rice.id, defaultOnHandUntil(rice, new Date()));
  setOnHandUntil(itemNamed('Olive oil').id, OUT_OF_IT_UNTIL);

  // And the pantry's own way in: a thing you have that the app has never seen
  // you buy. It's the one row shape nothing else here produces — off the list,
  // in the catalog, no purchases behind it — and it's the whole reason the
  // pantry has an add field, since an item with no row has no sheet to open.
  addToPantry('Baking soda');

  // The staples — always on hand, so they sort into their own group rather
  // than "Need to buy" when a recipe's ingredients get added to the list.
  setStaple(itemNamed('Salt').id, true);
  setStaple(itemNamed('Black pepper').id, true);

  // ...and the check the app writes about the row whose guess ran out above.
  // Seeded rather than left to `checkPantryCheckTasks`, for the reason the
  // quiet project's own review task is: that pass reads the *real* install's
  // settings, and this generator ships off, so a demo relying on it would show
  // the feature only to people who had already found it.
  //
  // The category is named here for the same reason the meal-plan and leftover
  // ones are (see seedMealPlanAndFridge) — the demo swaps the database, not
  // the preferences, so anything left to ensureGeneratedTaskCategory would
  // look different depending on the person's own settings. It's shared with
  // the grocery use-up task below, which is the pairing the registry's
  // defaultCategory already describes: both are questions about the same
  // cupboard.
  addCategory('Groceries');
  setCategoryEmoji('Groceries', '🛒');
  useSettingsStore.getState().setPantryCheckTaskCategory('Groceries');
  useSettingsStore.getState().setGroceryUseUpTaskCategory('Groceries');
  addTask({
    title: pantryCheckTitle(itemNamed('Rolled oats')),
    dueDate: today.toISOString(),
    linkUrl: pantryCheckLinkUrl(itemNamed('Rolled oats').id),
    category: 'Groceries',
    ...generatedBy('pantryCheck', itemNamed('Rolled oats').id),
  });

  // --- A supply stocked from the shopping list -----------------------------
  // The linked half of the supply bridge (see docs/arch/supplies.md), and the
  // half that can't be seen without a row of its own: an unlinked supply writes
  // an "Order more X" task, where a linked one puts the item on the *list* and
  // writes no task at all. With only the unlinked case seeded, the entire
  // grocery side of the feature reads as something the app doesn't do.
  //
  // Dishwasher tablets rather than a filter, because the linking is only ever
  // the right answer for a thing you buy where you buy food — that's the whole
  // rule deciding which of the two answers a supply gets.
  addToPantry('Dishwasher tablets');
  addTask({
    title: 'Run the dishwasher',
    notes: 'A supply stocked from the shopping list: one tablet a run, and the tablets go on the list when they get low.',
    category: 'Home',
    dueDate: today.toISOString(),
    recurrenceType: 'daily',
    recurrenceInterval: 2,
    supplyCount: 4,
    supplyUnit: 'tablets',
    supplyRefillCount: 40,
    supplyReorderAt: 5,
    supplyGroceryItemId: itemNamed('Dishwasher tablets').id,
  });
  // Already low, so the row sits on the list saying what it's for. Written out
  // rather than left to the sweep for the reason the pantry check above is:
  // that pass runs on Today's focus, and a demo that only comes right after
  // the second screen visit is a demo of nothing.
  setRunningLow(itemNamed('Dishwasher tablets').id, true, { registerUndo: false });

  // The use-by half. The three finished trips above already stamped a date on
  // everything the shelf-life lexicon recognises, so most of that is here for
  // free — this is the pair the seed has to say out loud: a date corrected by
  // hand (the bag was already a few days old), and the per-item opt-in that
  // turns one item's date into a real task with the setting still off. Without
  // it the demo has use-by dates nothing ever acts on, which reads as the
  // reminders not existing.
  setExpiresAt(itemNamed('Spinach').id, dayKeyOf(addDays(new Date(), 1)));
  setUseUpTask(itemNamed('Spinach').id, true);

  // ...and the other half of that same pair (#1689): two perishables on their
  // last day with the setting still off, so neither gets a task and both say so
  // on Today as kitchen context rows instead. That is exactly the gap the rows
  // exist for — with `groceryUseUpTasks` off by default, a use-by date the
  // catalog knows about had no voice anywhere the user actually looks.
  //
  // The pepper is the row the feature is really for: tonight's dinner is the
  // stir-fry, and the stir-fry calls for a red bell pepper, so its row reads
  // "Use by tomorrow · Dinner: Weeknight chicken stir-fry" — the warning and
  // the plan that answers it, on one line. The cilantro is the same row with
  // nothing planned to eat it, which is what most of them look like.
  //
  // Two of them and not three, deliberately: past two the rows collapse into a
  // single "N things to use up" and the demo would show the summary instead of
  // either of the captions worth seeing.
  addToPantry('Red bell pepper');
  setExpiresAt(itemNamed('Red bell pepper').id, dayKeyOf(addDays(new Date(), 1)));
  setExpiresAt(itemNamed('Cilantro').id, dayKeyOf(new Date()));

  // An opened jar, which is the second lexicon's whole reason for existing.
  // addToPantry deliberately doesn't date anything ("Got it" doesn't say
  // *when*), so this row has no countdown at all until it's opened — and then
  // it has a real one, dated from the opening rather than from a purchase.
  addToPantry('Salsa');
  setOpened(itemNamed('Salsa').id, true);

  // A row that has gone bad before, which is the only thing the disposal record
  // is for: opening Cilantro's Use by field says "Went bad 2 of 3 times" right
  // where the shelf life is edited, so the number the app guessed and the
  // evidence against it are on the same screen. Cilantro because it's the
  // herb everyone has thrown out, and because it's already the row here with a
  // use-by day and nothing planned to eat it.
  //
  // Through the store action like everything else, so a seeded record can't
  // drift from the type — which means the second "went bad" raises the
  // shelf-life offer for real, and the demo has to put it back down. A banner
  // is a reaction to a tap, and nobody tapped anything.
  recordDisposal(itemNamed('Cilantro').id, 'usedUp');
  recordDisposal(itemNamed('Cilantro').id, 'spoiled');
  recordDisposal(itemNamed('Cilantro').id, 'spoiled');
  dismissDisposalOffer();

  // Running low, which is the one pantry state that touches the shopping list:
  // the row is on this week's list because of this line, not because anyone
  // typed it there. Coffee, because it's the thing people actually notice
  // running out of.
  setRunningLow(itemNamed('Coffee').id, true);

  // The freezer, on both halves of the kitchen. Chicken is the case the feature
  // was built for: the shelf-life lexicon gives it two days, so the trip above
  // stamped a use-by date on it, and without a freezer the demo would open with
  // "Use up Chicken breast" nagging about meat that's under an inch of ice. Its
  // stored date is deliberately left in place and simply not read, which is what
  // the Pantry row's "in the freezer · Frozen …" caption is showing.
  setFrozen(itemNamed('Chicken breast').id, true);
  // And a bag of peas, which is what most of a freezer actually is: something
  // with no use-by date at all, in the freezer because that's where it lives.
  // Without a row like it the section would read as a place perishables go to
  // hide rather than a place in the kitchen.
  addToPantry('Frozen peas');
  setFrozen(itemNamed('Frozen peas').id, true);

  // Two loaves in the kitchen at once, in two different places — the pantry
  // state that lives on a *box* rather than on the item. This is the case those
  // four columns exist for: freezing the spare loaf while you work through the
  // one that's out is a thing everybody does, and with one slot per item the
  // app could only ever have called both of them frozen. Deliberately the two
  // boxes not rated "never again" — a loaf you avoid is not one you have two of.
  //
  // **After the trips, not beside the other product seeding**, because Arnold's
  // is Bread's preferred box and a finished trip clears exactly these four
  // columns on it (dbFinishGroceryShopping) — the packet you froze is not the
  // packet you just carried home. Seeded up there, the trip below would wipe it
  // and the demo would quietly lose the feature.
  if (sourdough) setProductFrozen(sourdough.id, true);
  if (arnolds) {
    setProductOnHandUntil(arnolds.id, defaultOnHandUntil(itemNamed('Bread'), new Date()));
  }

  // A walk order the user has clearly edited: a custom section they file two
  // things into by hand, a built-in they never shop deleted (which leaves the
  // tombstone that stops normalizeAisleOrder re-appending it), and Frozen
  // moved to the end because that's the last thing you want in the trolley.
  const bulkBins = addAisle('Bulk bins');
  if (bulkBins) {
    setAisle(itemNamed('Almonds').id, bulkBins);
    setAisle(itemNamed('Rice').id, bulkBins);
  }
  deleteAisle('Personal Care');
  const order = useGroceryStore.getState().aisleOrder;
  setAisleOrder([...order.filter(a => a !== 'Frozen'), 'Frozen']);

  // What's on the list right now, with two things already in the trolley — the
  // state the finish-shopping sheet is for. Milk, Eggs, Bananas, Bread and
  // Tortillas are already catalog rows (bought or linked above) and go back
  // on the list as themselves; Cheddar, Sparkling water and Ice cream were
  // never bought or linked, so clearList dropped them — they're typed fresh,
  // same as a name nobody has shopped for yet.
  // Cottage cheese is here for the brand rule: it's on the list, Trader Joe's
  // is recorded with the wrong brand, and the trip below is at Trader Joe's —
  // which is what puts the wrong-brand caption on a row you can actually see.
  const ON_LIST_EXISTING = [
    'Milk', 'Eggs', 'Bananas', 'Bread', 'Tortillas', 'Peanut butter', 'Cottage cheese',
  ];
  addExistingMany(idsNamed(ON_LIST_EXISTING));
  ['Cheddar', 'Sparkling water', 'Ice cream'].forEach(name =>
    addByName(name, undefined, undefined, { registerUndo: false })
  );
  setCheckedMany(idsNamed(['Milk', 'Bananas']), true);

  // Coriander, typed fresh — see the Cilantro trip above. It has to be added
  // here, after the clear: it carries nothing anyone put on it, so clearList
  // would sweep it along with every other bare name on the list.
  addByName('Coriander', undefined, undefined, { registerUndo: false });

  // The shelf-life correction itself: a name the lexicon has never heard of
  // (cheddar isn't in it), given a shelf life by hand. Cheddar is still on
  // the list and hasn't been bought in this seed, so this doesn't count down
  // yet — it only turns into a real use-by date the next time a trip actually
  // buys it. See GroceryItem.shelfLifeDays.
  setShelfLifeDays(itemNamed('Cheddar').id, 21);

  // ...plus tonight's dinner, added off the recipe, so a few rows carry "from
  // Weeknight chicken stir-fry" rather than looking hand-typed.
  // The aisles come from the ingredient rows the sheet reviewed, not from the
  // lexicon — "red bell pepper" would otherwise land under Baking & Spices on
  // its last token, and "serrano chile" is a name the lexicon has never heard.
  // The chile is the recipe's either/or, and it's on the list as one: this is
  // the shop where "Decide at the shop" was picked instead of answering
  // serrano-or-jalapeño at the kitchen table, so both rows are here under one
  // choiceGroup and ticking either at the shelf takes the other off. It's the
  // only place the grocery half of either/or shows up in the demo (#1572), and
  // the reason it's seeded through addFromPlan rather than addByName is that
  // this is exactly the path a recipe takes to get there.
  addFromPlan([
    { name: 'Chicken breast', quantity: '2', aisle: 'Meat & Seafood', choiceGroup: null },
    { name: 'Red bell pepper', quantity: '1', aisle: 'Produce', choiceGroup: null },
    { name: 'Soy sauce', quantity: '2 tbsp', aisle: 'Pantry', choiceGroup: null },
    { name: 'Serrano chile', quantity: '1', aisle: 'Produce', choiceGroup: `${recipes.stirFry}:Chile` },
    { name: 'Jalapeno', quantity: '1', aisle: 'Produce', choiceGroup: `${recipes.stirFry}:Chile` },
  ].map(row => ({
    ...row,
    sourceRecipeId: recipes.stirFry,
    sourceRecipeTitle: 'Weeknight chicken stir-fry',
  })));

  // ...and you're at Trader Joe's right now, which is the only state in which
  // the list says anything about stores. Two of the three things a row can say
  // are on screen because of it: Tortillas are marked as not stocked here, and
  // Peanut butter is on record at Costco alone. The third ("Usually X") can't
  // be seeded honestly — it needs an item bought at two stores while you stand
  // in a third, and this demo has two stores anyone would shop at.
  startTrip(traderJoes.id);
}

// ---------------------------------------------------------------------------
// The week's meals, and what they left in the fridge
// ---------------------------------------------------------------------------

/**
 * A fortnight of dinners either side of today, and four containers in the
 * fridge at four different points on the clock.
 *
 * `loadRange` first, and it matters: the meal plan store is range-scoped, so a
 * write outside the loaded window goes to SQLite and is deliberately *not*
 * patched into memory — which would leave setCooked/setRecipeScale/
 * setRecipeChoices below with nothing to find. The window also means Today's
 * planned-meals section is populated the moment demo mode starts, rather than
 * staying blank until the meal plan screen has been visited once.
 */
/**
 * The weekly "plan this week" nudge, as the stack of seven it fires as (#1585,
 * retargeted to the trigger's own week rather than the one after by #1730).
 *
 * Seeded rather than left to `checkMealPlanNudge`, which is off by default and
 * fires once a week at a configured hour — a demo can't wait for Sunday. The
 * days and the titles come from `dueMealPlanNudge` itself rather than being
 * written out here, so the demo can't drift from what the generator actually
 * produces; only the trigger is faked, by asking it about today.
 *
 * The target week is now the same one `seedMealPlanAndFridge` above already
 * fleshes out, so the row counters' range comes from that existing spread
 * rather than from meals planted here: today (offset 0) is always planned end
 * to end up there, which is the "ready to complete" state on its own, and most
 * of the days around it already carry one or two meals, which is the partial
 * state. Nothing is added here — adding a second "3/3" day on top of today's
 * would be the very bug this retargeting introduced (#1730).
 */
function seedMealPlanNudgeStack(
  today: Date,
  weekStartsOn: WeekStart,
  plan: (dayOffset: number, slot: MealSlot, entry: { title: string; recipeId?: string; cookTask?: boolean | null }) => unknown
): void {
  const { addTask, updateTask } = useTaskStore.getState();
  const { createGroup, setGroupCollapsed } = useTaskGroupStore.getState();

  // Fire it as though the trigger were now — midnight today, on today's own
  // weekday, never fired before.
  const due = dueMealPlanNudge(today, weekStartsOn, today.getDay(), '00:00', null);
  if (!due) return;

  const group = createGroup(due.title, 'Meal Plan');
  setGroupCollapsed(group.id, false);
  due.days.forEach((day, index) => {
    const task = addTask({
      title: day.title,
      dueDate: due.dueDate.toISOString(),
      linkUrl: mealPlanNudgeLinkUrl(day.dayKey),
      category: 'Meal Plan',
      groupId: group.id,
      ...generatedBy('mealPlanNudge', day.dayKey),
    });
    updateTask(task.id, { sortOrder: index + 1 }, { skipPostponeCount: true });
  });
}

/**
 * Tomorrow's dinner, handed to `seedPeople` so it can name guests on it.
 *
 * A module-level handoff rather than a return value because the meals are
 * seeded behind the kitchen switch and the people are not, so the two calls
 * can't be chained — and null when the kitchen half is off, which the guest
 * seeding reads as "nothing to be a guest at".
 */
let seededSalmonNightId: string | null = null;
/**
 * The steak dinner four days ago, handed to `seedPeople` for the same reason
 * `seededSalmonNightId` is — but this one is already cooked, so it's what
 * gives the year-in-review stat (#2092) something to count. The salmon dinner
 * deliberately isn't it: that one has to stay uncooked for COMING UP.
 */
let seededSteakNightId: string | null = null;

function seedMealPlanAndFridge(recipes: DemoRecipes, today: Date): void {
  const { loadRange, planMeal, setCooked, setRecipeScale, setRecipeChoices, stampAddedToList } =
    useMealPlanStore.getState();
  const { markCooked } = useRecipeStore.getState();
  const { logLeftover, finishLeftover, setFrozen: setLeftoverFrozen } = useLeftoverStore.getState();
  const weekStartsOn = useSettingsStore.getState().weekStartsOn;
  // The two categories the kitchen's generated tasks file under, named and
  // pointed at explicitly rather than left to ensureGeneratedTaskCategories:
  // that pass reads the *real* install's settings (demo mode swaps the
  // database, not the in-memory preferences), so a demo that relied on it
  // would look different depending on what the person's own settings happened
  // to say. These are the names a fresh install gets.
  const { addCategory, setCategoryEmoji } = useCategoryStore.getState();
  ([['Meal Plan', '🍽️'], ['Leftovers', '🥡']] as Array<[string, string]>).forEach(([name, emoji]) => {
    addCategory(name);
    setCategoryEmoji(name, emoji);
  });
  useSettingsStore.getState().setMealCookTaskCategory('Meal Plan');
  useSettingsStore.getState().setLeftoverUseUpTaskCategory('Leftovers');

  loadRange(dayKeyOf(subDays(today, 14)), dayKeyOf(addDays(today, 14)));

  const plan = (
    dayOffset: number,
    slot: MealSlot,
    entry: { title: string; recipeId?: string; leftoverId?: string; cookTask?: boolean | null }
  ) =>
    planMeal({
      date: dayKeyOf(addDays(today, dayOffset)),
      slot,
      title: entry.title,
      recipeId: entry.recipeId ?? null,
      leftoverId: entry.leftoverId ?? null,
      cookTask: entry.cookTask ?? null,
    });

  // --- Nights already cooked ----------------------------------------------
  // cookedAt is the one thing an entry tracks about the past; the recipe's own
  // cookCount is bumped separately and never derived back from entries, which
  // is why both calls are here.
  //
  // These opt out of a cook task (#1402): a night eight days ago doesn't want
  // a task spawned and instantly completed, which would date a cooking to
  // right now and put five of them in today's Logbook and Stats.
  const cooked = (
    dayOffset: number,
    slot: MealSlot,
    entry: { title: string; recipeId?: string }
  ) => {
    const planned = plan(dayOffset, slot, { ...entry, cookTask: false });
    if (planned) setCooked(planned.id, true);
    if (entry.recipeId) markCooked(entry.recipeId);
    return planned;
  };

  cooked(-8, 'dinner', { title: 'Lemon garlic salmon', recipeId: recipes.salmon });
  cooked(-6, 'dinner', { title: 'Takeout curry' });
  cooked(-5, 'lunch', { title: 'Turkey and avocado sandwich', recipeId: recipes.sandwich });
  const steakNight = cooked(-4, 'dinner', {
    title: 'Seared steak with potatoes',
    recipeId: recipes.steak,
  });
  if (steakNight) {
    // Cooked for eight — a fact about that Sunday, never written back onto the
    // recipe, so every other meal using it is untouched.
    setRecipeScale(steakNight.id, 2);
    // ...and that night it was the roast potatoes rather than the default mash.
    const roasted = componentIdFor(recipes.steak, recipes.roasties);
    if (roasted) setRecipeChoices(steakNight.id, [roasted]);
  }
  seededSteakNightId = steakNight?.id ?? null;
  const stirFryNight = cooked(-1, 'dinner', {
    title: 'Weeknight chicken stir-fry',
    recipeId: recipes.stirFry,
  });
  // Planned and then not cooked — the night the week got away from you. Without
  // one of these, Stats' "Planned meals cooked" row can only ever read "n of n"
  // and the fraction looks like it has no other state (#1367). Opted out of a
  // cook task for the same reason the cooked nights are: a task for a dinner
  // three days ago wants neither spawning nor completing.
  plan(-3, 'dinner', { title: 'Chicken tacos', cookTask: false });

  // --- What those left behind ---------------------------------------------
  // One container at each point on the clock, so the freshness ladder, the
  // hub-pill badge and the "use it up" nudge all have something to show.
  const stirFryLeftover = logLeftover({
    title: 'Chicken stir-fry',
    recipeId: recipes.stirFry,
    sourceEntryId: stirFryNight?.id ?? null,
    storedAt: subDays(today, 1).toISOString(),
    keepDays: 3,
  });
  // A component's leftover points at the component's own recipe, not at the
  // dinner it was part of: this is a tub of mash, not a tub of steak. Five days
  // because that's what the mash recipe says its leftovers keep — the number the
  // log sheet would have opened on.
  logLeftover({
    title: 'Mashed potatoes',
    recipeId: recipes.mash,
    sourceEntryId: steakNight?.id ?? null,
    storedAt: subDays(today, 4).toISOString(),
    keepDays: 5,
  });
  logLeftover({
    title: 'Carrot cake',
    recipeId: recipes.cake,
    storedAt: subDays(today, 3).toISOString(),
    keepDays: 3,
  });
  // Logged by hand with no recipe behind it — half a takeaway is a leftover.
  logLeftover({
    title: 'Takeout curry',
    storedAt: subDays(today, 6).toISOString(),
    keepDays: 3,
  });

  // A portion put in the freezer rather than eaten in time — the fridge half of
  // the same feature, and the reason it exists on both halves: a container of
  // chilli and a bag of spinach going in the freezer are one fact to the cook.
  // Its keep-until is weeks past, which is exactly the point: nothing counts
  // down, nothing is red, and it sits under "In the freezer" beside the peas.
  const frozenChilli = logLeftover({
    title: 'Beef chilli',
    storedAt: subDays(today, 24).toISOString(),
    keepDays: 4,
  });
  if (frozenChilli) setLeftoverFrozen(frozenChilli.id, true);

  // The other way into the freezer, and the one the log sheet asks about: a
  // batch cooked and split at the sink, half for this week and half for a
  // night in November. Two rows rather than one, because a container has one
  // clock — the fridge half counts down and the freezer half doesn't, which is
  // the whole reason "Both" writes twice instead of writing a flag.
  const batchStoredAt = subDays(today, 2).toISOString();
  logLeftover({ title: 'Sausage ragù', storedAt: batchStoredAt, keepDays: 4 });
  logLeftover({ title: 'Sausage ragù', storedAt: batchStoredAt, keepDays: 4, frozen: true });

  // Closed out, so the fridge history has both endings in it. "We ate it" and
  // "it went off" are the two things the feature exists to tell apart.
  const eaten = logLeftover({
    title: 'Roast chicken',
    storedAt: subDays(today, 9).toISOString(),
    keepDays: 3,
  });
  if (eaten) finishLeftover(eaten.id, 'eaten');
  const tossed = logLeftover({
    title: 'Lentil soup',
    storedAt: subDays(today, 12).toISOString(),
    keepDays: 4,
  });
  if (tossed) finishLeftover(tossed.id, 'tossed');

  // --- The week ahead ------------------------------------------------------
  // Cook tasks (#1402) are shown as a mixture on purpose, because both halves
  // of the feature are invisible until something uses them. Today's oats and
  // dinner each put a "Cook …" task on the day — segmented to their slot, so
  // the dinner one stays hidden until evening — while the sandwich and the
  // snack plate opt out, which is what the entry sheet's per-meal toggle
  // writes. A day where every recipe became a chore is exactly the pile-up the
  // toggle exists for.
  //
  // That mixture is now also what shows both halves of the *fold* (#1571): the
  // two with a cook task appear as ordinary task rows, and the two without
  // appear as context rows in the same section — which is the whole point of
  // meals going inline rather than into a strip of their own. The demo files
  // them under Meal Plan (see the categories seeded above) so they land in a
  // section rather than loose above every one.
  plan(0, 'breakfast', { title: 'Overnight oats', recipeId: recipes.oats });
  plan(0, 'lunch', { title: 'Turkey and avocado sandwich', recipeId: recipes.sandwich, cookTask: false });
  plan(0, 'dinner', { title: 'Weeknight chicken stir-fry', recipeId: recipes.stirFry });
  plan(0, 'snack', { title: 'Hummus snack plate', recipeId: recipes.snacks, cookTask: false });

  plan(1, 'breakfast', { title: 'Overnight oats', recipeId: recipes.oats });
  // Captured for the shopping task seeded at the end of this function — it's
  // the night the kitchen can't currently make.
  const salmonNight = plan(1, 'dinner', { title: 'Lemon garlic salmon', recipeId: recipes.salmon });
  seededSalmonNightId = salmonNight?.id ?? null;

  // Freeform — planning doesn't require a recipe, and a night that just says
  // "eating out" holds its place and counts like any other.
  plan(2, 'dinner', { title: 'Eating out' });

  // Eating the chilli that's in the fridge. Planning against a leftover
  // deliberately doesn't close it out — a pot feeds two dinners.
  if (stirFryLeftover) {
    plan(3, 'dinner', {
      title: 'Leftover chicken stir-fry',
      leftoverId: stirFryLeftover.id,
    });
  }

  // Two things on one dinner — real, and the reason there's no UNIQUE(date, slot).
  plan(4, 'dinner', { title: 'Lemon garlic salmon', recipeId: recipes.salmon });
  plan(4, 'dinner', { title: 'Simple green salad', recipeId: recipes.salad });

  const sundayRoast = plan(5, 'dinner', {
    title: 'Seared steak with potatoes',
    recipeId: recipes.steak,
  });
  // Roast potatoes again this week, decided in advance.
  if (sundayRoast) {
    const roasted = componentIdFor(recipes.steak, recipes.roasties);
    if (roasted) setRecipeChoices(sundayRoast.id, [roasted]);
  }
  plan(5, 'snack', { title: 'Carrot cake with cream cheese frosting', recipeId: recipes.cake });

  seedMealPlanNudgeStack(today, weekStartsOn, plan);

  // The run ends on a night nobody has decided yet: breakfast planned, dinner
  // open, which is the one state a day reads ambiguously in — a day holding
  // something already can't be told from a decided one at a glance, least of
  // all at compact density. It also leaves the suggestion shelf somewhere to
  // land, which a fortnight with every dinner spoken for does not.
  plan(6, 'breakfast', { title: 'Overnight oats', recipeId: recipes.oats });

  // Today's meal tasks, through the generator rather than written out here —
  // the same call the app makes on every launch, so the demo can't show a shape
  // the real pass wouldn't produce. It reads today's slots as they now stand,
  // which is why it runs after the week above is planted: breakfast and dinner
  // are answered and get "Cook X → Eat X", and the two nights that opted out
  // (`cookTask: false` on lunch and the snack) get no task and appear as
  // context rows instead — both sides of the same section, which is what the
  // arrangement is for.
  //
  // It writes a week rather than a day, which is what puts both states on one
  // screen: the nights already planned read "Cook X" on their own day, and the
  // slots nobody has filled in (the open dinner on offset 6 above, every lunch
  // past the ones seeded) read "Choose dinner" — undecided, and saying so.
  useTaskStore.getState().checkMealSlotTasks();

  // This week's ingredients have been through "Add week to list" already —
  // a stamp on the week header, never a lock on adding again.
  stampAddedToList(dayKeyOf(buildWeekDays(today, weekStartsOn)[0]));

  // --- A meal the kitchen can't currently make ------------------------------
  // The generator that says so before the night arrives, which is the whole
  // point of it: planning a week has never required owning any of it, and until
  // this existed the only way to find out was to open the meal plan and tap the
  // cart yourself, on a day you had no reason to be thinking about tomorrow.
  //
  // Tomorrow's salmon is the honest instance rather than an invented one. It
  // genuinely qualifies against the catalog seeded above — no row at all for
  // salmon fillets or asparagus, and butter is explicitly marked out of
  // (OUT_OF_IT_UNTIL) — while lemons, garlic and the mash's potatoes are all
  // there, so the row means "you're short two things", not "this recipe is
  // unknown to me". That matters because the shortfall check runs on every
  // foreground: a seeded task the real pass disagreed with would delete itself
  // the moment the demo was opened.
  //
  // Written out here rather than via checkMealShortfallTasks, unlike the meal
  // tasks above, because that pass reads the *real* install's setting and this
  // generator ships off — so a demo relying on it would show the feature only
  // to the people who had already found it. Same reason the pantry check is
  // written by hand, and the category is named for the same reason too.
  if (salmonNight) {
    useSettingsStore.getState().setMealShortfallTaskCategory('Meal Plan');
    useTaskStore.getState().addTask({
      title: mealShortfallTitle(salmonNight.date, 'Lemon garlic salmon'),
      dueDate: today.toISOString(),
      linkUrl: mealShortfallLinkUrl(salmonNight.date),
      category: 'Meal Plan',
      ...generatedBy('mealShortfall', salmonNight.id),
    });
  }

  // The nights above went through setCooked, which raises the post-cook sheet
  // — so the last of them would drop demo mode straight into a sheet asking
  // about a dinner eight days ago.
  //
  // It's cleared rather than left standing, and this is the one capability
  // here that genuinely can't be seeded: the recap isn't a row, it's the app's
  // answer to a tap you just made. Seeding one would be asserting a tap that
  // never happened, and its lasting outputs are a rating, a fridge row and an
  // item marked out of — the last of which is a *negative*, so it shows up as
  // nothing at all. The honest way to see this feature is to mark a meal
  // cooked, which the demo is fully set up for: tonight's stir-fry, its
  // ingredients and an unrated recipe are all here.
  useMealPlanStore.getState().clearCookRecap();

}
