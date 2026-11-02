import type { NutrientKey } from './nutrition';

/**
 * A row on the Today list that isn't a task and never becomes one (#1571).
 *
 * A calendar event, a planned meal, what's about to go off in the kitchen and
 * what Apple Health has recorded today all
 * belong on the day, and none of them can be dragged, selected or edited here —
 * an event is EventKit's row and the app only reads it, a meal is
 * `MealPlanEntry`'s, a kitchen row is a reading over the catalog and the
 * fridge (#1689), and a health row is HealthKit's. The first two used to sit in two fixed strips above the list;
 * folding them in needs a row treatment that doesn't bring a second interaction
 * model with it, which is what this is: no drag handle and no `SelectionDot`.
 * That last absence is the signal for bulk edits — every *eligible* row grows a
 * ring while one is on, so a row without one is already how this list says "not
 * this one".
 *
 * **The third kind is why the mechanism was worth having.** The kitchen's front
 * door is the list the user already reads every day, not a screen they have to
 * go to: everything the groceries/meals area knows sits behind More →
 * Groceries & meals → a pill, and a bag of spinach nobody navigates to is a bag
 * of spinach that rots. A context row is the opposite — the knowledge arrives
 * where the attention already is.
 *
 * **A meal can be ticked off from here; an event can't.** That asymmetry is the
 * whole of what a context row can *do*, and it follows from who owns the row: a
 * meal's `cookedAt` is this app's to write, and a leftover or a takeaway planned
 * for tonight is a real thing to finish that has no "Make X" task to finish it
 * with. See `DayContextRow`, which draws the tickable one's glyph as a button.
 *
 * **A kitchen row is a reading, so it can't be ticked either** (#1689) — and
 * that's the line between it and the "Use up X" *task* the same food can
 * produce. A task is a thing to do: it carries an opt-out, it can be deferred,
 * and it lands in the Logbook when it's done. A kitchen row states what the
 * kitchen is right now; it goes away when the food does, and the only two
 * answers it could offer ("eaten" / "thrown out", "got it" / "out of it") are
 * exactly the two-way questions `KitchenScreen` already refuses to guess at with
 * a single glyph. So it opens the kitchen instead of finishing anything.
 *
 * **A health row is a reading too, and the strictest one.** It is the only kind
 * whose source this app cannot write to at all — nothing here can add a step —
 * so there is nothing a tick could mean and nowhere for it to go. It is also
 * the only kind that will not render its own falsy value: no row is drawn for a
 * count of null (which covers a refused read as well as an empty day, since
 * HealthKit does not distinguish them) or of zero, which is the state every
 * morning starts in. See `healthContextRows` for both rules and
 * `docs/arch/health-data.md` for why the first one is not the app's choice.
 *
 * **A view model, computed per render, never stored.** Nothing here is written
 * to SQLite: `src/utils/dayContextRows.ts` builds these from the calendar store
 * and the meal plan on every read, the same way `TripSummary` is derived rather
 * than kept. It carries only what a row draws, so no reader is tempted to
 * treat it as the source — the event and the entry it came from stay canonical.
 */
export interface ContextRow {
  /**
   * Stable across renders (an event id, a meal entry id — prefixed by kind, so
   * two sources can't collide), because it's the list key. Deliberately not the
   * bare source id: a task and a context row can share a list, and a duplicate
   * key is how a row ends up rendering someone else's content.
   */
  id: string;
  /**
   * The row this was built from — a `MealPlanEntry.id` for a meal, a
   * `BusyEvent.id` for an event. Its own field rather than `id` with the
   * prefix peeled off at the call site: `id` is a list key and owes nothing to
   * whatever made it, and a screen re-deriving a store key by string surgery
   * is how the two quietly stop matching.
   *
   * Empty on a health row: the reading names a day rather than a row, and
   * there is no record anywhere in this app it could point at.
   */
  sourceId: string;
  kind: 'event' | 'meal' | 'health';
  title: string;
  /**
   * The caption under the title — "4:15 PM", "All day", "Now", "Dinner". A
   * single string rather than a time plus a formatter, because the cases
   * don't share a format and the row would otherwise need to know which it
   * had. They all say *when*, which is what lets the row caption them with
   * one glyph. Empty on a health reading, which has no time of its own: the
   * row then draws no caption line.
   */
  caption: string;
  /** Which category section this files under; null = the header-less loose group. */
  category: string | null;
  /**
   * True only while an event is actually running. The one emphasis in the
   * treatment (medium-weight title, accent caption) and deliberately the only
   * one — the row is otherwise drawn exactly as a task is, so anything further
   * would make a running event louder than the work it sits among.
   */
  now: boolean;
  /**
   * The calendar an event row came from, when it's worth saying — null for
   * every meal row, and for an event when only one calendar is being read
   * (see `eventContextRows`'s `calendarsById`). With one calendar chosen,
   * every event already comes from it; the tag only earns its place once a
   * second source makes "which one" a real question.
   */
  calendarTag: { name: string; color: string } | null;
  /**
   * A blank stand-in for an event row while the calendar read is under way on
   * a cold launch (`eventPlaceholderRows`). Drawn as the row's shape with no
   * text, never pressable, and hidden from VoiceOver. `withLocation` draws the
   * location line too, for a row that had one, so it holds that row's height.
   */
  placeholder?: { withLocation: boolean };
  /**
   * An event that moved with tasks planned around it ("Moved, 3 tasks"), set
   * by `eventContextRows`' `movedNote`. The offer to move them is in the events
   * sheet this row opens; this only makes sure somebody looking at Today sees
   * there is one. Absent on every other row.
   */
  movedNote?: string | null;
  /**
   * "in 45 min" on the one event that starts next, when that is within a few
   * hours (`startsInLabel`). Absent on every other row.
   */
  startsIn?: string | null;
  /**
   * An event's location, verbatim from the calendar, so the row can offer
   * directions to it. Absent when the event has none, and on every other row.
   */
  location?: string | null;
  /** "18 min drive", from the Leave-by estimates, when held. Event rows only. */
  travelNote?: string | null;
  /**
   * The occurrence's start, on an event that has a video call, so the row can
   * offer to join it. Absent when there is no call, and on every other row.
   */
  videoCallStart?: string;
  /**
   * How a Stay under limit's row reads against it (`limitContextRows`): the
   * glyph goes orange once the day is close and the row red once it is past.
   * Absent on every other row.
   */
  tone?: 'near' | 'over';
  /**
   * The nutrient a limit or goal row is about, so a tap can open that
   * nutrient's food contribution breakdown. Absent on every other row.
   */
  nutrientKey?: NutrientKey;
  /**
   * A drawing that goes with the figure, for a health reading that is measured
   * against something: a bar for a limit or the Move goal, the three rings for
   * the Activity summary. The title stays the full sentence either way, since
   * it is what a screen reader and a collapsed section read. Absent on a row
   * with nothing to measure against (steps, every event and meal).
   */
  visual?: ContextVisual;
}

export type ContextVisual =
  /** `fraction` is clamped to 0..1; `move` draws it in the Move ring's red. */
  | { type: 'bar'; fraction: number; hue?: 'move' }
  | { type: 'rings'; rings: import('../utils/activityRings').ActivityRings };
