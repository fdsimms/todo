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
  unused_features: 'Features you might not be using',
  habit_patterns: 'How habits are going',
  mood_insights: 'Mood insights',
  plan_day: 'Plan the day',
  list_automations: 'List automations',
  list_categories: 'List categories',
  rebalance_week: 'Rebalance the week',
  list_tasks: 'List tasks',
  search_tasks: 'Search tasks',
  get_task: 'Task details',
  list_projects: 'List projects',
  get_project: 'Project details',
  next_in_project: 'Next step in a project',
  preview_change: 'Preview a change',
  list_stacks: 'List stacks',
  get_rewards: 'Coins and rewards',
  list_grocery_items: 'Grocery list',
  grocery_setup: 'Aisles, stores and lists',
  get_grocery_item: 'Grocery item details',
  match_receipt: 'Match a receipt to the catalog',
  focus_history: 'Focus session history',
  list_milestones: 'Milestones',
  list_saved_views: 'Saved views',
  get_saved_view: 'One saved view',
  list_pantry: 'What is in the pantry',
  get_pantry_item: 'Pantry details for one item',
  pantry_review: 'Pantry items in doubt',
  use_up_recipes: 'What to use up, and what to cook with it',
  list_food_log: 'Food log',
  list_mood_logs: 'Mood log',
  list_journal_entries: 'Journal and dreams',
  list_calendar_requests: 'Calendar requests',
  list_medication_logs: 'Medication log',
  list_templates: 'List templates',
  get_template: 'Read a template',
  template_library_check: 'Check all templates',
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
  update_recipe: { title: 'Change a recipe', destructive: true, idempotent: true },
  delete_recipe: { title: 'Delete a recipe', destructive: true, idempotent: true },
  save_recipe: { title: 'Save a recipe', destructive: false, idempotent: false },
  set_automation: { title: 'Change an automation', destructive: false, idempotent: true },
  delete_category: { title: 'Delete a category', destructive: true, idempotent: false },
  save_rule: { title: 'Save an automation rule', destructive: true, idempotent: false },
  delete_rule: { title: 'Delete an automation rule', destructive: true, idempotent: true },
  log_food: { title: 'Log food', destructive: false, idempotent: false },
  log_water: { title: 'Log water', destructive: false, idempotent: false },
  add_milestone: { title: 'Add a milestone', destructive: false, idempotent: false },
  update_milestone: { title: 'Change a milestone', destructive: true, idempotent: true },
  delete_milestone: { title: 'Delete a milestone', destructive: true, idempotent: true },
  log_journal_entry: { title: 'Write a journal entry or dream', destructive: false, idempotent: false },
  update_journal_entry: { title: 'Change a journal entry or dream', destructive: true, idempotent: true },
  delete_journal_entry: { title: 'Delete a journal entry or dream', destructive: true, idempotent: true },
  create_saved_view: { title: 'Create a saved view', destructive: false, idempotent: false },
  delete_saved_view: { title: 'Delete a saved view', destructive: true, idempotent: true },
  set_vacation_mode: { title: 'Turn vacation mode on or off', destructive: false, idempotent: true },
  log_mood: { title: 'Log a mood check-in', destructive: false, idempotent: false },
  request_calendar_event: { title: 'Ask the phone to add a calendar event', destructive: false, idempotent: false },
  cancel_calendar_request: { title: 'Cancel a calendar request', destructive: false, idempotent: true },
  update_food_entry: { title: 'Correct a food entry', destructive: true, idempotent: true },
  delete_food_entry: { title: 'Delete a food entry', destructive: true, idempotent: true },
  update_mood_log: { title: 'Correct a mood check-in', destructive: true, idempotent: true },
  delete_mood_log: { title: 'Delete a mood check-in', destructive: true, idempotent: true },
  update_medication_log: { title: 'Correct a dose', destructive: true, idempotent: true },
  delete_medication_log: { title: 'Delete a dose', destructive: true, idempotent: true },
  log_medication: { title: 'Log a dose', destructive: false, idempotent: false },
  forget: { title: 'Forget a note', destructive: true, idempotent: true },
  update_task: { title: 'Edit a task', destructive: true, idempotent: true },
  archive_task: { title: 'Archive a task', destructive: true, idempotent: true },
  reopen_task: { title: 'Reopen a task', destructive: true, idempotent: true },
  update_answer: { title: 'Correct a recorded answer', destructive: true, idempotent: true },
  add_project_steps: { title: 'Add steps to a project', destructive: false, idempotent: false },
  complete_task: { title: 'Complete a task', destructive: false, idempotent: false },
  mark_done_by_other: { title: 'Mark a task done by someone else', destructive: false, idempotent: false },
  defer_task: { title: 'Reschedule a task', destructive: false, idempotent: true },
  create_project: { title: 'Create a project', destructive: false, idempotent: false },
  update_project: { title: 'Edit a project', destructive: true, idempotent: true },
  create_stack: { title: 'Create a stack', destructive: false, idempotent: false },
  rename_stack: { title: 'Rename a stack', destructive: true, idempotent: true },
  assign_to_stack: { title: 'File tasks in a stack', destructive: true, idempotent: true },
  create_reward: { title: 'Add a reward', destructive: false, idempotent: false },
  update_reward: { title: 'Change a reward', destructive: true, idempotent: true },
  delete_reward: { title: 'Delete a reward', destructive: true, idempotent: true },
  claim_reward: { title: 'Claim a reward', destructive: true, idempotent: false },
  unclaim_reward: { title: 'Take back a claim', destructive: true, idempotent: true },
  set_reward_goal: { title: 'Choose the reward to save for', destructive: false, idempotent: true },
  set_bounty: { title: 'Post or withdraw a bounty', destructive: true, idempotent: true },
  mark_missed: { title: 'Mark a task missed', destructive: true, idempotent: false },
  log_slip: { title: 'Log a slip', destructive: true, idempotent: false },
  undo_slip: { title: 'Undo a slip', destructive: true, idempotent: true },
  create_template: { title: 'Create a template', destructive: false, idempotent: false },
  update_template: { title: 'Edit a template', destructive: true, idempotent: true },
  apply_template: { title: 'Run a template', destructive: false, idempotent: false },
  delete_template: { title: 'Delete a template', destructive: true, idempotent: true },
  reorder_templates: { title: 'Reorder templates', destructive: true, idempotent: true },
  update_meal: { title: 'Change a planned meal', destructive: true, idempotent: true },
  remove_meal: { title: 'Remove a planned meal', destructive: true, idempotent: true },
  plan_meal: { title: 'Plan a meal', destructive: false, idempotent: false },
  create_person: { title: 'Add a person', destructive: false, idempotent: false },
  update_person: { title: 'Change a person', destructive: true, idempotent: true },
  add_person_history: { title: 'Record time with someone', destructive: false, idempotent: false },
  add_grocery_item: { title: 'Add to the grocery list', destructive: false, idempotent: false },
  check_off_grocery_item: { title: 'Check off a grocery item', destructive: false, idempotent: true },
  remove_from_grocery_list: { title: 'Remove from the grocery list', destructive: false, idempotent: true },
  update_pantry_item: { title: 'Change what is in the pantry', destructive: true, idempotent: true },
  update_pantry_box: { title: 'Change one packet in the pantry', destructive: true, idempotent: true },
  add_to_pantry: { title: 'Add to the pantry', destructive: false, idempotent: true },
  answer_pantry_review: { title: 'Answer the pantry review', destructive: true, idempotent: true },
  update_grocery_item: { title: 'Edit a grocery item', destructive: true, idempotent: true },
  save_grocery_box: { title: 'Edit a brand of an item', destructive: true, idempotent: false },
  save_store: { title: 'Add or edit a store', destructive: false, idempotent: false },
  delete_grocery_item: { title: 'Delete a grocery item', destructive: true, idempotent: true },
  create_grocery_list: { title: 'Create a separate list', destructive: false, idempotent: false },
  rename_grocery_list: { title: 'Rename a separate list', destructive: true, idempotent: true },
  delete_grocery_list: { title: 'Delete a separate list', destructive: true, idempotent: true },
  finish_grocery_trip: { title: 'Finish a shopping trip', destructive: true, idempotent: false },
  import_receipt: { title: 'Import a receipt', destructive: true, idempotent: false },
  log_leftover: { title: 'Log a leftover', destructive: false, idempotent: false },
  update_leftover: { title: 'Change a leftover', destructive: true, idempotent: true },
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
