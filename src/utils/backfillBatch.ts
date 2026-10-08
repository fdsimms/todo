import type { Task, Person, GroceryItem, Recipe } from '../types';
import { OTHER_AISLE } from './groceryAisles';

/**
 * Answering one Backfill card for a whole set of cards at once, where the set
 * means something: "use this for all 5 in Work".
 *
 * A **scope** is one way a card belongs to a set. A task can belong to several
 * (its kind of generated task, its project, its category, its stack), so the
 * card offers each as its own choice rather than guessing which one was meant;
 * the other pools have one each (a person's group, an item's aisle, a recipe's
 * cookbook), and the categories and projects pools have none, since nothing
 * ties one category or project to another.
 *
 * The members of a scope are the cards **still in the queue**, never every row
 * that shares the key: an item that already has the value, or was told never to
 * be asked, has answered and is not this batch's to change. That is also why a
 * redo-from-scratch run offers no batch (see the screen): its queue is full of
 * answered cards and a batch would replace all of their values at once.
 *
 * Nothing here writes. It decides what a batch is; the screen applies it and
 * files one undo for the lot.
 */

export type BatchScopeKind = 'generated' | 'project' | 'category' | 'stack' | 'personGroup' | 'aisle' | 'cookbook';

export interface BatchScope {
  kind: BatchScopeKind;
  /** The id the kind names (a project id, a category name, an aisle name…). */
  id: string;
  /** `kind:id`, unique across kinds, what the screen holds as the armed scope. */
  key: string;
}

const scope = (kind: BatchScopeKind, id: string): BatchScope => ({ kind, id, key: `${kind}:${id}` });

export interface BatchOption<T> {
  scope: BatchScope;
  /** The queued cards in this scope, the current one included. Always two or more. */
  members: T[];
}

/**
 * The scopes the card in front of you could be answered for, each with the
 * queued cards it would reach. A scope that would reach only this card is not
 * a batch and is left out.
 */
export function batchOptionsFor<T>(
  queue: readonly T[],
  current: T,
  scopesOf: (item: T) => BatchScope[],
): BatchOption<T>[] {
  return scopesOf(current)
    .map(s => ({
      scope: s,
      members: queue.filter(item => item === current || scopesOf(item).some(o => o.key === s.key)),
    }))
    .filter(o => o.members.length > 1);
}

export function taskBatchScopes(
  task: Pick<Task, 'generatedKind' | 'projectId' | 'category' | 'groupId'>,
): BatchScope[] {
  const scopes: BatchScope[] = [];
  if (task.generatedKind) scopes.push(scope('generated', task.generatedKind));
  if (task.projectId) scopes.push(scope('project', task.projectId));
  if (task.category) scopes.push(scope('category', task.category));
  if (task.groupId) scopes.push(scope('stack', task.groupId));
  return scopes;
}

export function personBatchScopes(person: Pick<Person, 'groupId'>): BatchScope[] {
  return person.groupId ? [scope('personGroup', person.groupId)] : [];
}

/** "Other" is where an unplaced item lands, so sharing it says nothing about two items. */
export function itemBatchScopes(item: Pick<GroceryItem, 'aisle'>): BatchScope[] {
  return item.aisle && item.aisle !== OTHER_AISLE ? [scope('aisle', item.aisle)] : [];
}

export function recipeBatchScopes(recipe: Pick<Recipe, 'cookbookId'>): BatchScope[] {
  return recipe.cookbookId ? [scope('cookbook', recipe.cookbookId)] : [];
}

type BatchPool = 'task' | 'person' | 'item' | 'recipe';

/**
 * The fields a batch can **answer**, which is the narrower list: a value is
 * only worth writing to a whole set when the set plausibly shares it. A task's
 * reminder is an absolute time against its own due date, so it is left out; an
 * item's nutrition panel, variety and substitutes are about one food, and
 * every recipe's cooked weight is its own.
 */
const BATCH_APPLY: Record<BatchPool, readonly string[]> = {
  task: ['estimate', 'priority', 'difficulty', 'category', 'streak', 'vacation', 'suggestions'],
  person: ['location'],
  item: [],
  recipe: ['servings', 'cookTime', 'prepTime'],
};

/**
 * The fields a batch can **dismiss** ("don't ask again for all of these"). Wider
 * than the answer list, because "none of these needs one" can be true of a set
 * whose members would never share a value: a whole aisle of non-food, a whole
 * cookbook of drinks with no cooked weight.
 */
const BATCH_DISMISS: Record<BatchPool, readonly string[]> = {
  task: ['estimate', 'priority', 'difficulty', 'category', 'streak', 'vacation', 'reminder', 'suggestions'],
  person: ['cadence', 'location'],
  item: ['variety', 'substitutes', 'nutrition'],
  recipe: ['servings', 'cookTime', 'prepTime', 'cookedWeight'],
};

export const canBatchApply = (pool: BatchPool, fieldId: string): boolean => BATCH_APPLY[pool].includes(fieldId);
export const canBatchDismiss = (pool: BatchPool, fieldId: string): boolean => BATCH_DISMISS[pool].includes(fieldId);
export const canBatch = (pool: BatchPool, fieldId: string): boolean =>
  canBatchApply(pool, fieldId) || canBatchDismiss(pool, fieldId);
