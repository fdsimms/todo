// Where the cook is in a recipe's method, kept while a cook timer is running.
//
// CookModeSheet resets to the start on every close, because a cooking is one
// sitting and step 6 of yesterday's dish is worse than the start. A running
// cook timer says the sitting is still going, so closing the sheet (or coming
// back from a Live Activity tap) must not throw the place away.
//
// The cook timer itself survives the app being killed (it is a stored start
// time), and so does the Live Activity that points back at it, so the place has
// to as well: a long cook is exactly when iOS reclaims the app, and the tap then
// cold-launches into a process with nothing in memory. The Map is a cache over a
// device-local settings row per recipe, read back on a miss. A saved place older
// than `MAX_AGE_MS` is treated as a different sitting, so a cook that was
// stopped while the app was closed (nothing cleared it) can't hand its step to
// the next one.

import { dbDeleteSetting, dbGetSetting, dbSetSetting } from '../db/database';
import type { RecipeOverride } from '../types';

export interface CookPosition {
  /** -1 is the mise en place screen, 0.. a step. */
  rawIndex: number;
  /** Past the last step, on the end screen. */
  finished: boolean;
  /**
   * The step `rawIndex` was on, when it was on one. Restored by id when the
   * step is still there, so a step added or removed above it while the sheet
   * was closed doesn't hand the cook the step next to theirs.
   */
  stepId?: string;
}

/**
 * What the cooking is for: the factor and the either/or picks. Screen state on
 * RecipeDetailScreen, and re-entering through CookingBar navigates with fresh
 * route params that carry none of it, so the screen reseeds to 1x. Kept here
 * for the same reason the position is, and restored only on that re-entry.
 */
export interface CookSetup {
  scale: number;
  choices: string[];
  overrides: RecipeOverride[];
}

interface Stored {
  position?: CookPosition;
  setup?: CookSetup;
  savedAt: number;
}

/** Longer than any one cooking, shorter than "yesterday's dish". */
export const COOK_POSITION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const cookPositionKey = (recipeId: string) => `cookPosition:${recipeId}`;

const cache = new Map<string, Stored>();

function parseStored(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Stored;
    return parsed && typeof parsed.savedAt === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

function load(recipeId: string): Stored | null {
  const hit = cache.get(recipeId);
  const stored = hit ?? parseStored(dbGetSetting(cookPositionKey(recipeId)));
  if (!stored) return null;
  if (Date.now() - stored.savedAt > COOK_POSITION_MAX_AGE_MS) {
    clearCookPosition(recipeId);
    return null;
  }
  if (!hit) cache.set(recipeId, stored);
  return stored;
}

function store(recipeId: string, patch: Partial<Stored>): void {
  const next: Stored = { ...(load(recipeId) ?? {}), ...patch, savedAt: Date.now() };
  cache.set(recipeId, next);
  dbSetSetting(cookPositionKey(recipeId), JSON.stringify(next));
}

export function saveCookPosition(recipeId: string, position: CookPosition): void {
  store(recipeId, { position: { ...position } });
}

export function savedCookPosition(recipeId: string): CookPosition | null {
  const saved = load(recipeId)?.position;
  return saved ? { ...saved } : null;
}

export function clearCookPosition(recipeId: string): void {
  cache.delete(recipeId);
  dbDeleteSetting(cookPositionKey(recipeId));
}

export function saveCookSetup(recipeId: string, setup: CookSetup): void {
  store(recipeId, { setup: { scale: setup.scale, choices: [...setup.choices], overrides: [...setup.overrides] } });
}

export function savedCookSetup(recipeId: string): CookSetup | null {
  return load(recipeId)?.setup ?? null;
}

/**
 * The position a sheet should rest at while closed: the saved one when the
 * cook timer is running, otherwise the start (mise en place where there is
 * something to gather, step 1 where there isn't).
 */
export function restingCookPosition(
  recipeId: string,
  cookRunning: boolean,
  hasIngredients: boolean,
  /** The method's step ids as they are now, to find a saved step by. */
  stepIds: readonly string[] = [],
): CookPosition {
  const saved = cookRunning ? savedCookPosition(recipeId) : null;
  if (!saved) return { rawIndex: hasIngredients ? -1 : 0, finished: false };
  const at = saved.stepId ? stepIds.indexOf(saved.stepId) : -1;
  return at >= 0 ? { ...saved, rawIndex: at } : saved;
}
