import { addDays } from 'date-fns/addDays';
import { subDays } from 'date-fns/subDays';
import { setHours } from 'date-fns/setHours';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { getCurrentDayStart } from './dateUtils';
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
// Today, Later, Unscheduled, Inbox, Projects, Logbook and Stats.
export function seedDemoData(): void {
  const {
    addTask,
    addSubtask,
    updateTask,
    completeTask,
    addNewGroupedTask,
    addExistingToProject,
    addTag,
  } = useTaskStore.getState();
  const { addCategory, setCategoryEmoji } = useCategoryStore.getState();
  const { createProject } = useProjectStore.getState();
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

  // --- Today ---------------------------------------------------------------
  addTask({
    title: 'Send the Q3 roadmap to Priya',
    notes: 'Draft is in the shared folder — just needs the headcount slide.',
    category: 'Work',
    priority: 4,
    effort: 2,
    dueDate: today.toISOString(),
    deadline: addDays(today, 2).toISOString(),
    tags: ['admin'],
    pinned: true,
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
    notes: 'Fifteen minutes, camera optional.',
    category: 'Work',
    recurrenceType: 'weekly',
    recurrenceDays: [1, 2, 3, 4, 5],
    timeSegments: ['morning'],
    effort: 1,
  });
  updateTask(standup.id, { streakCount: 9, streakDate: subDays(today, 1).toISOString() });

  const meditate = addTask({
    title: 'Ten minutes of quiet',
    notes: 'Streaks survive a vacation — this one is paused while Vacation mode is on.',
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

  addTask({
    title: 'Swing by the farmers market',
    notes: 'Only worth doing between 8 and 1 — after that the good stalls are gone.',
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

  // --- A stack (three independently-scheduled tasks under one label) --------
  const supplements = createGroup('Supplements', 'Health');
  addNewGroupedTask(supplements.id, 'Vitamin D');
  addNewGroupedTask(supplements.id, 'Omega-3');
  const iron = addNewGroupedTask(supplements.id, 'Iron');
  updateTask(iron.id, { timeSegments: ['evening'] });

  // --- Later (deferred / future-dated) -------------------------------------
  addTask({
    title: 'Renew the passport',
    notes: 'Six weeks of processing time, so this needs starting well before the trip.',
    category: 'Errands',
    priority: 4,
    effort: 3,
    dueDate: addDays(today, 9).toISOString(),
    deadline: addDays(today, 21).toISOString(),
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

  addTask({
    title: 'Dentist — 2:40pm',
    category: 'Health',
    dueDate: addDays(today, 5).toISOString(),
    reminderTime: setHours(addDays(today, 5), 13).toISOString(),
    effort: 1,
  });

  // --- Unscheduled (organized, but no date) --------------------------------
  addTask({
    title: 'Deep clean the garage',
    notes: 'Effort is a size, not a time estimate — this one is an XL.',
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

  // --- A project -----------------------------------------------------------
  const kitchen = createProject(
    'Kitchen refresh',
    today.toISOString(),
    addDays(today, 45).toISOString(),
  );
  const projectTasks = [
    { title: 'Measure the counters', effort: 1 as const, done: true },
    { title: 'Pick a tile', effort: 2 as const, done: true },
    { title: 'Get three quotes', effort: 3 as const, done: false },
    { title: 'Book the installer', effort: 2 as const, done: false },
  ];
  projectTasks.forEach(({ title, effort, done }) => {
    const t = addTask({ title, category: 'Home', effort });
    addExistingToProject(t.id, kitchen.id);
    if (done) completeTask(t.id);
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

  // --- History, so Logbook and Stats aren't empty --------------------------
  const HISTORY: Array<[string, string, number]> = [
    ['Reply to the landlord', 'Home', 0],
    ['Ship the pricing changes', 'Work', 0],
    ['Pick up the dry cleaning', 'Errands', 1],
    ['Weekly review', 'Work', 1],
    ['Call Mum', 'Home', 2],
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
}
