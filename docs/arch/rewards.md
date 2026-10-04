# Coins and rewards

A light, Habitica-style economy over the tasks you already have. Completing a task earns coins,
marking one missed or logging a slip costs coins, and coins buy rewards you define yourself. Off by
default (`rewardsEnabled`), switched on from the Rewards screen (its own menu row, under Tasks). The rules live in
`src/utils/rewards.ts`, the ledger in `src/store/useRewardStore.ts`, and the four hooks in
`useTaskStore` (`completeTask`, `uncompleteTask`, `logSlip`, `undoSlip`).

## Rules

- **The balance is derived, never stored.** It is the sum of `coin_entries`. Sync is
  last-writer-wins per row, so a stored balance would drop whichever device's coins arrived second;
  one row per event merges by union. It can't be derived from completed tasks either, because
  `completedRetentionDays` purges those. Entries tied to a completion or a miss take a derived id
  (`spawnSeed.coinEarn`/`coinMiss`), so the same occurrence completed on two phones is one row and a
  redo rewrites the row an undo removed.
- **What earns:** a task's effort bucket (`COINS_BY_EFFORT`, read through `estimatedMinutesFor` so a
  chain pays for the live step) scaled by its difficulty (`DIFFICULTY_MULTIPLIER`), plus one coin per `STREAK_BONUS_EVERY` on the streak this completion
  reaches, capped at `STREAK_BONUS_CAP`. Subtasks earn nothing, or splitting a task would be the way
  to earn more.
- **Only a person moves it.** `neutral` completions (the overshoot and interval sweeps), the quota
  rollover (which bypasses `completeTask`) and the expiry sweep earn and cost nothing. Losses come
  from `markMissed` and `logSlip` only. The app never claims a miss on the user's behalf, so it
  doesn't charge for one: a task left undone costs nothing until you say you missed it. **Don't add a
  charge to a sweep**; that is Habitica's daily damage, and it is exactly the claim
  `sweepExpiredTasks` refuses to make.
- **Undo takes back exactly what the action wrote.** Unticking removes the completion's or miss's
  entry, undoing a slip removes that slip's entry, and an undone claim removes the spend. Unlike the
  penalty block (where `undoSlip` deliberately refunds nothing), none of this can be gamed, because
  each refund is the row the action itself wrote.
- **The balance can go below zero.** Losses are taken in full, and unticking a task whose coins
  were already spent still takes them back. Refusing the undo would overrule a correction, and
  flooring the balance would make a miss free once you were broke.
- **Coins never touch the app shield.** See `penaltyCreditFor`: anything that hands out unblocked
  minutes is a rewards feature wearing the penalty's clothes. A reward is a note to yourself, and
  claiming one unlocks nothing in the app.
- **Off means nothing is written.** Every `record*` action and `claimReward` is a no-op while
  `rewardsEnabled` is off. The `takeBack*` actions are not gated, so an entry written while it was on
  still goes when its completion is undone after it was switched off.

## Difficulty

`Task.difficulty` (Easy / Normal / Hard) says how hard a task is to make yourself do, which the time
estimate can't: a two-minute call you dread and an hour of something you enjoy. Hard doubles the
effort bucket's value and Easy halves it, never below 1. Every place it can be set (the task, template
item and follow-up task editors, quick add's chip, the bulk bar, Backfill) offers it only while
rewards are on, since nothing else reads it.

- **Null is "never rated" and earns as Normal does**, so every task that predates the column earns
  exactly what it did. It is kept apart from an explicit Normal because Backfill asks about the
  unrated ones, and a rating someone gave is an answer. Every picker but Backfill's leads with "Not
  set", since a segmented control can't be tapped off.
- **There is no new-task default and no title rule for it.** A default would rate every task without
  anyone deciding, which is the null the backfill queue exists to ask about.
- **It carries to the next occurrence** (a `CONTENT_FIELD`), unlike a bounty. A bounty is for the one
  task you've been putting off; a rating is for the kind of task that is always hard.
- **Nothing sets it but the person.** Inferring it from `postponeCount` would pay more for a task that
  waited, which is the rule bounties exist to keep.
- **A miss costs the effort bucket's value or what doing it would earn, whichever is less**
  (`coinsForLoss`). A hard task costing double to miss would raise the stake on trying the tasks the
  rating is meant to get done.
- **Rating everything Hard is not much of a cheat.** Reward prices are suggested from the earning rate,
  which scales with it; what the rating changes is how tasks pay relative to each other.

## Bounties

Extra coins posted on a task you've been putting off (`Task.bountyPushes`, rules under "Bounties" in
`src/utils/rewards.ts`). Posted from the Bounty switch in the task editor, listed and withdrawn on the
Rewards screen.

- **A task is never worth more for having waited.** That is the whole design constraint. A bonus
  that grew with `postponeCount` or drift age would pay you to push once more, so a bounty is worth
  the most when it's posted and loses a step on every push (`bountyCoinsFor`), gone after
  `BOUNTY_PUSHES_TO_EXPIRE`. Don't add anything that pays more for an older or more-pushed task.
- **Pushes count from the post**, as their own column rather than a read of `postponeCount`, so a task
  already pushed a dozen times can be posted on at full value. A pull back to today doesn't restore a
  lost step, or push-then-pull would be free.
- **Withdrawing spends it** (`BOUNTY_WITHDRAWN`), so withdraw-and-repost can't restart the decay.
- **It belongs to the occurrence**, like `postponeCount`: every successor and skip writes it null.
- **Few at once** (`bountyLimit`, 1 by default, up to 5). Bounties on everything would just be a
  higher base rate. An expired bounty frees its slot.
- **A miss costs the base value only.** The bounty rides on the completion's own entry, so the undo
  takes it back with no extra bookkeeping.

## Pricing a reward

A typed number is a guess, and a wrong guess is how this kind of system goes stale: too cheap and a
reward stops meaning anything, too dear and it's never reached. So the add/edit form prices a reward
in **time**: pick how often you want it (`REWARD_FREQUENCIES`) and the cost is `earnRatePerDay` times
that, rounded by `suggestRewardCost`. Each reward then shows `describeRewardPace` ("about every 6
days at your current pace").

- **The rate comes from completed tasks, not the ledger**, run through the same coin rules, so it
  works the day rewards are switched on. It divides by the history actually there, so a short
  retention window or a new install isn't read as a slow month, and refuses to answer under
  `MIN_EARN_HISTORY_DAYS`.
- **A suggestion fills the field; a price never changes on its own.** A cost that moved after you'd
  saved toward it would be the goalposts moving. The pace line is what moves, so drift is visible and
  repricing is your call.
- **No AI.** What a reward is "worth" is your earning rate and how often you want it; the first is
  computable and only you know the second.

- **Ideas are offered, never inserted.** `REWARD_IDEAS` is a starter list shown while you have no
  rewards and behind an Ideas button after. Rewards the app wrote unasked would be clutter for anyone
  with their own, and two devices each seeding one list would sync into duplicates. An idea carries a
  frequency, not a price, so it's priced by the same rule; until there's a week of history that rule
  uses `DEFAULT_EARN_RATE_PER_DAY`, which prices ideas only and never describes a pace.

## A reward's details

- **Link and note** are plain optional fields. The link takes the same values as `Task.linkUrl` (a
  `KNOWN_LINK_APPS` scheme or a URL) and opens the way a task row's does, with no `canOpenURL`.
  Opening is its own tap: you might claim now and order later.
- **One-time is read off the ledger.** A one-time reward with a spend naming it is claimed
  (`rewardIsOpen`), so undoing the claim brings it back with nothing else to reset. `claimReward`
  refuses a second claim for a device that hadn't synced the first.
- **"Saving for" is one setting** (`rewardGoalId`), not a flag per reward, because saving for
  something means choosing it over the rest. A goal pointing at a claimed or deleted reward is ignored.
- **A wish list item can be a reward** (`Reward.taskId`), from the one list chosen on the screen
  (`rewardListProjectId`). The item stays the source: `rewardDisplay` shows its title, notes and
  link, so editing it edits the reward. Claiming checks the item off with `{ neutral: true }`, or
  checking off the thing you just spent coins on would also earn coins; the undo takes both back.
  Checking it off by hand (you bought it without coins) retires the reward. Always one-time.

## Where it shows

- **The coin is the feature's icon, not the trophy.** `CoinIcon` (`src/components/CoinIcon.tsx`) is
  drawn, like `PinIcon` and `TargetIcon`, because Ionicons has no coin. Filled gold (`colors.warning`
  with `onWarning` marks) where a coin is the point (the balance, an empty state, a reward's cost, a
  history row), outlined where it sits beside Ionicons (the menu row, the toast, a bounty's chip). A
  screen named by an icon string uses `COIN_ICON` (`src/constants/coinIcon.ts`, a separate file so
  `navHubs.ts` can name it without importing a component) and draws it through `NamedIcon`.

- **Celebrations are two moments, both on the Rewards screen.** A burst of coins (`CoinBurst`, path in
  `src/utils/coinBurst.ts`) on claiming a reward, and a larger one with a success haptic when a rise
  in the balance crosses the goal's price. Only the crossing counts, so opening the screen above the
  price or choosing a goal you can already afford fires nothing. Nothing celebrates a completion
  elsewhere (that is `CoinToast`'s quiet pill), and Reduce Motion skips the burst and the hop.
- **The Rewards screen** (menu row under Tasks): the balance with the goal's progress, the rule
  spelled out, the rewards (add, edit in place, claim, open the link, set as goal, delete), the
  chosen list's items, starter ideas and the history.
- **`CoinToast`**, mounted at the navigator root beside `UndoBar`: a "+3 coins" pill after a
  completion, red for a loss. It is driven by `lastChange`, which the store sets only for an entry
  dated within the last minute, so a backdated one (the morning check-in, a widget tap drained
  later, the demo seed) never announces itself on whatever screen comes next.
- **The MCP replica** earns through the same store and rules when it completes a task
  (`mcp/src/replica.ts`), keyed by the completed row like everything else.
