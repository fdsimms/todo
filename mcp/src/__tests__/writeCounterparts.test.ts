/**
 * Every tool that creates something has a way to correct it, or a stated reason
 * it does not.
 *
 * `create_template` shipped with no edit, delete or reorder, and the log tools
 * with no way to fix an entry, because a create tool is the natural first thing
 * to build and nothing asks what happens after a mistake. This makes the
 * question a thing the build asks: a new creating tool (named create_*, log_*,
 * save_*, plan_*, add_* or quick_add) fails this suite until it is listed here
 * with the tools that correct it, or under `NO_COUNTERPART` with why not.
 *
 * "Corrects" is loose on purpose: an edit, an undo (archive, reopen) or a
 * delete all count, since which one is right depends on the thing. What is not
 * allowed is the entry being absent.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const server = readFileSync(join(__dirname, '..', 'server.ts'), 'utf8');
const toolNames = [...server.matchAll(/server\.tool\(\s*'([a-z_]+)'/g)].map(m => m[1]);

const CREATING = /^(create|log|save|plan|add)_|^quick_add$/;

/** A creating tool, and the tools that put right what it made. */
const COUNTERPARTS: Record<string, string[]> = {
  create_task: ['update_task', 'archive_task', 'reopen_task'],
  quick_add: ['update_task', 'archive_task'],
  add_project_steps: ['update_task', 'archive_task'],
  create_project: ['update_project', 'update_task'],
  create_stack: ['rename_stack', 'assign_to_stack'],
  create_reward: ['update_reward', 'delete_reward'],
  log_slip: ['undo_slip'],
  create_template: ['update_template', 'delete_template', 'reorder_templates'],
  create_person: ['update_person'],
  log_food: ['update_food_entry', 'delete_food_entry'],
  log_mood: ['update_mood_log', 'delete_mood_log'],
  request_calendar_event: ['cancel_calendar_request'],
  log_medication: ['update_medication_log', 'delete_medication_log'],
  plan_meal: ['update_meal', 'remove_meal'],
  add_grocery_item: ['remove_from_grocery_list', 'check_off_grocery_item'],
  add_to_pantry: ['update_pantry_item'],
  save_rule: ['delete_rule'],
  save_recipe: ['update_recipe', 'delete_recipe'],
  add_person_history: ['reopen_task', 'archive_task'],
};

/** Creating tools with no counterpart, and why that is the right answer or a known gap. */
const NO_COUNTERPART: Record<string, string> = {
  plan_day: 'Proposes an order and writes nothing, so there is nothing to put right.',
};

describe('creating tools and their counterparts', () => {
  const creating = toolNames.filter(n => CREATING.test(n));

  it('finds the tools', () => {
    expect(toolNames.length).toBeGreaterThan(50);
    expect(creating).toContain('create_template');
  });

  it('has a decision for every creating tool', () => {
    const undecided = creating.filter(n => !(n in COUNTERPARTS) && !(n in NO_COUNTERPART));
    expect(undecided).toEqual([]);
  });

  it('names counterparts that exist', () => {
    const missing = Object.entries(COUNTERPARTS).flatMap(([creator, others]) =>
      others.filter(o => !toolNames.includes(o)).map(o => `${creator} -> ${o}`));
    expect(missing).toEqual([]);
  });

  it('lists nothing that is not a tool, or in both tables', () => {
    const stale = [...Object.keys(COUNTERPARTS), ...Object.keys(NO_COUNTERPART)].filter(n => !toolNames.includes(n));
    const both = Object.keys(COUNTERPARTS).filter(n => n in NO_COUNTERPART);
    expect({ stale, both }).toEqual({ stale: [], both: [] });
  });
});
