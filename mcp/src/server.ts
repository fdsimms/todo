/**
 * The MCP server: SDK wiring, an HTTP listener, and nothing else.
 *
 * **Every decision worth testing lives somewhere other than this file.** The
 * lenses are in tools.ts, the projection in serialize.ts, the token check in
 * auth.ts, the db layer in replica.ts, and all four run under the repo's own
 * jest. What is left here is the part that cannot: the SDK's transport, an
 * Express app, and the mapping between the two. It is the one file in `mcp/`
 * excluded from the root `tsc --noEmit` (see the root tsconfig.json), because
 * it is the one file importing packages that only exist in `mcp/node_modules`.
 *
 * Keep it that way. A conditional that ends up in here is a conditional nothing
 * in CI is looking at.
 *
 * Transport is Streamable HTTP rather than stdio because the destination is a
 * hosted server that Claude reaches over the internet — a stdio server is
 * launched as a subprocess by a desktop client and can never be reached from a
 * phone. docs/arch/mcp-server.md has the reasoning.
 */
import express, { type Request, type Response } from 'express';
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import {
  InvalidGrantError,
  InvalidRequestError,
  InvalidTargetError,
  InvalidTokenError,
  type OAuthError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';

import { authorize, bearerToken, scopeFor, type AuthScope } from './auth';
import { oauthConfigProblem, openOAuthStore, OAuthRefusal, SCOPE_READ, SCOPE_WRITE, type OAuthClient, type OAuthStore } from './oauth';
import { installExpoSqliteShim, openReplica, type Replica } from './replica';
import { openSyncStore, DEFAULT_RETENTION_DAYS, type SyncStore } from './syncStore';
import { createSyncGate, READ_WAIT_MS, type SyncGate } from './syncGate';
import {
  MAX_LOG_DAYS,
  TASK_VIEWS,
  getTask,
  listFoodLog,
  listGroceryItems,
  listMedicationLogs,
  listMoodLogs,
  createTask,
  updateTask,
  createTemplate,
  completeTask,
  updateAnswer,
  deferTask,
  archiveTask,
  addGroceryItem,
  setGroceryChecked,
  removeFromGroceryList,
  listProjects,
  listCategories,
  listTasks,
  listTemplates,
  searchTasks,
} from './tools';
import {
  DELIVERABLE_KINDS,
  REPEAT_EVERY,
  STEP_QUESTION_KINDS,
  TIME_SEGMENTS,
  type RepeatEvery,
  type TaskFieldsInput,
} from './taskFields';
import type { DeliverableKind, MealSlot, TimeOfDay } from '../../src/types';
import { addProjectSteps, createProject, getProject, updateProject, type CreateProjectInput, type ProjectPlanStepInput } from './projectTools';
import { DEFAULT_PLAN_DAYS, MAX_PLAN_DAYS, MEAL_SLOTS as KITCHEN_MEAL_SLOTS, getRecipe, listMealPlan, listRecipes, planMeal } from './kitchenTools';
import { DEFAULT_BIRTHDAY_DAYS, MAX_BIRTHDAY_DAYS, addPersonHistory, getPerson, listPeople, upcomingBirthdays } from './peopleTools';
import { appLinks, appSiteAssociation, appUrlForOpenPath, openPage } from './appLinks';
import { ANCHORS, CONTAINERS, QUESTION_KINDS, QUESTION_SOURCES, SCHEDULE_FREQUENCIES } from './templatePlan';
import { DEFAULT_AGENDA_DAYS, DEFAULT_HISTORY_DAYS, DEFAULT_STALE_DAYS, MAX_AGENDA_DAYS, completionHistory, getAgenda, getOverview, reviewTasks } from './insightTools';
import { DEFAULT_HELP_LIMIT, appHelp } from './helpTools';
import { SERVER_INSTRUCTIONS } from './instructions';
import { annotationsFor } from './toolAnnotations';
import { createConfirmTokens, describeEffects, type ConfirmTokens } from './confirmWrites';
import type { AgentLedgerEntry } from './agentLedger';
import { PROMPTS } from './prompts';
import { forget, remember } from './memoryTools';
import { deleteRule, listAutomations, saveRule, setAutomation, RULE_TYPES } from './automationTools';
import { NUTRIENT_KEY_LIST, logFood, logMedication, logMood, saveRecipe } from './logTools';
import { DEFAULT_PATTERN_DAYS, habitPatterns, moodInsights } from './patternTools';
import { MAX_BATCH, MAX_QUICK_ADD, batchUpdateTasks, planDay, quickAdd, rebalanceWeek, type BatchChange } from './agentTools';

/** `YYYY-MM-DD`, the shape every day-keyed table stores and sorts on. */
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.');

const logRange = {
  days: z.number().int().positive().max(MAX_LOG_DAYS).optional(),
  from: dayKey.optional(),
  to: dayKey.optional(),
};

const PORT = Number(process.env.PORT ?? 8787);

/**
 * How long a replica may answer without re-syncing.
 *
 * Ten seconds is long enough to cover the run of tool calls a model makes to
 * answer one question, and short enough that a person who just ticked something
 * off on their phone and turned to Claude sees it.
 */
const SYNC_THROTTLE_MS = 10_000;

/**
 * Each replica's sync gate (syncGate.ts). Kept outside `buildMcpServer` because
 * that runs once per HTTP request (the transport is stateless): state inside
 * it started every request at zero, so every tool call synced and the
 * throttle above never applied.
 */
const syncGateByReplica = new WeakMap<Replica, SyncGate>();

/**
 * Each replica's outstanding preview tokens (confirmWrites.ts). Module scope for
 * the sync gate's reason: a preview and its confirm arrive as two requests,
 * and this file builds a fresh server for each.
 */
const confirmTokensByReplica = new WeakMap<Replica, ConfirmTokens>();

function confirmTokensFor(replica: Replica): ConfirmTokens {
  let tokens = confirmTokensByReplica.get(replica);
  if (!tokens) {
    tokens = createConfirmTokens();
    confirmTokensByReplica.set(replica, tokens);
  }
  return tokens;
}

/** Said once on every write tool, after its own description. */
const CONFIRM_NOTE = 'Every write previews first: called without apply it changes nothing and returns willDo (what would change, in plain words) and a confirmToken. Show the person willDo and wait for their yes before calling again with apply: true and the confirmToken.';

/** A tool result's JSON back as a value, or undefined when it is not JSON. */
function parseToolText(out: { content: { type: string; text?: string }[] }): unknown {
  const text = out.content.find(c => c.type === 'text')?.text;
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * A preview's result without ids or links: everything it created was rolled
 * back, so an id in it names nothing, and a model holding one would try to
 * use it.
 */
function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIds);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        // `applied` too: the write inside a preview ran, so a tool reporting on
        // itself says it applied, and that is exactly what did not happen.
        .filter(([k]) => !['id', 'openInApp', 'taskId', 'applied', 'note'].includes(k))
        .map(([k, v]) => [k, withoutIds(v)]),
    );
  }
  return value;
}

function syncGateFor(replica: Replica): SyncGate {
  let gate = syncGateByReplica.get(replica);
  if (!gate) {
    gate = createSyncGate(
      () => replica.sync(),
      SYNC_THROTTLE_MS,
      Date.now,
      e => console.error('Replica sync failed; answering from the database as it stands', e),
      READ_WAIT_MS,
      () => console.error(`Replica sync still running after ${READ_WAIT_MS / 1000}s; answering from the database as it stands`)
    );
    syncGateByReplica.set(replica, gate);
  }
  return gate;
}

/**
 * Compact rather than indented. The reader is a model, which needs no
 * whitespace to follow nesting, and indentation was a fifth or more of every
 * result: tokens spent on spaces in a list of fifty tasks are tasks that did not
 * fit in the same context.
 */
function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

/**
 * Write tools are registered per request, only for a caller that presented the
 * write token.
 *
 * Cheap to do here because the transport is stateless, so this runs once per
 * request with that request's scope already known — and stronger than a check
 * inside each handler: a read-scoped caller does not see the write tools in
 * `tools/list` at all, so there is nothing for a model to try and be refused.
 */
/**
 * Where an `openInApp` link points, from PUBLIC_URL, or null on a server with no
 * public address (a laptop), where there is nothing for a phone to open.
 */
const LINKS = appLinks(process.env.PUBLIC_URL);

/** `result` with a link that opens its subject in the app, when there is one. */
function withLink<T extends object>(result: T, link: string | undefined): T | (T & { openInApp: string }) {
  return link ? { ...result, openInApp: link } : result;
}

export function buildMcpServer(replica: Replica, scope: AuthScope = 'read'): McpServer {
  const server = new McpServer({ name: 'todo', version: '0.1.0' }, { instructions: SERVER_INSTRUCTIONS });

  // Every tool gets its title and read/write hints from one table
  // (toolAnnotations.ts) rather than an argument at each of thirty call sites.
  // Applied on the way through `server.tool` so a tool added below picks them
  // up with no change here, and one missing from the table claims nothing.
  const register = server.tool.bind(server) as (...args: unknown[]) => RegisteredTool;
  (server as unknown as { tool: (...args: unknown[]) => RegisteredTool }).tool = (...args: unknown[]) => {
    const tool = register(...args);
    const annotations = annotationsFor(String(args[0]));
    if (Object.keys(annotations).length > 0) tool.update({ annotations, title: annotations.title });
    return tool;
  };

  // Every handler refreshes first. The replica caches reads for the length of a
  // request so the blocker registry does not re-read the task table once per
  // blocked task; that cache must not outlive the request, or a sync landing
  // between two calls is invisible to the second one.
  //
  // A sync is attempted first, throttled, so a question asked after the phone
  // changed something gets the new answer. Throttled rather than every call
  // because a model reads several tools in a row to answer one question, and
  // three round trips to the payload store inside one thought is latency spent
  // on nothing: nothing can have changed in the second between them that the
  // next question will not pick up. syncGate.ts owns the throttle, the queue
  // that keeps two runs from overlapping, and swallowing a failed sync.
  const gate = syncGateFor(replica);

  const withFresh = async <T>(fn: () => T): Promise<T> => {
    await gate.fresh();
    replica.refresh();
    return fn();
  };

  /**
   * A write, then a push, ignoring the throttle.
   *
   * The throttle is about not spending a round trip per *read*, and a write is
   * the opposite case: `withFresh` syncs before the tool runs, so a write
   * performed inside one has missed its own push and would sit in the replica
   * until something else happened to call a tool. That is up to ten seconds of
   * a template that exists on the server and nowhere else, which to the person
   * who asked for it is indistinguishable from the call having failed.
   */
  const withWrite = async <T>(fn: () => T): Promise<T> => {
    replica.refresh();
    // Previewing (see confirmWrites.ts): the same write, measured and rolled
    // back, and nothing pushed, since nothing changed.
    if (previewing) {
      const { result, effects } = replica.dryRun(fn);
      previewing.push(...effects);
      return result;
    }
    const result = fn();
    await gate.afterWrite();
    return result;
  };

  /** Set while a write tool is previewing; collects what the write would record in Activity. */
  let previewing: AgentLedgerEntry[] | null = null;

  server.tool(
    'list_tasks',
    "Tasks in one of the app's own lenses: today (visible now), later (deferred or not yet due), unscheduled, inbox, or all.",
    {
      view: z.enum(TASK_VIEWS).optional(),
      category: z.string().optional(),
      tag: z.string().optional(),
      projectId: z.string().optional(),
      includeCompleted: z.boolean().optional(),
      limit: z.number().int().positive().optional(),
    },
    async input => json(await withFresh(() => listTasks(replica, input)))
  );

  server.tool(
    'search_tasks',
    'Fuzzy search across task titles, notes and project names, ranked the way the app ranks its own search.',
    { query: z.string().min(1), limit: z.number().int().positive().optional() },
    async input => json(await withFresh(() => searchTasks(replica, input)))
  );

  server.tool(
    'get_task',
    'One task in full: its subtasks, its chain steps, its project, and why it is not on Today if it is not.',
    { id: z.string().min(1) },
    async ({ id }) => {
      const result = await withFresh(() => getTask(replica, id));
      return result ? json(withLink(result, LINKS?.task(id))) : json({ error: `No task with id ${id}.` });
    }
  );

  server.tool(
    'list_categories',
    'The task categories, in the user\'s own order, each with how many open tasks it holds and a few of them as examples. Every task you create needs one of these (or a new one, flagged with newCategory), so check here first and pick the one the task belongs under.',
    {},
    async () => json(await withFresh(() => listCategories(replica)))
  );

  server.tool('list_projects', "Active projects and how far through each one is. The counts are the app's own: a recurring member counts once however many times it has recurred, and a dated series counts once rather than once per date.", {}, async () =>
    json(await withFresh(() => listProjects(replica)))
  );

  server.tool(
    'list_grocery_items',
    'The home grocery list, with whether each item is checked off there. This is the list the grocery write tools act on. An item only on a separate list (a trip\'s list, say) is not included. Pass onListOnly: false to search the whole catalog instead.',
    { onListOnly: z.boolean().optional() },
    async input => json(await withFresh(() => listGroceryItems(replica, input)))
  );

  server.tool(
    'list_food_log',
    'Logged food over a range of days, with summed nutrients. A nutrient nobody logged is absent rather than zero. Defaults to the last 7 days. Empty unless the person has turned on Include health logs for the sync server on their phone, so an empty result is not evidence that nothing was logged.',
    logRange,
    async input => json(await withFresh(() => listFoodLog(replica, input)))
  );

  server.tool(
    'list_mood_logs',
    'Mood check-ins over a range of days: the 1 to 5 rating, any symptoms and their severity, context tags and notes. Defaults to the last 7 days. Empty unless the person has turned on Include health logs for the sync server on their phone, so an empty result is not evidence that nothing was logged.',
    logRange,
    async input => json(await withFresh(() => listMoodLogs(replica, input)))
  );

  server.tool(
    'list_medication_logs',
    'Doses recorded over a range of days, including as-needed ones. Defaults to the last 7 days. Empty unless the person has turned on Include health logs for the sync server on their phone, so an empty result is not evidence that nothing was logged.',
    logRange,
    async input => json(await withFresh(() => listMedicationLogs(replica, input)))
  );

  server.tool(
    'list_templates',
    'Stored task templates: name, category, how many items, the item groups, and the questions a run asks. Use this to find a template to nest inside another.',
    {},
    async () => json(await withFresh(() => listTemplates(replica)))
  );

  server.tool(
    'get_project',
    'One project in full: its details, every open task in the project\'s own order (with each one\'s checklist and what it waits on), the most recently finished, and every decision: each question a task asked on completion, with its answer and when it was given. Use it before suggesting what to do next on a project, or before re-scoping one.',
    { id: z.string().min(1) },
    async ({ id }) => {
      const result = await withFresh(() => getProject(replica, id));
      return result ? json(withLink(result, LINKS?.project(id))) : json({ error: `No project with id ${id}.` });
    }
  );

  server.tool(
    'list_recipes',
    'Recipes, alphabetically. query matches the name, a tag or an ingredient ("spinach").',
    {
      query: z.string().optional(),
      mealType: z.enum(['breakfast', 'lunch', 'dinner', 'side', 'condiment', 'snack', 'dessert', 'beverage']).optional(),
      upNext: z.boolean().optional().describe('Only the recipes on the "Up next" shelf.'),
      limit: z.number().int().positive().optional(),
    },
    async input => json(await withFresh(() => listRecipes(replica, input)))
  );

  server.tool(
    'get_recipe',
    'One recipe in full: ingredients (with sections and either/or groups: lines sharing oneOf are alternatives), steps, notes and source.',
    { id: z.string().min(1) },
    async ({ id }) => {
      const result = await withFresh(() => getRecipe(replica, id));
      return result ? json(withLink(result, LINKS?.recipe(id))) : json({ error: `No recipe with id ${id}.` });
    }
  );

  server.tool(
    'list_meal_plan',
    `Meals planned over a range of days. Defaults to the ${DEFAULT_PLAN_DAYS} days from today.`,
    {
      from: dayKey.optional(),
      to: dayKey.optional(),
      days: z.number().int().positive().max(MAX_PLAN_DAYS).optional(),
    },
    async input => {
      try {
        return json(await withFresh(() => listMealPlan(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not read the meal plan.' });
      }
    }
  );

  server.tool(
    'list_people',
    "The people the user keeps up with, in their own order. Don't rank or sort them by how recently they were seen, and say when you last saw someone as a date, not a count of days: the app keeps those out on purpose.",
    {},
    async () => json(await withFresh(() => listPeople(replica)))
  );

  server.tool(
    'get_person',
    'One person: contact details, birthday, what to ask them about, gift ideas, food notes, and what you did together (newest first).',
    { id: z.string().min(1) },
    async ({ id }) => {
      const result = await withFresh(() => getPerson(replica, id));
      return result ? json(withLink(result, LINKS?.person(id))) : json({ error: `No person with id ${id}.` });
    }
  );

  server.tool(
    'upcoming_birthdays',
    `Birthdays in the next N days (default ${DEFAULT_BIRTHDAY_DAYS}), soonest first.`,
    { days: z.number().int().positive().max(MAX_BIRTHDAY_DAYS).optional() },
    async ({ days }) => json(await withFresh(() => upcomingBirthdays(replica, days)))
  );

  server.tool(
    'get_overview',
    "Start here. The person's time zone and logical today (their day can start after midnight), how many tasks are in each of Today, Later, Unscheduled and Inbox and how many are overdue, their categories (with any hours a category is limited to), most-used tags, active projects, which areas of the app are switched off, whether health logs reach this server, and whether you can write.",
    {},
    async () => json(await withFresh(() => getOverview(replica, scope)))
  );

  server.tool(
    'get_agenda',
    `The coming days as the app sees them, from today (default ${DEFAULT_AGENDA_DAYS} days, up to ${MAX_AGENDA_DAYS}): each day's tasks, repeats expected that day that have no task yet, estimated minutes, the app's own "busy"/"full" cue, trip days, what is carried over from before today, and deadlines that will not fit in the time left. The server cannot see the calendar, so meetings are unknown.`,
    { days: z.number().int().positive().max(MAX_AGENDA_DAYS).optional() },
    async input => json(await withFresh(() => getAgenda(replica, input)))
  );

  server.tool(
    'completion_history',
    `What got done over a range of days (default the last ${DEFAULT_HISTORY_DAYS}): completed tasks newest first, and a summary by day, weekday, hour of the day, category, project and tag, with estimated minutes, deadlines met, and how many occurrences were missed rather than done. Use it for reviews ("what did I get done this week"), patterns ("when do I actually do my workouts") and progress. Filter by category, projectId or tag.`,
    {
      ...logRange,
      category: z.string().optional(),
      projectId: z.string().optional(),
      tag: z.string().optional(),
      limit: z.number().int().positive().max(500).optional().describe('How many tasks to list. The summary always covers all of them.'),
    },
    async input => {
      try {
        return json(await withFresh(() => completionHistory(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not read the history.' });
      }
    }
  );

  server.tool(
    'review_tasks',
    `Things in the list worth a second look, for a cleanup or weekly review: overdue tasks (oldest first), Inbox items left untriaged over a week, Unscheduled tasks older than staleDays (default ${DEFAULT_STALE_DAYS}), open tasks that look like duplicates, active projects with nothing finished in three weeks, and the repeating tasks missed most often. It lists, it does not judge: ask the person what they want done with any of it before changing anything.`,
    { staleDays: z.number().int().positive().max(3650).optional() },
    async input => json(await withFresh(() => reviewTasks(replica, input)))
  );

  server.tool(
    'app_help',
    `How the app works, in the app's own words. Pass the person's question or a few keywords ("repeat every other week", "day start", "pin"). Returns matching Settings rows with the path to tap to reach each, and dated release notes describing the features (a later note supersedes an earlier one). Use it before explaining a feature or pointing someone at a setting, rather than guessing. Bug-fix notes are left out unless includeFixes is true. Returns up to ${DEFAULT_HELP_LIMIT} of each by default.`,
    {
      query: z.string().min(1),
      limit: z.number().int().positive().max(40).optional(),
      includeFixes: z.boolean().optional(),
    },
    async input => json(await withFresh(() => appHelp(replica, input)))
  );

  server.tool(
    'habit_patterns',
    `How each repeating task and habit is going over the last N days (default ${DEFAULT_PATTERN_DAYS}): its streak, a daily or weekly target and whether it is on pace, how often it was done or missed, the hours it actually gets done in, and where that disagrees with the part of the day it is set to. Also the overall rhythm of when things get done, and how timed work compares with its estimates. Each pattern needs a minimum number of completions before it is reported.`,
    { days: z.number().int().min(7).max(730).optional() },
    async input => json(await withFresh(() => habitPatterns(replica, input)))
  );

  server.tool(
    'mood_insights',
    "The Mood screen's findings: mood against what got done, by category, by repeating task, by symptom, by context tag, by food, by time of day, and before and after each milestone the person marked. Every comparison is held to the app's minimum number of days and reports both sides' day counts. They are associations, never causes; read the rules field and stay inside it when explaining. Empty unless health logs reach this server.",
    {},
    async () => json(await withFresh(() => moodInsights(replica)))
  );

  server.tool(
    'list_automations',
    "Everything that adds tasks on its own: each automation (birthdays, weather, calendar events, Health, Screen Time, meal and pantry tasks, and the rest), whether it is on, what it does, and what it needs on the phone. Also every rule the person wrote for the ones that take rules, plus title rules, which file a new task by a word in its title. Use it before suggesting or changing an automation.",
    {},
    async () => json(await withFresh(() => listAutomations(replica)))
  );

  server.tool(
    'plan_day',
    "Proposes an order and a time for each task on today's list, fitted between startAt and endAt (default: now, or the start of their active hours, until the end of their active hours) and around busy blocks you pass in. Pinned first, then anything with a deadline today, then priority. It never places a task before the app would show it or past its time window, and lists what does not fit. The server cannot see the calendar: ask the person about meetings, or read them with a calendar tool, and pass them as busy. Writes nothing; apply what they agree to with batch_update_tasks.",
    {
      startAt: z.string().optional().describe('HH:MM, 24-hour.'),
      endAt: z.string().optional().describe('HH:MM, 24-hour.'),
      busy: z.array(z.object({ start: z.string(), end: z.string(), label: z.string().optional() })).optional()
        .describe('Times already taken today, HH:MM.'),
    },
    async input => {
      try {
        return json(await withFresh(() => planDay(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not plan the day.' });
      }
    }
  );

  server.tool(
    'rebalance_week',
    'Proposes moves that bring each heavy day in the coming days (default 7) under the app\'s "busy" line: for today, the app\'s own Lighten today plan; for later days, the biggest movable tasks to the lightest later day that keeps them before their deadline. Lists what it would leave in place and why (pinned, running, on a streak, due before a deadline). Writes nothing; apply the moves the person agrees to with batch_update_tasks using action "defer".',
    { days: z.number().int().min(2).max(21).optional() },
    async input => json(await withFresh(() => rebalanceWeek(replica, input)))
  );

  if (scope === 'write') {
    // Every write tool previews before it writes (confirmWrites.ts). Applied
    // on the way through `server.tool`, as the annotations are, so a write
    // tool added to registerWriteTools cannot skip it.
    const tokens = confirmTokensFor(replica);
    const plain = server.tool.bind(server) as (...args: unknown[]) => RegisteredTool;
    type WriteCallback = (args: Record<string, unknown>, extra: unknown) => Promise<{ content: { type: 'text'; text: string }[] }>;
    const guarded = (
      name: string,
      description: string,
      shape: Record<string, z.ZodTypeAny>,
      cb: WriteCallback,
    ) => plain(
      name,
      `${description} ${CONFIRM_NOTE}`,
      {
        ...shape,
        apply: z.boolean().optional().describe('Leave out to preview. true, with confirmToken, to make the change.'),
        confirmToken: z.string().optional().describe('From the preview of this exact request.'),
      },
      async (args: Record<string, unknown>, extra: unknown) => {
        const { apply, confirmToken, ...request } = args;
        if (!apply) {
          previewing = [];
          let out: Awaited<ReturnType<typeof cb>>;
          let effects: AgentLedgerEntry[];
          try {
            out = await cb({ ...request, apply: true }, extra);
          } finally {
            effects = previewing ?? [];
            previewing = null;
          }
          const details = parseToolText(out);
          if (details && typeof details === 'object' && 'error' in details) return out;
          const willDo = describeEffects(effects);
          return json({
            preview: true,
            willDo: willDo.length > 0 ? willDo : ['Nothing in the app would change.'],
            ...(details !== undefined ? { details: withoutIds(details) } : {}),
            confirmToken: tokens.issue(name, request, willDo),
            next: 'Nothing has changed yet. Tell the person, in plain words, what willDo says, and wait for a yes. Then call this tool again with exactly the same arguments, apply: true and this confirmToken.',
          });
        }
        if (typeof confirmToken !== 'string') {
          return json({ error: 'Preview first: call this tool without apply, show the person what willDo says, then confirm with the confirmToken it returns.' });
        }
        const redeemed = tokens.redeem(confirmToken, name, request);
        if (!redeemed.ok) return json({ error: redeemed.reason });
        return cb({ ...request, apply: true }, extra);
      },
    );
    (server as unknown as { tool: unknown }).tool = guarded;
    registerWriteTools(server, replica, withWrite);
    (server as unknown as { tool: typeof plain }).tool = plain;
  }

  // Prompts are scripts over the tools (prompts.ts). Registered for every
  // caller: a read-scoped one can still review, and each script says to ask
  // before changing anything, which is all a write-scoped one needs.
  for (const prompt of PROMPTS) {
    const argsSchema = Object.fromEntries((prompt.args ?? []).map(arg => [
      arg.name,
      arg.required ? z.string().describe(arg.description) : z.string().optional().describe(arg.description),
    ]));
    server.registerPrompt(prompt.name, { title: prompt.title, description: prompt.description, argsSchema }, (args: Record<string, string | undefined>) => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: prompt.text(args ?? {}) } }],
    }));
  }

  return server;
}

/**
 * The zod mirror of `TemplatePlan`.
 *
 * Deliberately not generated from the TypeScript: what the model needs is the
 * `.describe()` on each field, and those are documentation rather than types.
 * The two are kept in step by `templatePlan.test.ts` exercising the same shapes.
 */
const conditionSchema = z.object({
  question: z.string().describe('The name of a choice question defined in this plan.'),
  values: z.array(z.string()).min(1).describe('Which of that question\'s options switch this item on.'),
});

const itemSchema = z.object({
  title: z.string().min(1),
  notes: z.string().optional(),
  optional: z.boolean().optional().describe('Starts unticked in a run. A condition replaces this rather than stacking with it.'),
  anchor: z.enum(ANCHORS as unknown as [string, ...string[]]).optional().describe('Which anchor date the offsets below count from.'),
  dueOffsetDays: z.number().int().nullable().optional(),
  deferOffsetDays: z.number().int().nullable().optional(),
  deadlineOffsetDays: z.number().int().nullable().optional(),
  windowStart: z.string().nullable().optional().describe('HH:MM.'),
  windowEnd: z.string().nullable().optional().describe('HH:MM.'),
  reminderOffsetMinutes: z.number().int().nullable().optional(),
  timeSegments: z.array(z.enum(TIME_SEGMENTS as unknown as [TimeOfDay, ...TimeOfDay[]])).optional(),
  tags: z.array(z.string()).optional(),
  category: z.string().nullable().optional(),
  priority: z.number().int().min(0).max(4).optional(),
  effort: z.number().int().min(0).max(6).optional(),
  difficulty: z.enum(['easy', 'normal', 'hard']).optional(),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  recurrenceType: z.string().optional(),
  recurrenceInterval: z.number().int().positive().optional(),
  recurrenceDays: z.array(z.number().int().min(0).max(6)).optional(),
  recurrenceMonthDay: z.number().int().min(1).max(31).nullable().optional(),
  recurrenceFromCompletion: z.boolean().optional(),
  vacationPause: z.boolean().optional(),
  excludeFromSuggestions: z.boolean().optional(),
  gatesApps: z.boolean().optional(),
  subtasks: z.array(z.object({ id: z.string(), title: z.string() })).optional(),
  groupKey: z.string().optional().describe('The key of a group defined in this plan.'),
  conditions: z.array(conditionSchema).optional(),
  key: z.string().optional().describe('Your own handle for this item, so another item\'s onlyIfAnswer can name it.'),
  deliverableKind: z.enum(DELIVERABLE_KINDS as unknown as [DeliverableKind, ...DeliverableKind[]]).nullable().optional()
    .describe('A question the task asks when completed: text, date, number, yesno or choice.'),
  deliverableOptions: z.array(z.string()).optional().describe('For a choice question: the options, at least two.'),
  onlyIfAnswer: z.object({
    item: z.string().describe('The key of an item in this plan that asks a Yes/No or choice question.'),
    answers: z.array(z.string()).min(1),
  }).optional()
    .describe('A branch decided after the template is applied: the task waits for that item\'s question to be answered, then shows only for these answers and is not needed for any other. Unlike conditions, which decide what is ticked when the template is applied.'),
  refTemplate: z.string().optional().describe('An existing template id, or its name when unique, to nest here.'),
});

/**
 * The task fields create_task and update_task share, described for a caller
 * that has never seen the app. The rules behind them (which combinations are
 * allowed, what a change clears) are taskFields.ts's, which is tested; this is
 * only the shape and the words.
 */
const isoDateTime = z.string().nullable().optional();
const taskFieldsShape = {
  notes: z.string().optional(),
  category: z.string().nullable().optional().describe('A task category, by name, from list_categories. Required when creating a top-level task unless its project has a default category; a name that isn\'t one of the user\'s is refused unless newCategory is set.'),
  newCategory: z.boolean().optional().describe('Create category as a new category. Only when none of the existing ones fits; say so to the user.'),
  tags: z.array(z.string()).optional(),
  projectId: z.string().nullable().optional().describe('File it in a project (see list_projects), or null to take it out.'),
  dueDate: isoDateTime.describe('YYYY-MM-DD (read as that day in their own time zone) or an ISO date-time: the day it is for. On a repeating task this also moves the schedule; to move just this occurrence use defer_task.'),
  deferUntil: isoDateTime.describe('YYYY-MM-DD or an ISO date-time. Hides the task until then.'),
  deadline: isoDateTime.describe('ISO date-time. Shown on the task; does not hide or move it.'),
  reminderTime: isoDateTime.describe('ISO date-time of a reminder.'),
  timeSegments: z.array(z.enum(TIME_SEGMENTS as unknown as [TimeOfDay, ...TimeOfDay[]])).optional()
    .describe('The part of the day it shows up in. Usually one.'),
  priority: z.number().int().min(0).max(4).optional().describe('0 none, 1 low, 2 medium, 3 high, 4 urgent.'),
  effort: z.number().int().min(0).max(6).optional(),
  difficulty: z.enum(['easy', 'normal', 'hard']).nullable().optional()
    .describe('How hard the task is to make yourself do, apart from how long it takes. Scales the coins it earns: hard doubles, easy halves.'),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  pinned: z.boolean().optional().describe('Pin it to the top of Today.'),
  deliverableKind: z.enum(DELIVERABLE_KINDS as unknown as [DeliverableKind, ...DeliverableKind[]]).nullable().optional()
    .describe('Makes completing this task ask for an answer of that kind, recorded on the row.'),
  deliverableOptions: z.array(z.string()).optional()
    .describe("The options a 'choice' question offers, e.g. ['Yes', 'No', 'Maybe']. Ignored for other kinds."),
  repeat: z.object({
    every: z.enum(REPEAT_EVERY as unknown as [RepeatEvery, ...RepeatEvery[]])
      .describe('"never" removes a repeat. "hours" is "every N hours after it was done".'),
    interval: z.number().int().optional().describe('Every N of the unit. Default 1. 1 to 99.'),
    weekdays: z.array(z.number().int()).optional().describe('Weekly only: which days, 0 = Sunday to 6 = Saturday. E.g. [1, 3] for Mondays and Wednesdays.'),
    monthDay: z.number().int().optional().describe('Monthly or yearly: day of the month, 1 to 31, or -1 for the last day. Omit to use the due date\'s day.'),
    nthWeekday: z.object({
      ordinal: z.number().int().describe('1 to 4, or -1 for the last.'),
      weekday: z.number().int().describe('0 = Sunday to 6 = Saturday.'),
    }).optional().describe('Monthly only, instead of monthDay: "the 2nd Tuesday" is { ordinal: 2, weekday: 2 }.'),
    month: z.number().int().optional().describe('Yearly only: 1 to 12. Omit to use the due date\'s month.'),
    fromCompletion: z.boolean().optional()
      .describe('Count the next one from when it was done rather than on a fixed schedule. Defaults to true for daily and hourly, as the app does, false otherwise.'),
    endDate: z.string().nullable().optional().describe('ISO date: stop repeating after this.'),
    count: z.number().int().nullable().optional().describe('Stop after this many more times, this one included. Give endDate or count, not both.'),
  }).optional().describe('How it repeats. Replaces the whole rule. The first occurrence sits on dueDate; the rule places the ones after it, so set dueDate to the first matching day.'),
  chain: z.object({
    steps: z.array(z.object({
      title: z.string(),
      estimatedMinutes: z.number().int().positive().nullable().optional(),
      asks: z.enum(STEP_QUESTION_KINDS as unknown as [string, ...string[]]).nullable().optional()
        .describe('Completing this step asks for an answer of this kind.'),
      answerSchedulesNextStep: z.boolean().optional()
        .describe('With asks: "date", the answer becomes the next step\'s date ("Book haircut" answered with the appointment puts "Get haircut" on that day).'),
    })).describe('At least two. One task that becomes each step in turn: completing a step brings up the next.'),
    stepsFollowSchedule: z.boolean().optional()
      .describe('On a repeating chain: each step waits for the next date on the schedule, instead of coming up as soon as the last one is done.'),
  }).nullable().optional()
    .describe('A sequence of steps done one after another, each appearing when the one before is done. On a repeating task the whole chain starts over on the schedule. Not subtasks: subtasks are a checklist done together. null removes it.'),
  target: z.object({
    count: z.number().int().describe('2 to 99.'),
    per: z.enum(['day', 'week']),
    unit: z.string().nullable().optional().describe('E.g. "glasses". Optional.'),
    allowOvershoot: z.boolean().optional().describe('Per day only: keep counting past the target.'),
  }).nullable().optional()
    .describe('Something done several times: "drink water 8 times a day", "run 3 times a week". A daily target makes the task repeat daily if it did not; a weekly one makes it repeat weekly. null removes it.'),
  window: z.object({
    start: z.string().nullable().optional().describe('"HH:MM", 24-hour: it shows up from this time.'),
    end: z.string().nullable().optional().describe('"HH:MM", 24-hour: after this it counts as missed for the day.'),
  }).nullable().optional().describe('A time of day to do it in. null removes it.'),
  habit: z.enum(['do', 'avoid']).optional()
    .describe('"avoid" makes it a habit of NOT doing something ("no phone in bed"): it is never completed, and its streak counts the days you held off. Only for a plain task, not a chain or a target.'),
  dueDaysFromEvent: z.number().int().optional()
    .describe('Instead of dueDate: days from the project\'s event date, negative for before ("get the license 60 days before" is -60, "thank-you notes a week after" is 7). Becomes an ordinary date; it does not follow the event later, but moving the event with moveTasks moves it.'),
  deadlineDaysFromEvent: z.number().int().optional()
    .describe('Instead of deadline: days from the project\'s event date, as dueDaysFromEvent.'),
  dueEndOfMonthAfterEvent: z.number().int().min(0).optional()
    .describe('Instead of dueDate: the last day of a month counted from the event\'s, 0 for the event\'s own month and 1 for the month after ("update records by the end of the month after" is 1).'),
  deadlineEndOfMonthAfterEvent: z.number().int().min(0).optional()
    .describe('Instead of deadline: as dueEndOfMonthAfterEvent.'),
  waitsOn: z.array(z.string()).optional()
    .describe('Ids of tasks this one waits on: it stays hidden until they are all done. [] clears it.'),
  onlyIfAnswer: z.object({
    taskId: z.string().describe('A task that asks a Yes/No or pick-one question when completed.'),
    answers: z.array(z.string()).min(1).describe('The answers that show this task, spelled as the question offers them.'),
  }).nullable().optional()
    .describe('A branch: this task waits until that question is answered, then shows only for these answers. Any other answer marks it not needed: off every list and out of the project\'s count. A task waiting only on not-needed tasks is not needed too. null removes it.'),
  followUp: z.object({
    everyN: z.number().int().describe('2 to 99.'),
    title: z.string(),
    notes: z.string().optional(),
    estimatedMinutes: z.number().int().positive().nullable().optional(),
    oneAtATime: z.boolean().optional().describe('Don\'t add another while the last one is still open.'),
  }).nullable().optional()
    .describe('Repeating tasks only: every Nth completion also adds a separate task, e.g. every 4th run, "Replace running shoes" or every 10th clean, "Deep clean the oven". null removes it.'),
};

function registerWriteTools(
  server: McpServer,
  replica: Replica,
  withWrite: <T>(fn: () => T) => Promise<T>
): void {
  server.tool(
    'create_task',
    "Add a task. Beyond the basics it can repeat (any rule the app has), be a chain of steps, have a daily or weekly target, a time window, blockers it waits on, a follow-up every Nth completion, or be a habit of not doing something. It needs a category (see list_categories) unless its project has a default one; the app's other defaults apply (its time-of-day segment, title rules), and an invalid combination is refused with every problem listed. The result is the task in full, as get_task shows it, so check it says what you meant.",
    {
      title: z.string().min(1),
      ...taskFieldsShape,
      parentId: z.string().nullable().optional().describe('Makes this a subtask (a checklist item) of that task.'),
    },
    async input => {
      try {
        const result = await withWrite(() => createTask(replica, input as Parameters<typeof createTask>[1]));
        return json(withLink(result, LINKS?.task(result.task.id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not create the task.' });
      }
    }
  );

  server.tool(
    'update_task',
    'Edit a task. Only the fields you name change; null clears one that can be empty, and repeat, chain, target, window and followUp each replace that whole part. Uses the same rules as editing in the app: changing the repeat re-anchors the schedule, and on a task with several dates the content edit also applies to its later dates (the result says how many). Completed and archived tasks are refused. To move one occurrence of a repeating task, use defer_task instead of dueDate.',
    {
      id: z.string().min(1),
      title: z.string().optional(),
      ...taskFieldsShape,
    },
    async ({ id, ...input }) => {
      try {
        return json(withLink(await withWrite(() => updateTask(replica, id, input as TaskFieldsInput)), LINKS?.task(id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not update the task.' });
      }
    }
  );

  server.tool(
    'save_recipe',
    'Save a recipe to the app: from a page, a photo, or a conversation. Give ingredients as the lines a recipe prints ("2 cloves garlic, minced"), one per entry; the app reads the amount, the name and the prep out of each. Put a heading in section ("For the sauce"), and give lines that are alternatives ("serrano or jalapeño") the same alternativeGroup, one line each, never one line with "or". Refused if a recipe with that name is already in that cookbook. The result counts the ingredient lines the app could read.',
    {
      name: z.string().min(1),
      cookbook: z.string().nullable().optional().describe('A cookbook by title. Created if there is none by that name.'),
      ingredients: z.array(z.object({
        text: z.string().min(1),
        section: z.string().nullable().optional(),
        alternativeGroup: z.string().nullable().optional(),
      })).optional(),
      steps: z.array(z.object({ text: z.string().min(1), section: z.string().nullable().optional() })).optional(),
      servings: z.number().int().positive().nullable().optional(),
      estimatedMinutes: z.number().int().positive().nullable().optional().describe('Total time, start to table.'),
      mealType: z.enum(['breakfast', 'lunch', 'dinner', 'side', 'condiment', 'snack', 'dessert', 'beverage']).nullable().optional(),
      tags: z.array(z.string()).optional(),
      sourceUrl: z.string().nullable().optional(),
      notes: z.string().optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => saveRecipe(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not save the recipe.' });
      }
    }
  );

  server.tool(
    'log_food',
    `Log something the person ate, with your estimate of its nutrition for the whole amount eaten. Amounts are keyed ${NUTRIENT_KEY_LIST.join(', ')}; leave out any you cannot estimate (absent is not zero). Without apply: true it only shows the figures as the app read them: show the person, and log it once they agree, since the app never stores an estimate nobody looked at. The entry is marked as estimated, and it is not written to Apple Health (only the phone a meal is logged on does that).`,
    {
      label: z.string().min(1),
      quantity: z.string().optional().describe('How much, in words: "1 bowl", "2 slices".'),
      amounts: z.record(z.number().nonnegative()),
      slot: z.enum(KITCHEN_MEAL_SLOTS as unknown as [MealSlot, ...MealSlot[]]).nullable().optional(),
      at: z.string().optional().describe('When it was eaten: an ISO date-time, or YYYY-MM-DD. Default now.'),
      apply: z.boolean().optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => logFood(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not log that.' });
      }
    }
  );

  server.tool(
    'log_mood',
    'Record a mood check-in: a rating from 1 (low) to 5 (great), and/or symptoms with a severity of 1 (mild) to 3 (severe), context tags ("work", "poor sleep") and a note. Leave the rating out when the person gave none; an unrated check-in is not a 3. Symptoms and tags are matched to the spellings already in their log. Log only what they told you, never an inference about how they seem.',
    {
      mood: z.number().int().min(1).max(5).nullable().optional(),
      symptoms: z.array(z.object({ name: z.string().min(1), severity: z.number().int().min(1).max(3).optional() })).optional(),
      contextTags: z.array(z.string().min(1)).optional(),
      note: z.string().nullable().optional(),
      at: z.string().optional().describe('An ISO date-time, or YYYY-MM-DD for a day gone by. Default now.'),
    },
    async input => {
      try {
        return json(await withWrite(() => logMood(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not record that.' });
      }
    }
  );

  server.tool(
    'log_medication',
    'Record a dose taken: the medication, the amount and unit together (or neither), whether it was as-needed, and when. The name is matched to the spelling already in their log, but never folded into a different medicine or strength.',
    {
      name: z.string().min(1),
      amount: z.number().positive().nullable().optional(),
      unit: z.string().nullable().optional(),
      asNeeded: z.boolean().optional(),
      note: z.string().nullable().optional(),
      at: z.string().optional().describe('When it was taken: an ISO date-time, or YYYY-MM-DD. Default now.'),
    },
    async input => {
      try {
        return json(await withWrite(() => logMedication(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not record that dose.' });
      }
    }
  );

  server.tool(
    'set_automation',
    'Turn an automation on or off, by its kind from list_automations. Applies on every synced device. Say what it will do (its "does" line) and anything it needs on the phone before turning it on.',
    { kind: z.string().min(1), on: z.boolean() },
    async ({ kind, on }) => {
      try {
        return json(await withWrite(() => setAutomation(replica, kind, on)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change that automation.' });
      }
    }
  );

  server.tool(
    'save_rule',
    'Add a rule, or change one by passing its id from list_automations (only the fields you give change). title: file a new task by a word in its title ("pay" → Bills, high priority). weather: add a task when the forecast is sunny, rainy, snowy, cold or hot. event: add a task ahead of a calendar event whose title has one of these words. health: add a task when an Apple Health reading is under (or over) a number by a given hour. screenTime: add a task after this many minutes in the watched apps. The app checks every rule the way its own rule sheets do; the result is the rule as saved, and says when a value was adjusted. The matching automation must be on for a rule to fire.',
    {
      type: z.enum(RULE_TYPES as unknown as [string, ...string[]]),
      rule: z.object({
        id: z.string().optional(),
        enabled: z.boolean().optional(),
        title: z.string().optional().describe('The task the rule adds (all but title rules).'),
        estimatedMinutes: z.number().int().positive().nullable().optional(),
        category: z.string().optional().describe('Files the task it adds under this category (all but title rules).'),
        keywords: z.array(z.string()).optional().describe('title: words that trigger it, 3+ letters each.'),
        match: z.enum(['startsWith', 'contains']).optional().describe('title: where the word must be.'),
        fileUnder: z.string().nullable().optional().describe('title: the category a matching task is filed under.'),
        projectId: z.string().nullable().optional().describe('title: the project a matching task goes in.'),
        tags: z.array(z.string()).optional().describe('title: tags to add.'),
        priority: z.number().int().min(0).max(4).optional().describe('title: 0 (none) to 4 (urgent).'),
        linkUrl: z.string().nullable().optional().describe('title: a link to attach.'),
        stripKeyword: z.boolean().optional().describe('title: remove the word from the title.'),
        condition: z.enum(['sunny', 'rainy', 'snowy', 'cold', 'hot']).optional().describe('weather.'),
        matches: z.array(z.string()).optional().describe('event: 1 to 6 words or phrases looked for in event titles.'),
        leadDays: z.number().int().min(0).max(14).optional().describe('event: days before the event to add the task.'),
        metric: z.enum(['steps', 'sleepHours', 'exerciseMinutes', 'sodiumMg', 'proteinG', 'satFatG', 'fiberG', 'sugarG', 'caffeineMg', 'waterMl', 'calorieKcal']).optional().describe('health.'),
        threshold: z.number().optional().describe('health: in the metric\'s own unit.'),
        direction: z.enum(['under', 'over']).optional().describe('health: which side of the threshold fires it. Each metric has a usual one.'),
        checkpointHour: z.number().int().min(0).max(23).optional().describe('health: the hour of the day it is judged from.'),
        thresholdMinutes: z.number().int().min(5).max(480).optional().describe('screenTime.'),
      }),
    },
    async ({ type, rule }) => {
      try {
        // A title rule's own field for its category is `category`, which every
        // other rule uses for the task it adds; the tool names them apart.
        const { fileUnder, ...rest } = rule;
        const fields = type === 'title' && fileUnder !== undefined ? { ...rest, category: fileUnder } : rest;
        return json(await withWrite(() => saveRule(replica, type as never, fields)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not save that rule.' });
      }
    }
  );

  server.tool(
    'delete_rule',
    'Delete a rule by its type and id from list_automations. To stop one firing but keep it, save it with enabled: false instead.',
    { type: z.enum(RULE_TYPES as unknown as [string, ...string[]]), id: z.string().min(1) },
    async ({ type, id }) => {
      try {
        return json(await withWrite(() => deleteRule(replica, type as never, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete that rule.' });
      }
    }
  );

  server.tool(
    'remember',
    'Keep a note the person wants you to remember in every conversation ("errands happen on Saturdays", "never schedule anything after 6pm"). It is saved in their app, where they can read, edit and remove it (Settings › Data & reset › Sync › Notes for Claude), and get_overview returns all of them. Use it when they say to remember something, or offer to when they state a lasting preference. One idea per note, in their words.',
    { text: z.string().min(1).max(500) },
    async ({ text }) => {
      try {
        return json(await withWrite(() => remember(replica, text)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not save that note.' });
      }
    }
  );

  server.tool(
    'forget',
    'Remove one of the notes get_overview lists under notesForClaude, by id. Use it when the person says a note is no longer true.',
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(await withWrite(() => forget(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not remove that note.' });
      }
    }
  );

  server.tool(
    'batch_update_tasks',
    `Edit, complete or reschedule up to ${MAX_BATCH} tasks in one call. Without apply: true it is a preview: each row says exactly what would change (field by field, before and after), and nothing is written. Show the preview to the person, then send the same changes with apply: true. If any change would be refused, the whole batch is refused before anything is written, and that row says why. "defer" moves one occurrence of a repeating task without moving its schedule, the same as defer_task. "complete" on a task that asks a question needs deliverableValue (or null to skip the question).`,
    {
      changes: z.array(z.discriminatedUnion('action', [
        z.object({ id: z.string().min(1), action: z.literal('update'), fields: z.object({ title: z.string().optional(), ...taskFieldsShape }) }),
        z.object({ id: z.string().min(1), action: z.literal('complete'), deliverableValue: z.string().nullable().optional() }),
        z.object({ id: z.string().min(1), action: z.literal('defer'), date: z.string().nullable().describe('YYYY-MM-DD, or null to clear the date.') }),
      ])).min(1).max(MAX_BATCH),
      apply: z.boolean().optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => batchUpdateTasks(replica, input as { changes: BatchChange[]; apply?: boolean })));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not apply the batch.' });
      }
    }
  );

  server.tool(
    'quick_add',
    `Add up to ${MAX_QUICK_ADD} tasks from lines of text, each read with the app's own quick-add grammar: "Pay rent tomorrow 5pm #home !high ~30m +Moving". Dates and repeats ("every other Monday"), #category or #tag, !priority, +project and an estimate are read out of the title; anything that matches nothing stays in the title and the row says so. Start a line with "remind me" to set a reminder at its time. Bullets and numbering are ignored, so a pasted list works. Without apply: true it only shows how each line reads.`,
    {
      lines: z.array(z.string()).min(1),
      apply: z.boolean().optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => quickAdd(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not add those.' });
      }
    }
  );

  server.tool(
    'create_template',
    'Create a task template: its items, item groups, the questions a run asks, an optional firing schedule, and references to other templates. Everything is created in one call; an invalid plan creates nothing and reports every problem at once.',
    {
      name: z.string().min(1),
      category: z.string().nullable().optional(),
      container: z.enum(CONTAINERS as unknown as [string, ...string[]]).optional()
        .describe('What a run puts the tasks in: none, a stack, a project, or one task with subtasks.'),
      anchorsAreAway: z.boolean().optional().describe('Whether the anchor dates mean a period away from home.'),
      groups: z.array(z.object({
        key: z.string().min(1).describe('Your own handle for this group, used by an item groupKey.'),
        title: z.string().min(1),
      })).optional(),
      questions: z.array(z.object({
        name: z.string().optional().describe('The {blank} this fills. Omit for a people question, which fills none.'),
        prompt: z.string(),
        kind: z.enum(QUESTION_KINDS as unknown as [string, ...string[]]),
        options: z.array(z.string()).optional().describe('Required for a choice, at least two. The first is the default.'),
        defaultValue: z.string().optional(),
        fromDates: z.enum(QUESTION_SOURCES as unknown as [string, ...string[]]).optional()
          .describe('A number question can take its answer off the anchor dates: days or nights.'),
      })).optional(),
      schedule: z.object({
        frequency: z.enum(SCHEDULE_FREQUENCIES as unknown as [string, ...string[]]),
        weekday: z.number().int().min(0).max(6).optional(),
        monthDay: z.number().int().min(1).max(31).optional(),
        month: z.number().int().min(0).max(11).optional(),
        time: z.string().optional().describe('HH:MM.'),
        anchorSpanDays: z.number().int().nullable().optional(),
      }).nullable().optional(),
      items: z.array(itemSchema).min(1),
    },
    async input => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return json(await withWrite(() => createTemplate(replica, input as any)));
      } catch (e) {
        // The validator's whole point is reporting every problem at once, so
        // the message is handed back rather than collapsed into "failed".
        return json({ error: e instanceof Error ? e.message : 'Could not create the template.' });
      }
    }
  );

  server.tool(
    'complete_task',
    "Complete a task. A recurring one spawns its next occurrence, a chain advances one step, and a dated series lays out its next set, so the result says what was created rather than only that the row is done. A task that asks a question on completion is refused unless deliverableValue is given, including explicitly null to complete it without an answer.",
    {
      id: z.string().min(1),
      deliverableValue: z.string().nullable().optional()
        .describe('The answer, for a task that asks one. Null completes it without an answer. Omitting it on a task that asks is refused.'),
      completedAt: z.string().optional()
        .describe('ISO date-time, for recording something done earlier. Defaults to now.'),
      why: z.string().optional().describe('With an answer: why it was chosen, in a sentence. Shown under the answer in the project\'s Decisions.'),
      revisitIf: z.string().optional().describe('With an answer: what would reopen the decision ("the guest list goes over 25").'),
    },
    async ({ id, ...rest }) => {
      try {
        // 'deliverableValue' in options is what the refusal tests, so the key
        // has to survive only when the caller actually sent it. Zod drops an
        // omitted optional rather than setting it undefined, so this holds.
        const result = await withWrite(() => completeTask(replica, id, rest));
        // The next occurrence or step, where the completion made one: that is the
        // task still on the list.
        return json(withLink(result, LINKS?.task(result.nextTask?.id ?? id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not complete the task.' });
      }
    }
  );

  server.tool(
    'update_answer',
    'Correct the answer a completed task recorded, or add or change the reasoning given with it: why it was chosen, and what would reopen it. Only the fields given change; null clears one. Clearing the answer clears its reasoning. Nothing is completed or reopened.',
    {
      id: z.string().min(1),
      answer: z.string().nullable().optional(),
      why: z.string().nullable().optional(),
      revisitIf: z.string().nullable().optional(),
    },
    async ({ id, ...edit }) => {
      try {
        return json(await withWrite(() => updateAnswer(replica, id, edit)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the answer.' });
      }
    }
  );

  server.tool(
    'defer_task',
    'Move a task to a date, or clear its date with null. Pushing a recurring task out hides it until then without moving the schedule the rest of its occurrences come from; pulling one forward moves its date. The result is the whole task, since which field changed depends on which of those happened.',
    {
      id: z.string().min(1),
      date: z.string().nullable().describe('ISO date-time, or null to leave the task with no date.'),
    },
    async ({ id, date }) => {
      try {
        return json(withLink(await withWrite(() => deferTask(replica, id, date)), LINKS?.task(id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not reschedule the task.' });
      }
    }
  );

  server.tool(
    'archive_task',
    'Archive a task, taking it off every list and out of its project, or restore one with archived: false. This is how to undo a task you created by mistake: there is no delete, and an archived task can always be restored here or in the app. Archiving unpins it; restoring a repeating task starts its streak over, as the app does.',
    {
      id: z.string().min(1),
      archived: z.boolean().optional().describe('false restores an archived task. Defaults to true.'),
    },
    async ({ id, archived }) => {
      try {
        return json(await withWrite(() => archiveTask(replica, id, archived ?? true)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not archive the task.' });
      }
    }
  );

  server.tool(
    'add_grocery_item',
    "Put something on the home grocery list. A name the user has bought before re-lists the shelf item they already have, keeping its aisle, its history and its pantry state, rather than creating a second one. Singular and plural resolve to the same item. The result says which of those happened.",
    {
      name: z.string().min(1).describe('What to add. A leading amount is split off, so "2 gal milk" files milk with a quantity of 2 gal.'),
      quantity: z.string().nullable().optional().describe('Stated separately instead of being parsed out of the name.'),
      note: z.string().nullable().optional(),
    },
    async ({ name, ...rest }) => {
      try {
        return json(withLink(await withWrite(() => addGroceryItem(replica, name, rest)), LINKS?.groceries()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not add that.' });
      }
    }
  );

  server.tool(
    'check_off_grocery_item',
    'Check something off on the home grocery list, or un-check it with checked: false. Takes the item id from list_grocery_items.',
    { id: z.string().min(1), checked: z.boolean().optional().describe('Defaults to true.') },
    async ({ id, checked }) => {
      try {
        return json(withLink(await withWrite(() => setGroceryChecked(replica, id, checked ?? true)), LINKS?.groceries()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not check that off.' });
      }
    }
  );

  server.tool(
    'remove_from_grocery_list',
    'Take something off the home grocery list without deleting it. The shelf item stays in the catalog with its aisle, purchase history, prices and substitutes, so adding it again brings all of that back. There is deliberately no tool that deletes one.',
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(withLink(await withWrite(() => removeFromGroceryList(replica, id)), LINKS?.groceries()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not remove that.' });
      }
    }
  );
  const planStep = z.object({
    title: z.string().min(1),
    ...taskFieldsShape,
    subtasks: z.array(z.string()).optional().describe('A checklist under this step.'),
    after: z.array(z.number().int().min(0)).optional()
      .describe('Positions (from 0) of earlier steps in this plan that must be done first. The step stays hidden until they are.'),
    onlyIfAnswerTo: z.object({
      step: z.number().int().min(0).describe('Position (from 0) of an earlier step in this plan that asks a Yes/No or pick-one question.'),
      answers: z.array(z.string()).min(1),
    }).optional()
      .describe('onlyIfAnswer for a question in this same plan, which has no id yet.'),
  });

  server.tool(
    'create_project',
    'Create a project and its whole plan in one go: the project, its steps (each a full task: dates, estimates, repeats and the rest), each step\'s checklist, and which steps wait on earlier ones. Everything is checked first and written together, so a problem creates nothing and lists every issue. Scope it with the user before calling: agree on the steps, their order and what blocks what, then create it once. kind "list" is a running list with no dates (shopping ideas, questions for the doctor). The result is the project as get_project shows it.',
    {
      title: z.string().min(1),
      notes: z.string().optional(),
      deadline: z.string().nullable().optional().describe('ISO date to finish by. Shown on the project; schedules nothing.'),
      eventDate: z.string().nullable().optional().describe('ISO date of the day the project is for: the wedding, the move, the party. Separate from the deadline, since work happens on both sides of it. Steps can be dated from it with dueDaysFromEvent.'),
      category: z.string().nullable().optional().describe('A project category, for grouping on the Projects page.'),
      defaultTaskCategory: z.string().nullable().optional().describe('A task category (from list_categories) every step gets unless it names its own. Without it, every step needs its own category.'),
      newCategory: z.boolean().optional().describe('Create defaultTaskCategory as a new category.'),
      kind: z.enum(['project', 'list']).optional(),
      steps: z.array(planStep).optional(),
    },
    async input => {
      try {
        const result = await withWrite(() => createProject(replica, input as CreateProjectInput));
        return json(withLink(result, LINKS?.project(result.project.id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not create the project.' });
      }
    }
  );

  server.tool(
    'add_project_steps',
    'Add several steps to a project that already exists, in one go: each a full task, with its checklist and what it waits on. "after" names earlier steps in this same batch by position; "waitsOn" names tasks already in the app by id. Everything is checked first and written together, so a problem adds nothing and lists every issue. The result is the project as get_project shows it, plus the ids of the steps added (archive_task takes any of them back).',
    {
      projectId: z.string().min(1),
      steps: z.array(planStep).min(1),
    },
    async ({ projectId, steps }) => {
      try {
        return json(await withWrite(() => addProjectSteps(replica, projectId, steps as ProjectPlanStepInput[])));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not add the steps.' });
      }
    }
  );

  server.tool(
    'update_project',
    'Change a project: rename it, edit its notes, deadline or event date, re-file it, mark it complete, or archive it. Its tasks are not touched unless moveTasks asks for them to follow a new event date; add steps with add_project_steps and edit them with update_task.',
    {
      id: z.string().min(1),
      title: z.string().optional(),
      notes: z.string().optional(),
      deadline: z.string().nullable().optional(),
      eventDate: z.string().nullable().optional().describe('The day the project is for. Changing it leaves the tasks where they are unless moveTasks is set.'),
      moveTasks: z.boolean().optional().describe('With a new eventDate: move the project\'s dated tasks by the same number of days, as the app offers when the date is changed there. Ask the user first. Pinned, urgent and some other tasks are left in place and listed under notMoved.'),
      moveTasksFrom: z.string().optional().describe('Move the dated tasks after the event date has already been changed: the old event date. They move by the days from it to the event date now.'),
      category: z.string().nullable().optional(),
      defaultTaskCategory: z.string().nullable().optional(),
      newCategory: z.boolean().optional().describe('Create defaultTaskCategory as a new category.'),
      kind: z.enum(['project', 'list']).optional(),
      completed: z.boolean().optional(),
      archived: z.boolean().optional(),
    },
    async ({ id, moveTasks, moveTasksFrom, ...patch }) => {
      try {
        return json(withLink(await withWrite(() => updateProject(replica, id, patch, { moveTasks, moveTasksFrom })), LINKS?.project(id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not update the project.' });
      }
    }
  );

  server.tool(
    'plan_meal',
    'Put a meal on the plan: a recipe (recipeId) or just a title ("Leftovers", "Takeout"). The app scales a recipe to the household size it is set to.',
    {
      date: dayKey,
      slot: z.enum(KITCHEN_MEAL_SLOTS as unknown as [MealSlot, ...MealSlot[]]),
      recipeId: z.string().nullable().optional(),
      title: z.string().optional().describe('Needed when there is no recipe; otherwise the recipe\'s name is used.'),
    },
    async input => {
      try {
        const result = await withWrite(() => planMeal(replica, input));
        return json(withLink(result, LINKS?.mealPlan(result.date)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not plan the meal.' });
      }
    }
  );

  server.tool(
    'add_person_history',
    'Record something the user did with one or more people ("Coffee with Sam", "Called Mom"), on a day that has already happened. This is how the app keeps history with someone: it is the only change these tools can make to the people section.',
    {
      personIds: z.array(z.string().min(1)).min(1),
      title: z.string().min(1),
      date: z.string().optional().describe('ISO date or date-time it happened. Defaults to now.'),
    },
    async input => {
      try {
        return json(withLink(await withWrite(() => addPersonHistory(replica, input)), LINKS?.person(input.personIds[0])));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not add that to their history.' });
      }
    }
  );
}

/**
 * The two routes `httpSyncTransport` speaks to.
 *
 * Deliberately dumb, and deliberately not versioned: the payload is opaque and
 * the cursor is the store's own, so there is nothing here for a schema change
 * to break. See syncStore.ts.
 */
function mountSyncStore(app: express.Express, store: SyncStore): void {
  const guard = (req: Request, res: Response): boolean => {
    const verdict = authorize(req.header('authorization'), process.env.SYNC_AUTH_TOKEN);
    if (verdict.ok) return true;
    if (verdict.challenge) res.set('WWW-Authenticate', verdict.challenge);
    res.status(401).json({ error: verdict.reason });
    return false;
  };

  app.post('/sync/push', (req: Request, res: Response) => {
    if (!guard(req, res)) return;

    const payload = (req.body as { payload?: unknown } | undefined)?.payload;
    if (typeof payload !== 'string' || payload === '') {
      res.status(400).json({ error: 'Expected a non-empty string payload.' });
      return;
    }

    store.push(payload);
    res.status(204).end();
  });

  app.get('/sync/pull', (req: Request, res: Response) => {
    if (!guard(req, res)) return;

    const since = typeof req.query.since === 'string' ? req.query.since : null;
    res.json(store.pull(since));
  });

  // Once at boot rather than on a timer: the horizon is 90 days, so a process
  // that restarts monthly still prunes often enough, and a cron nobody can see
  // is a worse way to lose data than a restart somebody can.
  const pruned = store.prune(DEFAULT_RETENTION_DAYS);
  if (pruned > 0) console.error(`sync store: pruned ${pruned} payloads past ${DEFAULT_RETENTION_DAYS} days`);
}


/** An OAuthRefusal as the SDK error class the token endpoint reports. */
function sdkError(e: unknown): unknown {
  if (!(e instanceof OAuthRefusal)) return e;
  const byCode: Record<OAuthRefusal['code'], new (message: string) => OAuthError> = {
    invalid_grant: InvalidGrantError,
    invalid_token: InvalidTokenError,
    invalid_request: InvalidRequestError,
    invalid_target: InvalidTargetError,
  };
  return new byCode[e.code](e.message);
}

const rethrown = <T>(fn: () => T): Promise<T> => {
  try {
    return Promise.resolve(fn());
  } catch (e) {
    return Promise.reject(sdkError(e));
  }
};

/** oauth.ts's store as the SDK's provider. Mapping only; the rules are there. */
function oauthProvider(store: OAuthStore): OAuthServerProvider {
  const asClient = (c: OAuthClientInformationFull) => c as unknown as OAuthClient;
  return {
    clientsStore: {
      getClient: id => store.getClient(id) as OAuthClientInformationFull | undefined,
      registerClient: client => store.registerClient(client as never) as unknown as OAuthClientInformationFull,
    },
    async authorize(client, params, res) {
      // The page posts to /oauth/approve, which checks the password.
      res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
      res.setHeader('X-Frame-Options', 'DENY');
      res.type('html').send(
        store.approvalPage({
          client: asClient(client),
          redirectUri: params.redirectUri,
          codeChallenge: params.codeChallenge,
          state: params.state,
          resource: params.resource,
        })
      );
    },
    challengeForAuthorizationCode: (client, code) => rethrown(() => store.challengeForAuthorizationCode(asClient(client), code)),
    exchangeAuthorizationCode: (client, code, _verifier, redirectUri, resource) =>
      rethrown(() => store.exchangeAuthorizationCode(asClient(client), code, redirectUri, resource)),
    exchangeRefreshToken: (client, refreshToken, scopes, resource) =>
      rethrown(() => store.exchangeRefreshToken(asClient(client), refreshToken, scopes, resource)),
    verifyAccessToken: token => rethrown(() => store.verifyAccessToken(token)),
    revokeToken: (client, request) => rethrown(() => store.revokeToken(asClient(client), request.token)),
  };
}

/**
 * Mounts OAuth when it is configured, and returns the store for /mcp to check
 * tokens against, or null when the chat connector is off.
 */
function mountOAuth(app: express.Express): { store: OAuthStore; resourceMetadataUrl: string } | null {
  const problem = oauthConfigProblem(process.env.MCP_OAUTH_PASSWORD, process.env.PUBLIC_URL);
  if (problem) {
    console.error(problem);
    return null;
  }
  const base = new URL(process.env.PUBLIC_URL!);
  const resource = new URL('/mcp', base);
  const store = openOAuthStore(process.env.OAUTH_STORE_PATH ?? ':memory:', {
    password: process.env.MCP_OAUTH_PASSWORD!,
    writesEnabled: !!process.env.MCP_WRITE_TOKEN,
    resource,
  });
  if (!process.env.OAUTH_STORE_PATH) console.error('OAUTH_STORE_PATH is unset: chat connections will not survive a restart.');

  app.use(
    mcpAuthRouter({
      provider: oauthProvider(store),
      issuerUrl: base,
      resourceServerUrl: resource,
      scopesSupported: [SCOPE_READ, SCOPE_WRITE],
      resourceName: 'dundundun',
      // Never expire a registered client's secret: the chat would have to be
      // reconnected by hand every 30 days for no gain, since the password is
      // what actually guards the door.
      clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
    })
  );

  // The password form. Rate limited hard, since it is the one thing a guesser
  // can aim at.
  app.post(
    '/oauth/approve',
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }),
    express.urlencoded({ extended: false }),
    (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
      res.setHeader('X-Frame-Options', 'DENY');
      const result = store.approve(req.body ?? {});
      if (result.ok) {
        res.redirect(302, result.redirect);
      } else if (result.pending) {
        res.status(result.status).type('html').send(store.approvalPage(result.pending, result.error));
      } else {
        res.status(result.status).type('text').send(result.error);
      }
    }
  );

  console.error(`Claude chat connector: add ${resource.href} as a custom connector.`);
  return { store, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource) };
}

async function main(): Promise<void> {
  const dbPath = process.env.TODO_DB_PATH;
  if (!dbPath) {
    console.error('Set TODO_DB_PATH to the todo.db this server should serve. See mcp/README.md.');
    process.exit(1);
  }

  // Order is load-bearing: the shim has to be in the module cache before
  // anything requires the db layer. replica.ts says why at length.
  installExpoSqliteShim(dbPath);
  const replica = openReplica(dbPath);

  const app = express();
  // Behind Fly's proxy, which is the one hop that sets X-Forwarded-For. The
  // OAuth rate limits key on the caller's address and would otherwise see
  // every request as coming from the proxy.
  app.set('trust proxy', 1);
  // Payloads are whole change sets, so the default 100kb body limit is too
  // small for a device catching up after a long offline stretch.
  app.use(express.json({ limit: '32mb' }));

  // Two services, one process, two tokens. They deploy together and share the
  // auth seam, which is why they are one package; they are addressed to
  // different callers (Claude vs the user's own devices) and so must not share
  // a secret. Handing the phone's token to a model, or the reverse, is the one
  // mistake a single token would make easy.
  if (process.env.SYNC_STORE_PATH) {
    mountSyncStore(app, openSyncStore(process.env.SYNC_STORE_PATH));
  }

  // The two routes universal links need (see appLinks.ts). Apple fetches the
  // association file itself, through its CDN, and wants it as plain JSON with
  // no redirect; the fly.toml https redirect is fine, since Apple asks over https.
  app.get('/.well-known/apple-app-site-association', (_req: Request, res: Response) => {
    const body = appSiteAssociation(process.env.APPLE_TEAM_ID, process.env.APP_BUNDLE_ID ?? 'com.fdsimms.dundundun');
    if (!body) {
      res.status(404).json({ error: 'APPLE_TEAM_ID is unset, so this server associates with no app.' });
      return;
    }
    res.type('application/json').send(JSON.stringify(body));
  });
  // Reached only when the app didn't catch the link: a desktop, or a phone
  // without the associated build.
  app.get('/open/:path', (req: Request, res: Response) => {
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    const appUrl = appUrlForOpenPath(String(req.params.path), query);
    if (!appUrl) {
      res.status(404).type('text').send('Not a link this app opens.');
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.type('html').send(openPage(appUrl));
  });

  const oauth = mountOAuth(app);

  // The static tokens first (Claude Code, curl), then an OAuth access token
  // (the chat connector). A token that is neither gets the challenge that
  // points an OAuth client at the metadata, when OAuth is on.
  const scopeOf = (authorization: string | undefined): AuthScope | null => {
    const fixed = scopeFor(authorization, process.env.MCP_AUTH_TOKEN, process.env.MCP_WRITE_TOKEN);
    if (fixed || !oauth) return fixed;
    const token = bearerToken(authorization);
    if (!token) return null;
    try {
      const verified = oauth.store.verifyAccessToken(token);
      return verified.scopes.includes(SCOPE_WRITE) && process.env.MCP_WRITE_TOKEN ? 'write' : 'read';
    } catch {
      return null;
    }
  };

  app.post('/mcp', async (req: Request, res: Response) => {
    const scope = scopeOf(req.header('authorization'));
    if (scope === null) {
      if (oauth) {
        res.set('WWW-Authenticate', `Bearer resource_metadata="${oauth.resourceMetadataUrl}"`);
        res.status(401).json({ error: 'Not authorized.' });
        return;
      }
      const verdict = authorize(req.header('authorization'), process.env.MCP_AUTH_TOKEN);
      if (verdict.challenge) res.set('WWW-Authenticate', verdict.challenge);
      res.status(401).json({ error: verdict.reason });
      return;
    }

    // Stateless: a transport per request, so there is no session table to
    // outlive a restart and nothing to clean up when a client goes away. No
    // tool, read or write, depends on anything from an earlier request, so
    // there is no continuity to lose.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => void transport.close());

    await buildMcpServer(replica, scope).connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(PORT, () => {
    console.error(`todo MCP server on :${PORT}, serving ${replica.path}`);
    if (!process.env.MCP_AUTH_TOKEN) {
      console.error(
        process.env.MCP_WRITE_TOKEN
          ? 'MCP_AUTH_TOKEN is unset: only callers presenting MCP_WRITE_TOKEN will be served.'
          : 'MCP_AUTH_TOKEN is unset: every MCP request will be refused.'
      );
    }
    if (!process.env.MCP_WRITE_TOKEN) console.error('MCP_WRITE_TOKEN is unset: this server is read-only.');
    if (!process.env.SYNC_STORE_PATH) {
      console.error('SYNC_STORE_PATH is unset: the sync store is not mounted, so the replica cannot be a peer.');
    } else if (!process.env.SYNC_AUTH_TOKEN) {
      console.error('SYNC_AUTH_TOKEN is unset: every sync request will be refused.');
    }
  });
}

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
