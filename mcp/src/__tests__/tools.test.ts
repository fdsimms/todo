/**
 * The tool layer against a stub replica.
 *
 * No database and no SDK, which is the point of `tools.ts` taking a `Replica`
 * rather than reaching for one: the lenses, the caps and the projection are
 * ordinary functions over ordinary data. replica.test.ts is where the same
 * functions meet a real database.
 */
import { serializeTask } from '../serialize';
import {
  addGroceryItem,
  getTask,
  listFoodLog,
  listGroceryItems,
  listMedicationLogs,
  listMoodLogs,
  listProjects,
  listTasks,
  removeFromGroceryList,
  resolveRange,
  searchTasks,
  listCategories,
  setGroceryChecked,
  createTask,
  updateTask,
  DEFAULT_LIMIT,
  DEFAULT_LOG_DAYS,
  MAX_LIMIT,
  MAX_LOG_DAYS,
} from '../tools';
import type { Replica } from '../replica';
import type { Category, FoodLogEntry, GroceryItem, GroceryListEntry, MedicationLog, MoodLog, Project, Task } from '../../../src/types';

const task = (over: Partial<Task> & { id: string; title: string }): Task =>
  ({
    notes: '',
    completed: false,
    category: null,
    tags: [],
    timeSegments: [],
    priority: 0,
    parentId: null,
    projectId: null,
    dueDate: null,
    deadline: null,
    deferUntil: null,
    recurrenceType: 'none',
    chainItems: [],
    chainIndex: 0,
    pinned: false,
    ...over,
  }) as Task;

/**
 * Visibility is stubbed by convention rather than computed: a task whose id
 * starts with the lens name belongs to it. The real model is tested against a
 * real database in replica.test.ts, and duplicating it here would be testing
 * the stub.
 */
function stubReplica(over: Partial<Replica> = {}): Replica {
  const tasks: Task[] = [];
  return {
    path: ':stub:',
    refresh: () => {},
    rotationDoneIds: () => [],
    tasks: () => tasks,
    taskById: (id: string) => tasks.find(t => t.id === id) ?? null,
    projects: () => [],
    projectProgress: () => ({ done: 0, total: 0 }),
    projectDecisions: () => [],
    categories: () => [],
    groceryItems: () => [],
    groceryListEntries: () => [],
    groceryLists: () => [],
    awaySpan: () => null,
    itemProducts: () => [],
    shops: () => [],
    itemShopLinks: () => [],
    itemSubLinks: () => [],
    storeAliases: () => [],
    aisleOverrides: () => ({}),
    aisleNames: () => [],
    updateGroceryItem: () => { throw new Error('not stubbed'); },
    saveGroceryBox: () => { throw new Error('not stubbed'); },
    saveShop: () => { throw new Error('not stubbed'); },
    deleteGroceryItem: () => { throw new Error('not stubbed'); },
    createGroceryList: () => { throw new Error('not stubbed'); },
    renameGroceryList: () => { throw new Error('not stubbed'); },
    deleteGroceryList: () => { throw new Error('not stubbed'); },
    finishGroceryTrip: () => { throw new Error('not stubbed'); },
    importReceipt: () => { throw new Error('not stubbed'); },
    leftovers: () => [],
    updatePantryItem: () => { throw new Error('not stubbed'); },
    updatePantryBox: () => { throw new Error('not stubbed'); },
    addToPantry: () => { throw new Error('not stubbed'); },
    answerPantryReview: () => { throw new Error('not stubbed'); },
    updateLeftover: () => { throw new Error('not stubbed'); },
    createLeftover: () => { throw new Error('not stubbed'); },
    isVisible: (t: Task) => t.id.startsWith('today'),
    isHiddenForVacation: (t: Task) => t.id.startsWith('vacation'),
    isUnscheduled: (t: Task) => t.id.startsWith('unscheduled'),
    isInbox: (t: Task) => t.id.startsWith('inbox'),
    isBlocked: (t: Task) => t.id.startsWith('blocked'),
    liveBlockers: () => [],
    isNotNeeded: () => false,
    visibleAt: () => new Date('2099-01-01T00:00:00.000Z'),
    search: () => [],
    displayTitle: (t: Task) => t.title,
    estimatedMinutes: () => null,
    deliverableKind: () => null,
    deliverableOptions: () => [],
    // A fixed "today" so the range arithmetic is assertable. The real one goes
    // through getLogicalToday; what is tested here is the counting, not the
    // clock.
    todayKey: () => '2026-09-11',
    shiftDayKey: (key: string, days: number) => {
      const d = new Date(`${key}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    },
    foodLogEntries: () => [],
    foodProduce: () => [],
    foodTotals: () => ({ total: {}, reported: {}, entries: 0 }),
    moodLogs: () => [],
    medicationLogs: () => [],
    medicationSummary: (log: MedicationLog) => log.name,
    // No store configured is the ordinary state for a replica pointed at a
    // file somebody copied, and the tool layer never calls this anyway.
    sync: async () => null,
    templates: () => [],
    createTemplate: () => { throw new Error('not stubbed'); },
    updateTemplate: () => { throw new Error('not stubbed'); },
    deleteTemplate: () => { throw new Error('not stubbed'); },
    applyTemplate: () => { throw new Error('not stubbed'); },
    updateRecipe: () => { throw new Error('not stubbed'); },
    deleteRecipe: () => { throw new Error('not stubbed'); },
    reopenTask: () => { throw new Error('not stubbed'); },
    updateFoodEntry: () => { throw new Error('not stubbed'); },
    deleteFoodEntry: () => { throw new Error('not stubbed'); },
    updateMoodLog: () => { throw new Error('not stubbed'); },
    deleteMoodLog: () => { throw new Error('not stubbed'); },
    updateMedicationLog: () => { throw new Error('not stubbed'); },
    deleteMedicationLog: () => { throw new Error('not stubbed'); },
    calendarRequests: () => [],
    requestCalendarEvent: () => { throw new Error('not stubbed'); },
    cancelCalendarRequest: () => { throw new Error('not stubbed'); },
    updateMeal: () => { throw new Error('not stubbed'); },
    removeMeal: () => { throw new Error('not stubbed'); },
    createPerson: () => { throw new Error('not stubbed'); },
    updatePerson: () => { throw new Error('not stubbed'); },
    renameStack: () => { throw new Error('not stubbed'); },
    reorderTemplates: () => { throw new Error('not stubbed'); },
    createTask: () => { throw new Error('not stubbed'); },
    scaleFirstWeek: () => {},
    completeTask: () => { throw new Error('not stubbed'); },
    completionProblem: () => null,
    deferTask: () => { throw new Error('not stubbed'); },
    setTaskArchived: () => { throw new Error('not stubbed'); },
    deleteTask: () => { throw new Error('not stubbed'); },
    skipOccurrence: () => { throw new Error('not stubbed'); },
    reorderTasks: () => { throw new Error('not stubbed'); },
    setTaskDates: () => { throw new Error('not stubbed'); },
    duplicateTask: () => { throw new Error('not stubbed'); },
    deleteTag: () => { throw new Error('not stubbed'); },
    setCompletedAt: () => { throw new Error('not stubbed'); },
    tagList: () => [],
    updateStack: () => { throw new Error('not stubbed'); },
    deleteStack: () => { throw new Error('not stubbed'); },
    renameCategory: () => { throw new Error('not stubbed'); },
    updateCategorySettings: () => { throw new Error('not stubbed'); },
    reorderCategories: () => { throw new Error('not stubbed'); },
    deleteProject: () => { throw new Error('not stubbed'); },
    saveProjectCategory: () => { throw new Error('not stubbed'); },
    reorderProjects: () => { throw new Error('not stubbed'); },
    startFreshProject: () => { throw new Error('not stubbed'); },
    saveProjectAsTemplate: () => { throw new Error('not stubbed'); },
    projectCategories: () => [],
    deleteCookbook: () => { throw new Error('not stubbed'); },
    splitLeftover: () => { throw new Error('not stubbed'); },
    deleteLeftover: () => { throw new Error('not stubbed'); },
    moveFoodEntry: () => { throw new Error('not stubbed'); },
    duplicateFoodEntry: () => { throw new Error('not stubbed'); },
    savedMeals: () => { throw new Error('not stubbed'); },
    saveMealFromEntries: () => { throw new Error('not stubbed'); },
    logSavedMeal: () => { throw new Error('not stubbed'); },
    deleteSavedMeal: () => { throw new Error('not stubbed'); },
    nutritionTargets: () => ({}),
    setNutritionTargets: () => { throw new Error('not stubbed'); },
    setMealCooked: () => { throw new Error('not stubbed'); },
    saveMealAsRecipe: () => { throw new Error('not stubbed'); },
    copyMealWeek: () => { throw new Error('not stubbed'); },
    copyMealTo: () => { throw new Error('not stubbed'); },
    mealChoices: () => { throw new Error('not stubbed'); },
    cookbookSummaries: () => { throw new Error('not stubbed'); },
    cookbookIndex: () => { throw new Error('not stubbed'); },
    renameCookbook: () => { throw new Error('not stubbed'); },
    mergeCookbooks: () => { throw new Error('not stubbed'); },
    saveIndexEntry: () => { throw new Error('not stubbed'); },
    deleteIndexEntry: () => { throw new Error('not stubbed'); },
    recipeFromIndexEntry: () => { throw new Error('not stubbed'); },
    reorderUpNext: () => { throw new Error('not stubbed'); },
    logCookTime: () => { throw new Error('not stubbed'); },
    requestCalendarChange: () => { throw new Error('not stubbed'); },
    setMedicationArchived: () => { throw new Error('not stubbed'); },
    renameMoodTag: () => { throw new Error('not stubbed'); },
    settingValues: () => ({}),
    applySettings: () => { throw new Error('not stubbed'); },
    activeTrip: () => null,
    nonFoodAisles: () => [],
    plannedIngredients: () => { throw new Error('not stubbed'); },
    addPlannedToList: () => { throw new Error('not stubbed'); },
    addChoiceToList: () => { throw new Error('not stubbed'); },
    settleChoice: () => { throw new Error('not stubbed'); },
    swapForSubstitute: () => { throw new Error('not stubbed'); },
    clearGroceryList: () => { throw new Error('not stubbed'); },
    setTrip: () => { throw new Error('not stubbed'); },
    setItemUnavailable: () => { throw new Error('not stubbed'); },
    setNutritionPanel: () => { throw new Error('not stubbed'); },
    saveAisle: () => { throw new Error('not stubbed'); },
    reorderAisles: () => { throw new Error('not stubbed'); },
    deleteShop: () => { throw new Error('not stubbed'); },
    updateShopSettings: () => { throw new Error('not stubbed'); },
    reorderShops: () => { throw new Error('not stubbed'); },
    reorderGroceryLists: () => { throw new Error('not stubbed'); },
    mergeGroceryItems: () => { throw new Error('not stubbed'); },
    deletePerson: () => { throw new Error('not stubbed'); },
    reorderPeople: () => { throw new Error('not stubbed'); },
    savePersonGroup: () => { throw new Error('not stubbed'); },
    addPersonNote: () => { throw new Error('not stubbed'); },
    updatePersonNote: () => { throw new Error('not stubbed'); },
    deletePersonNote: () => { throw new Error('not stubbed'); },
    updateSavedView: () => { throw new Error('not stubbed'); },
    updateAnswer: () => { throw new Error('not stubbed'); },
    addGroceryItem: () => { throw new Error('not stubbed'); },
    setGroceryChecked: () => { throw new Error('not stubbed'); },
    removeFromGroceryList: () => { throw new Error('not stubbed'); },
    taskPatch: () => { throw new Error('not stubbed'); },
    updateTask: () => { throw new Error('not stubbed'); },
    createProjectPlan: () => { throw new Error('not stubbed'); },
    addProjectSteps: () => { throw new Error('not stubbed'); },
    moveProjectTasks: () => { throw new Error('not stubbed'); },
    updateProject: () => { throw new Error('not stubbed'); },
    stacks: () => [],
    createStack: () => { throw new Error('not stubbed'); },
    setTaskStack: () => { throw new Error('not stubbed'); },
    rewardState: () => ({ entries: [], rewards: [] }),
    addReward: () => { throw new Error('not stubbed'); },
    updateReward: () => { throw new Error('not stubbed'); },
    deleteReward: () => { throw new Error('not stubbed'); },
    claimReward: () => { throw new Error('not stubbed'); },
    unclaimReward: () => { throw new Error('not stubbed'); },
    setRewardGoal: () => { throw new Error('not stubbed'); },
    postBounty: () => { throw new Error('not stubbed'); },
    withdrawBounty: () => { throw new Error('not stubbed'); },
    markMissed: () => { throw new Error('not stubbed'); },
    markDoneByOther: () => { throw new Error('not stubbed'); },
    logSlip: () => { throw new Error('not stubbed'); },
    undoSlip: () => { throw new Error('not stubbed'); },
    recipes: () => [],
    cookbooks: () => [],
    mealPlan: () => [],
    planMeal: () => { throw new Error('not stubbed'); },
    people: () => [],
    personGroups: () => [],
    personNotes: () => [],
    personHistory: () => [],
    nextBirthday: () => null,
    addPersonHistory: () => { throw new Error('not stubbed'); },
    settings: () => ({
      dayResetTime: '00:00', weekStartsOn: 0, vacationMode: false, vacationStart: null, vacationEnd: null, vacationDrivenBy: null, waterUnit: 'ml',
      morningStart: '06:00', afternoonStart: '12:00', eveningStart: '18:00', nightStart: '21:00', activeHoursStart: '08:00', activeHoursEnd: '22:00',
      kitchenEnabled: true, simpleMode: false, rewardsEnabled: false, rewardGoalId: null, bountyLimit: 1, completedRetentionDays: null,
      calendarRequestsOn: false,
    }),
    lookAhead: () => { throw new Error('not stubbed'); },
    logicalDayKeyOf: (iso: string) => iso.slice(0, 10),
    dayKeyOf: (iso: string) => iso.slice(0, 10),
    isRealCompletion: (t: Task) => t.completed && !t.missedAt,
    describeBounty: () => null,
    onTimeSummary: () => ({ onTime: 0, total: 0, rate: 0 }),
    mostMissed: () => [],
    searchSettings: () => [],
    lastSyncedAt: () => null,
    lib: () => { throw new Error('not stubbed'); },
    allMoodLogs: () => [],
    milestones: () => [],
    addMilestone: () => { throw new Error('not stubbed'); },
    updateMilestone: () => { throw new Error('not stubbed'); },
    deleteMilestone: () => { throw new Error('not stubbed'); },
    journalEntries: () => [],
    addJournalEntry: () => { throw new Error('not stubbed'); },
    updateJournalEntry: () => { throw new Error('not stubbed'); },
    deleteJournalEntry: () => { throw new Error('not stubbed'); },
    focusHistory: () => [],
    savedViews: () => [],
    savedViewTasks: () => [],
    createSavedView: () => { throw new Error('not stubbed'); },
    deleteSavedView: () => { throw new Error('not stubbed'); },
    setVacationMode: () => { throw new Error('not stubbed'); },
    tagRegistry: () => [],
    createRecipe: () => { throw new Error('not stubbed'); },
    logFood: () => { throw new Error('not stubbed'); },
    logWater: () => { throw new Error('not stubbed'); },
    logMood: () => { throw new Error('not stubbed'); },
    logMedication: () => { throw new Error('not stubbed'); },
    ruleLists: () => ({ title: [], weather: [], event: [], health: [], screenTime: [] }),
    setRuleList: () => {},
    generatorEnabled: () => false,
    setGeneratorEnabled: () => {},
    generatorCategory: () => null,
    setGeneratorCategory: () => {},
    deleteCategory: () => { throw new Error('not used'); },
    dryRun: () => { throw new Error('not stubbed'); },
    withBatch: (_id, fn) => fn(),
    agentNotes: () => [],
    writeAgentNotes: () => {},
    deviceId: () => 'stub-device',
    syncable: () => true,
    ...over,
  };
}

const withTasks = (tasks: Task[], over: Partial<Replica> = {}) =>
  stubReplica({ tasks: () => tasks, taskById: id => tasks.find(t => t.id === id) ?? null, ...over });

describe('listTasks', () => {
  const everything = [
    task({ id: 'today-1', title: 'Due now' }),
    task({ id: 'later-1', title: 'Deferred' }),
    task({ id: 'unscheduled-1', title: 'Someday' }),
    task({ id: 'inbox-1', title: 'Untriaged' }),
  ];

  it('defaults to today', () => {
    const result = listTasks(withTasks(everything));
    expect(result.view).toBe('today');
    expect(result.tasks.map(t => t.id)).toEqual(['today-1']);
  });

  it('treats later as the leftover of the other three, not as its own predicate', () => {
    // This is the property that lets the four lenses stay disjoint without
    // tools.ts owning a fifth definition of "later".
    expect(listTasks(withTasks(everything), { view: 'later' }).tasks.map(t => t.id)).toEqual(['later-1']);
  });

  it.each(['unscheduled', 'inbox'] as const)('routes %s to its own selector', view => {
    expect(listTasks(withTasks(everything), { view }).tasks.map(t => t.id)).toEqual([`${view}-1`]);
  });

  it('excludes subtasks from every lens', () => {
    const tasks = [task({ id: 'today-1', title: 'Parent' }), task({ id: 'today-2', title: 'Step', parentId: 'today-1' })];
    expect(listTasks(withTasks(tasks), { view: 'all' }).tasks.map(t => t.id)).toEqual(['today-1']);
  });

  it('hides completed tasks unless asked', () => {
    const tasks = [task({ id: 'today-1', title: 'Open' }), task({ id: 'today-2', title: 'Done', completed: true })];
    expect(listTasks(withTasks(tasks), { view: 'all' }).tasks).toHaveLength(1);
    expect(listTasks(withTasks(tasks), { view: 'all', includeCompleted: true }).tasks).toHaveLength(2);
  });

  it('leaves archived tasks out of every lens', () => {
    // Archived is "out of every list" in the app, and an open archived row
    // would otherwise fall through the other three lenses into later.
    const tasks = [task({ id: 'later-1', title: 'Deferred' }), task({ id: 'later-2', title: 'Filed away', archived: true })];
    expect(listTasks(withTasks(tasks), { view: 'later' }).tasks.map(t => t.id)).toEqual(['later-1']);
    expect(listTasks(withTasks(tasks), { view: 'all' }).tasks.map(t => t.id)).toEqual(['later-1']);
  });

  it('filters by category, tag and project', () => {
    const tasks = [
      task({ id: 'today-1', title: 'A', category: 'Home', tags: ['errand'], projectId: 'p1' }),
      task({ id: 'today-2', title: 'B', category: 'Work', tags: ['deep'], projectId: 'p2' }),
    ];
    expect(listTasks(withTasks(tasks), { category: 'Home' }).tasks.map(t => t.id)).toEqual(['today-1']);
    expect(listTasks(withTasks(tasks), { tag: 'deep' }).tasks.map(t => t.id)).toEqual(['today-2']);
    expect(listTasks(withTasks(tasks), { projectId: 'p1' }).tasks.map(t => t.id)).toEqual(['today-1']);
  });

  it('caps the list but still reports what matched', () => {
    const many = Array.from({ length: 300 }, (_, i) => task({ id: `today-${i}`, title: `T${i}` }));
    const capped = listTasks(withTasks(many));
    expect(capped.tasks).toHaveLength(DEFAULT_LIMIT);
    // The count is what tells the caller the answer was cut, so it counts
    // matches rather than what survived the cap.
    expect(capped.matched).toBe(300);

    expect(listTasks(withTasks(many), { limit: 9999 }).tasks).toHaveLength(MAX_LIMIT);
    expect(listTasks(withTasks(many), { limit: 0 }).tasks).toHaveLength(1);
  });
});

describe('searchTasks', () => {
  it('hands the query to the replica and caps the result', () => {
    const hits = Array.from({ length: 80 }, (_, i) => ({
      task: task({ id: `t${i}`, title: `T${i}` }),
      score: 1,
      projectName: null,
    }));
    const result = searchTasks(stubReplica({ search: () => hits }), { query: 'plant' });

    expect(result.query).toBe('plant');
    expect(result.matched).toBe(80);
    expect(result.tasks).toHaveLength(DEFAULT_LIMIT);
  });
});

describe('getTask', () => {
  const parent = task({ id: 'today-1', title: 'Book haircut', projectId: 'p1', chainItems: [{ title: 'Book' }, { title: 'Go' }] as Task['chainItems'], chainIndex: 1 });
  const child = task({ id: 'today-2', title: 'Find a barber', parentId: 'today-1' });
  const project = { id: 'p1', title: 'Errands', notes: '', deadline: null, archived: false } as Project;

  it('returns null for an id that is not there', () => {
    expect(getTask(stubReplica(), 'nope')).toBeNull();
  });

  it('gathers subtasks, the chain and the project', () => {
    const result = getTask(withTasks([parent, child], { projects: () => [project] }), 'today-1')!;

    expect(result.subtasks.map(t => t.id)).toEqual(['today-2']);
    expect(result.chain).toEqual({ index: 1, steps: [{ title: 'Book' }, { title: 'Go' }] });
    expect(result.project).toEqual({ id: 'p1', title: 'Errands' });
  });

  it('says when a task is hidden and until when, and stays quiet when it is not', () => {
    expect(getTask(withTasks([parent]), 'today-1')!.hiddenUntil).toBeUndefined();

    const hidden = task({ id: 'later-1', title: 'Deferred' });
    expect(getTask(withTasks([hidden]), 'later-1')!.hiddenUntil).toBe('2099-01-01T00:00:00.000Z');
  });

  it('gives no date when nothing hiding the task is a moment, since getVisibleAt answers "now"', () => {
    // An undated task is hidden from Today but has no time to surface at.
    const undated = task({ id: 'unscheduled-1', title: 'Someday' });
    const result = getTask(withTasks([undated], { visibleAt: () => new Date() }), 'unscheduled-1')!;
    expect(result.hiddenUntil).toBeUndefined();

    const past = getTask(withTasks([undated], { visibleAt: () => new Date('2000-01-01T00:00:00.000Z') }), 'unscheduled-1')!;
    expect(past.hiddenUntil).toBeUndefined();
  });

  it('adds the per-task state a list row has no room for, and nothing for an ordinary task', () => {
    expect(getTask(withTasks([parent]), 'today-1')!.waitingOnPerson).toBeUndefined();
    expect(getTask(withTasks([parent]), 'today-1')!.onCompletion).toBeUndefined();

    const rich = task({
      id: 'rich-1', title: 'Take vitamin D', waitingOnPersonId: 'per1', followUpOn: '2026-10-09',
      linkUrl: 'https://example.com', phoneNumber: '555-0100', emailAddress: 'a@b.co', location: 'Clinic',
      streakCount: 4, streakDate: '2026-10-03', medicationName: 'Vitamin D', medicationAmount: 1000, medicationUnit: 'IU',
      logHealthMetric: 'waterMl', logHealthAmount: 250, logMealSlot: 'breakfast',
      timedMinutes: 15, healthMetric: 'steps', healthTarget: 8000, actualMinutes: 12,
      postponeCount: 3, driftingSince: '2026-09-01', postponeMuted: true,
      supplyCount: 3, supplyUnit: 'filters', supplyReorderAt: 1, rotationEnabled: true,
      rotationItems: [{ id: 'a', title: 'Portuguese' }, { id: 'b', title: 'Korean' }],
      penaltyMinutes: 30, penaltyCutoffTime: '21:00', penaltyFiredAt: '2026-10-03T21:00:00.000Z', slipCount: 2, slipDate: '2026-10-04', bountyPushes: 1, autoScheduledAt: '2026-10-01T09:00:00.000Z',
    });
    const result = getTask(withTasks([rich], { people: () => [{ id: 'per1', name: 'Gideon' } as never], describeBounty: () => '+5 extra when done.' }), 'rich-1')!;

    expect(result.waitingOnPerson).toEqual({ personId: 'per1', name: 'Gideon', followUpOn: '2026-10-09' });
    expect(result.contact).toEqual({ link: 'https://example.com', phone: '555-0100', email: 'a@b.co', location: 'Clinic' });
    expect(result.streak).toEqual({ days: 4, lastDay: '2026-10-03' });
    expect(result.onCompletion).toEqual({
      logsMedication: { name: 'Vitamin D', amount: 1000, unit: 'IU' },
      logsHealth: { metric: 'waterMl', amount: 250 },
      logsMealSlot: 'breakfast',
    });
    expect(result.timer).toEqual({ minutes: 15 });
    expect(result.healthTarget).toEqual({ metric: 'steps', target: 8000 });
    expect(result.measuredMinutes).toBe(12);
    expect(result.postponed).toEqual({ count: 3, since: '2026-09-01', muted: true });
    expect(result.supply).toEqual({ count: 3, unit: 'filters', reorderAt: 1 });
    expect(result.rotation).toEqual({ members: [{ title: 'Portuguese', doneThisWeek: false }, { title: 'Korean', doneThisWeek: false }] });
    expect(result.penalty).toEqual({ minutes: 30, cutoffTime: '21:00', chargedAt: '2026-10-03T21:00:00.000Z' });
    expect(result.slips).toEqual({ count: 2, day: '2026-10-04' });
    expect(result.bounty).toEqual({ summary: '+5 extra when done.', pushes: 1 });
    expect(result.autoScheduledAt).toBe('2026-10-01T09:00:00.000Z');
  });

  it('explains a task held by vacation mode, which has no moment to surface at', () => {
    const paused = task({ id: 'vacation-1', title: 'Water the plants', vacationPause: true });
    const result = getTask(withTasks([paused], { visibleAt: () => new Date() }), 'vacation-1')!;
    expect(result.hiddenReason).toBe('hidden while vacation mode is on');
    expect(result.hiddenUntil).toBeUndefined();
    // Visible tasks say nothing, whatever their flag.
    expect(getTask(withTasks([task({ id: 'today-1', title: 'x', vacationPause: true })]), 'today-1')!.hiddenReason).toBeUndefined();
  });

  it('shows the rules behind a recomputed deadline or reminder, a followed water target, a linked supply, and the two per-task flags', () => {
    const rich = task({
      id: 'rich-2', title: 'Pay rent', deadlineOffsetDays: 3, reminderOffsetDays: 2,
      targetCount: 8, quotaPeriod: 'day', progressCount: 2, followWaterTarget: true,
      supplyCount: 4, supplyReorderAt: 1, supplyGroceryItemId: 'g1',
      excludeFromSuggestions: true, streakRequiresWindow: true,
    });
    const result = getTask(withTasks([rich], { groceryItems: () => [{ id: 'g1', name: 'Filters' } as GroceryItem] }), 'rich-2')!;
    expect(result.deadlineRule).toEqual({ daysBeforeDate: 3 });
    expect(result.reminderRule).toEqual({ daysBeforeDate: 2 });
    expect(result.target).toMatchObject({ count: 8, followsWaterTarget: true });
    expect(result.supply).toEqual({ count: 4, reorderAt: 1, groceryItem: { id: 'g1', name: 'Filters' } });
    expect(result.excludeFromSuggestions).toBe(true);
    expect(result.streakRequiresWindow).toBe(true);

    const monthly = task({ id: 'm', title: 'Invoice', deadlineMonthDay: -1, reminderTracksVisibility: true, supplyCount: 1, supplyReorderAt: 1, supplyGroceryItemId: 'gone' });
    const r2 = getTask(withTasks([monthly]), 'm')!;
    expect(r2.deadlineRule).toEqual({ dayOfMonth: 'last' });
    expect(r2.reminderRule).toEqual({ whenItSurfaces: true });
    // A deleted catalog row is left out rather than named by id.
    expect(r2.supply).toEqual({ count: 1, reorderAt: 1 });

    const plain = getTask(withTasks([task({ id: 'p', title: 'Plain', deadline: '2026-10-10T12:00:00.000Z' })]), 'p')!;
    expect(plain.deadlineRule).toBeUndefined();
    expect(plain.reminderRule).toBeUndefined();
    expect(plain.excludeFromSuggestions).toBeUndefined();
    expect(plain.streakRequiresWindow).toBeUndefined();
  });
  it('names as waitsOn only what the replica says still holds the task back', () => {
    const blocker = task({ id: 'today-1', title: 'Pick colour' });
    const waiting = task({ id: 'blocked-1', title: 'Buy paint', blockedById: 'today-1' });
    const live = withTasks([blocker, waiting], { liveBlockers: t => (t.id === 'blocked-1' ? [blocker] : []) });
    expect(getTask(live, 'blocked-1')!.waitsOn).toEqual([{ id: 'today-1', title: 'Pick colour' }]);
    // A finished blocker holds nothing (replica.test.ts has the real rule), so
    // the field is absent rather than listing it as done.
    expect(getTask(withTasks([blocker, waiting]), 'blocked-1')!.waitsOn).toBeUndefined();
  });

});

describe('listCategories', () => {
  it('lists each category with its open tasks counted and a few named, in the user\'s order', () => {
    const result = listCategories(stubReplica({
      categories: () => [{ name: 'Home' }, { name: 'Wedding' }] as Category[],
      tasks: () => [
        task({ id: 'a', title: 'Fix the gate', category: 'Home' }),
        task({ id: 'b', title: 'Done one', category: 'Home', completed: true }),
        task({ id: 'c', title: 'Roses', category: 'Home', parentId: 'a' }),
      ],
    }));
    expect(result).toEqual([
      { name: 'Home', openTasks: 1, examples: ['Fix the gate'] },
      { name: 'Wedding', openTasks: 0 },
    ]);
  });
});

describe('listProjects', () => {
  const projects = [
    { id: 'p1', title: 'Kitchen', notes: '', deadline: null, archived: false },
    { id: 'p2', title: 'Old thing', notes: '', deadline: null, archived: true },
  ] as Project[];

  it('leaves archived projects out', () => {
    expect(listProjects(stubReplica({ projects: () => projects })).map(p => p.id)).toEqual(['p1']);
  });

  // The counting itself is the app's own projectProgress, tested against a real
  // database in replica.test.ts. What this layer owes is reporting it faithfully
  // rather than recounting rows, which is what it used to do.
  it('reports the progress the replica gives, and derives outstanding from it', () => {
    const result = listProjects(stubReplica({
      projects: () => projects,
      projectProgress: () => ({ done: 3, total: 8 }),
    }))[0];
    expect(result).toMatchObject({ done: 3, total: 8, outstanding: 5 });
  });

  it('reports the away span through the app\'s own reader, so a half-set end is left out', () => {
    const trip = { id: 'p2', title: 'Lisbon', notes: '', deadline: null, archived: false, awayStart: '2026-11-03T12:00:00.000Z', awayEnd: '2026-11-10T12:00:00.000Z', destination: 'Lisbon' } as Project;
    const halfSet = { ...trip, id: 'p3', awayEnd: '2026-11-01T12:00:00.000Z', destination: null } as Project;
    const replica = stubReplica({
      projects: () => [trip, halfSet],
      // The real awaySpanOf keeps an end only when it falls after the start.
      awaySpan: (p: Project) => (p.awayStart ? { start: new Date(p.awayStart), end: p.awayEnd && p.awayEnd > p.awayStart ? new Date(p.awayEnd) : null } : null),
    });
    const [lisbon, half] = listProjects(replica);
    expect(lisbon).toMatchObject({ awayStart: trip.awayStart, awayEnd: trip.awayEnd, destination: 'Lisbon' });
    expect(half).toMatchObject({ awayStart: trip.awayStart });
    expect(half).not.toHaveProperty('awayEnd');
    expect(half).not.toHaveProperty('destination');
  });

  it('reports a finished project as nothing outstanding', () => {
    const result = listProjects(stubReplica({
      projects: () => projects,
      projectProgress: () => ({ done: 4, total: 4 }),
    }))[0];
    expect(result.outstanding).toBe(0);
  });
});

describe('listGroceryItems', () => {
  const items = [
    { id: 'g1', name: 'Milk', quantity: '2L', aisle: 'Dairy', onList: true, checked: false },
    { id: 'g2', name: 'Paprika', quantity: null, aisle: '', onList: false, checked: false },
  ] as GroceryItem[];
  const entry = (itemId: string, listId: string | null, checked = false): GroceryListEntry =>
    ({ itemId, listId, checked, sortOrder: 0, choiceGroup: null, addedAt: '' });
  const entries = [entry('g1', null)];

  it('shows the list by default and the catalog on request', () => {
    const replica = stubReplica({ groceryItems: () => items, groceryListEntries: () => entries });
    expect(listGroceryItems(replica).map(i => i.id)).toEqual(['g1']);
    expect(listGroceryItems(replica, { onListOnly: false }).map(i => i.id)).toEqual(['g1', 'g2']);
  });

  it('drops empty strings rather than reporting them', () => {
    const [, catalog] = listGroceryItems(
      stubReplica({ groceryItems: () => items, groceryListEntries: () => entries }),
      { onListOnly: false }
    );
    expect(catalog.quantity).toBeUndefined();
    expect(catalog.aisle).toBeUndefined();
  });

  // check_off and remove act on the home list, so the read has to describe
  // that list. The item row's onList is "in any trolley", which folded a
  // trip's list into this one and then had check-off refuse what it listed.
  it('reports the home list with its ticks, leaving out a row only on another list', () => {
    const rows = [
      { id: 'g1', name: 'Milk', onList: true, checked: false },
      { id: 'g3', name: 'Sunscreen', onList: true, checked: false },
      { id: 'g4', name: 'Bread', onList: true, checked: false },
    ] as GroceryItem[];
    const replica = stubReplica({
      groceryItems: () => rows,
      groceryListEntries: () => [entry('g1', null, true), entry('g3', 'airbnb', true), entry('g4', null), entry('g4', 'airbnb', true)],
    });

    expect(listGroceryItems(replica)).toEqual([
      { id: 'g1', name: 'Milk', onList: true, checked: true },
      { id: 'g4', name: 'Bread', onList: true },
    ]);
    const catalog = listGroceryItems(replica, { onListOnly: false });
    expect(catalog.find(i => i.id === 'g3')).toEqual({ id: 'g3', name: 'Sunscreen', onList: false });
  });

  it('describes a write\'s result by the home list too', () => {
    const milk = { id: 'g1', name: 'Milk', onList: true, checked: false } as GroceryItem;
    const replica = stubReplica({
      groceryListEntries: () => [entry('g1', null, true)],
      setGroceryChecked: () => milk,
      removeFromGroceryList: () => milk,
    });
    expect(setGroceryChecked(replica, 'g1', true).item).toEqual({ id: 'g1', name: 'Milk', onList: true, checked: true });

    // Still on a trip's list after leaving the one at home.
    const after = stubReplica({
      groceryListEntries: () => [entry('g1', 'airbnb')],
      removeFromGroceryList: () => milk,
    });
    expect(removeFromGroceryList(after, 'g1').item.onList).toBe(false);
  });
});

describe('resolveRange', () => {
  it('counts days back from today, with today inside the count', () => {
    // 7 days means today and the six before it, not today and seven before it.
    expect(resolveRange(stubReplica())).toEqual({ from: '2026-09-05', to: '2026-09-11' });
    expect(resolveRange(stubReplica(), { days: 1 })).toEqual({ from: '2026-09-11', to: '2026-09-11' });
    expect(DEFAULT_LOG_DAYS).toBe(7);
  });

  it('lets an explicit from win, and defaults its end to today', () => {
    expect(resolveRange(stubReplica(), { from: '2026-01-01' })).toEqual({
      from: '2026-01-01',
      to: '2026-09-11',
    });
    expect(resolveRange(stubReplica(), { from: '2026-01-01', to: '2026-01-31' })).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    });
    // `days` is ignored rather than combined, so the two can't disagree.
    expect(resolveRange(stubReplica(), { from: '2026-01-01', days: 3 }).from).toBe('2026-01-01');
  });

  it('clamps the day count at both ends', () => {
    expect(resolveRange(stubReplica(), { days: 0 }).from).toBe('2026-09-11');
    expect(resolveRange(stubReplica(), { days: 99999 }).from).toBe(
      resolveRange(stubReplica(), { days: MAX_LOG_DAYS }).from
    );
  });
});

describe('listFoodLog', () => {
  const entry = (over: Partial<FoodLogEntry> & { id: string; label: string }): FoodLogEntry =>
    ({
      dayKey: '2026-09-11',
      atISO: '2026-09-11T08:00:00.000Z',
      slot: null,
      quantity: '',
      grams: null,
      recipeId: null,
      ...over,
    }) as FoodLogEntry;

  it('reports the range it actually read, alongside the entries', () => {
    const result = listFoodLog(
      stubReplica({ foodLogEntries: () => [entry({ id: 'f1', label: 'Porridge', slot: 'breakfast' })] })
    );
    expect(result.range).toEqual({ from: '2026-09-05', to: '2026-09-11' });
    expect(result.entries).toEqual([
      { id: 'f1', dayKey: '2026-09-11', at: '2026-09-11T08:00:00.000Z', slot: 'breakfast', label: 'Porridge' },
    ]);
  });

  it('estimates vegetable and fruit servings per day, and says what it could not weigh', () => {
    const result = listFoodLog(
      stubReplica({
        foodLogEntries: () => [
          entry({ id: 'f1', label: 'Carrots' }),
          entry({ id: 'f3', label: 'Broccoli', dayKey: '2026-09-10' }),
        ],
        foodProduce: () => [
          { dayKey: '2026-09-10', vegetable: 0, fruit: 0, unmeasured: 1 },
          { dayKey: '2026-09-11', vegetable: 2.2, fruit: 1.4, unmeasured: 0 },
        ],
      })
    );
    expect(result.produce).toEqual([
      { dayKey: '2026-09-10', vegetable: 0, fruit: 0, unmeasured: 1 },
      { dayKey: '2026-09-11', vegetable: 2, fruit: 1.5, unmeasured: 0 },
    ]);
  });

  it('passes totals through without filling in a nutrient nobody logged', () => {
    const result = listFoodLog(
      stubReplica({
        foodLogEntries: () => [entry({ id: 'f1', label: 'Toast' })],
        foodTotals: () => ({ total: { calorieKcal: 210 }, reported: { calorieKcal: 1 }, entries: 1 }),
      })
    );
    // A day logged thinly is a hole, not a small number, so protein is absent
    // rather than 0 — that distinction is the whole reason totals carry
    // `reported` alongside `total`.
    expect(result.totals.total).toEqual({ calorieKcal: 210 });
    expect(result.totals.total.proteinG).toBeUndefined();
    expect(result.totals.reported).toEqual({ calorieKcal: 1 });
  });
});

describe('listMoodLogs', () => {
  const log = (over: Partial<MoodLog> & { id: string }): MoodLog =>
    ({
      dayKey: '2026-09-11',
      loggedAt: '2026-09-11T09:00:00.000Z',
      mood: null,
      symptoms: [],
      contextTags: [],
      note: null,
      dream: null,
      ...over,
    }) as MoodLog;

  it('keeps a check-in that recorded only symptoms', () => {
    const result = listMoodLogs(
      stubReplica({
        moodLogs: () => [log({ id: 'm1', symptoms: [{ name: 'Headache', severity: 2 }] as MoodLog['symptoms'] })],
      })
    );
    // mood is nullable on purpose: somebody can log a symptom without rating
    // the day, and reporting that as a 0 would invent a rating.
    expect(result.logs[0].mood).toBeUndefined();
    expect(result.logs[0].symptoms).toEqual([{ name: 'Headache', severity: '2' }]);
  });

  it('drops empty symptom and tag lists rather than sending them', () => {
    const result = listMoodLogs(stubReplica({ moodLogs: () => [log({ id: 'm1', mood: 4 })] }));
    expect(result.logs[0]).toEqual({
      id: 'm1',
      dayKey: '2026-09-11',
      loggedAt: '2026-09-11T09:00:00.000Z',
      mood: 4,
    });
  });
});

describe('listMedicationLogs', () => {
  const dose = (over: Partial<MedicationLog> & { id: string; name: string }): MedicationLog =>
    ({
      dayKey: '2026-09-11',
      takenAt: '2026-09-11T20:00:00.000Z',
      amount: null,
      unit: null,
      asNeeded: false,
      ...over,
    }) as MedicationLog;

  it("uses the app's own one-line rendering rather than rebuilding it", () => {
    const result = listMedicationLogs(
      stubReplica({
        medicationLogs: () => [dose({ id: 'd1', name: 'Ibuprofen', amount: 400, unit: 'mg', asNeeded: true })],
        medicationSummary: () => 'Ibuprofen · 400 mg · as needed',
      })
    );
    expect(result.logs[0].summary).toBe('Ibuprofen · 400 mg · as needed');
    expect(result.logs[0]).toMatchObject({ amount: 400, unit: 'mg', asNeeded: true });
  });

  it('omits asNeeded when a dose was scheduled', () => {
    const result = listMedicationLogs(
      stubReplica({ medicationLogs: () => [dose({ id: 'd1', name: 'Levothyroxine' })] })
    );
    expect(result.logs[0].asNeeded).toBeUndefined();
  });
});

describe('serializeTask', () => {
  it('drops nulls and empty arrays rather than serializing them', () => {
    const result = serializeTask(stubReplica(), task({ id: 't', title: 'Bare' }));
    expect(result).toEqual({ id: 't', title: 'Bare', completed: false });
  });

  it('names the priority rather than emitting its number, and omits None', () => {
    expect(serializeTask(stubReplica(), task({ id: 't', title: 'A', priority: 4 })).priority).toBe('Urgent');
    expect(serializeTask(stubReplica(), task({ id: 't', title: 'A', priority: 0 })).priority).toBeUndefined();
  });

  it('takes the title from the live chain step, not from the task', () => {
    const chained = task({
      id: 't',
      title: 'Haircut',
      chainItems: [{ title: 'Book' }, { title: 'Go' }] as Task['chainItems'],
      chainIndex: 1,
    });
    const replica = stubReplica({ displayTitle: () => 'Go' });

    expect(serializeTask(replica, chained)).toMatchObject({ title: 'Go', chainStep: 'Go' });
  });

  it('says a missed occurrence is missed rather than letting completed read as done', () => {
    const missed = serializeTask(stubReplica(), task({ id: 't', title: 'Run', completed: true, missedAt: '2026-10-02T00:00:00.000Z' }));
    expect(missed).toMatchObject({ completed: true, missed: true });
    expect(serializeTask(stubReplica(), task({ id: 't', title: 'Run', completed: true })).missed).toBeUndefined();
  });

  it('marks a task the app wrote unasked, and a repeat that pins each occurrence', () => {
    expect(serializeTask(stubReplica(), task({ id: 't', title: 'Sunscreen', generatedKind: 'weather' })).generatedBy).toBe('weather');
    expect(serializeTask(stubReplica(), task({ id: 't', title: 'A', pinEachOccurrence: true })).pinsEachOccurrence).toBe(true);
  });

  it('does not call a single-item chain a chain', () => {
    const one = task({ id: 't', title: 'Solo', chainItems: [{ title: 'Solo' }] as Task['chainItems'] });
    expect(serializeTask(stubReplica(), one).chainStep).toBeUndefined();
  });

  it('names the people a task is about, keeps a series id, and says when a task hides on vacation', () => {
    const people = [{ id: 'per1', name: 'Gideon Reyes', nickname: 'Gid' }, { id: 'per2', name: 'Mom', nickname: '' }] as never[];
    const r = stubReplica({ people: () => people });
    const t = serializeTask(r, task({ id: 'a', title: 'Call', personIds: ['per1', 'per2', 'gone'], seriesId: 's1', vacationPause: true }));
    // The nickname where there is one, the name otherwise, and an id with no
    // person behind it dropped rather than reported nameless.
    expect(t.people).toEqual([{ id: 'per1', name: 'Gid' }, { id: 'per2', name: 'Mom' }]);
    expect(t.seriesId).toBe('s1');
    expect(t.vacationPause).toBe(true);

    const plain = serializeTask(r, task({ id: 'b', title: 'Plain', personIds: [], seriesId: null, vacationPause: false }));
    expect(plain).not.toHaveProperty('people');
    expect(plain).not.toHaveProperty('seriesId');
    expect(plain).not.toHaveProperty('vacationPause');
  });

  it('reports blocked separately from merely not being due', () => {
    expect(serializeTask(stubReplica(), task({ id: 'blocked-1', title: 'Waiting' })).blocked).toBe(true);
    expect(serializeTask(stubReplica(), task({ id: 'today-1', title: 'Free' })).blocked).toBeUndefined();
  });
});

describe('createTask and updateTask', () => {
  it('scales a new weekly target\'s first week unless asked for the full count', () => {
    const created = task({ id: 'today-new', title: 'Run' });
    const scaleFirstWeek = jest.fn();
    const r = withTasks([created], { taskPatch: () => ({}), createTask: () => created, scaleFirstWeek });
    createTask(r, { title: 'Run', target: { count: 3, per: 'week' } });
    createTask(r, { title: 'Run', target: { count: 3, per: 'week', firstWeek: 'full' } });
    createTask(r, { title: 'Water', target: { count: 8, per: 'day' } });
    expect(scaleFirstWeek).toHaveBeenCalledTimes(1);
    expect(scaleFirstWeek).toHaveBeenCalledWith('today-new');
  });

  it('refuses a subtask of a task that does not exist, before writing anything', () => {
    const r = stubReplica({ taskPatch: () => ({}) });
    expect(() => createTask(r, { title: 'Child', parentId: 'nope' })).toThrow(/No task with id nope/);
  });

  it('refuses an edit that changes nothing, and an unknown task', () => {
    const existing = task({ id: 'today-1', title: 'Here' });
    const r = withTasks([existing], { taskPatch: () => ({}) });
    expect(() => updateTask(r, 'today-1', {})).toThrow(/Nothing to change/);
    expect(() => updateTask(r, 'nope', { notes: 'x' })).toThrow(/No task/);
  });

  it('says how many later dates of a series took the edit', () => {
    const existing = task({ id: 'today-1', title: 'Here' });
    const r = withTasks([existing], {
      taskPatch: () => ({ notes: 'x' }),
      updateTask: () => ({ task: existing, alsoUpdated: 2 }),
    });
    expect(updateTask(r, 'today-1', { notes: 'x' }).alsoUpdatedLaterDates).toBe(2);
  });

  it('says when a fixed deadline replaced the rule that recomputed it, and only then', () => {
    const relative = task({ id: 'today-1', title: 'Rent', deadlineOffsetDays: 3 });
    const cleared = { deadline: '2026-10-10T12:00:00.000Z', deadlineOffsetDays: null, deadlineMonthDay: null } as Partial<Task>;
    const r = withTasks([relative], {
      taskPatch: () => cleared,
      updateTask: () => ({ task: { ...relative, ...cleared } as Task, alsoUpdated: 0 }),
    });
    expect(updateTask(r, 'today-1', { deadline: '2026-10-10' }).deadlineRuleCleared).toMatch(/fixed date given/);

    const dropped = { deadline: null, deadlineOffsetDays: null, deadlineMonthDay: null } as Partial<Task>;
    const r2 = withTasks([relative], { taskPatch: () => dropped, updateTask: () => ({ task: { ...relative, ...dropped } as Task, alsoUpdated: 0 }) });
    expect(updateTask(r2, 'today-1', { deadline: null }).deadlineRuleCleared).toMatch(/no deadline either/);

    // A fixed deadline that was already fixed says nothing.
    const fixed = task({ id: 'today-2', title: 'Taxes', deadline: '2026-04-15T12:00:00.000Z' });
    const r3 = withTasks([fixed], { taskPatch: () => ({ deadline: '2026-04-20T12:00:00.000Z' }), updateTask: () => ({ task: fixed, alsoUpdated: 0 }) });
    expect(updateTask(r3, 'today-2', { deadline: '2026-04-20' })).not.toHaveProperty('deadlineRuleCleared');
  });
});
