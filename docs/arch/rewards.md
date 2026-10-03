# Coins and rewards

A light, Habitica-style economy over the tasks you already have. Completing a task earns coins,
marking one missed or logging a slip costs coins, and coins buy rewards you define yourself. Off by
default (`rewardsEnabled`), switched on from the Rewards screen (History hub). The rules live in
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
  chain pays for the live step), plus one coin per `STREAK_BONUS_EVERY` on the streak this completion
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

## Where it shows

- **The Rewards screen** (History hub): the balance, the rule spelled out, the rewards (add, edit in
  place, claim, delete) and the history.
- **`CoinToast`**, mounted at the navigator root beside `UndoBar`: a "+3 coins" pill after a
  completion, red for a loss. It is driven by `lastChange`, which the store sets only for an entry
  dated within the last minute, so a backdated one (the morning check-in, a widget tap drained
  later, the demo seed) never announces itself on whatever screen comes next.
- **The MCP replica** earns through the same store and rules when it completes a task
  (`mcp/src/replica.ts`), keyed by the completed row like everything else.
