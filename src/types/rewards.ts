/**
 * What moved the coin balance — see `src/utils/rewards.ts` for every rule.
 *
 * `earn` is a completion, `loss` is a miss or a slip, `spend` is a reward
 * claimed. Three kinds rather than a signed amount so a row says what happened
 * on its own, and so the balance is one sum with no sign convention to get
 * backwards.
 */
export type CoinEntryKind = 'earn' | 'loss' | 'spend';

/**
 * One movement of the coin balance.
 *
 * The balance is never stored: it is the sum of these rows, because a stored
 * number synced last-writer-wins would drop whichever device's coins arrived
 * second. Rows tied to a completion or a miss carry a derived id
 * (`spawnSeed.coinEarn`/`coinMiss`) so two devices completing the same
 * occurrence apart write one row, not two.
 */
export interface CoinEntry {
  id: string;
  kind: CoinEntryKind;
  /** Always positive; `kind` says which way it moved the balance. */
  amount: number;
  /** ISO instant. */
  at: string;
  /**
   * The task that earned or cost this, when one did. Provenance, and the key
   * unticking a task (or undoing a slip) uses to take the row back. Carries no
   * foreign key: the entry outlives a task the retention window purges.
   */
  taskId: string | null;
  /** The reward claimed, for a `spend`. */
  rewardId: string | null;
  /** What to show in the history list: the task's or reward's title at the time. */
  label: string;
  /**
   * The part of `amount` that went into (an `earn`) or came out of (a `loss`
   * or `spend`) the savings for the goal, written once when the entry is and
   * never recomputed (see `src/utils/rewardSavings.ts`). 0 or absent: all of
   * it was spending money. Never more than `amount`.
   */
  saved?: number;
}

/**
 * Where an unlock's leave-out list looks. Categories are named because that is
 * how a task holds one (`Task.category`, rewritten on a rename); stacks and
 * projects are ids.
 */
export interface UnlockIgnoreList {
  categories: string[];
  stackIds: string[];
  projectIds: string[];
}

/**
 * A treat opened by doing a share of the day's work rather than bought with
 * coins ("Switch, once 60% of today's work is done"). Rules in
 * `src/utils/rewardUnlocks.ts`. It never moves the balance.
 */
export interface RewardUnlock {
  id: string;
  title: string;
  /** One emoji, or null for the default icon. Same rule as `Reward.glyph`. */
  glyph: string | null;
  createdAt: string;
  /** The share of today's work, 1..100, that opens it. */
  sharePct: number;
  /**
   * Tasks that also have to be done first, on the days they are due. Any
   * occurrence of the task counts: the id is resolved to its family
   * (`occurrenceFamilyKey`), so a repeating task's later rows still match.
   */
  requiredTaskIds: string[];
  /** Minutes of play a day once open, or null for no limit (and no timer). */
  playMinutes: number | null;
  /** Open all day on Saturday and Sunday without any work. */
  freeOnWeekends: boolean;
  /** Open all day while vacation mode is on. */
  freeOnVacation: boolean;
  /**
   * "HH:MM", or null to count everything. A task whose time window starts at
   * or after this isn't part of today's work for this unlock, whether it is
   * done or not (a bedtime routine would otherwise hold the share down all
   * day). It doesn't hide the task or change the coins it pays.
   */
  ignoreAfter?: string | null;
  /**
   * Tasks in these categories (by name), stacks or projects (by id) aren't part
   * of today's work for this unlock, done or not: the same leave-out as
   * `ignoreAfter`, picked by where a task is filed instead of when it starts.
   * Null leaves nothing out. Rules in `src/utils/rewardUnlocks.ts`.
   */
  ignoreList?: UnlockIgnoreList | null;
  /**
   * An "Avoid this" habit for doing it while it's locked. A slip logged on
   * it while the unlock is open asks first, since it isn't one.
   */
  guardsTaskId: string | null;
  /**
   * The app group the shield blocks while this unlock is locked ("Switch
   * Parental Controls" for a console's phone app), or null for none. Lifts the
   * moment it opens. A group id as the app-groups store knows it; a removed one
   * resolves to the fallback group like every other reason's. Device-local
   * apps, so only the id is stored here. Rules in `src/utils/unlockShield.ts`.
   */
  blockGroupId?: string | null;
  /**
   * A code kept for the person (a console's parental controls PIN), shown only
   * while the unlock is open. Never sent to the MCP server's reader.
   */
  pin: string | null;
  /** The logical day (`YYYY-MM-DD`) the play fields below count, or null before any play. */
  playDay: string | null;
  /** Play already used on `playDay`, not counting the stretch running now. */
  playUsedMs: number;
  /** Time added on `playDay` past `playMinutes` ("+15 min"). */
  playExtraMs: number;
  /** When the running stretch began, or null when nothing is running. */
  playStartedAt: string | null;
}

/** Something you've decided to treat yourself to, for a price in coins. */
export interface Reward {
  id: string;
  /**
   * What it's called. For a reward made from a wish list item this is a
   * snapshot taken when it was priced, shown only if the item is gone; the
   * item's own title is what's displayed (see `rewardDisplay`).
   */
  title: string;
  /** Coins it costs to claim. A positive whole number. */
  cost: number;
  createdAt: string;
  /** An app or URL to open for it ("Uber Eats" for takeout). Same values as `Task.linkUrl`. */
  linkUrl: string | null;
  /** A line of context ("the Thai place on 5th"). */
  note: string | null;
  /**
   * Claimed once, then gone from the list. Whether it has been is read off
   * the ledger (a spend naming it), not stored, so undoing the claim brings
   * it back without a second field to keep in step.
   */
  oneTime: boolean;
  /**
   * The wish list item this reward is, when it is one. Its title, notes and
   * link are the reward's, claiming it checks the item off, and checking the
   * item off by hand retires the reward. Always one-time. Carries no foreign
   * key, like every other provenance pointer in the ledger.
   */
  taskId: string | null;
  /**
   * A real-money price in minor units (cents), for a reward that costs money.
   * When set, `cost` is derived from it at the current exchange rate
   * (`repriceCoinsFor` in `src/utils/rewards.ts`) and rewritten whenever the
   * rate moves, so `cost` stays the one figure every reader claims, sorts and
   * saves toward. Null for a reward priced in coins only.
   */
  priceMinor: number | null;
  /**
   * Add the sales tax rate (`rewardSalesTaxPercent`) to `priceMinor` before it
   * becomes coins. Only meaningful with a dollar price, and only applied while
   * a rate is set (`priceWithTax` in `src/utils/rewards.ts`). Always false
   * without a price.
   */
  taxable: boolean;
  /**
   * The "don't do this" habit this reward is the honest way to have ("No
   * dessert unless claimed" for "A dessert"). A slip logged on it claims the
   * reward when the balance covers it, and otherwise is charged the reward's
   * price down to zero. Never set on a one-time or wish list reward. Rules in
   * `src/utils/rewardGuard.ts`. No foreign key, like `taskId`.
   */
  guardsTaskId: string | null;
  /**
   * The reward can be claimed once per this many days (a week is 7, a month
   * 30; the form picks days, weeks or months). Null is no limit. Whether it is
   * waiting is read off the ledger's newest claim (`claimWaitDays`), so undoing
   * the claim frees it with nothing else to reset. Never set on a one-time or
   * wish list reward, which are claimed once anyway.
   */
  claimEveryDays: number | null;
  /**
   * The emoji drawn on the reward's tile ("☕" for a coffee). Null draws the
   * gift icon. Chosen by hand and never guessed from the title; a reward made
   * from a wish list item has none, since the item is what is shown.
   */
  glyph: string | null;
}
