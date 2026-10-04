/**
 * The MCP annotations every tool carries: a human title, and whether it reads,
 * writes, or writes something hard to take back.
 *
 * Clients act on these. The Claude apps decide from `readOnlyHint` whether a
 * call needs the person's approval, so a read left unannotated asks permission
 * to look at a task list, and a write marked read-only would run without asking.
 * That second mistake is the one that matters, which is why the default for a
 * name missing from the table is to claim nothing: the protocol reads an
 * absent `readOnlyHint` as "may write".
 *
 * A table here rather than an argument at each `server.tool` call so the whole
 * classification is one screen, and so `toolAnnotations.test.ts` can hold it
 * against the list of write tools without the SDK.
 *
 * `openWorldHint` is false throughout: every tool acts on the person's own
 * replica and nothing else.
 */
export interface ToolAnnotationSet {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Reads. Safe to call freely; none of them changes anything. */
export const READ_TOOLS: Record<string, string> = {
  get_overview: 'Overview of the app',
  get_agenda: 'Agenda for the coming days',
  completion_history: 'What got done',
  review_tasks: 'Tasks worth a second look',
  app_help: 'How the app works',
  habit_patterns: 'How habits are going',
  mood_insights: 'Mood insights',
  plan_day: 'Plan the day',
  list_automations: 'List automations',
  rebalance_week: 'Rebalance the week',
  list_tasks: 'List tasks',
  search_tasks: 'Search tasks',
  get_task: 'Task details',
  list_projects: 'List projects',
  get_project: 'Project details',
  list_grocery_items: 'Grocery list',
  list_food_log: 'Food log',
  list_mood_logs: 'Mood log',
  list_medication_logs: 'Medication log',
  list_templates: 'List templates',
  list_recipes: 'List recipes',
  get_recipe: 'Recipe details',
  list_meal_plan: 'Meal plan',
  list_people: 'List people',
  get_person: 'Person details',
  upcoming_birthdays: 'Upcoming birthdays',
};

/**
 * Writes, and how each behaves. `destructive` is for a write that overwrites
 * what the person set (an edit, an archive); adding a row or ticking one off is
 * not, since both are a tap to reverse in the app. `idempotent` is for a call
 * that lands in the same state however many times it is repeated, which tells a
 * client a retry after a timeout is safe.
 */
export const WRITE_TOOLS: Record<string, { title: string; destructive: boolean; idempotent: boolean }> = {
  create_task: { title: 'Create a task', destructive: false, idempotent: false },
  batch_update_tasks: { title: 'Change several tasks', destructive: true, idempotent: false },
  quick_add: { title: 'Quick add tasks', destructive: false, idempotent: false },
  remember: { title: 'Remember a note', destructive: false, idempotent: true },
  save_recipe: { title: 'Save a recipe', destructive: false, idempotent: false },
  set_automation: { title: 'Turn an automation on or off', destructive: false, idempotent: true },
  save_rule: { title: 'Save an automation rule', destructive: true, idempotent: false },
  delete_rule: { title: 'Delete an automation rule', destructive: true, idempotent: true },
  log_food: { title: 'Log food', destructive: false, idempotent: false },
  log_mood: { title: 'Log a mood check-in', destructive: false, idempotent: false },
  log_medication: { title: 'Log a dose', destructive: false, idempotent: false },
  forget: { title: 'Forget a note', destructive: true, idempotent: true },
  update_task: { title: 'Edit a task', destructive: true, idempotent: true },
  complete_task: { title: 'Complete a task', destructive: false, idempotent: false },
  defer_task: { title: 'Reschedule a task', destructive: false, idempotent: true },
  create_project: { title: 'Create a project', destructive: false, idempotent: false },
  update_project: { title: 'Edit a project', destructive: true, idempotent: true },
  create_template: { title: 'Create a template', destructive: false, idempotent: false },
  plan_meal: { title: 'Plan a meal', destructive: false, idempotent: false },
  add_person_history: { title: 'Record time with someone', destructive: false, idempotent: false },
  add_grocery_item: { title: 'Add to the grocery list', destructive: false, idempotent: false },
  check_off_grocery_item: { title: 'Check off a grocery item', destructive: false, idempotent: true },
  remove_from_grocery_list: { title: 'Remove from the grocery list', destructive: false, idempotent: true },
};

export function annotationsFor(name: string): ToolAnnotationSet {
  const read = READ_TOOLS[name];
  if (read) return { title: read, readOnlyHint: true, openWorldHint: false };
  const write = WRITE_TOOLS[name];
  if (write) {
    return {
      title: write.title,
      readOnlyHint: false,
      destructiveHint: write.destructive,
      idempotentHint: write.idempotent,
      openWorldHint: false,
    };
  }
  return {};
}
