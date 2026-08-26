import { featureHidden, type SimpleFeatureId } from './simpleMode';

/**
 * What the app can do, as data.
 *
 * The app has a lot of behavior that is invisible until someone happens on it:
 * a swipe, a long press, a pill row, a whole hub behind one drawer entry. The
 * only in-app documentation any of it had was the `hint` line on an editor or
 * settings row (see `CollapsibleField`/`SettingsRow`), which can only ever
 * describe a control you are already looking at. Nothing said a control was
 * there.
 *
 * So this is one record per thing worth knowing, and two surfaces read it:
 * `TipHost` shows one as a banner on the screen it belongs to, once its
 * `when` is true, and `TipsScreen` lists every one of them whether or not it
 * ever surfaced. Both read this array, which is the point. A tip written for
 * the banner is automatically in the list, and a tip nobody ever saw pop up is
 * still somewhere it can be found on purpose.
 *
 * **This is content, not UI.** It carries no colors, no components and no
 * navigation beyond a tab name, for the same reason `settingsIndex.ts` carries
 * no control types: the two surfaces draw it differently, and a record that
 * knew how it was drawn could only serve one of them.
 *
 * Three rules for writing one:
 *
 * - **Say the mechanism.** A tip exists because someone can't see the control.
 *   "Swipe right on a task to reschedule it" is the whole job; "stay on top of
 *   your day" is not a tip.
 * - **One thing per tip.** They are shown one at a time and read in a list, so
 *   a tip covering three features is one nobody finishes.
 * - **Array order is priority.** `chooseTip` takes the first eligible unseen
 *   tip for a screen, so the earlier a tip sits within its screen's run, the
 *   sooner someone meets it. Core-loop tips go first.
 */

/**
 * Which part of the app a tip is about. Doubles as the section a tip is filed
 * under on `TipsScreen`, so these track the way the drawer already splits the
 * app rather than being a second taxonomy over it.
 */
export type TipArea = 'today' | 'organize' | 'groceries' | 'kitchen' | 'recipes' | 'mealPlan' | 'app';

/**
 * A hub screen that hosts the tip banner. Only these six render a `TipHost`:
 * they're the screens someone lands on rather than navigates to for one
 * errand, and a tip on top of a screen you opened to do one specific thing is
 * an interruption rather than an aside.
 *
 * A tip with no `screen` is browse-only. That's not a lesser tip. Plenty of
 * what's worth knowing (the widget, the app lock, backups) has no screen it
 * would naturally interrupt, and popping it onto Today because Today is where
 * people are is how a tip system turns into an ad.
 */
export type TipScreen = 'today' | 'projects' | 'groceries' | 'recipes' | 'mealPlan' | 'kitchen';

/**
 * The state a tip's `when` gets to look at.
 *
 * Deliberately a flat bag of scalars rather than the stores themselves. A
 * predicate that could reach a store could also read one that hasn't
 * initialized, and — more to the point — this is what makes every trigger
 * testable without mounting anything. `useTipSignals` is the one place it's
 * built from real state.
 */
export interface TipSignals {
  /** Top-level tasks that aren't completed. Subtasks are excluded. */
  taskCount: number;
  /** Completed rows of any age, which is what "has used the app a bit" means. */
  completedCount: number;
  pinnedCount: number;
  stackCount: number;
  /** User categories. Never 0 in practice, since a fresh install seeds some. */
  categoryCount: number;
  projectCount: number;
  templateCount: number;
  tagCount: number;
  /** Tasks carrying any recurrence rule. */
  recurringCount: number;
  /** Items currently on the shopping list, bought or not. */
  groceryItemCount: number;
  /** Items in the catalog, which outlives any one list. */
  catalogCount: number;
  shopCount: number;
  recipeCount: number;
  /**
   * Catalog items the app has seen bought at least once, which is the
   * population the pantry is built out of. Deliberately this rather than a
   * live `kitchenInventory` count: that walks items, leftovers and every
   * product box to build entries, and no tip is worth running it on a screen
   * that wasn't going to.
   */
  purchasedItemCount: number;
  /** Meals planned onto any day, past or future. */
  plannedMealCount: number;
  kitchenEnabled: boolean;
  /** Whether an Anthropic API key is set, which is what gates every AI feature. */
  hasApiKey: boolean;
}

export interface Tip {
  id: string;
  area: TipArea;
  /** Ionicons glyph name. Resolved against the palette by whichever surface draws it. */
  icon: string;
  /** A statement, not a headline. Sentence case, no trailing period. */
  title: string;
  /** One or two sentences saying how the thing works. */
  body: string;
  /** The hub screen this may surface on. Omitted = browse-only, see `TipScreen`. */
  screen?: TipScreen;
  /**
   * A tab to open from the tip itself, for a tip whose whole problem is that
   * nobody can find the screen it's about (#1372). The name is a route in
   * `AppNavigator`; `'Settings'` is the one root-stack route allowed here.
   */
  link?: { label: string; screen: string };
  /**
   * Surfaces the banner only once this is true. Omitted means eligible from
   * the first launch, which is right for the handful of tips about the core
   * loop and wrong for everything else: a tip about stacks shown to someone
   * with four tasks is noise, and the same tip shown once they have twenty is
   * the answer to a question they've started to have.
   *
   * Has no bearing on `TipsScreen`, which lists everything unconditionally.
   */
  when?: (signals: TipSignals) => boolean;
  /**
   * Extra search terms for `TipsScreen`, for words someone would look up that
   * the copy itself doesn't use. The title and body are always searched, so
   * this is only ever for synonyms.
   */
  keywords?: string[];
  /**
   * The capability this tip is about, where simplified mode takes that
   * capability away — see `tipsFor`. A tip exists because someone can't see a
   * control, so a tip about a control that isn't there is the one thing this
   * file can't afford to be.
   */
  feature?: SimpleFeatureId;
}

export interface TipAreaInfo {
  id: TipArea;
  title: string;
  icon: string;
}

/** Section order on `TipsScreen`. */
export const TIP_AREAS: TipAreaInfo[] = [
  { id: 'today', title: 'The daily list', icon: 'checkbox-outline' },
  { id: 'organize', title: 'Organizing tasks', icon: 'folder-outline' },
  { id: 'groceries', title: 'Groceries', icon: 'cart-outline' },
  { id: 'kitchen', title: 'The kitchen', icon: 'snow-outline' },
  { id: 'recipes', title: 'Recipes', icon: 'restaurant-outline' },
  { id: 'mealPlan', title: 'Meal planning', icon: 'calendar-outline' },
  { id: 'app', title: 'Around the app', icon: 'settings-outline' },
];

export const TIPS: Tip[] = [
  // ==== The daily list ====
  {
    id: 'view-pills',
    area: 'today',
    screen: 'today',
    icon: 'apps-outline',
    title: 'Today, Later, Unscheduled and Inbox',
    body: 'The pills under the title are four views of the same tasks, and every task you have sits in exactly one of them. Later holds anything hidden until a date or a time of day, Unscheduled anything with no date at all.',
    keywords: ['tabs', 'segments', 'filter', 'views'],
  },
  {
    id: 'swipe-actions',
    area: 'today',
    screen: 'today',
    icon: 'swap-horizontal-outline',
    title: 'Swipe a row for its two actions',
    body: 'Swipe right to reschedule a task. Swipe left to start selecting, so you can act on several at once. Nothing on a swipe deletes anything.',
    when: s => s.taskCount >= 3,
    keywords: ['gesture', 'slide', 'reschedule', 'bulk', 'multi select'],
  },
  {
    id: 'quick-add-parsing',
    area: 'today',
    screen: 'today',
    icon: 'text-outline',
    title: 'Type the date into the task itself',
    body: 'Quick add reads what you type. "pay rent tmrw 5p #home" comes out as a task due tomorrow at 5pm, tagged home, with the extra words stripped from the title.',
    when: s => s.taskCount >= 2,
    keywords: ['natural language', 'parse', 'shorthand', 'syntax', 'hashtag'],
  },
  {
    id: 'expand-row',
    area: 'today',
    screen: 'today',
    icon: 'expand-outline',
    title: 'Tap a task to open it in place',
    body: 'Tapping a row expands it over a dimmed list, showing its notes, subtasks and actions without opening the full editor. Tap anywhere outside to close it again.',
    when: s => s.taskCount >= 2,
    keywords: ['expand', 'preview', 'detail', 'spotlight'],
  },
  {
    id: 'pin-tasks',
    area: 'today',
    screen: 'today',
    icon: 'star-outline',
    title: 'Pin the ones you actually mean to do',
    body: 'A pinned task gets a second row in a Pinned block at the top of Today. The original stays in its category, both rows are live, and completing either one completes the task.',
    when: s => s.taskCount >= 5 && s.pinnedCount === 0,
    keywords: ['pin', 'top', 'priority', 'focus'],
  },
  {
    id: 'paint-select',
    feature: 'paintSelect',
    area: 'today',
    screen: 'today',
    icon: 'ellipsis-vertical-outline',
    title: 'Select a run of rows in one drag',
    body: 'Once you are selecting, drag down the circles at the right edge to sweep through a whole run of tasks instead of tapping each one.',
    when: s => s.taskCount >= 6,
    keywords: ['bulk', 'multi select', 'paint', 'drag', 'sweep'],
  },
  {
    id: 'pull-to-search',
    area: 'today',
    screen: 'today',
    icon: 'search-outline',
    title: 'Pull down on the list to search',
    body: 'Pulling down on any of the four task views opens quick search. The full Search screen, with filters, is in the side menu.',
    when: s => s.taskCount >= 10,
    keywords: ['find', 'lookup', 'refresh', 'gesture'],
  },
  {
    id: 'drag-to-fab',
    area: 'today',
    screen: 'today',
    icon: 'move-outline',
    title: 'Drag the add button onto a task',
    body: 'Holding the + button and dragging it over the list turns the rows into drop targets, so you can add a subtask to whichever one you drop it on.',
    when: s => s.taskCount >= 8,
    keywords: ['fab', 'plus', 'subtask', 'drop', 'gesture'],
  },
  {
    id: 'reorder-drag',
    area: 'today',
    screen: 'today',
    icon: 'reorder-three-outline',
    title: 'Long press a task to move it',
    body: 'A long press lifts a row so you can drag it up or down, including into another category. The order you leave it in is the order it keeps.',
    when: s => s.taskCount >= 6,
    keywords: ['sort', 'order', 'rearrange', 'drag'],
  },
  {
    id: 'focus-session',
    feature: 'focusSessions',
    area: 'today',
    screen: 'today',
    icon: 'hourglass-outline',
    title: 'Work a queue one task at a time',
    body: 'The hourglass in the Today header builds a focus session: a queue of tasks with timed breaks between them. It keeps running while you move around the app.',
    when: s => s.taskCount >= 6,
    keywords: ['pomodoro', 'timer', 'break', 'session', 'concentrate'],
  },
  {
    id: 'suggested-pins',
    feature: 'suggestedPins',
    area: 'today',
    screen: 'today',
    icon: 'color-wand-outline',
    title: 'Let the app pick the day for you',
    body: 'The wand in the Today header suggests a handful of tasks worth pinning, based on what is due, overdue and blocking something else. You pick which of them to keep.',
    when: s => s.taskCount >= 10 && s.pinnedCount === 0,
    keywords: ['suggest', 'wand', 'pin', 'recommend'],
  },
  {
    id: 'deload',
    feature: 'deload',
    area: 'today',
    screen: 'today',
    icon: 'trending-down-outline',
    title: 'Lighten a day that got away from you',
    body: 'When Today is overloaded, the app can propose a new day for each task that can move, and shows you where each one is going before anything changes. You approve them row by row.',
    when: s => s.taskCount >= 15,
    keywords: ['overload', 'busy', 'reschedule', 'spread', 'lighten'],
  },
  {
    id: 'shake-undo',
    area: 'today',
    icon: 'phone-portrait-outline',
    title: 'Shake the phone to undo',
    body: 'Right after completing, deleting or rescheduling something, a shake takes it back. It covers the last action only, and it can be turned off in Settings.',
    link: { label: 'Open Settings', screen: 'Settings' },
    keywords: ['undo', 'mistake', 'revert', 'shake'],
  },
  {
    id: 'day-reset',
    area: 'today',
    icon: 'moon-outline',
    title: 'Your day does not have to start at midnight',
    body: 'If you are usually up past midnight, set the day to turn over at 2am or 4am in Settings. A task finished at 1am then counts for the day you think it does.',
    link: { label: 'Open Settings', screen: 'Settings' },
    keywords: ['midnight', 'rollover', 'night owl', 'streak', 'day start'],
  },

  // ==== Organizing tasks ====
  {
    id: 'categories',
    area: 'organize',
    icon: 'folder-outline',
    title: 'Categories are the headings on Today',
    body: 'Every task sits in one category, and that is what splits the day into sections. You can reorder them, hide one, or give one its own schedule.',
    link: { label: 'Open Categories', screen: 'Categories' },
    keywords: ['section', 'group', 'heading', 'list'],
  },
  {
    id: 'stacks',
    feature: 'stacks',
    area: 'organize',
    icon: 'layers-outline',
    title: 'Stacks group tasks that go together',
    body: 'A stack is a label several tasks hang off, so they appear under one heading on Today with a count of what is due. Each task keeps its own date.',
    link: { label: 'Open Stacks', screen: 'Stacks' },
    when: s => s.taskCount >= 8,
    keywords: ['group', 'bundle', 'cluster', 'together'],
  },
  {
    id: 'projects',
    area: 'organize',
    screen: 'projects',
    icon: 'briefcase-outline',
    title: 'Projects hold work that has an end',
    body: 'A project tracks progress across its tasks and can pull the next few into your day when you ask. Use a category for a permanent area of life and a project for something that finishes.',
    keywords: ['project', 'progress', 'milestone', 'goal'],
  },
  {
    id: 'templates',
    feature: 'templates',
    area: 'organize',
    icon: 'copy-outline',
    title: 'Templates create a set of tasks at once',
    body: 'A template is a checklist you can run whenever you need it: packing for a trip, closing the house up. It can ask you a question or two first and date the tasks from your answer.',
    link: { label: 'Open Templates', screen: 'Templates' },
    when: s => s.completedCount >= 20,
    keywords: ['checklist', 'routine', 'repeat', 'preset', 'boilerplate'],
  },
  {
    id: 'chains',
    feature: 'chains',
    area: 'organize',
    icon: 'link-outline',
    title: 'Steps that arrive one at a time',
    body: 'A chain gives one task an ordered list of steps. Completing a step immediately creates the next one, so only the step you are on is ever in your way.',
    when: s => s.taskCount >= 10,
    keywords: ['sequence', 'steps', 'order', 'workflow', 'cycle'],
  },
  {
    id: 'series-dates',
    feature: 'taskSeries',
    area: 'organize',
    icon: 'calendar-number-outline',
    title: 'One task on several dates',
    body: 'A task can be given more than one date at once, for something like cat sitting on the 10th and the 15th. Each date is a real row you can complete on its own.',
    when: s => s.taskCount >= 10,
    keywords: ['multiple dates', 'series', 'occurrences', 'several days'],
  },
  {
    id: 'recurrence',
    area: 'organize',
    icon: 'repeat-outline',
    title: 'Repeat from the date or from the day you finish',
    body: 'A repeating task can follow a fixed schedule, or count from whenever you last completed it. The second is what you want for something like watering plants, where being three days late should move the next one too.',
    when: s => s.taskCount >= 6 && s.recurringCount === 0,
    keywords: ['recurring', 'repeat', 'schedule', 'weekly', 'daily'],
  },
  {
    id: 'blocking',
    feature: 'blocking',
    area: 'organize',
    icon: 'hand-left-outline',
    title: 'Mark what a task is waiting on',
    body: 'A task can be blocked by another task, or by a person you are waiting to hear from. Blocked tasks stay out of your way and collect on the Waiting screen.',
    link: { label: 'Open Waiting', screen: 'Waiting' },
    when: s => s.taskCount >= 12,
    keywords: ['blocked', 'depends', 'waiting on', 'someone else'],
  },
  {
    id: 'daily-target',
    feature: 'dailyTargets',
    area: 'organize',
    icon: 'speedometer-outline',
    title: 'A task you do a set number of times a day',
    body: 'Give a task a daily target and it tracks units instead of a single check-off: eight glasses of water, three sets. It hides itself once you are on pace for the time of day and comes back when you fall behind.',
    when: s => s.taskCount >= 10,
    keywords: ['quota', 'habit', 'count', 'target', 'pace', 'reps'],
  },
  {
    id: 'deadline-vs-date',
    feature: 'deadlines',
    area: 'organize',
    icon: 'flag-outline',
    title: 'A deadline is not the same as a date',
    body: 'The date is when you mean to do it. The deadline is when it stops being any use. Setting both lets the app move the date around without ever pushing it past the deadline.',
    when: s => s.taskCount >= 8,
    keywords: ['due', 'deadline', 'hard date', 'latest'],
  },
  {
    id: 'defer',
    area: 'organize',
    icon: 'eye-off-outline',
    title: 'Hide a task until it is worth seeing',
    body: 'A task can wait for a day, for a time of day, or for both, so an evening errand does not sit in your morning list. It surfaces on its own when the moment arrives.',
    when: s => s.taskCount >= 8,
    keywords: ['defer', 'snooze', 'hide', 'later', 'morning', 'evening'],
  },
  {
    id: 'editor-search',
    area: 'organize',
    icon: 'search-circle-outline',
    title: 'Search the task editor itself',
    body: 'The task editor has a lot of fields. The magnifier in its header filters the whole sheet down to the rows that match what you type, so you can find one by name instead of by memory.',
    when: s => s.taskCount >= 12,
    keywords: ['find field', 'editor', 'options', 'settings'],
  },
  {
    id: 'tags',
    area: 'organize',
    icon: 'pricetag-outline',
    title: 'Tags cut across categories',
    body: 'A task sits in one category but can carry any number of tags, which is how you pull together things that live in different sections. Type #name in quick add to tag as you go.',
    link: { label: 'Open Tags', screen: 'Tags' },
    when: s => s.taskCount >= 10 && s.tagCount === 0,
    keywords: ['label', 'hashtag', 'cross cutting'],
  },
  {
    id: 'look-ahead',
    feature: 'lookAhead',
    area: 'organize',
    icon: 'binoculars-outline',
    title: 'See what is coming before it lands',
    body: 'Look ahead shows everything due in the next stretch of days and whether it actually fits in the time you have. It is the way to catch a bad week while you can still move things.',
    when: s => s.taskCount >= 15,
    keywords: ['upcoming', 'week', 'preview', 'capacity', 'workload'],
  },

  // ==== Groceries ====
  {
    id: 'grocery-aisles',
    area: 'groceries',
    screen: 'groceries',
    icon: 'git-branch-outline',
    title: 'The list sorts itself into aisles',
    body: 'Anything you add is filed into an aisle automatically, so the list reads in the order you walk the store. Reorder the aisles once to match your own route and every list after that follows it.',
    keywords: ['sections', 'order', 'shop layout', 'route'],
  },
  {
    id: 'grocery-quick-add',
    area: 'groceries',
    screen: 'groceries',
    icon: 'add-circle-outline',
    title: 'Add several items in one line',
    body: 'The add field takes quantities and separators, so "2 milk, bread, 500g rice" becomes three items with their amounts attached. It suggests things you have bought before as you type.',
    when: s => s.groceryItemCount >= 3,
    keywords: ['bulk add', 'parse', 'quantity', 'autocomplete'],
  },
  {
    id: 'grocery-shops',
    area: 'groceries',
    screen: 'groceries',
    icon: 'storefront-outline',
    title: 'Say which store an item comes from',
    body: 'An item can be tied to a store, and starting a trip at that store filters the list down to what you can actually buy there. Everything else waits for the trip that can get it.',
    when: s => s.catalogCount >= 10,
    keywords: ['store', 'shop', 'supermarket', 'trip', 'filter'],
  },
  {
    id: 'active-trip',
    feature: 'shoppingTrips',
    area: 'groceries',
    screen: 'groceries',
    icon: 'walk-outline',
    title: 'Tell the app you are at the store',
    body: 'Starting a trip switches the list into shopping mode: it narrows to that store, tracks what goes in the cart, and asks about prices and leftovers when you finish.',
    when: s => s.groceryItemCount >= 5,
    keywords: ['shopping', 'trip', 'in store', 'cart', 'checkout'],
  },
  {
    id: 'either-or',
    feature: 'itemChoices',
    area: 'groceries',
    screen: 'groceries',
    icon: 'shuffle-outline',
    title: 'Apples or pears, decided at the shelf',
    body: 'Two items can be linked as a choice, so the list asks for one of them rather than both. Buying either resolves the pair and the other drops off.',
    when: s => s.catalogCount >= 15,
    keywords: ['choice', 'alternative', 'or', 'pair', 'undecided'],
  },
  {
    id: 'substitutes',
    feature: 'substitutes',
    area: 'groceries',
    screen: 'groceries',
    icon: 'swap-vertical-outline',
    title: 'If there is no butter, use margarine',
    body: 'An item can record what you would accept instead. The substitute shows up on the item when you are standing there without the thing you wanted.',
    when: s => s.catalogCount >= 15,
    keywords: ['substitute', 'swap', 'replacement', 'instead'],
  },
  {
    id: 'standing-swaps',
    feature: 'substitutes',
    area: 'groceries',
    icon: 'sync-outline',
    title: 'Always use oat milk where a recipe says milk',
    body: 'A substitution can be made standing, so the app applies it every time on its own instead of asking. Every rule currently running is listed in one place, and turning one off restores the original.',
    when: s => s.recipeCount >= 3,
    keywords: ['always', 'default', 'rule', 'dietary', 'automatic'],
  },
  {
    id: 'barcode-scan',
    feature: 'barcodeScanning',
    area: 'groceries',
    screen: 'groceries',
    icon: 'barcode-outline',
    title: 'Scan a barcode onto the list',
    body: 'Scanning looks the product up and adds it by name. The app remembers which of your items that barcode is, so the second scan of the same thing needs no lookup at all.',
    when: s => s.catalogCount >= 10,
    keywords: ['scan', 'camera', 'barcode', 'product', 'gtin'],
  },
  {
    id: 'receipt-import',
    feature: 'receiptImport',
    area: 'groceries',
    icon: 'receipt-outline',
    title: 'Read a receipt into the app',
    body: 'A photo of a receipt matches its lines against your list and records what each thing cost. Store shorthand you teach it once is remembered for next time.',
    when: s => s.catalogCount >= 20 && s.hasApiKey,
    keywords: ['receipt', 'photo', 'prices', 'scan', 'ocr'],
  },
  {
    id: 'grocery-prices',
    area: 'groceries',
    icon: 'pricetags-outline',
    title: 'Which store is cheaper for this',
    body: 'Prices recorded per store build up over time, so an item can tell you where it was last cheapest and whether it is getting more expensive.',
    when: s => s.shopCount >= 2,
    keywords: ['price', 'cost', 'compare', 'cheaper', 'budget'],
  },
  {
    id: 'buy-again',
    area: 'groceries',
    screen: 'groceries',
    icon: 'repeat-outline',
    title: 'The app knows what you usually buy',
    body: 'Anything bought before stays in the catalog, ranked by how often and how recently you got it, so rebuilding a weekly list is mostly tapping things you recognize.',
    when: s => s.catalogCount >= 20,
    keywords: ['catalog', 'regular', 'usual', 'again', 'history'],
  },

  // ==== The kitchen ====
  {
    id: 'kitchen-what-it-is',
    feature: 'pantryTracking',
    area: 'kitchen',
    screen: 'kitchen',
    icon: 'file-tray-stacked-outline',
    title: 'The pantry is what you already have',
    body: 'Finishing a shopping trip puts what you bought in here, and the app uses it to stop suggesting things you already own. You can add anything by hand too.',
    keywords: ['pantry', 'fridge', 'inventory', 'stock', 'have'],
  },
  {
    id: 'freshness',
    feature: 'pantryTracking',
    area: 'kitchen',
    screen: 'kitchen',
    icon: 'time-outline',
    title: 'What is about to go bad, in order',
    body: 'Each thing carries a use-by date, guessed from what it is if you do not set one. The pantry sorts by how close that is, so the top of the list is what to cook tonight.',
    when: s => s.purchasedItemCount >= 5,
    keywords: ['expiry', 'use by', 'spoil', 'waste', 'fresh'],
  },
  {
    id: 'freezer',
    feature: 'pantryTracking',
    area: 'kitchen',
    screen: 'kitchen',
    icon: 'snow-outline',
    title: 'Freezing something stops its clock',
    body: 'Moving an item to the freezer pauses its use-by date, and taking it out again starts it running from where it left off. Nothing in the freezer nags you.',
    when: s => s.purchasedItemCount >= 5,
    keywords: ['freezer', 'frozen', 'thaw', 'defrost', 'pause'],
  },
  {
    id: 'opened-and-low',
    feature: 'pantryTracking',
    area: 'kitchen',
    screen: 'kitchen',
    icon: 'water-outline',
    title: 'An opened jar has less time left',
    body: 'Marking something opened shortens its use-by to the once-opened window for that kind of food. Marking it running low is what gets it back onto the shopping list.',
    when: s => s.purchasedItemCount >= 8,
    keywords: ['opened', 'running low', 'nearly out', 'jar', 'restock'],
  },
  {
    id: 'use-up-recipes',
    feature: 'pantryTracking',
    area: 'kitchen',
    screen: 'kitchen',
    icon: 'bulb-outline',
    title: 'Cook the thing that is about to turn',
    body: 'The app can look at what is closest to its use-by date and suggest recipes you already have that use it, rather than just telling you it is going bad.',
    when: s => s.purchasedItemCount >= 5 && s.recipeCount >= 3,
    keywords: ['use up', 'waste', 'leftover ingredients', 'suggest'],
  },
  {
    id: 'disposal',
    feature: 'pantryTracking',
    area: 'kitchen',
    icon: 'help-circle-outline',
    title: 'Say whether it got eaten or thrown out',
    body: 'When something leaves the pantry the app asks which it was. Used up and went bad mean different things to how it guesses shelf life and what it suggests buying next.',
    when: s => s.purchasedItemCount >= 8,
    keywords: ['finished', 'threw out', 'binned', 'wasted', 'gone'],
  },

  // ==== Recipes ====
  {
    id: 'recipe-import',
    area: 'recipes',
    screen: 'recipes',
    icon: 'link-outline',
    title: 'Paste a link to a recipe page',
    body: 'The app reads the page and fills in the ingredients, steps, times and yield, and shows you what it found before saving anything.',
    keywords: ['import', 'url', 'website', 'paste', 'scrape'],
  },
  {
    id: 'recipe-to-list',
    area: 'recipes',
    screen: 'recipes',
    icon: 'cart-outline',
    title: 'Send a recipe to the shopping list',
    body: 'Adding a recipe to the list skips whatever you already have in the pantry, so you only buy the gaps. It respects any scaling you have applied.',
    when: s => s.recipeCount >= 2,
    keywords: ['shopping', 'ingredients', 'add to list', 'groceries'],
  },
  {
    id: 'recipe-scale',
    feature: 'recipeScaling',
    area: 'recipes',
    screen: 'recipes',
    icon: 'resize-outline',
    title: 'Halve or double a recipe',
    body: 'Scaling rewrites every amount in the ingredient list, including the ones written as fractions or in cups. What goes to the shopping list scales with it.',
    when: s => s.recipeCount >= 2,
    keywords: ['scale', 'double', 'halve', 'servings', 'portions'],
  },
  {
    id: 'cook-mode',
    feature: 'cookMode',
    area: 'recipes',
    screen: 'recipes',
    icon: 'list-outline',
    title: 'Read a recipe one step at a time',
    body: 'The Steps button on a recipe shows a single step at a time in large text, keeps the screen awake, and starts a timer from any step that names a duration.',
    when: s => s.recipeCount >= 2,
    keywords: ['cooking', 'steps', 'hands free', 'screen on', 'kitchen'],
  },
  {
    id: 'recipe-components',
    feature: 'recipeComposition',
    area: 'recipes',
    icon: 'git-merge-outline',
    title: 'One recipe used inside another',
    body: 'A recipe can list another recipe as an ingredient, so a sauce you make often is written once and pulled into everything that needs it. The shopping list flattens it back out.',
    when: s => s.recipeCount >= 5,
    keywords: ['sub recipe', 'component', 'nested', 'sauce', 'base'],
  },
  {
    id: 'recipe-units',
    area: 'recipes',
    icon: 'calculator-outline',
    title: 'Show amounts in whichever units you think in',
    body: 'Recipes can display in metric or US units regardless of how they were written, so an imported page does not have to be converted by hand.',
    when: s => s.recipeCount >= 3,
    keywords: ['metric', 'imperial', 'grams', 'cups', 'convert'],
  },
  {
    id: 'recipe-timers',
    area: 'recipes',
    icon: 'alarm-outline',
    title: 'Two timers that follow you around',
    body: 'A recipe can run two timers at once, and they keep counting from any screen in the app. Useful when the oven and the pan are on different clocks.',
    when: s => s.recipeCount >= 3,
    keywords: ['timer', 'alarm', 'countdown', 'oven'],
  },

  // ==== Meal planning ====
  {
    id: 'meal-plan-exists',
    area: 'mealPlan',
    screen: 'groceries',
    icon: 'calendar-outline',
    title: 'There is a meal plan in here',
    body: 'The pills under the header switch between Groceries, Recipes, Meal plan and Pantry. The meal plan is a week of dinners you can fill from your own recipes, and it can send the whole week to the shopping list at once.',
    link: { label: 'Open Meal plan', screen: 'MealPlan' },
    keywords: ['meal plan', 'week', 'dinners', 'planning', 'menu'],
  },
  {
    id: 'suggest-meals',
    area: 'mealPlan',
    screen: 'mealPlan',
    icon: 'sparkles-outline',
    title: 'Fill the empty nights for you',
    body: 'The app can propose a dish for each blank day, drawing on your own recipes, what is in the fridge, and what you have not cooked in a while. You accept them one at a time.',
    when: s => s.recipeCount >= 4,
    keywords: ['suggest', 'ideas', 'fill', 'empty', 'what to cook'],
  },
  {
    id: 'leftovers',
    area: 'mealPlan',
    screen: 'mealPlan',
    icon: 'file-tray-outline',
    title: 'Leftovers count as a meal',
    body: 'After cooking, the app asks whether there is anything left. Logging it puts the leftovers in the fridge and lets you plan them onto another night instead of cooking again.',
    when: s => s.plannedMealCount >= 3,
    keywords: ['leftovers', 'batch', 'again', 'fridge', 'reheat'],
  },
  {
    id: 'meal-slots',
    area: 'mealPlan',
    icon: 'restaurant-outline',
    title: 'Meals can show up as tasks on Today',
    body: 'Turn this on and each planned meal writes itself onto your day as a task, so cooking sits alongside everything else you have to do rather than on a separate screen.',
    link: { label: 'Open Settings', screen: 'Settings' },
    when: s => s.plannedMealCount >= 3,
    keywords: ['today', 'tasks', 'cook task', 'breakfast', 'lunch', 'dinner'],
  },
  {
    id: 'restock-offer',
    area: 'mealPlan',
    screen: 'mealPlan',
    icon: 'basket-outline',
    title: 'What the week needs that you have not bought',
    body: 'Once there are meals on the plan, the app can tell you which of their ingredients are not on the list and not in the kitchen, and add just those.',
    when: s => s.plannedMealCount >= 2,
    keywords: ['restock', 'missing', 'shopping', 'ingredients', 'gap'],
  },

  // ==== Around the app ====
  {
    id: 'settings-search',
    area: 'app',
    icon: 'options-outline',
    title: 'Search Settings instead of scrolling it',
    body: 'Settings has a search field at the top that finds a row by name or by what it does, and jumps straight to it. Faster than remembering which of the eight groups it is in.',
    link: { label: 'Open Settings', screen: 'Settings' },
    keywords: ['preferences', 'find', 'options', 'configuration'],
  },
  {
    id: 'widget',
    area: 'app',
    icon: 'phone-portrait-outline',
    title: 'There is a home screen widget',
    body: 'Add it from your home screen the usual way, by long pressing and searching for this app. It shows what is due today, and tasks can be checked off without opening anything.',
    keywords: ['widget', 'home screen', 'lock screen', 'glance'],
  },
  {
    id: 'app-lock',
    area: 'app',
    icon: 'lock-closed-outline',
    title: 'Lock the app behind Face ID',
    body: 'Turning the lock on means the app asks for Face ID when you open it, with a grace period so switching apps for a moment does not lock you out.',
    link: { label: 'Open Settings', screen: 'Settings' },
    keywords: ['privacy', 'face id', 'touch id', 'passcode', 'security'],
  },
  {
    id: 'vacation-mode',
    feature: 'vacationPause',
    area: 'app',
    icon: 'airplane-outline',
    title: 'Pause the whole list while you are away',
    body: 'Vacation mode hides everything you marked as pausable for a set stretch of days, so a week off does not come back as a wall of overdue tasks.',
    link: { label: 'Open Settings', screen: 'Settings' },
    when: s => s.taskCount >= 15,
    keywords: ['holiday', 'away', 'pause', 'break', 'trip'],
  },
  {
    id: 'backup',
    area: 'app',
    icon: 'download-outline',
    title: 'Everything is on this device only',
    body: 'There is no account and no server: your data lives in a file on the phone. Export a backup from Settings every so often, and keep it somewhere you would still have it if you lost the phone.',
    link: { label: 'Open Settings', screen: 'Settings' },
    when: s => s.completedCount >= 30,
    keywords: ['export', 'backup', 'restore', 'privacy', 'offline', 'data'],
  },
  {
    id: 'sync',
    area: 'app',
    icon: 'cloud-outline',
    title: 'Sync between your own devices',
    body: 'Sync moves your data between devices signed into the same iCloud account. It is off until you turn it on, and it never involves a server of ours.',
    link: { label: 'Open Settings', screen: 'Settings' },
    keywords: ['icloud', 'sync', 'ipad', 'devices', 'cloudkit'],
  },
  {
    id: 'ai-key',
    area: 'app',
    icon: 'sparkles-outline',
    title: 'The AI features need your own API key',
    body: 'Suggestions, recipe reading and receipt parsing are off until you paste an Anthropic API key into Settings. Nothing leaves the phone before you do, and you choose which features may use it.',
    link: { label: 'Open Settings', screen: 'Settings' },
    when: s => !s.hasApiKey && s.completedCount >= 15,
    keywords: ['ai', 'claude', 'anthropic', 'api key', 'suggestions'],
  },
  {
    id: 'demo-mode',
    area: 'app',
    icon: 'people-outline',
    title: 'Show someone the app without showing your list',
    body: 'Demo mode swaps your data for a made-up set for as long as it is on. Nothing you tap during a demo touches your real tasks, and turning it off puts everything back.',
    link: { label: 'Open Settings', screen: 'Settings' },
    keywords: ['demo', 'show', 'privacy', 'sample', 'screenshot'],
  },
  {
    id: 'reminders-import',
    area: 'app',
    icon: 'mic-outline',
    title: 'Capture a task by talking to Siri',
    body: 'Point the app at an Apple Reminders list and anything that lands there gets pulled in, which makes "Hey Siri, remind me to..." a way into this app.',
    link: { label: 'Open Settings', screen: 'Settings' },
    when: s => s.completedCount >= 20,
    keywords: ['siri', 'voice', 'apple reminders', 'import', 'capture'],
  },
  {
    id: 'calendar-busy',
    area: 'app',
    icon: 'today-outline',
    title: 'The app can see how busy your day already is',
    body: 'Given read access to your calendar, the app counts your meetings as time already spent, so its idea of what fits in a day matches your actual one.',
    link: { label: 'Open Settings', screen: 'Settings' },
    when: s => s.taskCount >= 12,
    keywords: ['calendar', 'events', 'meetings', 'busy', 'free time'],
  },
  {
    id: 'retention',
    area: 'app',
    icon: 'trash-outline',
    title: 'Completed tasks are kept forever by default',
    body: 'Every completion leaves a row behind, which is what the Logbook and Stats are built from. If you would rather not keep them all, set a window in Settings and older ones are cleared automatically.',
    link: { label: 'Open Settings', screen: 'Settings' },
    when: s => s.completedCount >= 100,
    keywords: ['history', 'delete', 'cleanup', 'logbook', 'storage'],
  },
  {
    id: 'stats',
    feature: 'statsScreen',
    area: 'app',
    icon: 'bar-chart-outline',
    title: 'What you have actually been doing',
    body: 'The Stats screen reads your completion history back to you: streaks, what you finish and what you keep pushing, and how much you cook.',
    link: { label: 'Open Stats', screen: 'Stats' },
    when: s => s.completedCount >= 25,
    keywords: ['statistics', 'streak', 'progress', 'insights', 'charts'],
  },
  {
    id: 'drift',
    feature: 'driftScreen',
    area: 'app',
    icon: 'trending-down-outline',
    title: 'The tasks you keep moving',
    body: 'The Drift screen collects anything you have rescheduled over and over. A task pushed nine times is usually one to reword, break up, or drop.',
    link: { label: 'Open Drift', screen: 'Drift' },
    when: s => s.completedCount >= 30,
    keywords: ['postponed', 'procrastinate', 'stale', 'avoiding', 'rescheduled'],
  },
];

/**
 * Tips filed under an area, in array order.
 */
/**
 * The tips worth showing at all right now.
 *
 * Simplified mode hides about thirty capabilities, and this file is the app's
 * documentation of its own capabilities — so without this, someone who asked
 * for a plainer app would get banners teaching a control that isn't there and
 * a Tips screen listing thirty features they can't reach. Same one-record-at-a-
 * time treatment `SettingsEntry.kitchen`/`simple` give the settings index, and
 * for the same reason: a documentation surface that outlives what it documents
 * is worse than none.
 *
 * The kitchen area needs no equivalent because `TipSignals.kitchenEnabled` is
 * already in scope for a `when`, which is where those tips gate themselves.
 *
 * Every read of the whole set goes through this — `TipsScreen`'s list and its
 * unread count, the drawer's badge, and `TipHost`'s candidates — so the count
 * on the row always matches the list behind it.
 */
export function tipsFor(simpleMode: boolean, tips: Tip[] = TIPS): Tip[] {
  if (!simpleMode) return tips;
  return tips.filter(tip => !tip.feature || !featureHidden(tip.feature, simpleMode));
}

export function tipsForArea(area: TipArea, tips: Tip[] = TIPS): Tip[] {
  return tips.filter(tip => tip.area === area);
}

/**
 * The tips a screen could surface, unseen ones only, in priority order.
 *
 * Takes no signals on purpose: it's the cheap half of the decision, and
 * `TipHost` runs it before gathering any state so a screen whose tips are all
 * seen costs nothing at all.
 */
export function unseenTipsForScreen(screen: TipScreen, seen: readonly string[], tips: Tip[] = TIPS): Tip[] {
  const seenSet = new Set(seen);
  return tips.filter(tip => tip.screen === screen && !seenSet.has(tip.id));
}

/** What was last put in front of the user, and on which logical day. */
export interface LastTipShown {
  id: string;
  /** A `YYYY-MM-DD` logical day key, per `getLogicalDayKey`. */
  day: string;
}

export interface TipChoice {
  tip: Tip;
  /**
   * Whether this is a new promotion that has to be recorded. False when the
   * tip is simply the one already promoted today and still on screen.
   */
  stamp: boolean;
}

/**
 * Which tip, if any, a screen should be showing.
 *
 * **At most one new tip per logical day, across the whole app.** That's the
 * only thing keeping this from becoming the nagging it was built to replace:
 * without it, someone who opens four screens on the day they cross a threshold
 * meets four tips, and the fourth is an annoyance whatever it says. A tip
 * already promoted today keeps its place until it's dismissed, however many
 * days that takes, so the rate limit bounds arrivals rather than expiring
 * anything.
 *
 * The day is a logical one (`dayResetTime`), not a calendar one, so a tip
 * dismissed at 1am doesn't let another through at 2am for someone whose day
 * turns over at 4am.
 */
export function chooseTip(
  candidates: Tip[],
  signals: TipSignals,
  lastShown: LastTipShown | null,
  todayKey: string
): TipChoice | null {
  const eligible = candidates.filter(tip => !tip.when || tip.when(signals));
  if (eligible.length === 0) return null;

  if (lastShown && lastShown.day === todayKey) {
    // Today's slot is taken. It's only this screen's business if the tip that
    // took it is one of this screen's own and still standing.
    const held = eligible.find(tip => tip.id === lastShown.id);
    return held ? { tip: held, stamp: false } : null;
  }

  return { tip: eligible[0], stamp: true };
}

/**
 * Tips matching a search query, for `TipsScreen`.
 *
 * Every whitespace-separated word has to appear somewhere in the tip, which is
 * what makes a two-word query narrow the list rather than widen it. Plain
 * substring matching rather than `fuzzySearch`: that ranks short names by how
 * well they match, and these are paragraphs, where a fuzzy match on scattered
 * letters is a false positive nearly every time.
 */
export function filterTips(query: string, tips: Tip[] = TIPS): Tip[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return tips;

  return tips.filter(tip => {
    const haystack = [tip.title, tip.body, ...(tip.keywords ?? [])].join(' ').toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}
