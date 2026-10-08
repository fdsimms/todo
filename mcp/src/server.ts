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
  DEFAULT_LOG_DAYS,
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
  applyTemplate,
  deleteTemplate,
  getTemplate,
  reopenTask,
  reorderTemplates,
  updateTemplate,
  templateLibraryCheck,
  completeTask,
  markDoneByOther,
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
import { assignToStack, createStack, deleteStack, listStacks, renameStack, updateStack } from './stackTools';
import { claimReward, createReward, deleteReward, getRewards, markMissed, setBounty, setRewardGoal, setSlip, unclaimReward, updateReward } from './rewardTools';
import { addProjectSteps, createProject, deleteProject, getProject, nextInProject, reorderProjects, saveProjectAsTemplate, saveProjectCategory, startFreshProject, updateProject, type CreateProjectInput, type ProjectPlanStepInput } from './projectTools';
import { addChoiceToList, addIngredientsToList, clearGroceryList, createGroceryList, deleteGroceryItem, deleteGroceryList, finishGroceryTrip, getGroceryItem, grocerySetup, importReceipt, markUnavailable, matchReceipt, mergeGroceryItems, renameGroceryList, reorderAisles, reorderGroceryPlaces, resolveList, saveAisle, saveGroceryBox, saveStore, setNutritionPanel, setShoppingTrip, settleChoice, swapForSubstitute, updateGroceryItem, updateStore } from './groceryTools';
import { PANTRY_FILTERS, addToPantry, answerPantryReview, getPantryItem, listPantry, logLeftover, pantryReview, deleteLeftover, splitLeftover, updateLeftover, updatePantryBox, updatePantryItem, useUpRecipes } from './pantryTools';
import { deleteCookbook, deleteIndexEntry, getCookbookIndex, listCookbooks, logCookTime, mergeCookbooks, recipeFromIndexEntry, renameCookbook, reorderUpNext, saveIndexEntry } from './recipeTools';
import { DEFAULT_PLAN_DAYS, MAX_PLAN_DAYS, MEAL_SLOTS as KITCHEN_MEAL_SLOTS, copyMeals, getRecipe, listMealPlan, listRecipes, planMeal, removeMeal, saveMealAsRecipe, setMealCooked, updateMeal } from './kitchenTools';
import { DEFAULT_BIRTHDAY_DAYS, MAX_BIRTHDAY_DAYS, addPersonHistory, addPersonNote, createPerson, deletePerson, deletePersonNote, reorderPeople, savePersonGroup, updatePerson, updatePersonNote, getPerson, listPeople, upcomingBirthdays } from './peopleTools';
import { appLinks, appSiteAssociation, appUrlForOpenPath, openPage } from './appLinks';
import { ANCHORS, CONTAINERS, QUESTION_KINDS, QUESTION_SOURCES, SCHEDULE_FREQUENCIES } from './templatePlan';
import { DEFAULT_AGENDA_DAYS, DEFAULT_HISTORY_DAYS, DEFAULT_MIN_PUSHES, DEFAULT_STALE_DAYS, MAX_AGENDA_DAYS, completionHistory, getAgenda, getOverview, reviewTasks } from './insightTools';
import { DEFAULT_HELP_LIMIT, appHelp } from './helpTools';
import { DEFAULT_SUGGESTION_LIMIT, unusedFeatures } from './adoptionTools';
import { SERVER_INSTRUCTIONS } from './instructions';
import { annotationsFor } from './toolAnnotations';
import { createConfirmTokens, describeEffects, type ConfirmTokens } from './confirmWrites';
import type { AgentLedgerEntry } from './agentLedger';
import { PROMPTS } from './prompts';
import { forget, remember } from './memoryTools';
import { deleteRule, listAutomations, saveRule, setAutomation, RULE_TYPES } from './automationTools';
import { deleteCategory, reorderCategories, updateCategory } from './categoryTools';
import { cancelCalendarRequest, changeCalendarEvent, listCalendarRequests, requestCalendarEvent } from './calendarTools';
import { NUTRIENT_KEY_LIST, atFrom, deleteSavedMeal, duplicateFoodEntry, listSavedMeals, logSavedMeal, moveFoodEntry, saveMealFromEntries, setNutritionTargets, renameMoodTag, setMedicationArchived, logFood, logMedication, logMood, logWater, updateRecipe, deleteRecipe, updateFoodEntry, deleteFoodEntry, updateMoodLog, deleteMoodLog, updateMedicationLog, deleteMedicationLog, saveRecipe } from './logTools';
import { DEFAULT_PATTERN_DAYS, focusHistory, habitPatterns, moodInsights } from './patternTools';
import { addMilestone, deleteMilestone, listMilestones, updateMilestone } from './milestoneTools';
import { deleteJournalEntry, listJournalEntries, logJournalEntry, updateJournalEntry } from './journalTools';
import { SAVED_VIEW_TASK_LIMIT, createSavedView, deleteSavedView, getSavedView, listSavedViews, updateSavedView } from './savedViewTools';
import { setVacationMode } from './vacationTools';
import { getSettings, updateSettings } from './settingsTools';
import { SETTINGS_SPEC } from './settingsSpec';
import { MAX_DELETE, deleteTag, deleteTasks, duplicateTask, reorderTasks, setCompletionDate, setTaskDates, skipOccurrence } from './taskTools';
import { MAX_BATCH, MAX_QUICK_ADD, batchUpdateTasks, planDay, quickAdd, rebalanceWeek, type BatchChange } from './agentTools';
import { SERVER_ICONS } from './serverIcon';
import { generateId } from '../../src/utils/id';

/** `YYYY-MM-DD`, the shape every day-keyed table stores and sorts on. */
// A rotation member: a name, or a name with how many times a week.
const rotationMemberSchema = z.union([
  z.string().min(1),
  z.object({ title: z.string().min(1), timesPerWeek: z.number().int().min(1).max(7).optional() }),
]);
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
const CONFIRM_NOTE = 'Every write previews first. Call preview_change with this tool\'s name and arguments (it is read-only and needs no approval): it changes nothing and returns willDo (what would change, in plain words) and a confirmToken. Show the person willDo and wait for their yes, then call this tool with the same arguments plus apply: true, the confirmToken and willDo repeated exactly. Calling this tool without apply also previews, but asks for approval like a write.';

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
  const server = new McpServer({ name: 'dundundun', version: '0.1.0', icons: SERVER_ICONS }, { instructions: SERVER_INSTRUCTIONS });

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
    // One confirmed write is one batch in Activity (UnattendedEntry.batchId).
    const result = replica.withBatch(generateId(), fn);
    await gate.afterWrite();
    return result;
  };

  /** Set while a write tool is previewing; collects what the write would record in Activity. */
  let previewing: AgentLedgerEntry[] | null = null;

  server.tool(
    'get_settings',
    "The person's settings that can be changed from here, grouped as in Settings, each with its value and what it does: when the day starts and its parts, task defaults, what is switched on (the kitchen, simplified mode, rewards), the kitchen's units, and each automation's own timing.",
    {},
    async () => json(await withFresh(() => getSettings(replica)))
  );

  server.tool(
    'list_tasks',
    "Tasks in one of the app's own lenses: today (visible now), later (deferred or not yet due), unscheduled, inbox, all, or archived (put away with archive_task, as the Archived screen lists them; every other view leaves those out).",
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
    'One task in full: its subtasks, its chain steps, its project, and why it is not on Today if it is not (hiddenUntil for a moment it will surface at, hiddenReason for a task held while vacation mode is on). Also the rules behind a deadline or reminder that is recomputed each occurrence, and whether a water target follows the food log\'s goal.',
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
    'The home grocery list, with whether each item is checked off there. Pass list to read a separate list (a trip\'s, say) instead. Pass onListOnly: false to search the whole catalog.',
    { onListOnly: z.boolean().optional(), list: z.string().optional().describe('A separate list by name or id (see grocery_setup). The list at home when omitted.') },
    async ({ list, ...input }) => json(await withFresh(() => listGroceryItems(replica, { ...input, listId: resolveList(replica, list)?.id ?? null })))
  );

  server.tool(
    'grocery_setup',
    "The grocery setup: the aisles, the stores (with their receipt style), and the lists (the list at home and any separate ones, with item counts). Start here before filing an item in an aisle, linking a store or using a separate list.",
    {},
    async () => json(await withFresh(() => grocerySetup(replica)))
  );

  server.tool(
    'get_grocery_item',
    "Everything recorded about one grocery item: aisle, quantity, note, last price, brands (boxes), the stores it comes from, substitutes, the lists it is on, and the names receipts print for it. Takes an id from list_grocery_items or a name. For its pantry state use get_pantry_item.",
    { id: z.string().optional(), name: z.string().optional() },
    async input => {
      try {
        return json(await withFresh(() => getGroceryItem(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not read that item.' });
      }
    }
  );

  const receiptLineRead = z.object({
    label: z.string().min(1).describe('The line exactly as printed, abbreviations and all.'),
    name: z.string().min(1).describe('The same line as a shopper would say it ("milk"). This is what gets matched.'),
    quantity: z.string().optional(),
    priceMinor: z.number().int().positive().nullable().optional().describe('The price in minor units (cents). Null or omitted when the line has none.'),
  });

  server.tool(
    'match_receipt',
    "Read a receipt against the catalog, with the app's own matching. You read the receipt (photo or text) and pass its lines here; this server cannot see images. Names this store printed before are matched first (remembered), then exact, likely and weak matches. scope list reads lines against what is on a list (a shopping trip), catalog against everything (the pantry). Writes nothing: show the person what you are unsure of, then call import_receipt with decisions.",
    {
      store: z.string().optional().describe('The store name printed at the top. Matched to the stores in grocery_setup.'),
      scope: z.enum(['list', 'catalog']).optional(),
      list: z.string().optional().describe('For scope list: a separate list. The list at home when omitted.'),
      lines: z.array(receiptLineRead).min(1).max(100),
    },
    async ({ lines, ...rest }) => {
      try {
        return json(await withFresh(() => matchReceipt(replica, { ...rest, lines })));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not match that receipt.' });
      }
    }
  );

  server.tool(
    'list_pantry',
    "What is in the kitchen: the pantry (groceries the app has a reason to think are on hand), the fridge (leftovers) and the freezer, each with the app's reason, use-by day and how fresh it is. Use filter: use_up for what is at or near its use-by day. The list is only what the app has a reason to believe, so an item missing from it may still be on a shelf: use get_pantry_item or ask the person. There are no quantities, on purpose.",
    {
      query: z.string().optional().describe('Matches a name, brand or section.'),
      filter: z.enum(PANTRY_FILTERS).optional(),
      limit: z.number().int().positive().optional(),
    },
    async input => json(await withFresh(() => listPantry(replica, input)))
  );

  server.tool(
    'get_pantry_item',
    "Everything the app records about one item's place in the kitchen: whether it counts as on hand and why, its use-by day, opened and frozen state, shelf life, running-low and staple flags, purchase history, how often it went to waste, and its boxes (brands, packets, frozen portions). A status of unknown means the app has no opinion, which is not the same as out. Takes an id from list_grocery_items or list_pantry, or a name.",
    { id: z.string().optional(), name: z.string().optional() },
    async input => {
      try {
        return json(await withFresh(() => getPantryItem(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not read that item.' });
      }
    }
  );

  server.tool(
    'pantry_review',
    "The pantry review deck the app deals: items whose 'you probably have it' is a guess that has lapsed or an answer that is old, at most 20. Ask the person about each one and record what they say with answer_pantry_review. Never answer on their behalf.",
    {},
    async () => json(await withFresh(() => pantryReview(replica)))
  );

  server.tool(
    'use_up_recipes',
    "What is at or past its use-by day, and the recipes that would use some of it, the one using the most first. Groceries only, not leftovers.",
    {},
    async () => json(await withFresh(() => useUpRecipes(replica)))
  );

  server.tool(
    'list_cookbooks',
    'The person\'s cookbooks, with how many saved recipes and index lines each holds.',
    {},
    async () => json(await withFresh(() => listCookbooks(replica)))
  );

  server.tool(
    'get_cookbook_index',
    'One cookbook\'s index: the dishes in it, each with its page and main ingredients. An index line is a pointer to a page, not a saved recipe; recipe_from_index_entry makes one from it.',
    { cookbookId: z.string().min(1) },
    async ({ cookbookId }) => {
      try {
        return json(await withFresh(() => getCookbookIndex(replica, cookbookId)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not read that index.' });
      }
    }
  );

  server.tool(
    'list_saved_meals',
    'The person\'s saved meals: foods they log together under one name ("Usual breakfast"), to log again in one go with log_saved_meal.',
    {},
    async () => json(await withFresh(() => listSavedMeals(replica)))
  );

  server.tool(
    'list_food_log',
    'Logged food over a range of days, with summed nutrients and, in produce, an estimate of vegetable and fruit servings per day: 80 g servings, beans count once a day, rounded to the nearest half. It is read from food names and weights, so a food not named as produce counts as none, and unmeasured is how many entries that day could not be weighed and are not counted. Say it is an estimate, and say when unmeasured is above zero. A nutrient nobody logged is absent rather than zero. Defaults to the last 7 days. Empty unless the person has turned on Include health logs for the sync server on their phone, so an empty result is not evidence that nothing was logged.',
    logRange,
    async input => json(await withFresh(() => listFoodLog(replica, input)))
  );

  server.tool(
    'list_calendar_requests',
    'Events you asked the phone to add with request_calendar_event, newest first, and what happened to each: pending (waiting for the phone to sync), written (on the calendar), failed (with the reason), or cancelled. Also whether any device is set to add them. Answered requests are kept for 30 days. This is not their calendar: the server still cannot see it.',
    { status: z.enum(['pending', 'written', 'failed', 'cancelled']).optional() },
    async input => json(await withFresh(() => listCalendarRequests(replica, input)))
  );

  server.tool(
    'list_journal_entries',
    'Journal entries and dreams the person wrote, over a range of days, newest first. kind narrows to one ("journal" or "dream"). Defaults to the last 7 days. Empty unless the person has turned on Include journal and dreams for the sync server on their phone (its own switch, separate from health logs), so an empty result is not evidence that nothing was written; if they want you to see it, tell them where the switch is. Quote or summarize only what they ask about; never interpret a dream or read meaning into an entry.',
    { ...logRange, kind: z.enum(['journal', 'dream']).optional() },
    async input => json(await withFresh(() => listJournalEntries(replica, input)))
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
    'list_milestones',
    'The days something changed in the person\'s life that they have marked on the mood log ("Started sertraline", "New job"), each with its date. mood_insights reads mood before and after each one, under its own minimum-days rules; a start and a later stop are two milestones and are never paired. Empty unless the person has turned on Include health logs for the sync server on their phone.',
    {},
    async () => json(await withFresh(() => listMilestones(replica)))
  );

  server.tool(
    'focus_history',
    `Finished focus sessions over a range of days (default ${DEFAULT_LOG_DAYS}, up to ${MAX_LOG_DAYS}), as the Stats screen reads them: worked and rested minutes, how work stretches ran against their planned length (only once there are enough), how many offered breaks were taken, and each session's steps with the task behind each. History only: a session in progress lives on the phone and does not sync, so this cannot say what the person is working through right now, or start, pause or advance a session. Ask them.`,
    logRange,
    async input => json(await withFresh(() => focusHistory(replica, input)))
  );

  server.tool(
    'list_saved_views',
    'The person\'s saved views: each a named lens over every open task (across Today, Later, Unscheduled and Inbox at once) built from clauses a task has to pass, with the clauses in words and how many tasks it holds right now. Refer to one by its name.',
    {},
    async () => json(await withFresh(() => listSavedViews(replica)))
  );

  server.tool(
    'get_saved_view',
    `One saved view, by name or id, and the tasks it holds right now, in the app's own order (up to ${SAVED_VIEW_TASK_LIMIT}; the result says when there were more).`,
    {
      view: z.string().min(1).describe('The view\'s name (case does not matter) or its id from list_saved_views.'),
      limit: z.number().int().min(1).max(SAVED_VIEW_TASK_LIMIT).optional(),
    },
    async ({ view, limit }) => {
      try {
        return json(await withFresh(() => getSavedView(replica, view, limit)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not read that view.' });
      }
    }
  );

  server.tool(
    'list_templates',
    'Stored task templates: name, category, how many items, the item groups, and the questions a run asks. Use this to find a template to nest inside another.',
    {},
    async () => json(await withFresh(() => listTemplates(replica)))
  );

  server.tool(
    'template_library_check',
    'Check every template at once. Per template: problems a run mishandles now (a nested template that no longer exists, a condition on a deleted question, a wait on an item that is gone) and warnings (a {blank} no question fills, a question nothing uses, settings a run drops). Across templates: runs of items copied into several templates (worth moving into one template and nesting it), and pairs of templates that are near-copies (worth merging into one with a choice question). It changes nothing: each finding says what an update_template would do, and the person approves that edit.',
    {},
    async () => json(await withFresh(() => templateLibraryCheck(replica)))
  );

  server.tool(
    'get_template',
    'One template in full, in the same shape create_template and update_template take: its items (each with an id), item groups (keyed by id), questions, schedule and container, plus its version. Read it before editing a template, since update_template changes only what you name, and pass the version back as expectedVersion. Handing back what it returns unchanged keeps the template exactly as it is.',
    { template: z.string().describe('A template id, or its exact name when that names only one (list_templates).') },
    async ({ template }) => {
      const found = await withFresh(() => getTemplate(replica, template));
      return json(found ?? { error: `No template with id or name "${template}".` });
    }
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
    'next_in_project',
    "The next unchecked checklist item in one project step, without the rest of the project. With no step given, the step is the first open one, in the project's own order, that is not waiting on anything. Returns the step, the item (null when its checklist is finished or it has none) and how many items are checked. Use get_project when you need more than that.",
    {
      project: z.string().min(1).describe('A project id (list_projects).'),
      step: z.string().optional().describe('A step of that project by task id, from get_project. Leave out for the current step.'),
    },
    async ({ project, step }) => {
      const result = await withFresh(() => nextInProject(replica, project, step));
      return result ? json(withLink(result, LINKS?.project(project))) : json({ error: `No project with id ${project}.` });
    }
  );

  server.tool(
    'list_stacks',
    'Stacks: named groups of tasks that sit together on Today, each with its category and its open tasks in order. A stack is only a label, so every task in it keeps its own schedule, streak and logging. A task shows which stack it is in as stackId.',
    {},
    async () => json({ stacks: await withFresh(() => listStacks(replica)) })
  );

  server.tool(
    'get_rewards',
    "The coin economy: whether rewards are on, the balance, the reward being saved for and how far along it is, every reward on the list (cost, whether the balance covers it now, how many coins short, when it was last claimed), the tasks with a live coin bounty, and the latest coin history (what earned, what was lost, what was spent). Read it before claiming or pricing anything. A balance can be below zero. When enabled is false the person has rewards switched off, so do not bring them up.",
    { historyLimit: z.number().int().min(0).max(100).optional().describe('How many history entries, newest first. Default 15.') },
    async input => json(await withFresh(() => getRewards(replica, input)))
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
    `Things in the list worth a second look, for a cleanup or weekly review: overdue tasks (oldest first), Inbox items left untriaged over a week, Unscheduled tasks older than staleDays (default ${DEFAULT_STALE_DAYS}), open tasks that look like duplicates, active projects with nothing finished in three weeks, open tasks pushed to a later day at least minPushes times (default ${DEFAULT_MIN_PUSHES}, most pushed first, each with its postponed.since and blockers; the stuck ones, even when never overdue), and the repeating tasks missed most often. It lists, it does not judge: ask the person what they want done with any of it before changing anything.`,
    { staleDays: z.number().int().positive().max(3650).optional(), minPushes: z.number().int().positive().max(100).optional() },
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
    'unused_features',
    `App features this person's own data suggests they would get something from and are not using: for example many open tasks and no time estimates, or several projects and no templates. Each suggestion carries what was seen, what the feature does, and the Settings path when it is a setting. Raise a few at a time (default ${DEFAULT_SUGGESTION_LIMIT}) as options, never as a fault. If the person declines one, offer to remember that, naming its id, and it will not come up again. Features in areas they have switched off are never suggested.`,
    { limit: z.number().int().positive().max(20).optional() },
    async input => json(await withFresh(() => unusedFeatures(replica, input)))
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
    const writes = new Map<string, { shape: Record<string, z.ZodTypeAny>; cb: WriteCallback }>();
    /** The dry run, shared by a write called without apply and by preview_change. */
    const preview = async (name: string, request: Record<string, unknown>, cb: WriteCallback, extra: unknown) => {
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
      const described = describeEffects(effects, replica.dayKeyOf);
      const willDo = described.length > 0 ? described : ['Nothing in the app would change.'];
      return json({
        preview: true,
        willDo,
        ...(details !== undefined ? { details: withoutIds(details) } : {}),
        confirmToken: tokens.issue(name, request, willDo),
        next: `Nothing has changed yet. Tell the person, in plain words, what willDo says, and wait for a yes. Then call ${name} with exactly the same arguments, apply: true, this confirmToken and willDo repeated exactly.`,
      });
    };
    const guarded = (
      name: string,
      description: string,
      shape: Record<string, z.ZodTypeAny>,
      cb: WriteCallback,
    ) => {
      writes.set(name, { shape, cb });
      return plain(
        name,
        `${description} ${CONFIRM_NOTE}`,
        {
          ...shape,
          apply: z.boolean().optional().describe('Leave out to preview. true, with confirmToken and willDo, to make the change.'),
          confirmToken: z.string().optional().describe('From the preview of this exact request.'),
          willDo: z.array(z.string()).optional().describe("The preview's willDo lines, repeated exactly. They are what the approval prompt shows the person."),
        },
        async (args: Record<string, unknown>, extra: unknown) => {
          const { apply, confirmToken, willDo, ...request } = args;
          if (!apply) return preview(name, request, cb, extra);
          if (typeof confirmToken !== 'string') {
            return json({ error: 'Preview first: call preview_change with this tool and its arguments, show the person what willDo says, then confirm with the confirmToken it returns.' });
          }
          const redeemed = tokens.redeem(confirmToken, name, request, Array.isArray(willDo) ? willDo as string[] : []);
          if (!redeemed.ok) return json({ error: redeemed.reason });
          return cb({ ...request, apply: true }, extra);
        },
      );
    };
    (server as unknown as { tool: unknown }).tool = guarded;
    registerWriteTools(server, replica, withWrite);
    (server as unknown as { tool: typeof plain }).tool = plain;
    // The preview as its own read-only tool (annotations: toolAnnotations.ts),
    // so looking at a change does not ask for the approval the change does.
    server.tool(
      'preview_change',
      'Shows what a write tool would change, in plain words, without changing anything. Pass the write tool\'s name and the arguments you would give it (no apply). Returns willDo and a confirmToken. Show the person willDo and wait for their yes, then call the write tool itself with the same arguments plus apply: true, the confirmToken and willDo repeated exactly.',
      {
        tool: z.string().describe('The name of a write tool, such as update_task or complete_task.'),
        arguments: z.record(z.unknown()).optional().describe('The arguments you would pass that tool, without apply, confirmToken or willDo.'),
      },
      async ({ tool, arguments: raw }, extra: unknown) => {
        const target = writes.get(tool);
        if (!target) return json({ error: `${tool} is not a write tool here. Preview one of: ${[...writes.keys()].sort().join(', ')}.` });
        const { apply: _a, confirmToken: _c, willDo: _w, ...given } = (raw ?? {}) as Record<string, unknown>;
        const parsed = z.object(target.shape).safeParse(given);
        if (!parsed.success) return json({ error: `Those are not valid arguments for ${tool}: ${parsed.error.issues.map(i => `${i.path.join('.') || 'arguments'}: ${i.message}`).join('; ')}` });
        return preview(tool, parsed.data as Record<string, unknown>, target.cb, extra);
      },
    );
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
  values: z.array(z.string()).min(1).describe('Which of that question\'s options switch this item on. Any one of them is enough.'),
});

const variantSchema = z.object({
  question: z.string().describe('The name of a choice question defined in this plan.'),
  answer: z.string().describe('One of that question\'s options.'),
  title: z.string().optional().describe('Replaces the item\'s title for this answer. Omit to keep it.'),
  notes: z.string().optional().describe('Replaces the item\'s notes for this answer. Omit to keep them.'),
});

const itemSchema = z.object({
  id: z.string().optional().describe('Update only: the id of an item this template already has (get_template). It starts from the stored item and the other fields here change it.'),
  title: z.string().min(1).optional().describe('Required, except when id names an item that already has one.'),
  notes: z.string().optional(),
  optional: z.boolean().optional().describe('Starts unticked in a run. A condition replaces this rather than stacking with it.'),
  anchor: z.enum(ANCHORS as unknown as [string, ...string[]]).optional().describe('Which anchor date the offsets below count from.'),
  dueOffsetDays: z.number().int().nullable().optional(),
  deferOffsetDays: z.number().int().nullable().optional(),
  deadlineOffsetDays: z.number().int().nullable().optional(),
  deadlineTime: z.string().nullable().optional().describe('HH:MM (24-hour) the deadline closes at on its day. Needs deadlineOffsetDays; dropped without one.'),
  windowStart: z.string().nullable().optional().describe('HH:MM.'),
  windowEnd: z.string().nullable().optional().describe('HH:MM.'),
  windowStartSun: z.string().nullable().optional()
    .describe('Makes the window start follow the sun: "sunrise", "sunset", or either with a minutes offset of up to 180 ("sunset-30"). Needs windowStart beside it, the clock time to fall back to (roughly that event\'s time now).'),
  windowEndSun: z.string().nullable().optional()
    .describe('The same for the window end ("sunset" for "before dark"). Needs windowEnd beside it.'),
  reminderOffsetMinutes: z.number().int().nullable().optional(),
  timeSegments: z.array(z.enum(TIME_SEGMENTS as unknown as [TimeOfDay, ...TimeOfDay[]])).optional(),
  tags: z.array(z.string()).optional(),
  category: z.string().nullable().optional(),
  priority: z.number().int().min(0).max(4).optional(),
  effort: z.number().int().min(0).max(6).optional(),
  difficulty: z.enum(['trivial', 'easy', 'normal', 'hard']).optional(),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  recurrenceType: z.enum(['none', 'daily', 'weekly', 'monthly', 'yearly', 'hours']).optional(),
  recurrenceInterval: z.number().int().positive().optional(),
  recurrenceDays: z.array(z.number().int().min(0).max(6)).optional(),
  recurrenceMonthDay: z.number().int().min(1).max(31).nullable().optional(),
  recurrenceMonth: z.number().int().min(1).max(12).nullable().optional().describe('Yearly: the month, 1 to 12.'),
  recurrenceCount: z.number().int().positive().nullable().optional().describe('Stop repeating after this many occurrences.'),
  recurrenceFromCompletion: z.boolean().optional(),
  recurrenceHolidays: z.enum(['skip', 'move']).nullable().optional()
    .describe('An occurrence the rule lands on a holiday: "skip" leaves it out, "move" puts it on the next day. Holidays are the set and days off chosen in Settings. Null or absent: it happens anyway.'),
  recurrenceWeekOrdinal: z.number().int().min(-1).max(4).refine(n => n !== 0).nullable().optional()
    .describe('Monthly only: "the 2nd Tuesday" is 2 with recurrenceDays [2]; -1 is the last. Not with recurrenceMonthDay.'),
  targetCount: z.number().int().min(2).nullable().optional().describe('A counted target: done N times a day (or a week with quotaPeriod). null for an ordinary task.'),
  targetUnit: z.string().nullable().optional().describe('What the target counts, e.g. "glasses".'),
  quotaPeriod: z.enum(['day', 'week']).optional().describe('What targetCount is per. Default day.'),
  allowOvershoot: z.boolean().optional().describe('With a target: let it be logged past the target.'),
  quotaReminders: z.boolean().optional().describe('With a target: remind as each unit falls due.'),
  chainStepOnSchedule: z.boolean().optional().describe('On a repeating chain: each step waits for the next repeat instead of following straight away.'),
  phoneNumber: z.string().nullable().optional(),
  emailAddress: z.string().nullable().optional(),
  waitsOn: z.array(z.string()).optional().describe('Keys of other items in this plan that must be done first. The task waits on the tasks they become; an item not ticked in a run is dropped from the list.'),
  polarity: z.enum(['positive', 'negative']).optional().describe('negative makes it a habit of not doing something.'),
  linkUrl: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  weatherWait: z.enum(['sunny', 'rainy', 'snowy', 'cold', 'hot']).nullable().optional().describe('Hold the task until the next day with this forecast. Only for a one-off item.'),
  pinEachOccurrence: z.boolean().optional(),
  chain: z.object({
    steps: z.array(z.object({
      title: z.string().min(1),
      estimatedMinutes: z.number().int().positive().nullable().optional(),
      asks: z.enum(['text', 'date', 'number', 'yesno']).nullable().optional().describe('A question this step asks when ticked.'),
      answerSchedulesNextStep: z.boolean().optional().describe('With asks "date": the answer dates the next step.'),
    })).min(2),
  }).nullable().optional().describe('Steps done one after another, each appearing when the one before is done. On a repeating item the whole chain starts over on the schedule. null removes it.'),
  rotation: z.object({ members: z.array(rotationMemberSchema).min(2) }).nullable().optional()
    .describe('Named things done each week in any order, each once unless it says timesPerWeek. Not with a chain. null removes it.'),
  deliverableSetsAway: z.boolean().optional().describe('Update-only detail of a date question: its answer sets the away dates.'),
  vacationPause: z.boolean().optional(),
  excludeFromSuggestions: z.boolean().optional(),
  subtasks: z.array(z.object({ id: z.string(), title: z.string() })).optional(),
  groupKey: z.string().nullable().optional().describe('The key of a group defined in this plan. null takes the item out of its group.'),
  conditions: z.array(conditionSchema).optional()
    .describe('Which answers to the run\'s questions tick this item by default. Several values in one entry mean any of them (OR). Entries on different questions must ALL match (AND), and there is no OR across questions: to tick an item for either of two questions, list it twice, once per question. An item with no matching answer stays in the run unticked and can still be ticked by hand; conditions never remove it. An item with conditions ignores its optional flag. Only choice questions can be named, and an unanswered question matches nothing.'),
  variants: z.array(variantSchema).optional().describe('A different title and/or notes for particular answers of a choice question, so one item can say "Pack 4 shirts" for one answer and "Pack 8" for another instead of two items. The item\'s own text is used for every other answer. Blanks work in it. With update_template, variants replace the item\'s whole list.'),
  key: z.string().optional().describe('Your own handle for this item, so another item\'s onlyIfAnswer can name it.'),
  deliverableKind: z.enum(DELIVERABLE_KINDS as unknown as [DeliverableKind, ...DeliverableKind[]]).nullable().optional()
    .describe('A question the task asks when completed: text, date, number, yesno or choice.'),
  deliverableOptions: z.array(z.string()).optional().describe('For a choice question: the options, at least two.'),
  onlyIfAnswer: z.object({
    item: z.string().describe('The key of an item in this plan that asks a Yes/No or choice question.'),
    answers: z.array(z.string()).min(1),
  }).nullable().optional()
    .describe('A branch decided after the template is applied: the task waits for that item\'s question to be answered, then shows only for these answers and is not needed for any other. Unlike conditions, which decide what is ticked when the template is applied. null removes it.'),
  refTemplate: z.string().optional().describe('An existing template id, or its name when unique, to nest here.'),
});

/**
 * The blank syntax an item's title, notes, location, subtasks and chain steps
 * understand, written once for both template tools. The rules are
 * templateUtils.ts's (tested); this is only the words a client reads.
 */
const BLANK_SYNTAX = ' Text can hold {blanks} that a run fills in: {name} is a question\'s answer; {days + 1} does one sum (one operator and a number: + - * /) and rounds a fraction up; {days + 1 max 7} caps the count at 7; {laundry access = Yes ? days / 2 : days + 1} picks one of two counts by a choice answer (the question\'s name on the left, one of its options after =). A blank answer drops the token. An item can also carry variants: its own title and/or notes for particular answers of a choice question.';

const containerSchema = z.enum(CONTAINERS as unknown as [string, ...string[]]).optional()
  .describe('What a run puts the tasks in: none, a stack, a project, or one task with subtasks.');
const anchorsAreAwaySchema = z.boolean().optional().describe('Whether the anchor dates mean a period away from home.');
const groupsSchema = z.array(z.object({
  key: z.string().min(1).describe('Your own handle for this group, used by an item groupKey. To keep an existing group when updating, use its id.'),
  title: z.string().min(1),
  checklist: z.boolean().optional().describe('Run into a project, the section is a checklist.'),
})).optional();
const questionsSchema = z.array(z.object({
  name: z.string().optional().describe('The {blank} this fills. Omit for a people question, which fills none. Item titles, notes, location, subtask titles and chain step titles replace {name} with the answer when the template is applied (case-insensitive; an unanswered blank is dropped). A title can do one sum on it, `{name + 1}`, `{name - 2}`, `{name * 2}` or `{name / 2}`: one operator and a literal number, no parentheses, fractions round up, never below 0. A name that no item mentions is allowed and fills nothing. A name like `days-2` is refused because it reads as a sum.'),
  key: z.string().optional().describe('For a question with no name (a people question, or a choice that only decides what is ticked): a handle conditions can name it by. get_template returns the question\'s id here; keep it to keep the question.'),
  prompt: z.string(),
  kind: z.enum(QUESTION_KINDS as unknown as [string, ...string[]]),
  options: z.array(z.string()).optional().describe('Required for a choice, at least two. The first is the default.'),
  defaultValue: z.string().optional(),
  fromDates: z.enum(QUESTION_SOURCES as unknown as [string, ...string[]]).optional()
    .describe('A number question can take its answer off the anchor dates. nights is end minus start (the 3rd to the 10th is 7); days counts both end days (8). A typed answer wins over the dates. Only a choice question can gate an item through conditions, so a number cannot express "only if days > 5": add a choice question for that.'),
})).optional();
const scheduleSchema = z.object({
  frequency: z.enum(SCHEDULE_FREQUENCIES as unknown as [string, ...string[]]),
  weekday: z.number().int().min(0).max(6).optional(),
  monthDay: z.number().int().min(1).max(31).optional(),
  month: z.number().int().min(1).max(12).optional().describe('Yearly: the month, 1 to 12 (January is 1).'),
  time: z.string().optional().describe('HH:MM.'),
  anchorSpanDays: z.number().int().nullable().optional(),
}).nullable().optional();

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
  deadlineTime: z.string().nullable().optional()
    .describe('HH:MM (24-hour) the deadline closes at on its day, shown on the task row and counted late from that minute. null makes it a deadline for the whole day. Needs a deadline, or a deadlineRule.'),
  reminderTime: isoDateTime.describe('ISO date-time of a reminder.'),
  timeSegments: z.array(z.enum(TIME_SEGMENTS as unknown as [TimeOfDay, ...TimeOfDay[]])).optional()
    .describe('The part of the day it shows up in. Usually one.'),
  priority: z.number().int().min(0).max(4).optional().describe('0 none, 1 low, 2 medium, 3 high, 4 urgent.'),
  effort: z.number().int().min(0).max(6).optional(),
  difficulty: z.enum(['trivial', 'easy', 'normal', 'hard']).nullable().optional()
    .describe('How hard the task is to make yourself do, apart from how long it takes. Scales the coins it earns: hard doubles, easy halves, trivial earns none.'),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  weatherWait: z.enum(['sunny', 'rainy', 'snowy', 'cold', 'hot']).nullable().optional()
    .describe('Hold a one-off task until the first day in the next two weeks with this kind of forecast, e.g. "leave books on the curb on the next sunny day". The phone matches the forecast and moves the task, so it can take until the next sync to leave Today. Not for a repeating task, chain, set of dates or subtask. null stops waiting.'),
  pinned: z.boolean().optional().describe('Pin it to the top of Today.'),
  pinEachOccurrence: z.boolean().optional().describe('On a repeating task: every occurrence it spawns starts pinned, so the pin is not redone by hand each time. Does nothing on a task that does not repeat.'),
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
    holidays: z.enum(['skip', 'move']).nullable().optional()
      .describe('An occurrence the rule lands on a holiday: "skip" leaves it out, "move" puts it on the next day (a trash pickup after a holiday). Holidays are the set and days off chosen in the app\'s Settings. Omit for "happens anyway". Not for hourly.'),
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
    firstWeek: z.enum(['fewer', 'full']).optional()
      .describe('create_task, per week only: "fewer" (the default) scales the first week to the days left in it, as the app does (3 a week set on a Thursday asks for 2 that week, then 3). "full" asks for the whole count from the start.'),
  }).nullable().optional()
    .describe('Something done several times: "drink water 8 times a day", "run 3 times a week". A daily target makes the task repeat daily if it did not; a weekly one makes it repeat weekly. null removes it.'),
  timed: z.object({
    minutes: z.number().int().describe('1 to 1440.'),
  }).nullable().optional()
    .describe('A countdown the task runs once it is started, e.g. "stretch for 15 minutes". Also sets the estimate and effort from the countdown unless you name them. Not for a subtask. null removes it.'),
  rotation: z.object({
    members: z.array(rotationMemberSchema).describe('At least two different members, in the order to show them. A member is a name, or { title, timesPerWeek } for one done more than once a week (1 to 7). A bare name keeps the count it already has.'),
  }).nullable().optional()
    .describe('A set of things done each week, in any order ("a podcast in each of my five languages", or "three runs and one bike ride"). Each member is done once a week unless it says timesPerWeek. The weekly target is the sum of the counts. A task with no repeat becomes weekly. Re-sending a member\'s name keeps its history. null removes it.'),
  healthTarget: z.object({
    metric: z.enum(['steps', 'sleepHours', 'exerciseMinutes', 'activeEnergyKcal', 'standHours']),
    target: z.number().int().optional().describe('In the metric\'s own unit. Defaults to the app\'s starting value: 8000 steps, 8 hours, 30 minutes, 500 kcal, 12 hours.'),
    followGoal: z.boolean().optional().describe('exerciseMinutes, activeEnergyKcal and standHours only: use the goal set in Fitness instead of target.'),
  }).nullable().optional()
    .describe('The task becomes ready to check off once Apple Health reaches a number today. This only sets it up: it cannot be read from here, so never say whether it has been reached. It never completes the task. null removes it.'),
  supply: z.object({
    count: z.number().int().describe('How many are left now, 0 to 999. 0 means it has run out.'),
    unit: z.string().nullable().optional().describe('E.g. "filters".'),
    refillCount: z.number().int().nullable().optional().describe('How many arrive per restock.'),
    reorderAt: z.number().int().optional().describe('Offer to reorder when this many are left. At least 1; default 1.'),
    leadDays: z.number().int().nullable().optional().describe('Days a delivery takes, 0 to 365.'),
  }).nullable().optional()
    .describe('A stock that goes down by one each time this repeating task is completed ("12 filters left"), and asks to reorder as it runs low. Needs a repeat, and not for a subtask. null removes it.'),
  window: z.object({
    start: z.string().nullable().optional().describe('"HH:MM", 24-hour: it shows up from this time. Or follow the sun: "sunrise", "sunset", or either with a minutes offset of up to 180 ("sunset-30", "sunrise+45"), which moves with the sun each day.'),
    end: z.string().nullable().optional().describe('"HH:MM", 24-hour: after this it counts as missed for the day. Or "sunrise"/"sunset" with an optional offset, as for start ("sunset" for "before dark").'),
  }).nullable().optional().describe('A time of day to do it in. null removes it.'),
  habit: z.enum(['do', 'avoid']).optional()
    .describe('"avoid" makes it a habit of NOT doing something ("no phone in bed"): it is never completed, and its streak counts the days you held off. Only for a plain task, not a chain or a target.'),
  slipAllowance: z.number().int().min(1).max(20).nullable().optional()
    .describe('For an "avoid" habit: how many slips a day it absorbs. Those slips are counted but leave the streak alone and cost nothing; the next one resets it. null removes the allowance, and the first slip of a day then resets it.'),
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
  waitForSeriesEnd: z.boolean().optional()
    .describe('With waitsOn on a repeating task: keep waiting until its last repeat is done, not just the next one. A task that repeats with no end never releases this one.'),
  onlyIfAnswer: z.object({
    taskId: z.string().describe('A task that asks a Yes/No or pick-one question when completed.'),
    answers: z.array(z.string()).min(1).describe('The answers that show this task, spelled as the question offers them.'),
  }).nullable().optional()
    .describe('A branch: this task waits until that question is answered, then shows only for these answers. Any other answer marks it not needed: off every list and out of the project\'s count. A task waiting only on not-needed tasks is not needed too. null removes it.'),
  followUp: z.object({
    everyN: z.number().int().optional().describe('2 to 99. Give this or atEnd.'),
    atEnd: z.boolean().optional().describe('Add the task once, when the repeat ends instead of every Nth time. The repeat needs a count or end date.'),
    title: z.string(),
    notes: z.string().optional(),
    estimatedMinutes: z.number().int().positive().nullable().optional(),
    oneAtATime: z.boolean().optional().describe('Don\'t add another while the last one is still open.'),
  }).nullable().optional()
    .describe('Repeating tasks only: every Nth completion also adds a separate task, e.g. every 4th run, "Replace running shoes" or every 10th clean, "Deep clean the oven". Or with atEnd, adds it once when the repeat ends, e.g. after the last of 6 classes, "Sign up for the next session". null removes it.'),
  personIds: z.array(z.string()).optional()
    .describe('People the task is about or with, by id from list_people ("call Mum", "dinner with Sam"). It then shows on their page. [] clears them.'),
  linkUrl: z.string().nullable().optional().describe('A web address or app link the task row opens. null clears it.'),
  phoneNumber: z.string().nullable().optional().describe('A number the task row can call, as written. null clears it.'),
  emailAddress: z.string().nullable().optional().describe('An address the task row can email. null clears it.'),
  location: z.string().nullable().optional().describe('The place it happens, as free text. null clears it.'),
  vacationPause: z.boolean().optional()
    .describe('Hide this task, and keep its streak, while vacation mode is on (get_overview says whether it is).'),
  medication: z.object({
    name: z.string().describe('Use the spelling list_medication_logs already has.'),
    amount: z.number().nullable().optional(),
    unit: z.string().nullable().optional().describe('E.g. "mg".'),
  }).nullable().optional()
    .describe('Completing it also records a dose of this medicine in the medication log ("take vitamin D"). Undone with the completion by reopen_task. null stops it.'),
  deadlineRule: z.object({
    daysBeforeDate: z.number().int().optional(),
    daysAfterDate: z.number().int().optional(),
    dayOfMonth: z.union([z.number().int(), z.literal('last')]).optional().describe('Monthly repeats only: a day of the date\'s own month.'),
  }).nullable().optional()
    .describe('A deadline worked out from the date on every occurrence, instead of a fixed deadline: give one of the three. Needs a date. null drops the rule and the deadline.'),
  reminderRule: z.object({
    daysBeforeDate: z.number().int().optional().describe('0 for the day itself.'),
    at: z.string().optional().describe('With daysBeforeDate: "HH:MM". Defaults to the time of the reminder it already has.'),
    whenItSurfaces: z.literal(true).optional().describe('Remind the moment it comes back into view (off a defer, or when its time of day opens).'),
  }).nullable().optional()
    .describe('A reminder placed by rule on every occurrence instead of at a fixed time. A reminderTime given on its own replaces a rule. null drops the rule and the reminder.'),
};

function registerWriteTools(
  server: McpServer,
  replica: Replica,
  withWrite: <T>(fn: () => T) => Promise<T>
): void {
  server.tool(
    'create_task',
    "Add a task. Beyond the basics it can repeat (any rule the app has), be a chain of steps, have a daily or weekly target, a countdown (timed), a weekly rotation of named things, an Apple Health target, a supply that counts down, a time window, blockers it waits on, a follow-up every Nth completion, or be a habit of not doing something. It needs a category (see list_categories) unless its project has a default one; the app's other defaults apply (its time-of-day segment, title rules), and an invalid combination is refused with every problem listed. The result is the task in full, as get_task shows it, so check it says what you meant.",
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
    'Edit a task. Only the fields you name change; null clears one that can be empty, and repeat, chain, target, timed, rotation, healthTarget, supply, window and followUp each replace that whole part. Uses the same rules as editing in the app: changing the repeat re-anchors the schedule, and on a task with several dates the content edit also applies to its later dates (the result says how many). A deadline written to a task whose deadline is worked out from its date (deadlineRule on get_task) replaces that rule with the fixed date, and the result says so. A target on a task that follows the food log\'s water goal (followsWaterTarget) is refused, since the app sets that count each day. Completed and archived tasks are refused. To move one occurrence of a repeating task, use defer_task instead of dueDate.',
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

  // The fields save_recipe and update_recipe share.
  const recipeFields = {
    ingredients: z.array(z.object({
      text: z.string().min(1),
      section: z.string().nullable().optional(),
      alternativeGroup: z.string().nullable().optional(),
    })).optional(),
    steps: z.array(z.object({
      text: z.string().min(1),
      section: z.string().nullable().optional(),
      timerSeconds: z.number().int().nullable().optional().describe('Only when the sentence does not say how long (cook mode reads "for 10 minutes" itself).'),
      note: z.string().nullable().optional().describe('The cook\'s own note on this step.'),
    })).optional(),
    servings: z.number().int().positive().nullable().optional(),
    servingsMax: z.number().int().positive().nullable().optional().describe('The top of a range: "serves 4-6" is servings 4, servingsMax 6.'),
    recipeYield: z.string().nullable().optional().describe('What it makes when a person-count does not fit: "3 cups", "2 dozen cookies".'),
    estimatedMinutes: z.number().int().positive().nullable().optional().describe('Total time, start to table.'),
    prepMinutes: z.number().int().positive().nullable().optional().describe('Hands-on prep time.'),
    mealType: z.enum(['breakfast', 'lunch', 'dinner', 'side', 'condiment', 'snack', 'dessert', 'beverage']).nullable().optional(),
    tags: z.array(z.string()).optional(),
    sourceUrl: z.string().nullable().optional(),
    sourcePage: z.string().nullable().optional().describe('The page in its cookbook, as printed.'),
    author: z.string().nullable().optional().describe('Who wrote it, for a recipe not in a cookbook (a book\'s recipes take the book\'s author).'),
    notes: z.string().optional(),
    vote: z.enum(['loved', 'liked', 'never']).nullable().optional().describe('The person\'s own rating. Set it only on their word.'),
    upNext: z.boolean().optional().describe('On the Up next shelf.'),
    leftoverKeepDays: z.number().int().nullable().optional().describe('Days its leftovers keep, 0 to 90; null for the app default.'),
    components: z.array(z.object({
      recipeId: z.string().min(1),
      choiceGroup: z.string().nullable().optional(),
    })).optional().describe('Other saved recipes used inside this one (the crust, the sauce), replacing the list. Ones sharing a choiceGroup are alternatives: one is cooked.'),
    prepTasks: z.array(z.object({
      title: z.string().min(1),
      offsetDays: z.number().int().optional().describe('Days before the meal, -7 to 1 (default -1, the day before).'),
      reminderOffsetMinutes: z.number().int().nullable().optional().describe('Minutes before the task is due to remind, 0 to 1440; null for none.'),
    })).optional().describe('Tasks the app writes ahead of a planned meal of it ("soak the beans"), replacing the list.'),
  };

  server.tool(
    'save_recipe',
    'Save a recipe to the app: from a page, a photo, or a conversation. Give ingredients as the lines a recipe prints ("2 cloves garlic, minced"), one per entry; the app reads the amount, the name and the prep out of each. Put a heading in section ("For the sauce"), and give lines that are alternatives ("serrano or jalapeño") the same alternativeGroup, one line each, never one line with "or". Refused if a recipe with that name is already in that cookbook. The result counts the ingredient lines the app could read.',
    {
      name: z.string().min(1),
      cookbook: z.string().nullable().optional().describe('A cookbook by title. Created if there is none by that name.'),
      ...recipeFields,
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
    'update_recipe',
    'Change a saved recipe (ids from list_recipes). Only what you name changes. ingredients, steps, components and prepTasks each replace the whole list, so send the full set, in the same form as save_recipe (one line per ingredient, alternatives sharing an alternativeGroup); a step whose text is unchanged keeps its timer, note and the cook questions asked about it. cookbook moves it to another book by title (made if new), or null takes it out of one; a move clears a page that belonged to the old book. A rename or move is refused if that cookbook already has a recipe of that name; planned meals made from it are retitled.',
    {
      id: z.string().min(1),
      name: z.string().min(1).optional(),
      cookbook: z.string().nullable().optional(),
      ...recipeFields,
    },
    async ({ id, ...patch }) => {
      try {
        return json(await withWrite(() => updateRecipe(replica, id, patch)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the recipe.' });
      }
    }
  );

  server.tool(
    'rename_cookbook',
    'Rename a cookbook or change its author. Every recipe in it takes the new title and author. Refused when another book already has that title and author; merge_cookbooks joins two copies of one book.',
    {
      id: z.string().min(1),
      title: z.string().min(1),
      author: z.string().nullable().optional().describe('Leave out to keep the author; null to clear it.'),
    },
    async ({ id, title, author }) => {
      try {
        return json(await withWrite(() => renameCookbook(replica, id, title, author)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not rename that cookbook.' });
      }
    }
  );

  server.tool(
    'merge_cookbooks',
    'Two entries that are the same book, made one: every recipe and index line in mergeId moves to keepId (a dish both indexes list is kept once), and mergeId is gone. Not undoable from here.',
    { keepId: z.string().min(1), mergeId: z.string().min(1) },
    async ({ keepId, mergeId }) => {
      try {
        return json(await withWrite(() => mergeCookbooks(replica, keepId, mergeId)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not merge those cookbooks.' });
      }
    }
  );

  server.tool(
    'delete_cookbook',
    'Delete a cookbook. Its recipes stay, no longer in a book but still naming it as their source, and its index goes with it. Not undoable from here; merge_cookbooks is the way to fold a duplicate into the real one.',
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(await withWrite(() => deleteCookbook(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete that cookbook.' });
      }
    }
  );

  server.tool(
    'save_index_entry',
    'Add a dish to a cookbook\'s index (give cookbookId), or change one (give id). Its ingredients are the dish\'s main things, the ones the person would look it up by, which is what Cook with... searches. Refused when that index already lists the dish.',
    {
      id: z.string().min(1).optional(),
      cookbookId: z.string().min(1).optional(),
      title: z.string().min(1),
      page: z.string().nullable().optional(),
      ingredients: z.array(z.string()).optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => saveIndexEntry(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not save that index line.' });
      }
    }
  );

  server.tool(
    'delete_index_entry',
    'Take a dish out of a cookbook\'s index. A recipe saved from it is not touched.',
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(await withWrite(() => deleteIndexEntry(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete that index line.' });
      }
    }
  );

  server.tool(
    'recipe_from_index_entry',
    'The saved recipe for a cookbook index line: the one already in that book under that name, or a new one with the book and page and nothing else, ready to plan or fill in with update_recipe.',
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(await withWrite(() => recipeFromIndexEntry(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not make that recipe.' });
      }
    }
  );

  server.tool(
    'reorder_up_next',
    'Put the Up next shelf in an order: recipe ids, first to last. Recipes on the shelf you leave out follow, in their current order. update_recipe with upNext adds or removes one.',
    { ids: z.array(z.string().min(1)).min(1) },
    async ({ ids }) => {
      try {
        return json(await withWrite(() => reorderUpNext(replica, ids)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not reorder the shelf.' });
      }
    }
  );

  server.tool(
    'log_cook_time',
    'Record how long cooking a recipe took, timed on the person\'s own clock: the same record the recipe\'s cook timer keeps ("took 32m last time"), which also fills in its time the first time.',
    { id: z.string().min(1), minutes: z.number().int().positive() },
    async ({ id, minutes }) => {
      try {
        return json(await withWrite(() => logCookTime(replica, id, minutes)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not log that.' });
      }
    }
  );

  server.tool(
    'delete_recipe',
    'Delete a saved recipe. Not undoable from here. Planned meals made from it keep their title but no longer link to a recipe. Prefer update_recipe when the person only wants it changed.',
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(await withWrite(() => deleteRecipe(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete the recipe.' });
      }
    }
  );

  server.tool(
    'log_food',
    `Log something the person ate, with your estimate of its nutrition for the whole amount eaten. Amounts are keyed ${NUTRIENT_KEY_LIST.join(', ')}; leave out any you cannot estimate (absent is not zero). Without apply: true it only shows the figures as the app read them: show the person, and log it once they agree, since the app never stores an estimate nobody looked at. The entry is marked as estimated. It is not in Apple Health when this returns: the phone writes it there the next time the app is opened, if Health writing is on there, so never say it is already in Health.`,
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
    'move_food_entry',
    'Move a food log entry to another day or time (it was logged on the wrong day). The entry is rewritten at the new moment and gets a new id, as moving one in the app does. Refused once the entry is in Apple Health, since only the phone can take the old sample back out; and for water, which log_water records a day at a time.',
    {
      id: z.string().min(1),
      at: z.string().min(1).describe('The new moment: an ISO date-time, or YYYY-MM-DD for noon that day.'),
    },
    async ({ id, at }) => {
      try {
        return json(await withWrite(() => moveFoodEntry(replica, id, at)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not move that entry.' });
      }
    }
  );

  server.tool(
    'duplicate_food_entry',
    'Log the same food again ("had the same lunch today"): a copy of an entry at another moment, default now. The original stays.',
    {
      id: z.string().min(1),
      at: z.string().optional().describe('An ISO date-time, or YYYY-MM-DD for noon that day. Default now.'),
    },
    async ({ id, at }) => {
      try {
        return json(await withWrite(() => duplicateFoodEntry(replica, id, at)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not log that again.' });
      }
    }
  );

  server.tool(
    'save_meal_from_entries',
    'Save logged food entries together as a meal, to log the same combination again later in one go.',
    { name: z.string().min(1), entryIds: z.array(z.string().min(1)).min(1) },
    async ({ name, entryIds }) => {
      try {
        return json(await withWrite(() => saveMealFromEntries(replica, name, entryIds)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not save that meal.' });
      }
    }
  );

  server.tool(
    'log_saved_meal',
    'Log every food in a saved meal at once, at one moment and meal. Each food becomes its own food log entry.',
    {
      id: z.string().min(1),
      slot: z.enum(KITCHEN_MEAL_SLOTS as unknown as [MealSlot, ...MealSlot[]]).nullable().optional(),
      at: z.string().optional().describe('An ISO date-time, or YYYY-MM-DD for noon that day. Default now.'),
    },
    async ({ id, slot, at }) => {
      try {
        return json(await withWrite(() => logSavedMeal(replica, id, slot, at)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not log that meal.' });
      }
    }
  );

  server.tool(
    'delete_saved_meal',
    'Delete a saved meal. What it logged before stays in the food log.',
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(await withWrite(() => deleteSavedMeal(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete that saved meal.' });
      }
    }
  );

  server.tool(
    'set_nutrition_targets',
    `Set or clear (null) the daily figures the food log reads a day's totals against, keyed ${NUTRIENT_KEY_LIST.join(', ')} (waterMl is the water goal). Set only figures the person gives you: the app ships with no targets and never suggests one, so do not propose a number of your own. list_food_log shows the current ones.`,
    { targets: z.record(z.number().nullable()) },
    async ({ targets }) => {
      try {
        return json(await withWrite(() => setNutritionTargets(replica, targets)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not set those targets.' });
      }
    }
  );

  server.tool(
    'log_water',
    'Log water the person drank. The app keeps one water entry a day and steps it up a glass at a time, so this adds onto today\'s entry (or the day named by at) rather than adding a row per glass; use it instead of log_food for water. Give the amount as ml or flOz. The result gives the day\'s total so far in the unit the person counts water in. Not in Apple Health yet: the phone writes it there the next time the app is opened, if Health writing is on there.',
    {
      ml: z.number().positive().optional().describe('Millilitres drunk. Give this or flOz.'),
      flOz: z.number().positive().optional().describe('Fluid ounces drunk. Give this or ml.'),
      at: z.string().optional().describe('When: an ISO date-time, or YYYY-MM-DD. Default now.'),
    },
    async input => {
      try {
        return json(await withWrite(() => logWater(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not log that.' });
      }
    }
  );

  server.tool(
    'log_mood',
    'Record a mood check-in: a rating from 1 (low) to 5 (great), and/or symptoms with a severity of 1 (mild) to 3 (severe), context tags ("work", "poor sleep"), and a short note. Dreams and longer writing go in the journal (log_journal_entry). Leave the rating out when the person gave none; an unrated check-in is not a 3. Symptoms and tags are matched to the spellings already in their log. Log only what they told you, never an inference about how they seem.',
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
    'request_calendar_event',
    'Ask the person\'s phone to add an event to their calendar. The server cannot reach the calendar, so this queues the event and the one device they chose in Settings adds it the next time it syncs; until then it is not on the calendar, so say it is queued, not added. Refused when no device is set to add them (get_overview features.calendarRequests). Give start as YYYY-MM-DD for an all-day event (end is then the last day, default the same day), or YYYY-MM-DDTHH:MM in their time zone for a timed one (end defaults to an hour later). Nothing here can change or delete an event once it is added.',
    {
      title: z.string().min(1),
      start: z.string().min(1).describe('YYYY-MM-DD for all day, or YYYY-MM-DDTHH:MM in their time zone.'),
      end: z.string().optional().describe('All day: the last day, YYYY-MM-DD. Timed: YYYY-MM-DDTHH:MM. Default: same day, or an hour after start.'),
      location: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => requestCalendarEvent(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not queue that event.' });
      }
    }
  );

  server.tool(
    'cancel_calendar_request',
    'Take back a calendar request that is still pending, so the phone never adds it. One already on the calendar can only be removed by the person, in their calendar app.',
    { id: z.string().min(1).describe('The id from list_calendar_requests or request_calendar_event.') },
    async input => {
      try {
        return json(await withWrite(() => cancelCalendarRequest(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not cancel that request.' });
      }
    }
  );

  const entryId = z.string().min(1).describe('The id from the matching list tool.');
  const dayNote = ' It cannot move an entry to another day; for a wrong date, delete it and log it again.';

  server.tool(
    'update_food_entry',
    'Correct a food log entry: its name, its meal slot, and, for an entry that was estimated, its quantity and figures (amounts replaces every figure, so give the full set). An entry measured against a food\'s own label or database record is corrected in the app, which re-measures it, and one already written to Apple Health only on the phone.' + dayNote,
    {
      id: entryId,
      label: z.string().min(1).optional(),
      quantity: z.string().optional(),
      amounts: z.record(z.number().nonnegative()).optional(),
      slot: z.enum(KITCHEN_MEAL_SLOTS as unknown as [MealSlot, ...MealSlot[]]).nullable().optional(),
    },
    async ({ id, ...patch }) => {
      try {
        return json(await withWrite(() => updateFoodEntry(replica, id, patch)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not correct that entry.' });
      }
    }
  );

  server.tool(
    'delete_food_entry',
    'Delete a food log entry. Not undoable from here. Refused for an entry already written to Apple Health, which only the phone can remove.',
    { id: entryId },
    async ({ id }) => {
      try {
        return json(await withWrite(() => deleteFoodEntry(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete that entry.' });
      }
    }
  );

  server.tool(
    'update_mood_log',
    'Correct a mood check-in. Only what you name changes; symptoms and contextTags replace the whole list, and null clears the rating or the note. A check-in cannot be left empty: delete it instead.' + dayNote,
    {
      id: entryId,
      mood: z.number().int().min(1).max(5).nullable().optional(),
      symptoms: z.array(z.object({ name: z.string().min(1), severity: z.number().int().min(1).max(3).optional() })).optional(),
      contextTags: z.array(z.string().min(1)).optional(),
      note: z.string().nullable().optional(),
    },
    async ({ id, ...patch }) => {
      try {
        return json(await withWrite(() => updateMoodLog(replica, id, patch)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not correct that check-in.' });
      }
    }
  );

  server.tool(
    'delete_mood_log',
    'Delete a mood check-in. Not undoable from here.',
    { id: entryId },
    async ({ id }) => {
      try {
        return json(await withWrite(() => deleteMoodLog(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete that check-in.' });
      }
    }
  );

  server.tool(
    'update_medication_log',
    'Correct a recorded dose: the medication, the amount and unit together (or neither), whether it was as-needed, or the note. The name is matched to the spelling already in their log, never folded into a different medicine or strength.' + dayNote,
    {
      id: entryId,
      name: z.string().min(1).optional(),
      amount: z.number().positive().nullable().optional(),
      unit: z.string().nullable().optional(),
      asNeeded: z.boolean().optional(),
      note: z.string().nullable().optional(),
    },
    async ({ id, ...patch }) => {
      try {
        return json(await withWrite(() => updateMedicationLog(replica, id, patch)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not correct that dose.' });
      }
    }
  );

  server.tool(
    'delete_medication_log',
    'Delete a recorded dose. Not undoable from here. A dose recorded by completing a task leaves the task completed; reopen the task instead to take both back.',
    { id: entryId },
    async ({ id }) => {
      try {
        return json(await withWrite(() => deleteMedicationLog(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete that dose.' });
      }
    }
  );

  server.tool(
    'log_journal_entry',
    'Write down a journal entry or a dream for the person, in their words. A dream files under the day they woke. Write only what they gave you to write; never compose an entry for them.',
    {
      kind: z.enum(['journal', 'dream']),
      text: z.string().min(1).max(5000),
      at: z.string().optional().describe('An ISO date-time, or YYYY-MM-DD for a day gone by. Default now.'),
    },
    async input => {
      try {
        return json(await withWrite(() => logJournalEntry(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not write that down.' });
      }
    }
  );

  server.tool(
    'update_journal_entry',
    'Replace the text of a journal or dream entry, by its id from list_journal_entries. It cannot move an entry to another day; for a wrong date, delete it and write it again.',
    { id: z.string().min(1), text: z.string().min(1).max(5000) },
    async ({ id, text }) => {
      try {
        return json(await withWrite(() => updateJournalEntry(replica, id, text)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the entry.' });
      }
    }
  );

  server.tool(
    'delete_journal_entry',
    'Delete a journal or dream entry by its id from list_journal_entries. It cannot be restored from here.',
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(await withWrite(() => deleteJournalEntry(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete the entry.' });
      }
    }
  );

  server.tool(
    'add_milestone',
    'Mark the day something changed in the person\'s life ("Started sertraline", "New job", "Moved house"), for the mood log to read mood before and after it. Only what they tell you, in their words; the date defaults to today. Record a start and a later stop as two milestones.',
    {
      label: z.string().min(1).max(200).describe('What changed, in a few words.'),
      date: dayKey.optional().describe('The day it happened, YYYY-MM-DD. Default today.'),
    },
    async input => {
      try {
        return json(await withWrite(() => addMilestone(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not add the milestone.' });
      }
    }
  );

  server.tool(
    'update_milestone',
    'Change a milestone\'s label or date, by its id from list_milestones. Only what you name changes.',
    {
      id: z.string().min(1),
      label: z.string().min(1).max(200).optional(),
      date: dayKey.optional().describe('YYYY-MM-DD.'),
    },
    async ({ id, ...patch }) => {
      try {
        return json(await withWrite(() => updateMilestone(replica, id, patch)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the milestone.' });
      }
    }
  );

  server.tool(
    'delete_milestone',
    'Delete a milestone by its id from list_milestones. A milestone is a fact about one day, so a wrong one is corrected or deleted; there is no archive, and it cannot be restored from here.',
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(await withWrite(() => deleteMilestone(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete the milestone.' });
      }
    }
  );

  server.tool(
    'create_saved_view',
    'Save a named lens over every open task, as the app\'s Saved Views screen does. Each clause is one the app stores and a task has to pass all of them: { kind: "category", values: [names] }, { kind: "tag", values: [tags] }, { kind: "project", values: [project ids] }, { kind: "priority", values: [0 to 4] }, { kind: "effort", values: [0 to 6] }, { kind: "maxMinutes", minutes: n }, { kind: "overdue", overdue: bool }, { kind: "hasReminder", hasReminder: bool }, { kind: "heldBack", heldBack: bool }, { kind: "undated", undated: bool }. One clause per kind; an empty values list matches everything. A name already in use, an unknown category or project, or a clause the app would not store is refused. update_saved_view edits and reorders one.',
    {
      name: z.string().min(1).max(80),
      icon: z.string().optional().describe('One of the app\'s view icons (the refusal lists them). Default bookmark-outline.'),
      clauses: z.array(z.object({
        kind: z.string(),
        values: z.array(z.union([z.string(), z.number()])).optional(),
        minutes: z.number().optional(),
        overdue: z.boolean().optional(),
        hasReminder: z.boolean().optional(),
        heldBack: z.boolean().optional(),
        undated: z.boolean().optional(),
      })).optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => createSavedView(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not create the view.' });
      }
    }
  );

  server.tool(
    'update_saved_view',
    'Change a saved view: its name, icon, or its clauses (the whole set, in the shape create_saved_view takes, checked the same way), or move it in the list with position (0 is first).',
    {
      view: z.string().min(1).describe('The view\'s id or name.'),
      name: z.string().min(1).max(80).optional(),
      icon: z.string().optional(),
      clauses: z.array(z.object({
        kind: z.string(),
        values: z.array(z.union([z.string(), z.number()])).optional(),
        minutes: z.number().optional(),
        overdue: z.boolean().optional(),
        hasReminder: z.boolean().optional(),
        heldBack: z.boolean().optional(),
        undated: z.boolean().optional(),
      })).optional(),
      position: z.number().int().min(0).optional(),
    },
    async ({ view, ...input }) => {
      try {
        return json(await withWrite(() => updateSavedView(replica, view, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the view.' });
      }
    }
  );

  server.tool(
    'delete_saved_view',
    'Delete a saved view by name or id. The tasks it showed are untouched; only the lens goes, and it cannot be restored from here.',
    { view: z.string().min(1).describe('The view\'s name (case does not matter) or its id from list_saved_views.') },
    async ({ view }) => {
      try {
        return json(await withWrite(() => deleteSavedView(replica, view)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete the view.' });
      }
    }
  );

  server.tool(
    'set_vacation_mode',
    'Turn vacation mode on or off, as the switch in Settings does. On, it hides every task marked for vacation pause and every category set to hide on vacation, everywhere, and protects their streaks; nothing else moves. Off, it brings them back and forgives the protected streaks, as the app does. With on: true, until (YYYY-MM-DD, after today) is the day it turns itself off; with the mode already on, until only moves that day, and null clears it. The result says what it hides. get_overview reports the mode and, when a trip switched it on, which one: turning it off during that trip counts as declining it for the trip.',
    {
      on: z.boolean(),
      until: dayKey.nullable().optional().describe('With on: true. The day it turns itself off, YYYY-MM-DD, after today. null clears an end date already set. Leave out to keep it on until it is turned off.'),
    },
    async input => {
      try {
        return json(await withWrite(() => setVacationMode(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change vacation mode.' });
      }
    }
  );

  server.tool(
    'set_automation',
    'Turn an automation on or off, and/or choose the category its tasks file under (its "File them under" setting, shown as category in list_automations). Pass on, category or both. category: null files its tasks under none, which puts them in the loose block at the top of Today; prefer a real category. Applies on every synced device. Say what it will do (its "does" line) and anything it needs on the phone before turning it on.',
    {
      kind: z.string().min(1),
      on: z.boolean().optional(),
      category: z.string().nullable().optional().describe('A task category by name, from list_categories. It must already exist; null for none.'),
    },
    async ({ kind, on, category }) => {
      try {
        return json(await withWrite(() => setAutomation(replica, kind, { on, category })));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change that automation.' });
      }
    }
  );

  server.tool(
    'delete_category',
    'Delete a task category. Its tasks and stacks move to moveTo (a category from list_categories), or with uncategorize: true they are left with none, which puts them in the loose block at the top of Today. A category holding open tasks is refused until you choose one. Every automation that filed under it, and the calendar-events section if it was filed there, is re-pointed to moveTo (or to none) so nothing keeps naming a deleted category. This cannot be undone from here, and Activity lists it as a record. Prefer moveTo, and preview first: the preview names every automation affected.',
    {
      name: z.string().min(1).describe('The category to delete, by name from list_categories.'),
      moveTo: z.string().nullable().optional().describe('The category its tasks and stacks go to.'),
      uncategorize: z.boolean().optional().describe('Leave its tasks with no category instead of moving them.'),
    },
    async ({ name, moveTo, uncategorize }) => {
      try {
        return json(await withWrite(() => deleteCategory(replica, { name, moveTo, uncategorize })));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete that category.' });
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
        leadDays: z.number().int().min(0).max(14).optional().describe('event: days before the event to add the task. Ignored when afterEvent is true.'),
        afterEvent: z.boolean().optional().describe('event: add the task once the event has ended instead of ahead of it, on the day it ended. Use it for a follow-up like booking the next appointment.'),
        skipIfUpcoming: z.boolean().optional().describe('event, with afterEvent: add nothing while another event that matches is still ahead on the calendar (up to 6 months out).'),
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
    'Create a task template: its items, item groups, the questions a run asks, an optional firing schedule, and references to other templates. Everything is created in one call; an invalid plan creates nothing and reports every problem at once. A valid plan can still come back with warnings: things the template will do that were probably not meant (a {blank} no question fills, a reminder with no due date, a category that does not exist yet). Fix them, or tell the person why they stay. Every {word in braces} in a title or notes is a blank: declare a question with that name for each one, or a scheduled run and apply_template drop it.' + BLANK_SYNTAX,
    {
      name: z.string().min(1),
      category: z.string().nullable().optional(),
      container: containerSchema,
      anchorsAreAway: anchorsAreAwaySchema,
      groups: groupsSchema,
      questions: questionsSchema,
      schedule: scheduleSchema,
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
    'update_template',
    'Edit a template. Only what you name changes: name, category (null clears), container, anchorsAreAway, schedule (null removes it). groups, questions and items each replace their whole list when given, because items point at the other two, so send the full list. Keep an existing item by passing its id from get_template: { id } alone leaves it exactly as it is, and other fields written with the id change just those. An item with no id is new, and one left out is removed. A group is kept by using its id as its key; a question by keeping its name (or, for one with no name, its key). Checked in full first: an invalid edit changes nothing and reports every problem at once, and nesting a template inside itself is refused. Pass expectedVersion from get_template so an edit made against an old read is refused instead of undoing changes made since. The result lists the changes, which the preview shows the person, and any warnings.' + BLANK_SYNTAX,
    {
      template: z.string().describe('A template id, or its exact name when that names only one (list_templates).'),
      name: z.string().min(1).optional(),
      category: z.string().nullable().optional(),
      container: containerSchema,
      anchorsAreAway: anchorsAreAwaySchema,
      groups: groupsSchema,
      questions: questionsSchema,
      schedule: scheduleSchema,
      items: z.array(itemSchema).min(1).optional(),
      expectedVersion: z.string().optional().describe('The version get_template returned. The edit is refused if the template has changed since.'),
    },
    async ({ template, expectedVersion, ...patch }) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return json(await withWrite(() => updateTemplate(replica, template, patch as any, expectedVersion)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not update the template.' });
      }
    }
  );

  server.tool(
    'apply_template',
    "Run a template: create the tasks it describes, with dates counted from startDate and endDate. Does what the app's apply sheet does with its defaults plus what you give: which items are on follows the answers (a conditioned item is on or off by the answer, an optional one starts off), questions you do not answer take their default, and runName is what puts the tasks in the template's stack, project or parent task. Read the template with get_template first for its question names, item ids and container. include / leaveOut take item ids to switch on or off. projectId runs it into an existing project instead. People questions are not answered here. The preview lists each task with its dates and subtasks, the items left out and why (leftOut, with itemIds for include), blanks left empty (unfilledBlanks), and nested templates that no longer exist (brokenRefs): check those before confirming. Reminders and calendar events for the new tasks are set up by the phone.",
    {
      template: z.string().describe('A template id, or its exact name when that names only one (list_templates).'),
      runName: z.string().optional().describe('Names the run, e.g. "Lisbon trip". Needed for the template to create its stack, project or parent task; without it the tasks are loose.'),
      startDate: z.string().optional().describe('YYYY-MM-DD: the anchor items count their start offsets from. For a trip, the first day away.'),
      endDate: z.string().optional().describe('YYYY-MM-DD: the end anchor. For a trip, the last day away.'),
      answers: z.record(z.string()).optional().describe('Answers by question name, e.g. { "trip": "Work", "nights": "7" }. A number question left out is read off the dates.'),
      include: z.array(z.string()).optional().describe('Item ids to switch on (e.g. an optional item). A nested template\'s own item id switches on everything inside it.'),
      leaveOut: z.array(z.string()).optional().describe('Item ids to switch off. A nested template\'s own item id switches off everything inside it.'),
      projectId: z.string().optional().describe('An existing project to put the tasks in.'),
      planning: z.boolean().optional().describe('Create the run\'s project in Planning, its tasks held off every list until it is marked ready. Only for a named run whose container is a project.'),
    },
    async ({ template, ...input }) => {
      try {
        return json(await withWrite(() => applyTemplate(replica, template, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not run the template.' });
      }
    }
  );

  server.tool(
    'delete_template',
    'Delete a template. Templates have no archive, so this cannot be undone from here. Templates that nest it keep an item whose reference is now broken; the result names them. Prefer update_template when the person only wants it changed.',
    { template: z.string().describe('A template id, or its exact name when that names only one (list_templates).') },
    async ({ template }) => {
      try {
        return json(await withWrite(() => deleteTemplate(replica, template)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete the template.' });
      }
    }
  );

  server.tool(
    'reorder_templates',
    'Put templates in a new order. The ids listed go first, in the order given; every other template follows in the order it already had. To move one to a different category use update_template.',
    { ids: z.array(z.string()).min(1).describe('Template ids from list_templates, first to last.') },
    async ({ ids }) => {
      try {
        return json(await withWrite(() => reorderTemplates(replica, ids)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not reorder the templates.' });
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
    'mark_done_by_other',
    "Close a task as done by somebody else (a partner did the dishes). Only when the person says so. The occurrence is completed and a repeating task's next one is created, but it earns no coins, its streak is neither advanced nor broken, and no dose is logged. Works on a one-off task too. It shows as done by someone else in the Logbook and is left out of the person's own stats. A task that is not due yet is refused. reopen_task puts it back.",
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        const result = await withWrite(() => markDoneByOther(replica, id));
        return json(withLink(result, LINKS?.task(result.nextTask?.id ?? id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not mark the task done by someone else.' });
      }
    }
  );

  server.tool(
    'reopen_task',
    "Reopen a completed or missed task: it goes back on the list as outstanding, its streak and daily-target count go back to what they were, the coins and any dose its completion recorded are taken back, and the next occurrence the completion created is removed (unless that one was completed since). Use it when something was completed by mistake. Refused, with the reason, when the completion left something only the phone can undo: a calendar event, a screen-time credit or a meal marked cooked.",
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        const result = await withWrite(() => reopenTask(replica, id));
        return json(withLink(result, LINKS?.task(id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not reopen the task.' });
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
    'Archive a task, taking it off every list and out of its project, or restore one with archived: false. Prefer this to delete_task when the person only wants it out of the way: an archived task keeps its history and can always be restored here or in the app (list_tasks with view archived lists them). Archiving unpins it; restoring a repeating task starts its streak over, as the app does.',
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
    'update_settings',
    `Change settings, as the Settings screen does, by name from get_settings: ${Object.keys(SETTINGS_SPEC).join(', ')}. Every value is checked before any is stored, and the app's own limits apply (the result says when one was adjusted). Only on the person's word: these change how the whole app behaves.`,
    {
      changes: z.record(z.unknown()).describe('Setting names to their new values, e.g. { "dayResetTime": "04:00", "weekStartsOn": 1 }.'),
    },
    async ({ changes }) => {
      try {
        return json(await withWrite(() => updateSettings(replica, changes)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the settings.' });
      }
    }
  );

  server.tool(
    'archive_medication',
    'Move a medicine out of "what you take" on the Medication screen (it stops being offered), or bring it back with archived: false. No dose is deleted.',
    { name: z.string().min(1), archived: z.boolean().optional().describe('Default true.') },
    async ({ name, archived }) => {
      try {
        return json(await withWrite(() => setMedicationArchived(replica, name, archived ?? true)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not archive it.' });
      }
    }
  );

  server.tool(
    'rename_mood_tag',
    'Correct a mood context tag ("work stress", "slept badly") on every check-in that has it, as the app\'s rename does: a typo otherwise sits in the suggestions for good.',
    { from: z.string().min(1), to: z.string().min(1) },
    async ({ from, to }) => {
      try {
        return json(await withWrite(() => renameMoodTag(replica, from, to)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not rename the tag.' });
      }
    }
  );

  server.tool(
    'change_calendar_event',
    "Change, or remove (delete: true), an event that request_calendar_event added (requestId from list_calendar_requests; it has to have been written). Only events this server asked for: nothing the person put on their calendar can be reached. Like a new request, the phone set to add them does it the next time it syncs; check list_calendar_requests for the outcome. A new start with no end keeps the event's length.",
    {
      requestId: z.string().min(1),
      delete: z.literal(true).optional(),
      title: z.string().optional(),
      start: z.string().optional().describe('YYYY-MM-DD for all day, or YYYY-MM-DDTHH:MM.'),
      end: z.string().optional(),
      location: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => changeCalendarEvent(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not ask for the change.' });
      }
    }
  );

  server.tool(
    'delete_task',
    `Delete tasks for good, with their checklists, or single checklist items, as the app's delete does: gone from every list, the Logbook and Stats. Only when the person asks for a delete; archive_task is the gentler way to put something away. Up to ${MAX_DELETE} a call, so clearing old Logbook entries is one call. A task the app wrote itself (generatedBy on get_task) is refused: delete those in the app. Each deletion can be restored from the app's Activity screen.`,
    {
      ids: z.array(z.string().min(1)).min(1).describe('Task ids, or checklist item ids.'),
    },
    async ({ ids }) => {
      try {
        return json(await withWrite(() => deleteTasks(replica, ids)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete.' });
      }
    }
  );

  server.tool(
    'skip_occurrence',
    "Skip this occurrence of a repeating task: it moves to its next date with nothing completed, nothing marked missed and its streak untouched, as the app's Skip does. Use mark_missed when the person says they missed it, and defer_task to do it later instead.",
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(withLink(await withWrite(() => skipOccurrence(replica, id)), LINKS?.task(id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not skip it.' });
      }
    }
  );

  server.tool(
    'reorder_tasks',
    "Put tasks in a hand-sorted order: a project's open steps (projectId), a task's checklist (parentId), a stack's tasks (stackId), or the Pinned block on Today (pinned: true). Name one list. The tasks named go first, in the order given, and the rest keep their order after them. A project's steps swap the places they already hold, so reordering a project does not move them on Today.",
    {
      projectId: z.string().optional(),
      parentId: z.string().optional().describe('The task whose checklist to reorder.'),
      stackId: z.string().optional(),
      pinned: z.literal(true).optional(),
      ids: z.array(z.string().min(1)).min(1),
    },
    async input => {
      try {
        return json(await withWrite(() => reorderTasks(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not reorder.' });
      }
    }
  );

  server.tool(
    'set_task_dates',
    "Put one task on several dates (\"walk the dog on the 10th and the 15th\"), change that set of dates, or take it back to one. The task becomes one row per date, done separately; a set does not repeat by rule, so forming one drops any repeat on the task. monthly: true brings the same days round again each month once all of them are done. Dates already done stay as history. To move a single date, use defer_task.",
    {
      id: z.string().min(1),
      dates: z.array(z.string()).min(1).describe('YYYY-MM-DD, the whole set as it should be.'),
      monthly: z.boolean().optional(),
    },
    async ({ id, dates, monthly }) => {
      try {
        return json(withLink(await withWrite(() => setTaskDates(replica, id, dates, monthly ?? false)), LINKS?.task(id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not set the dates.' });
      }
    }
  );

  server.tool(
    'duplicate_task',
    "Copy a task with its checklist, as the app's Duplicate does: every setting comes along, and its progress (completion, streak, timer, answer) starts over. The copy is a new task you can then edit with update_task.",
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        const result = await withWrite(() => duplicateTask(replica, id));
        return json(withLink(result, LINKS?.task(result.task.id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not copy the task.' });
      }
    }
  );

  server.tool(
    'delete_tag',
    'Delete a tag: take it off every task that has it and out of the tag list, as the Tags screen does. The tasks themselves stay. To take a tag off some tasks only, use batch_update_tasks with their tags.',
    { tag: z.string().min(1) },
    async ({ tag }) => {
      try {
        return json(await withWrite(() => deleteTag(replica, tag)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete the tag.' });
      }
    }
  );

  server.tool(
    'set_completion_date',
    "Correct when a completed task was done (\"I actually did that yesterday\"), as the Logbook's date edit does. Moves it in the Logbook and Stats; the next occurrence of a repeating task stays where it is.",
    {
      id: z.string().min(1),
      date: z.string().describe('YYYY-MM-DD (noon that day) or an ISO date-time. Not in the future.'),
    },
    async ({ id, date }) => {
      try {
        const at = /^\d{4}-\d{2}-\d{2}$/.test(date.trim()) ? `${date.trim()}T12:00` : date;
        return json(withLink(await withWrite(() => setCompletionDate(replica, id, at)), LINKS?.task(id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the date.' });
      }
    }
  );

  server.tool(
    'add_grocery_item',
    "Put something on the home grocery list, or on a separate list with list. A name the user has bought before re-lists the shelf item they already have, keeping its aisle, its history and its pantry state, rather than creating a second one. Singular and plural resolve to the same item. The result says which of those happened.",
    {
      name: z.string().min(1).describe('What to add. A leading amount is split off, so "2 gal milk" files milk with a quantity of 2 gal.'),
      quantity: z.string().nullable().optional().describe('Stated separately instead of being parsed out of the name.'),
      note: z.string().nullable().optional(),
      list: z.string().optional().describe('A separate list by name or id (see grocery_setup). The list at home when omitted.'),
    },
    async ({ name, list, ...rest }) => {
      try {
        return json(withLink(await withWrite(() => addGroceryItem(replica, name, { ...rest, listId: resolveList(replica, list)?.id ?? null })), LINKS?.groceries()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not add that.' });
      }
    }
  );

  server.tool(
    'check_off_grocery_item',
    'Check something off on the home grocery list, or un-check it with checked: false. Takes the item id from list_grocery_items. Checking off one option of an either/or ("apples or pears") takes the other options off that list, as in the app.',
    { id: z.string().min(1), checked: z.boolean().optional().describe('Defaults to true.'), list: z.string().optional().describe('A separate list by name or id (see grocery_setup). The list at home when omitted.'), },
    async ({ id, checked, list }) => {
      try {
        return json(withLink(await withWrite(() => setGroceryChecked(replica, id, checked ?? true, resolveList(replica, list)?.id ?? null)), LINKS?.groceries()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not check that off.' });
      }
    }
  );

  server.tool(
    'remove_from_grocery_list',
    'Take something off the home grocery list without deleting it. The shelf item stays in the catalog with its aisle, purchase history, prices and substitutes, so adding it again brings all of that back. delete_grocery_item is the tool that deletes one, only when asked.',
    { id: z.string().min(1), list: z.string().optional().describe('A separate list by name or id (see grocery_setup). The list at home when omitted.'), },
    async ({ id, list }) => {
      try {
        return json(withLink(await withWrite(() => removeFromGroceryList(replica, id, resolveList(replica, list)?.id ?? null)), LINKS?.groceries()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not remove that.' });
      }
    }
  );

  const pantryItemShape = {
    id: z.string().optional().describe('From list_grocery_items, list_pantry or get_pantry_item. Give this or name.'),
    name: z.string().optional().describe('The item by name, singular or plural. Must already be in the catalog.'),
    status: z.enum(['have', 'out', 'clear']).optional().describe("have: 'Got it', on hand for the item's usual window. out: 'Out of it', which also clears its use-by, opened and frozen state. clear: forget what was said and go back to the app's own guess."),
    outcome: z.enum(['usedUp', 'spoiled']).optional().describe('With status out: how it went. spoiled is recorded as waste and used to suggest a shelf life; use usedUp when it was finished.'),
    staple: z.boolean().optional().describe("'Always have it': never expires."),
    frozen: z.boolean().optional().describe('Into the freezer, which pauses its use-by countdown. Out of it restarts a fresh shelf life from today.'),
    freezeSome: z.boolean().optional().describe('Freeze part of it as a separate frozen portion and leave the rest where it is.'),
    opened: z.boolean().optional().describe('Opened a jar or bag. Moves its use-by day to the opened shelf life when the app knows one for it.'),
    runningLow: z.boolean().optional().describe('True also puts it on the home grocery list. False never takes it off.'),
    expiresAt: dayKey.nullable().optional().describe('Use-by day, or null to clear.'),
    shelfLifeDays: z.number().int().min(0).nullable().optional().describe('How long this item keeps once bought or thawed. Used for the next purchase, not the current use-by day.'),
    useUpTask: z.boolean().nullable().optional().describe("true or false forces the 'Use up X' task on or off for this item, null follows the setting. The phone creates or drops the task itself the next time it syncs."),
  };

  server.tool(
    'update_pantry_item',
    "Change what the kitchen holds of one grocery item: mark it on hand or out, staple, frozen, opened, running low, its use-by day or shelf life. Several fields can be set in one call and are applied in the order listed. The rules are the app's own (thawing restarts the shelf life, opening can shorten the use-by day, out clears everything about the last box). Only do what the person said: marking something out or on hand replaces a guess with a claim. The result lists what changed.",
    pantryItemShape,
    async input => {
      try {
        return json(withLink(await withWrite(() => updatePantryItem(replica, input)), LINKS?.pantry()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change that.' });
      }
    }
  );

  server.tool(
    'update_pantry_box',
    "The same as update_pantry_item for one packet of an item: a brand or variant, or its frozen portion. Ids are the `boxes` of get_pantry_item or the boxId of a list_pantry row. Marking a frozen portion out deletes it.",
    {
      id: z.string().min(1),
      status: z.enum(['have', 'out', 'clear']).optional(),
      frozen: z.boolean().optional(),
      opened: z.boolean().optional(),
    },
    async ({ id, ...change }) => {
      try {
        return json(withLink(await withWrite(() => updatePantryBox(replica, id, change)), LINKS?.pantry()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change that packet.' });
      }
    }
  );

  server.tool(
    'add_to_pantry',
    "Say the person has these ('I have flour'). A name the catalog knows is marked on hand and keeps everything else; a new one becomes a catalog item that is NOT on the shopping list. A leading amount is dropped, since the app keeps no quantities. Use add_grocery_item to buy something instead.",
    { names: z.array(z.string().min(1)).min(1).max(50) },
    async ({ names }) => {
      try {
        return json(withLink(await withWrite(() => addToPantry(replica, names)), LINKS?.pantry()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not add those.' });
      }
    }
  );

  server.tool(
    'answer_pantry_review',
    "Record the person's answers to cards from pantry_review: have (still on hand), low (running low, which also puts it on the home list) or out. Every answer marks the card reviewed so it is not dealt again for a week. Only record what the person actually said.",
    { answers: z.array(z.object({ id: z.string().min(1), answer: z.enum(['have', 'low', 'out']) })).min(1).max(20) },
    async ({ answers }) => {
      try {
        return json(withLink(await withWrite(() => answerPantryReview(replica, answers)), LINKS?.pantry()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not record those answers.' });
      }
    }
  );

  server.tool(
    'update_leftover',
    "Change a container of cooked food (leftoverId of a list_pantry row): rename it, say when it was put away (its keep-for window moves with it), record what it weighs, freeze or thaw it (thawing restarts its fridge clock), finish it as eaten or tossed, reopen one that was finished (finished: null), or set how many days it keeps from the day it was stored. Eating one on the phone offers to log the meal; that offer does not happen here, so log_food separately if asked.",
    {
      id: z.string().min(1),
      title: z.string().min(1).optional(),
      storedAt: z.string().optional().describe('When it was put away: an ISO date-time, or YYYY-MM-DD for noon that day.'),
      weightG: z.number().positive().nullable().optional().describe('What the container holds, in grams; null for unweighed.'),
      frozen: z.boolean().optional(),
      finished: z.enum(['eaten', 'tossed']).nullable().optional(),
      keepDays: z.number().int().positive().max(365).optional(),
    },
    async ({ id, storedAt, ...change }) => {
      try {
        return json(withLink(await withWrite(() => updateLeftover(replica, id, { ...change, ...(storedAt !== undefined ? { storedAt: atFrom(storedAt) } : {}) })), LINKS?.pantry()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change that leftover.' });
      }
    }
  );

  server.tool(
    'split_leftover',
    'Split a container across the freezer line ("froze half the chili"): a second container of the same dish, put away when the first was, on the other side of the line. The original stays as it is.',
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(withLink(await withWrite(() => splitLeftover(replica, id)), LINKS?.pantry()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not split that leftover.' });
      }
    }
  );

  server.tool(
    'delete_leftover',
    'Delete a leftover logged by mistake. Not undoable from here. A container that was eaten or thrown out is finished with update_leftover instead, which keeps it in the waste record.',
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(await withWrite(() => deleteLeftover(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete that leftover.' });
      }
    }
  );

  server.tool(
    'update_grocery_item',
    "Edit a grocery item in the catalog (id from list_grocery_items, or its name): rename it, move it to another aisle, set its quantity, note or last price, mark it a kind of another item, choose its preferred brand, link it to stores, or add or remove substitutes. Several fields per call. Aisles must be ones that exist (grocery_setup). Filing an aisle is remembered for the name, as it is in the app. Activity can undo changes to the item's own fields; a rename and store or substitute changes are recorded but not undoable. Brands themselves are save_grocery_box.",
    {
      id: z.string().optional(),
      name: z.string().optional().describe('The item by name, when you have no id.'),
      rename: z.string().min(1).optional().describe('A new name. Refused if another item has it; merge_grocery_items joins two items that are the same thing.'),
      aisle: z.string().optional(),
      quantity: z.string().nullable().optional(),
      note: z.string().optional(),
      priceMinor: z.number().int().positive().nullable().optional().describe('The last price in minor units (cents), or null to clear. Paired with the current quantity.'),
      priceStore: z.string().optional().describe('With priceMinor: the store it was seen at, which also updates that store\'s link if it has one.'),
      kindOf: z.string().nullable().optional().describe('The generic this item is a kind of ("white onion" is a kind of "onion"), or null.'),
      preferredBoxId: z.string().nullable().optional().describe('A box id from get_grocery_item, or null for none.'),
      onlyPreferredBrand: z.boolean().optional(),
      linkStores: z.array(z.string()).optional().describe('Stores it can be bought at, by name or id.'),
      unlinkStores: z.array(z.string()).optional(),
      addSubstitutes: z.array(z.object({
        name: z.string().optional(), itemId: z.string().optional(),
        note: z.string().nullable().optional(),
        ratioFrom: z.string().nullable().optional().describe('With ratioTo: "1 cup butter" = "3/4 cup oil".'),
        ratioTo: z.string().nullable().optional(),
        standing: z.boolean().optional().describe('Always use this instead, in recipes.'),
        bothWays: z.boolean().optional(),
      })).optional(),
      removeSubstitutes: z.array(z.string()).optional().describe('Substitute items to remove, by name or id.'),
    },
    async input => {
      try {
        return json(withLink(await withWrite(() => updateGroceryItem(replica, input)), LINKS?.groceries()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change that item.' });
      }
    }
  );

  server.tool(
    'save_grocery_box',
    "Add, edit or delete a brand or variant (a box) of a grocery item. Omit boxId to add one (needs a brand or a variant; the first box becomes the preferred one). Pass boxId to edit it, or delete: true to remove it, which also clears it as a preference and from stores' claims. A frozen portion is not editable here (update_pantry_box).",
    {
      id: z.string().optional(),
      name: z.string().optional().describe('The item by name, when you have no id.'),
      boxId: z.string().optional(),
      brand: z.string().nullable().optional(),
      variant: z.string().nullable().optional(),
      note: z.string().optional(),
      rating: z.string().nullable().optional().describe('The app\'s own rating words for a box (see get_grocery_item).'),
      delete: z.boolean().optional(),
    },
    async ({ id, name, ...input }) => {
      try {
        return json(withLink(await withWrite(() => saveGroceryBox(replica, { id, name }, input as never)), LINKS?.groceries()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not save that brand.' });
      }
    }
  );

  server.tool(
    'save_store',
    "Add a store, or rename one or set how its receipts read. store is an existing store's name or id to change; omit it (and pass name) to add a new one. receiptStyle itemized is an ordinary receipt, none is a store whose receipts are not worth reading. update_store deletes one or sets its aisles.",
    {
      store: z.string().optional(),
      name: z.string().optional(),
      receiptStyle: z.enum(['itemized', 'none']).optional(),
    },
    async input => {
      try {
        return json(withLink(await withWrite(() => saveStore(replica, input)), LINKS?.groceries()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not save that store.' });
      }
    }
  );

  server.tool(
    'add_ingredients_to_list',
    "Put a recipe's ingredients (recipeId, optionally scaled), or every planned meal's between from and to (default the coming week), on a grocery list, as the app's Add to list sheets do. Ingredients the app thinks are needed go on; ones it thinks are on hand, staples you keep, and optional ones are left off and listed in leftOff, so ask the person and pass include with the names they want. exclude drops ones the default would add. What is already in the cart is skipped, and a recipe amount tops up one already on the list. Preview first: it shows every row.",
    {
      recipeId: z.string().optional(),
      scale: z.number().optional().describe('With recipeId: 0.5 halves it, 2 doubles it.'),
      from: z.string().optional().describe('YYYY-MM-DD. Without recipeId: the first day of planned meals. Default today.'),
      to: z.string().optional().describe('YYYY-MM-DD. Default six days after from.'),
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
      list: z.string().optional().describe('A separate list by name or id. The list at home when omitted.'),
    },
    async input => {
      try {
        return json(withLink(await withWrite(() => addIngredientsToList(replica, input)), LINKS?.groceries()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not add the ingredients.' });
      }
    }
  );

  server.tool(
    'add_choice_to_list',
    'Put an either/or on a grocery list ("butter or margarine", "apples or pears"): each option is its own row, and checking one off in the app takes the rest off. settle_choice decides it from here.',
    {
      options: z.array(z.object({ name: z.string().min(1), quantity: z.string().nullable().optional() })).min(2),
      list: z.string().optional(),
    },
    async input => {
      try {
        return json(withLink(await withWrite(() => addChoiceToList(replica, input)), LINKS?.groceries()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not add the choice.' });
      }
    }
  );

  server.tool(
    'settle_choice',
    'Decide an either/or on a list: keep the option named and take the others off, as checking one off does. keepAll: true ends the choice and keeps every option as an ordinary row.',
    {
      item: z.string().min(1).describe('One option, by name or id.'),
      keepAll: z.boolean().optional(),
      list: z.string().optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => settleChoice(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not settle the choice.' });
      }
    }
  );

  server.tool(
    'swap_for_substitute',
    "Swap an item on a list for one of its substitutes (get_grocery_item lists them), as the app's swap does: the substitute takes its place, with the amount converted where the link has a ratio, and the item comes off the list but stays in the catalog.",
    {
      item: z.string().min(1),
      substitute: z.string().min(1),
      list: z.string().optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => swapForSubstitute(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not swap.' });
      }
    }
  );

  server.tool(
    'clear_grocery_list',
    "Empty a grocery list, as the app's Clear list does: everything comes off it, items with history stay in the catalog, and ones with nothing recorded about them are deleted. Ends a shopping trip. To record a shop, use finish_grocery_trip instead. Only on the person's word.",
    { list: z.string().optional() },
    async input => {
      try {
        return json(await withWrite(() => clearGroceryList(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not clear the list.' });
      }
    }
  );

  server.tool(
    'set_shopping_trip',
    'Start a shopping trip at a store (store, optionally budget), change the budget of the trip in progress (budget alone, null for none), or end it (end: true) without recording anything. grocery_setup shows the trip. finish_grocery_trip records what was bought.',
    {
      store: z.string().optional(),
      budget: z.number().nullable().optional().describe('In the person\'s currency, e.g. 80 or 79.50.'),
      end: z.literal(true).optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => setShoppingTrip(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the trip.' });
      }
    }
  );

  server.tool(
    'mark_unavailable',
    "Note that a store doesn't carry an item, or (brandOnly) the item's preferred brand, as the app's \"not at this store\" does. unavailable: false takes the claim back.",
    {
      item: z.string().min(1),
      store: z.string().min(1),
      unavailable: z.boolean().optional().describe('Default true.'),
      brandOnly: z.boolean().optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => markUnavailable(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not mark it.' });
      }
    }
  );

  server.tool(
    'set_nutrition_panel',
    `Set what a grocery item is made of (its nutrition panel), or one of its brands' (boxId), as the app's panel editor does; panel null removes it. Figures are keyed ${NUTRIENT_KEY_LIST.join(', ')}, per 100g, per 100ml (a drink), or per serving. Leave out any the label does not state: absent is unknown, not zero. Set estimated when the figures are yours rather than read off a label. Recipes and the food log read it.`,
    {
      item: z.string().min(1),
      boxId: z.string().optional(),
      panel: z.object({
        basis: z.enum(['per100g', 'per100ml', 'perServing']),
        amounts: z.record(z.number()),
        servingGrams: z.number().nullable().optional(),
        servingText: z.string().nullable().optional().describe('As the label prints it: "1 cup (240ml)".'),
        estimated: z.boolean().optional(),
      }).nullable(),
    },
    async input => {
      try {
        return json(await withWrite(() => setNutritionPanel(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not set the panel.' });
      }
    }
  );

  server.tool(
    'save_aisle',
    'Add an aisle to the walk order, rename one (newName: every item, remembered filing and store order follows), delete one (its items move to Other), or mark one non-food (cleaning, toiletries: left out of the pantry and nutrition). Other cannot be renamed or deleted. Only on the person\'s word: the aisles are their walk round the shop.',
    {
      name: z.string().min(1),
      newName: z.string().optional(),
      delete: z.literal(true).optional(),
      nonFood: z.boolean().optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => saveAisle(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the aisle.' });
      }
    }
  );

  server.tool(
    'reorder_aisles',
    'Put the aisles in walk order: the ones named first, the rest after in their order, Other last.',
    { names: z.array(z.string().min(1)).min(1) },
    async ({ names }) => {
      try {
        return json(await withWrite(() => reorderAisles(replica, names)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not reorder the aisles.' });
      }
    }
  );

  server.tool(
    'update_store',
    "Change a store's own settings: leave it out of the app's store suggestions, say which aisles it has, set its own walk order (aisleOrder; null follows the usual one), or delete it (delete: true), which takes its item links, the prices recorded there and its receipt names with it. Add or rename a store with save_store.",
    {
      store: z.string().min(1),
      delete: z.literal(true).optional(),
      excludeFromSuggestions: z.boolean().optional(),
      aisles: z.array(z.string()).nullable().optional().describe('The aisles this store has; null for all of them.'),
      aisleOrder: z.array(z.string()).nullable().optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => updateStore(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the store.' });
      }
    }
  );

  server.tool(
    'reorder_stores_and_lists',
    'Put the stores (stores) and or the separate grocery lists (lists) in an order: the ones named first, the rest after.',
    {
      stores: z.array(z.string().min(1)).optional(),
      lists: z.array(z.string().min(1)).optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => reorderGroceryPlaces(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not reorder.' });
      }
    }
  );

  server.tool(
    'merge_grocery_items',
    "Merge one grocery item into another when they are the same thing under two names (\"cilantro\" into \"coriander\"), as the app's merge does: purchase history, brands, store links and prices, substitutes, receipt names, list entries, recipe lines and supply tasks move to the one kept, and the other is gone. Cannot be undone from Activity, so only on the person's word, and preview first.",
    {
      from: z.string().min(1).describe('The item that goes, by name or id.'),
      into: z.string().min(1).describe('The item kept.'),
    },
    async input => {
      try {
        return json(await withWrite(() => mergeGroceryItems(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not merge.' });
      }
    }
  );

  server.tool(
    'delete_grocery_item',
    "Delete a grocery item from the catalog for good: its brands, store links, substitutes, receipt names, prices and purchase history all go with it. Prefer remove_from_grocery_list, which only takes it off the list. The preview lists what goes. Recipes that name it keep working, since they match by name. Activity can restore it, with all of that, while nothing has re-created it. Only when the person asks to delete it.",
    { id: z.string().optional(), name: z.string().optional() },
    async input => {
      try {
        return json(await withWrite(() => deleteGroceryItem(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete that item.' });
      }
    }
  );

  server.tool(
    'create_grocery_list',
    "Create a separate grocery list, for a trip away. The list at home is not created or deleted. Items go on it with add_grocery_item's list. A separate list records almost nothing when finished (no purchase counts, prices or use-by days), by the app's rule.",
    { name: z.string().min(1) },
    async ({ name }) => {
      try {
        return json(await withWrite(() => createGroceryList(replica, name)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not create that list.' });
      }
    }
  );

  server.tool(
    'rename_grocery_list',
    'Rename a separate grocery list (by name or id).',
    { list: z.string().min(1), name: z.string().min(1) },
    async ({ list, name }) => {
      try {
        return json(await withWrite(() => renameGroceryList(replica, list, name)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not rename that list.' });
      }
    }
  );

  server.tool(
    'delete_grocery_list',
    'Delete a separate grocery list. Its items are taken off it and stay in the catalog. The list at home cannot be deleted. Not undoable from here.',
    { list: z.string().min(1) },
    async ({ list }) => {
      try {
        return json(await withWrite(() => deleteGroceryList(replica, list)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete that list.' });
      }
    }
  );

  server.tool(
    'finish_grocery_trip',
    "Finish a shopping trip: everything checked off on the list is recorded as bought and leaves it (purchase counts, last purchased, use-by days from the shelf-life table, prices, and the store link when store is given). Only what is checked off is finished. For a separate list it records only that the items left. date is the day of the trip (YYYY-MM-DD), today when omitted. prices and frozen are by item name.",
    {
      list: z.string().optional().describe('A separate list. The list at home when omitted.'),
      store: z.string().optional(),
      date: dayKey.optional(),
      prices: z.array(z.object({ name: z.string(), priceMinor: z.number().int().positive() })).optional(),
      frozen: z.array(z.string()).optional().describe('Items going straight into the freezer.'),
    },
    async input => {
      try {
        return json(withLink(await withWrite(() => finishGroceryTrip(replica, input)), LINKS?.groceries()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not finish that trip.' });
      }
    }
  );

  server.tool(
    'import_receipt',
    "Do what the app's receipt flow does, from a receipt you read (use match_receipt first, and show the person lines you are unsure of). context shopping (default): each line is put on the list if it is not there, checked off, and the trip is finished with the prices (finish: false only checks them off); finishing records everything checked off on the list, including items checked off before this receipt. context pantry: the lines are marked on hand, a repeat purchase clears the old packet's opened, frozen and running-low state, and prices are noted; no purchase is recorded. Each line needs an itemId (a match) or a name (which finds or creates the item). The text printed on a line is remembered as this store's name for the item. The preview lists every line.",
    {
      context: z.enum(['shopping', 'pantry']).optional(),
      list: z.string().optional().describe('Shopping on a separate list. The list at home when omitted.'),
      store: z.string().optional(),
      date: dayKey.optional().describe('The date printed on the receipt. Today when omitted.'),
      finish: z.boolean().optional(),
      lines: z.array(z.object({
        label: z.string().min(1).describe('As printed.'),
        itemId: z.string().optional(),
        name: z.string().optional(),
        quantity: z.string().nullable().optional(),
        priceMinor: z.number().int().positive().nullable().optional(),
        frozen: z.boolean().optional().describe('Going straight into the freezer.'),
        rememberAlias: z.boolean().optional().describe('Remember the printed text as this store\'s name for the item. Default true for an existing item.'),
      })).min(1).max(100),
    },
    async input => {
      try {
        return json(withLink(await withWrite(() => importReceipt(replica, input)), LINKS?.groceries()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not import that receipt.' });
      }
    }
  );

  server.tool(
    'log_leftover',
    "Log a container of cooked food that is now in the fridge, or in the freezer with frozen: true. keepDays is how long it keeps in the fridge (3 by default). It appears in list_pantry with a leftoverId. This does not link it to a recipe or a planned meal, and is not a food log entry: use log_food for what someone ate.",
    {
      title: z.string().min(1),
      keepDays: z.number().int().min(1).max(365).optional(),
      frozen: z.boolean().optional(),
    },
    async input => {
      try {
        return json(withLink(await withWrite(() => logLeftover(replica, input)), LINKS?.pantry()));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not log that leftover.' });
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
      planning: z.boolean().optional().describe('Start it in Planning: its steps, dated ones too, stay off every list until it is marked ready (update_project planning: false). For a plan the person is still working out.'),
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
    'Change a project: rename it, edit its notes, deadline or event date, set or clear its away dates and destination, re-file it, pause it until a day, set who it is with, its links, whether its steps go in order and how it nudges, mark it complete, or archive it. Its tasks are not touched unless moveTasks asks for them to follow a new event date; add steps with add_project_steps and edit them with update_task. The away dates are what the app\'s scheduled vacation mode and away grocery list run on, where the person has turned those on for the project (get_project shows pausesTasksWhileAway), so setting them is what schedules those.',
    {
      id: z.string().min(1),
      title: z.string().optional(),
      notes: z.string().optional(),
      deadline: z.string().nullable().optional(),
      eventDate: z.string().nullable().optional().describe('The day the project is for. Changing it leaves the tasks where they are unless moveTasks is set.'),
      awayStart: z.string().nullable().optional().describe('YYYY-MM-DD: the day the person leaves, for a project that is a trip. Moving it moves an existing awayEnd by the same number of days. null clears the whole span, the destination, and the vacation mode and grocery list nominations that hang off it.'),
      awayEnd: z.string().nullable().optional().describe('YYYY-MM-DD: the day they are back. Needs awayStart (given now or already set) and has to fall after it; null leaves a departure with no return yet.'),
      destination: z.string().nullable().optional().describe('Where the trip is going, free text. Needs away dates; null clears it.'),
      moveTasks: z.boolean().optional().describe('With a new eventDate: move the project\'s dated tasks by the same number of days, as the app offers when the date is changed there. Ask the user first. Pinned, urgent and some other tasks are left in place and listed under notMoved.'),
      moveTasksFrom: z.string().optional().describe('Move the dated tasks after the event date has already been changed: the old event date. They move by the days from it to the event date now.'),
      category: z.string().nullable().optional(),
      defaultTaskCategory: z.string().nullable().optional(),
      newCategory: z.boolean().optional().describe('Create defaultTaskCategory as a new category.'),
      taskDefaults: z.object({
        priority: z.number().int().min(0).max(4).nullable().optional().describe('0 means no priority on purpose, so the backfill screen stops asking. Null means ask.'),
        difficulty: z.enum(['easy', 'normal', 'hard']).nullable().optional(),
        effort: z.number().int().min(0).max(6).nullable().optional().describe('The time estimate bucket, 1 (XXS) to 6 (XL). 0 means no estimate on purpose, so the backfill screen stops asking. Null means ask.'),
      }).nullable().optional().describe('Priority, difficulty and time estimate every new task in the project starts with, so a list like a wish list never reaches backfill. Null clears them. Existing tasks are not changed.'),
      kind: z.enum(['project', 'list']).optional(),
      completed: z.boolean().optional(),
      archived: z.boolean().optional(),
      archiveRemaining: z.boolean().optional().describe('With completed: true, archive its open tasks too, as the app offers when a project is finished with tasks left. Ask the person first.'),
      pausedUntil: z.string().nullable().optional().describe('Pause it until a day (YYYY-MM-DD, after today): its tasks are held off every list until then, as "park the garden for winter". null resumes it now.'),
      planning: z.boolean().optional().describe('true puts it in Planning: its tasks, dated ones too, are held off every list and it gets no nudges until it is marked ready, for a project still being set up. false marks it ready. Not with pausedUntil.'),
      inOrder: z.boolean().optional().describe('Work the steps in page order: the app offers only the first open one.'),
      ongoing: z.boolean().optional().describe('Never finished: finishing its last task does not offer to complete it.'),
      personIds: z.array(z.string()).optional().describe('People it is with or for, by id from list_people. Replaces the list.'),
      links: z.array(z.object({ label: z.string().optional(), url: z.string() })).optional().describe('Links kept with it (the booking, the shared doc), in order. Replaces the list; [] clears it.'),
      nudgeCadenceDays: z.number().int().optional().describe('Days of quiet before the app offers its next task. 0 never offers.'),
      autoSchedule: z.boolean().optional().describe('When it runs dry, date its next task automatically instead of offering it.'),
      nudgeOptIn: z.boolean().optional().describe('false keeps it out of every nudge, the Pull from projects sheet included.'),
      weekendSource: z.boolean().optional().describe('Somewhere the weekend nudge looks for something to do when a weekend is bare.'),
      showChecked: z.boolean().optional().describe('On a list: checked items stay on the page, struck through, instead of folding away.'),
      hideNextStep: z.boolean().optional().describe('Leave the "Next:" line off its card on the Projects screen.'),
    },
    async ({ id, moveTasks, moveTasksFrom, archiveRemaining, ...patch }) => {
      try {
        return json(withLink(await withWrite(() => updateProject(replica, id, patch, { moveTasks, moveTasksFrom, archiveRemaining })), LINKS?.project(id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not update the project.' });
      }
    }
  );

  server.tool(
    'create_stack',
    'Make a stack, optionally filing tasks in it straight away. A stack owns its members\' category, so every task filed in it moves to the stack\'s category (the result lists each change). With taskIds and no category, the tasks\' shared category is used; if they are in different ones, pass category (from list_categories). Use it to group tasks that are done together but must keep separate schedules, streaks or logging, which subtasks would not.',
    {
      title: z.string().min(1),
      category: z.string().nullable().optional().describe('A task category (from list_categories) the stack and its members are filed under. null makes a stack that leaves its members\' categories alone.'),
      taskIds: z.array(z.string().min(1)).optional().describe('Open top-level tasks to file in the new stack.'),
      projectId: z.string().optional().describe('Make it a section on this project\'s page. Its tasks keep their own projects; file them in the project with update_task.'),
    },
    async input => {
      try {
        return json(await withWrite(() => createStack(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not create the stack.' });
      }
    }
  );

  server.tool(
    'assign_to_stack',
    'File open tasks in an existing stack (list_stacks), or take them out of whatever stack they are in with stackId null. Only the live task moves, not its finished occurrences. Filing a task moves it to the stack\'s category, which can change when it shows (the result lists each change); taking it out leaves the category as it is. Checked in full first, so a bad id moves nothing. Subtasks, completed and archived tasks are refused.',
    {
      stackId: z.string().min(1).nullable().describe('The stack to file the tasks in, or null to take them out of their stacks.'),
      taskIds: z.array(z.string().min(1)).min(1),
    },
    async ({ stackId, taskIds }) => {
      try {
        return json(await withWrite(() => assignToStack(replica, stackId, taskIds)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not file the tasks.' });
      }
    }
  );

  server.tool(
    'rename_stack',
    "Rename a stack (ids from list_stacks). Only the title: its category and members are not touched. update_stack changes the rest.",
    { id: z.string().min(1), title: z.string().min(1) },
    async ({ id, title }) => {
      try {
        return json(await withWrite(() => renameStack(replica, id, title)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not rename the stack.' });
      }
    }
  );

  server.tool(
    'update_stack',
    "Change a stack, as its editor does: title, notes, tags, which project page shows it as a section (projectId), whether its tasks are ticked off as a checklist, or its category. A stack owns its members' category, so a new category re-files every open task in it (the result lists each move; finished ones keep theirs). To reorder its tasks use reorder_tasks with stackId.",
    {
      id: z.string().min(1),
      title: z.string().optional(),
      notes: z.string().optional(),
      tags: z.array(z.string()).optional(),
      category: z.string().nullable().optional().describe('A category from list_categories, or null for none.'),
      projectId: z.string().nullable().optional().describe('The project whose page shows it as a section. Its tasks keep their own projects.'),
      checklist: z.boolean().optional(),
      hideNextStep: z.boolean().optional().describe('Leave the "Next:" task off its collapsed header.'),
    },
    async ({ id, ...input }) => {
      try {
        return json(await withWrite(() => updateStack(replica, id, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the stack.' });
      }
    }
  );

  server.tool(
    'delete_stack',
    "Delete a stack. Its tasks are taken out of it and keep their category, unless deleteTasks is true, which deletes its open tasks too (finished occurrences are only taken out: they are history). Ask the person which they want. Restorable from Activity.",
    {
      id: z.string().min(1),
      deleteTasks: z.boolean().optional(),
    },
    async ({ id, deleteTasks }) => {
      try {
        return json(await withWrite(() => deleteStack(replica, id, deleteTasks ?? false)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete the stack.' });
      }
    }
  );

  server.tool(
    'update_category',
    "Rename a task category, change its settings, or both. A rename reaches everywhere it is named, as the app's rename does: its tasks and stacks, project defaults, saved views, templates, automations and rules. Settings: an emoji, a schedule (the days and hours its tasks show; null removes it), hiding it on vacation, leaving it out of suggestions and of the new-tasks banner, and the time of day new tasks in it start in. To merge two categories, use delete_category with moveTo.",
    {
      name: z.string().min(1).describe('The category, from list_categories.'),
      newName: z.string().optional(),
      emoji: z.string().nullable().optional(),
      schedule: z.object({
        days: z.array(z.number().int()).describe('0 = Sunday to 6 = Saturday.'),
        start: z.string().describe('"HH:MM", 24-hour.'),
        end: z.string().describe('"HH:MM", 24-hour.'),
      }).nullable().optional(),
      hideOnVacation: z.boolean().optional(),
      excludeFromSuggestions: z.boolean().optional(),
      excludeFromNewTasksBanner: z.boolean().optional(),
      defaultTimeSegments: z.array(z.enum(TIME_SEGMENTS as unknown as [TimeOfDay, ...TimeOfDay[]])).optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => updateCategory(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the category.' });
      }
    }
  );

  server.tool(
    'reorder_categories',
    "Put the task categories (Today's sections) in an order: the ones named go first, the rest keep their order after them.",
    { names: z.array(z.string().min(1)).min(1) },
    async ({ names }) => {
      try {
        return json(await withWrite(() => reorderCategories(replica, names)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not reorder the categories.' });
      }
    }
  );

  server.tool(
    'delete_project',
    "Delete a project. Its tasks are left in no project, unless deleteTasks is true, which deletes them too (a task the app wrote is only taken out). Stacks shown on its page stay, in no project. Only when the person asks for a delete: archiving (update_project archived: true) keeps it. Ask whether its tasks should go with it. Restorable from Activity.",
    {
      id: z.string().min(1),
      deleteTasks: z.boolean().optional(),
    },
    async ({ id, deleteTasks }) => {
      try {
        return json(await withWrite(() => deleteProject(replica, id, deleteTasks ?? false)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete the project.' });
      }
    }
  );

  server.tool(
    'save_project_category',
    "Add a project category (a section of the Projects screen, filed with update_project's category), rename one, or delete one (its projects are left in none).",
    {
      name: z.string().min(1),
      newName: z.string().optional(),
      delete: z.literal(true).optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => saveProjectCategory(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the project category.' });
      }
    }
  );

  server.tool(
    'reorder_projects',
    'Put projects in an order on the Projects screen (ids: the ones named go first), and or the project categories (categories: by name).',
    {
      ids: z.array(z.string().min(1)).optional(),
      categories: z.array(z.string().min(1)).optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => reorderProjects(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not reorder.' });
      }
    }
  );

  server.tool(
    'start_fresh_project',
    "Make a new copy of a project for doing it again (next year's party, the next trip), as the app's Start fresh does: the same tasks, checklists, sections, blockers and settings, every task open and every date cleared (a repeating task starts today). The original is left as it is.",
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        const result = await withWrite(() => startFreshProject(replica, id));
        return json(withLink(result, LINKS?.project(result.project.id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not copy the project.' });
      }
    }
  );

  server.tool(
    'save_project_as_template',
    "Save a project as a template, as the app's Save as template does: its tasks, checklists and sections, with each dated task placed as days from the project's own date (the trip's departure, the event date, or the deadline), so applying it later asks for one date.",
    {
      id: z.string().min(1),
      name: z.string().optional().describe('Defaults to the project\'s title.'),
    },
    async ({ id, name }) => {
      try {
        return json(await withWrite(() => saveProjectAsTemplate(replica, id, name)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not save the template.' });
      }
    }
  );

  server.tool(
    'create_reward',
    "Add a reward the person can spend coins on, such as a treat or a night off. Ask them for the cost, or offer one based on how often they want it (get_rewards shows the balance and history to judge the pace). A reward is a note to themselves: claiming one unlocks nothing in the app. oneTime makes it disappear once claimed. Refused while rewards are switched off.",
    {
      title: z.string().min(1),
      cost: z.number().int().min(1).describe('Coins, a whole number.'),
      note: z.string().nullable().optional().describe('A line of context, e.g. "the Thai place on 5th".'),
      link: z.string().nullable().optional().describe('A URL to open for it.'),
      oneTime: z.boolean().optional().describe('Claimed once, then gone from the list.'),
    },
    async input => {
      try {
        return json(await withWrite(() => createReward(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not add the reward.' });
      }
    }
  );

  server.tool(
    'update_reward',
    "Change a reward's title, cost, note, link or one-time flag (ids from get_rewards). Coins already spent on it stay spent, and changing the cost never changes what was paid. A reward made from a wish-list item is refused: its title, note and link are the item's, so edit the item instead.",
    {
      id: z.string().min(1),
      title: z.string().min(1).optional(),
      cost: z.number().int().min(1).optional(),
      note: z.string().nullable().optional(),
      link: z.string().nullable().optional(),
      oneTime: z.boolean().optional(),
    },
    async ({ id, ...patch }) => {
      try {
        return json(await withWrite(() => updateReward(replica, id, patch)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the reward.' });
      }
    }
  );

  server.tool(
    'delete_reward',
    "Delete a reward from the list (ids from get_rewards). Coins already spent on it stay spent. Only on the person's say-so.",
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(await withWrite(() => deleteReward(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete the reward.' });
      }
    }
  );

  server.tool(
    'claim_reward',
    "Spend coins on a reward (ids from get_rewards): the same as tapping Claim in the app. Only when the person says they want it now; never claim a reward to be helpful, because it spends coins they earned over days. Refused when the balance is short or a one-time reward was already claimed. A wish-list reward also checks its list item off, with no extra coins (the result says which). The result carries a claimId; unclaim_reward takes it back, and reopens that item too.",
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(await withWrite(() => claimReward(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not claim the reward.' });
      }
    }
  );

  server.tool(
    'unclaim_reward',
    "Take back a claim by its claimId (from claim_reward, or an id from get_rewards history where kind is spend): the coins go back and a one-time reward returns to the list.",
    { claimId: z.string().min(1) },
    async ({ claimId }) => {
      try {
        return json(await withWrite(() => unclaimReward(replica, claimId)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not take back the claim.' });
      }
    }
  );

  server.tool(
    'set_reward_goal',
    "Choose the reward the person is saving for (an id from get_rewards), or null to stop saving for any. It only changes which reward the Rewards screen shows progress toward.",
    { id: z.string().min(1).nullable() },
    async ({ id }) => {
      try {
        return json(await withWrite(() => setRewardGoal(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not set the goal.' });
      }
    }
  );

  server.tool(
    'set_bounty',
    "Post extra coins on a task the person has been putting off (posted: true), or withdraw the live one (posted: false). Only when they ask: a bounty is theirs to set. It is worth the most when posted and loses value each time the task is moved, so a task is never worth more for having waited. One per occurrence, a few live at once (get_rewards shows the limit), and withdrawing it cannot be undone for that occurrence. Refused while rewards are off.",
    { taskId: z.string().min(1), posted: z.boolean() },
    async ({ taskId, posted }) => {
      try {
        return json(await withWrite(() => setBounty(replica, taskId, posted)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the bounty.' });
      }
    }
  );

  server.tool(
    'mark_missed',
    "Mark an occurrence of a repeating task as missed. Only when the person says they missed it: the app never decides that for them, and an overdue task costs nothing until they say so. It breaks the streak, creates the next occurrence, and costs coins when rewards are on (the result says how many). A one-off task and a repeat that is not due yet are refused. reopen_task puts it back and returns the coins.",
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        const result = await withWrite(() => markMissed(replica, id));
        return json(withLink(result, LINKS?.task(result.nextTask?.id ?? id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not mark the task missed.' });
      }
    }
  );

  server.tool(
    'log_slip',
    "Record that the person did the thing a \"don't do this\" habit is about, today. Only when they tell you they did. It resets the streak and costs coins when rewards are on, unless the habit has a slip allowance and today is still inside it: then the slip is counted and nothing else changes. A habit with a penalty is refused, because the slip also charges an app block that only the phone can set. undo_slip takes back today's latest slip and its coins.",
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(await withWrite(() => setSlip(replica, id, true)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not log the slip.' });
      }
    }
  );

  server.tool(
    'undo_slip',
    "Take back today's latest slip on a \"don't do this\" habit: the streak goes back to what it was and the slip's coins are returned. Only today's slips can be undone.",
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(await withWrite(() => setSlip(replica, id, false)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not undo the slip.' });
      }
    }
  );

  server.tool(
    'plan_meal',
    'Put a meal on the plan: a recipe (recipeId), a leftover in the fridge (leftoverId, from list_pantry\'s leftovers), or just a title ("Takeout"). The app scales a recipe to the household size it is set to. Planning a leftover does not mark it finished.',
    {
      date: dayKey,
      slot: z.enum(KITCHEN_MEAL_SLOTS as unknown as [MealSlot, ...MealSlot[]]),
      recipeId: z.string().nullable().optional(),
      leftoverId: z.string().nullable().optional(),
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
    'update_meal',
    "Change a planned meal (ids from list_meal_plan): move it to another date or slot, swap what it is (recipeId, or recipeId: null with a title for a typed meal), rename a typed one, set a recipe's scale (0.5 halves it, 2 doubles it), answer its either/or questions (choices, by the group and option names list_meal_plan shows), or say whether this meal gets a shopping task, a thaw task or the offer to log it (null hands the choice back to the setting). A leftover night is not swapped here. Whether a meal gets a cook task is set on the phone, which writes or removes that task as it is changed. The phone catches up the meal's task and calendar event the next time it opens.",
    {
      id: z.string().min(1),
      date: dayKey.optional(),
      slot: z.enum(KITCHEN_MEAL_SLOTS as unknown as [MealSlot, ...MealSlot[]]).optional(),
      title: z.string().optional(),
      scale: z.number().positive().optional(),
      recipeId: z.string().nullable().optional(),
      choices: z.array(z.object({ group: z.string().min(1), option: z.string().min(1) })).optional(),
      shopTask: z.boolean().nullable().optional(),
      thawTask: z.boolean().nullable().optional(),
      logMeal: z.boolean().nullable().optional(),
    },
    async ({ id, ...patch }) => {
      try {
        const result = await withWrite(() => updateMeal(replica, id, patch));
        return json(withLink(result, LINKS?.mealPlan(result.date)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the meal.' });
      }
    }
  );

  server.tool(
    'remove_meal',
    'Take a meal off the plan. Not undoable from here. A meal marked cooked is refused: it is history and feeds the cooking stats.',
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(await withWrite(() => removeMeal(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not remove the meal.' });
      }
    }
  );

  server.tool(
    'set_meal_cooked',
    'Mark a planned meal cooked, as its checkbox on the plan does: it counts toward the recipe\'s cooking history, marks the packets it was made from opened (only ones the app already thinks the person has), and completes the meal\'s task on Today. cooked: false takes the mark back and reopens that task; the recipe\'s count and the opened packets stay. The phone\'s questions after a cooking (what got used up, whether there are leftovers) are not asked from here, so ask the person yourself if it matters.',
    { id: z.string().min(1), cooked: z.boolean() },
    async ({ id, cooked }) => {
      try {
        return json(await withWrite(() => setMealCooked(replica, id, cooked)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change that meal.' });
      }
    }
  );

  server.tool(
    'save_meal_as_recipe',
    'Turn a typed meal on the plan ("Tacos") into a saved recipe: the one already called that, or a new empty one, with the meal pointed at it.',
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(await withWrite(() => saveMealAsRecipe(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not save that meal as a recipe.' });
      }
    }
  );

  server.tool(
    'copy_meals',
    'Copy planned meals, as the plan\'s copy offers do. fromWeek and toWeek (any day in each) copy a whole week into one with nothing planned yet; add slot to copy just that meal of each day into a week with none of it planned. mealId and dates put one meal on other days too, in the same slot, skipping a day that already has it. Leftover nights never copy, and a copy is unmarked as cooked.',
    {
      fromWeek: dayKey.optional(),
      toWeek: dayKey.optional(),
      slot: z.enum(KITCHEN_MEAL_SLOTS as unknown as [MealSlot, ...MealSlot[]]).optional(),
      mealId: z.string().min(1).optional(),
      dates: z.array(dayKey).optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => copyMeals(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not copy those meals.' });
      }
    }
  );

  const personShape = {
    nickname: z.string().optional(),
    kind: z.enum(['individual', 'business']).optional(),
    notes: z.string().optional(),
    askAbout: z.string().optional().describe('Something to ask them about next time.'),
    birthday: z.object({
      month: z.number().int().min(1).max(12),
      day: z.number().int().min(1).max(31),
      year: z.number().int().nullable().optional().describe('Leave out when unknown. The app never works an age out from it.'),
    }).nullable().optional().describe('null clears it.'),
    phoneNumber: z.string().nullable().optional(),
    faxNumber: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    linkUrl: z.string().nullable().optional(),
    location: z.string().nullable().optional().describe('Where they live, as free text ("Austin, TX"). The app uses it to find people when planning a trip. null clears it.'),
    groupId: z.string().nullable().optional().describe('The group they are listed under (save_person_group makes one), or null for none.'),
    archived: z.boolean().optional().describe('Take them off the list but keep everything about them. false brings them back.'),
    birthdayTaskOptOut: z.boolean().optional().describe('true: the app writes no birthday task for them.'),
    birthdayGiftTaskOptOut: z.boolean().optional().describe('true: the app writes no birthday gift task for them.'),
  };
  const PEOPLE_RULE = ' Nothing here sets how often to reach out or turns on nudges for someone: the app never scores anyone, and a rhythm with someone is the person\'s own choice.';

  server.tool(
    'create_person',
    'Add someone the user keeps up with.' + PEOPLE_RULE,
    { name: z.string().min(1), ...personShape },
    async input => {
      try {
        const person = await withWrite(() => createPerson(replica, input));
        return json(withLink(person, LINKS?.person(person.id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not add that person.' });
      }
    }
  );

  server.tool(
    'update_person',
    'Change who someone is: only the fields you name change, and null clears one that can be empty.' + PEOPLE_RULE,
    { id: z.string().min(1), name: z.string().min(1).optional(), ...personShape },
    async ({ id, ...fields }) => {
      try {
        const person = await withWrite(() => updatePerson(replica, id, fields));
        return json(withLink(person, LINKS?.person(id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change that person.' });
      }
    }
  );

  server.tool(
    'delete_person',
    "Delete someone, as the app's delete does: the notes, gift ideas and food notes about them go too; tasks that name them stay and stop showing their name. Only when the person asks for a delete: update_person with archived: true keeps them. Restorable from Activity.",
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(await withWrite(() => deletePerson(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete that person.' });
      }
    }
  );

  server.tool(
    'reorder_people',
    'Put people in an order on the People screen: the ones named go first, the rest keep their order after them. Only on the person\'s say: the order is theirs.',
    { ids: z.array(z.string().min(1)).min(1) },
    async ({ ids }) => {
      try {
        return json(await withWrite(() => reorderPeople(replica, ids)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not reorder.' });
      }
    }
  );

  server.tool(
    'save_person_group',
    'Add a group to list people under ("Family", "Book club"), rename one (newName), delete one (its people are left in none), or set whether its members are caught up with one at a time (catchUpSeparately). File someone in a group with update_person\'s groupId.',
    {
      name: z.string().min(1),
      newName: z.string().optional(),
      delete: z.literal(true).optional(),
      catchUpSeparately: z.boolean().optional(),
    },
    async input => {
      try {
        return json(await withWrite(() => savePersonGroup(replica, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the group.' });
      }
    }
  );

  server.tool(
    'add_person_note',
    'Write something down about someone: a gift idea (kind gift), a food note such as what they like or cannot eat (kind food), or anything else (kind note). about is the day a note is about ("starts the new job in September"), left out for one that is always true. Write only what the person told you.',
    {
      personId: z.string().min(1),
      kind: z.enum(['note', 'gift', 'food']),
      text: z.string().min(1),
      about: z.string().nullable().optional().describe('YYYY-MM-DD.'),
    },
    async input => {
      try {
        return json(withLink(await withWrite(() => addPersonNote(replica, input)), LINKS?.person(input.personId)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not add the note.' });
      }
    }
  );

  server.tool(
    'update_person_note',
    'Change a note, gift idea or food note about someone (ids from get_person): its text, its kind, the day it is about, or archived: true to keep it but file it away (a gift already given).',
    {
      id: z.string().min(1),
      text: z.string().optional(),
      kind: z.enum(['note', 'gift', 'food']).optional(),
      about: z.string().nullable().optional(),
      archived: z.boolean().optional(),
    },
    async ({ id, ...input }) => {
      try {
        return json(await withWrite(() => updatePersonNote(replica, id, input)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not change the note.' });
      }
    }
  );

  server.tool(
    'delete_person_note',
    'Delete a note, gift idea or food note about someone (ids from get_person).',
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return json(await withWrite(() => deletePersonNote(replica, id)));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not delete the note.' });
      }
    }
  );

  server.tool(
    'add_person_history',
    'Record something the user did with one or more people ("Coffee with Sam", "Called Mom"), on a day that has already happened. This is how the app keeps history with someone: create_person and update_person only ever touch who someone is.',
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
