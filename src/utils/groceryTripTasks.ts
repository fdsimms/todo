import type { Task } from '../types';
import { deliverableKindFor } from './deliverables';
import { isQuotaTask } from './visibilityUtils';
import { hasMission } from './missions';

/**
 * `isGroceriesUrl` and `groceriesUrlShop` from deepLinks.ts, passed in rather
 * than imported: that module handles links as they arrive, so it brings React
 * Native and half the stores with it, and nothing in utils imports it.
 */
export interface TripLinkReaders {
  isGroceriesUrl: (url: string) => boolean;
  groceriesUrlShop: (url: string) => string | null;
}

/**
 * The "Get groceries" tasks a finished trip checks off (#3699).
 *
 * Matched by the link the task carries, never by its title: a stop's task
 * opens `groceriesLinkUrl(shop.id)`, so finishing at that store answers it,
 * and the bare groceries link (a plain "Get groceries", or an older "Grocery
 * run") names no store and is answered by any finished trip. A title is the
 * user's to rename, and "Get groceries at Costco" retitled "Costco run" is
 * still that stop.
 *
 * Only a task on Today right now (`isVisible`, which the caller passes so this
 * stays free of the settings read inside `isTaskVisible`). That is what makes
 * a repeating "Grocery run" safe: today's occurrence is the one the trip just
 * did, and a future one, or one deferred to Saturday, is a different shop.
 * It is also what leaves out one held back on a blocker or a person.
 *
 * Left alone even when they match: a task that asks a question when it's
 * completed (nothing may answer one for the person, see deliverables.ts),
 * a daily target (a trip is one unit of something counted, not the whole
 * day's count), and a "don't do this" habit, which can't be completed at all.
 */
export function tripTasksToComplete(
  tasks: readonly Task[],
  shopId: string | null,
  isVisible: (task: Task) => boolean,
  links: TripLinkReaders,
): Task[] {
  return tasks.filter(task => {
    if (task.completed || task.archived || task.parentId !== null) return false;
    const url = task.linkUrl;
    if (!url || !links.isGroceriesUrl(url)) return false;
    const stop = links.groceriesUrlShop(url);
    if (stop !== null && stop !== shopId) return false;
    if (task.polarity === 'negative' || isQuotaTask(task) || deliverableKindFor(task) !== null || hasMission(task)) return false;
    return isVisible(task);
  });
}
