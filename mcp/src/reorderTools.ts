import type { Replica } from './replica';
import { reorderTemplates } from './tools';
import { reorderTasks } from './taskTools';
import { reorderProjects } from './projectTools';
import { reorderCategories } from './categoryTools';
import { reorderPeople } from './peopleTools';
import { reorderAisles, reorderGroceryPlaces } from './groceryTools';
import { reorderUpNext } from './recipeTools';

/** The lists `reorder` can put in order. */
export const REORDER_KINDS = [
  'tasks',
  'templates',
  'projects',
  'categories',
  'people',
  'aisles',
  'stores_and_lists',
  'up_next',
] as const;
export type ReorderKind = (typeof REORDER_KINDS)[number];

/**
 * One flat input rather than a union per kind, so the schema the client sees is
 * a single object. Each kind reads only its own fields, and `reorder` says
 * which are missing instead of ignoring a field the kind has no use for.
 */
export interface ReorderToolInput {
  kind: ReorderKind;
  /** tasks, templates, projects, people, up_next: ids, first to last. */
  ids?: string[];
  /** categories, aisles: names, first to last. */
  names?: string[];
  /** tasks: name exactly one list to reorder. */
  projectId?: string;
  parentId?: string;
  stackId?: string;
  pinned?: boolean;
  /** projects: project category names, first to last. */
  categories?: string[];
  /** stores_and_lists: store names and/or grocery list names, first to last. */
  stores?: string[];
  lists?: string[];
}

/** Which fields a kind reads, for the error that names what the call left out. */
const NEEDS: Record<ReorderKind, string> = {
  tasks: 'ids, and one of projectId, parentId, stackId or pinned: true',
  templates: 'ids',
  projects: 'ids and/or categories',
  categories: 'names',
  people: 'ids',
  aisles: 'names',
  stores_and_lists: 'stores and/or lists',
  up_next: 'ids',
};

function required<T>(list: T[] | undefined, kind: ReorderKind): T[] {
  if (!list || list.length === 0) throw new Error(`reorder ${kind} needs ${NEEDS[kind]}.`);
  return list;
}

/**
 * Every "put these first, in this order" write behind one door. Each kind calls
 * the function its own tool used to, so the rules (what an unlisted row does,
 * what a repeat or an unknown id refuses) are unchanged and live where they did.
 */
export function reorder(replica: Replica, input: ReorderToolInput) {
  switch (input.kind) {
    case 'tasks':
      return reorderTasks(replica, { ...input, ids: required(input.ids, 'tasks') });
    case 'templates':
      return { templates: reorderTemplates(replica, required(input.ids, 'templates')) };
    case 'projects':
      return reorderProjects(replica, { ids: input.ids, categories: input.categories });
    case 'categories':
      return reorderCategories(replica, required(input.names, 'categories'));
    case 'people':
      return reorderPeople(replica, required(input.ids, 'people'));
    case 'aisles':
      return reorderAisles(replica, required(input.names, 'aisles'));
    case 'stores_and_lists':
      return reorderGroceryPlaces(replica, { stores: input.stores, lists: input.lists });
    case 'up_next':
      return reorderUpNext(replica, required(input.ids, 'up_next'));
  }
}
