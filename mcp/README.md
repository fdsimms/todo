# todo-mcp

An MCP server over a replica of the app's database. **Phase 2: the replica syncs, and it writes.
Nothing is deployed behind real auth.** The design, the phases and the
reasoning are in [`docs/arch/mcp-server.md`](../docs/arch/mcp-server.md); read that first, this
file is only how to run it.

## Running it

To run it in the cloud instead of on a laptop, see [`DEPLOY.md`](DEPLOY.md) (Fly.io).

```bash
cd mcp
npm install
TODO_DB_PATH=./todo.db \
  MCP_AUTH_TOKEN=$(openssl rand -hex 32) \
  SYNC_STORE_PATH=./payloads.db \
  SYNC_AUTH_TOKEN=$(openssl rand -hex 32) \
  SYNC_URL=http://localhost:8787 \
  SYNC_TOKEN=<the same SYNC_AUTH_TOKEN> \
  npm start
```

It listens on `:8787` (`PORT` to change it) and serves two things: Streamable HTTP at `POST /mcp`
for Claude, and the payload store at `/sync/push` and `/sync/pull` for your devices. One process,
two tokens, because they answer to different callers and must not share a secret.

| Variable | What it is |
|---|---|
| `TODO_DB_PATH` | The replica. Created empty if absent, then filled by the first sync. |
| `MCP_AUTH_TOKEN` | Claude's bearer token, read-only. Unset means every MCP request is refused. |
| `MCP_WRITE_TOKEN` | A second token that also permits writing. Unset means the server is read-only, and a read-scoped caller never even sees the write tools. |
| `SYNC_STORE_PATH` | Where payloads are kept. Unset means the store is not mounted at all. |
| `SYNC_AUTH_TOKEN` | Your devices' bearer token, for `/sync/*`. |
| `SYNC_URL`, `SYNC_TOKEN` | Where the *replica itself* syncs to. Usually this same server. |

Then in the app: Settings → Data & reset → Sync, put the server's address in **Sync server** and
the `SYNC_AUTH_TOKEN` in **Sync server token**. Both are needed; either alone does nothing. iCloud
sync is unaffected and keeps running alongside.

That also removes the old chore of copying a `todo.db` off a device by hand. Point the server at a
path that does not exist yet and the first sync fills it.

It runs straight off the TypeScript through `tsx`; there is no build step, because there is nothing
to deploy to yet.

**`MCP_AUTH_TOKEN` is not optional.** With it unset the server starts and refuses every request,
which is deliberate: the alternative default is a server that serves an entire task history to
anyone who asks. The shared secrets are for Claude Code and curl; the Claude chat signs in with
OAuth instead, which is on when `MCP_OAUTH_PASSWORD` (16+ characters) and `PUBLIC_URL` are set
(`OAUTH_STORE_PATH` keeps its connections across restarts). See `src/oauth.ts` and DEPLOY.md.

## Tools

Read-only except those marked **Write**, which need `MCP_WRITE_TOKEN`.

The server sends the model a short primer on connect (MCP `instructions`, in `src/instructions.ts`)
and annotates every tool as read-only or not (`src/toolAnnotations.ts`), so the Claude apps can run
reads without asking. A new tool needs a line in that table; `toolAnnotations.test.ts` fails
without one.

Seven prompts (`src/prompts.ts`) appear as slash commands in the Claude apps: `weekly_review`,
`inbox_zero`, `plan_my_day`, `plan_my_week`, `clean_up_project`, `unstick_tasks` and `how_do_i`.

Every write previews first. `preview_change` (read-only, so it needs no approval) takes a write
tool's name and arguments, changes nothing and returns `willDo` and a `confirmToken`. The write
happens only when the tool is called with `apply: true`, that token for the identical request, and
`willDo` repeated exactly, so the approval prompt shows what will happen (`src/confirmWrites.ts`).
Calling a write tool without `apply` previews too, but asks for approval like a write.

Every write shows in the app's Activity screen under "Claude", and a task write can be undone
there while the task is still how Claude left it (`src/agentLedger.ts`).

It answers in the phone's time zone, which the app syncs as a setting. `TZ` in the environment is
only the fallback until the first sync.

| Tool | What it answers |
|---|---|
| `get_overview` | Where an agent starts: the person's time zone and logical today, counts per list, categories, tags, projects, what is switched off, and whether health logs arrive. |
| `get_agenda` | The coming days: each day's tasks, repeats expected that day, estimated minutes, what is carried over, and deadlines that will not fit. |
| `completion_history` | What got done over a range, with a summary by day, weekday, hour, category, project and tag. Missed occurrences are counted separately. |
| `review_tasks` | Overdue tasks, stale Inbox and Unscheduled items, likely duplicates, quiet projects, tasks pushed to a later day three or more times and the most-missed repeats. Lists, does not judge. |
| `app_help` | The matching Settings rows (with the path to each) and release notes, for explaining a feature in the app's own words. |
| `unused_features` | Features the person's own data suggests they would benefit from and are not using (many tasks and no estimates, saved recipes and no planned meals, people and no birthdays), with what was seen, what the feature does and the Settings path. Declined ones are silenced by an agent note naming the id. |
| `habit_patterns` | Each habit's streak, pace, how often done or missed, and when it actually gets done; how timed work compares with estimates. |
| `mood_insights` | The Mood screen's findings, held to its minimum-days rules, with those rules stated. |
| `focus_history` | Finished focus sessions over a range, as the Stats screen reads them: minutes worked and rested, how stretches ran against their plan (once there are enough), breaks taken, and each session's steps. History only: a session in progress stays on the phone. |
| `list_milestones` | The days something changed that the person marked on the mood log, each with its date. Empty unless health logs reach the server. |
| `list_journal_entries` | Journal entries and dreams over a range of days, optionally one kind. Empty unless health logs reach the server. |
| `log_journal_entry` / `update_journal_entry` / `delete_journal_entry` | **Write.** A journal entry or a dream, in the person's words. An entry's day is fixed once written. |
| `add_milestone` / `update_milestone` / `delete_milestone` | **Write.** A milestone by label and day; the day is anchored at noon as the app's sheet does. |
| `list_saved_views` | The person's saved views, each with its clauses in words and how many open tasks it holds right now. |
| `get_saved_view` | One view by id or name, with the tasks it holds (up to 100). |
| `create_saved_view` / `update_saved_view` / `delete_saved_view` | **Write.** A view by name, icon and clauses, checked by the app's own parser; a clause it would drop is refused instead. An update can also move it in the list. |
| `set_vacation_mode` | **Write.** Turn vacation mode on or off as the Settings switch does, optionally with the day it turns itself off. On hides every task marked for vacation pause and every hide-on-vacation category; off brings them back and forgives their streaks. |
| `plan_day` | A proposed timeline for today around busy blocks you pass in, and what does not fit. Writes nothing. |
| `rebalance_week` | Proposed moves that bring heavy days under the busy line. Writes nothing. |
| `save_recipe` | **Write.** A recipe from a page, a photo or a conversation, ingredients as printed lines. |
| `list_cookbooks` / `get_cookbook_index` | The cookbooks, and the dishes one's index lists. |
| `rename_cookbook` / `merge_cookbooks` / `delete_cookbook` | **Write.** Renames a cookbook on every recipe in it, joins two copies of one book, or deletes one (its recipes stay). |
| `save_index_entry` / `delete_index_entry` / `recipe_from_index_entry` | **Write.** Adds, changes or removes a dish in a cookbook's index, or makes the saved recipe for one. |
| `reorder_up_next` / `log_cook_time` | **Write.** Orders the Up next shelf; records how long cooking a recipe took. |
| `log_food` | **Write.** Something eaten, with estimated nutrition. Previews unless `apply: true`; marked estimated; written to Apple Health by the phone on its next foreground, not by the server. Refuses water, which is `log_water`'s. |
| `log_water` | **Write.** A glass of water, in ml or fl oz, added onto the day's single water entry the way the app's stepper does. Reports the day's total in the person's own unit. Written to Apple Health by the phone on its next foreground, not by the server. |
| `log_mood` / `log_medication` | **Write.** A mood check-in, or a dose taken, in the spellings already in the log. |
| `archive_medication` / `rename_mood_tag` | **Write.** Archive or restore a medicine in the medicines list; rename a mood context tag on every check-in that has it. |
| `list_automations` | Every automation, whether it is on and what it needs on the phone, and every rule written for them. |
| `get_settings` / `update_settings` | Read and **Write.** The person's preferences that sync (the day, task defaults, feature areas, rewards, kitchen, automation parameters), each with what it does. Device-local settings are changed on the device. |
| `set_automation` / `save_rule` / `delete_rule` | **Write.** Turn an automation on or off and choose the category its tasks file under; add, change or delete a weather, calendar event, Health, Screen Time or title rule. |
| `delete_category` | **Write.** Delete a task category. Its tasks and stacks move to `moveTo` (or `uncategorize: true`), and every automation that filed under it is re-pointed. Previews unless `apply: true`; not undoable from here. |
| `remember` / `forget` | **Write.** Add or remove a note the person wants every conversation to start with. They are in the app under Settings › Data & reset › Sync. |
| `batch_update_tasks` | **Write.** Edit, complete or reschedule up to 100 tasks. Previews unless `apply: true`; one refused change refuses the batch. |
| `quick_add` | **Write.** Lines of text through the app's quick-add grammar. Previews unless `apply: true`. |
| `list_tasks` | Tasks in one of the app's lenses: `today`, `later`, `unscheduled`, `inbox`, `all`, or `archived`. Filters by category, tag, project. Archived tasks are left out of every other view, as in the app. |
| `search_tasks` | The app's own fuzzy ranking over titles, notes and project names. |
| `get_task` | One task, with its subtasks, chain steps, repeat rule, target, window, blockers, follow-up, project, and why it is not on Today (`hiddenUntil`, or `hiddenReason` for a task held while vacation mode is on). Also, where the task has them: who it waits on, contact details, streak, what completing it also logs (medication, Health, a meal), timer and Health target, postponement history, supply (with the catalog row it reorders) and rotation, the rule behind a recomputed deadline or reminder, whether a water target follows the food log's goal, and the people it is about. |
| `list_projects` | Active projects and how far through each one is, counting a recurring member once rather than once per completion, with each trip's away dates and destination. |
| `get_project` | One project: its open tasks in order (each with its checklist and blockers), the most recently finished, its decisions, and its away dates, destination and whether it pauses tasks while away. |
| `next_in_project` | The next unchecked checklist item in one project step (the first open step not waiting on anything, unless one is named), with how many items are checked. |
| `list_recipes` / `get_recipe` | Recipes by name, tag or ingredient; one recipe's ingredients, steps and source. |
| `list_meal_plan` | Planned meals over a range of days, the coming week by default. |
| `list_people` / `get_person` | People in the user's own order; one person's details, gift ideas, food notes and shared history, each with its id. |
| `upcoming_birthdays` | Birthdays in the next N days, soonest first. |
| `list_grocery_items` | The home grocery list, or the whole catalog with `onListOnly: false`. A separate list (a trip's, say) is not included. |
| `grocery_setup` | The aisles (and which are non-food), the stores (with receipt style, their own aisles and order), the lists (home and separate) with item counts, and the trip in progress. |
| `get_grocery_item` | One item's whole catalog record: aisle, quantity, note, last price, brands, stores, substitutes, lists, receipt names. |
| `match_receipt` | The app's receipt matching over lines Claude read. Writes nothing. |
| `list_pantry` | What the app has a reason to think is in the kitchen: pantry, fridge and freezer, each with the app's reason, use-by day and freshness. `filter: use_up`, `frozen` or `fridge` narrows it. Has no quantities, on purpose. |
| `get_pantry_item` | One item's whole pantry state (on hand and why, use-by, opened, frozen, running low, staple, shelf life, waste history, boxes). `unknown` means the app has no opinion, not that it is out. |
| `pantry_review` | The app's review deck: items whose "probably have it" has lapsed or gone stale. |
| `use_up_recipes` | What is at or past its use-by day, and the recipes that would use it. |
| `list_food_log` | Logged food over a day range, with summed nutrients and the person's daily targets. |
| `list_saved_meals` | Foods the person logs together under one name. |
| `move_food_entry` / `duplicate_food_entry` | **Write.** Moves an entry to another day (not once it is in Apple Health), or logs it again. |
| `save_meal_from_entries` / `log_saved_meal` / `delete_saved_meal` | **Write.** Saves entries as a meal, logs a saved meal in one go, or deletes one. |
| `set_nutrition_targets` | **Write.** The daily figures the food log reads totals against, only as the person gives them. |
| `list_mood_logs` | Mood check-ins: rating, symptoms, context tags, notes. |
| `list_medication_logs` | Doses recorded, scheduled and as-needed. |
| `list_templates` | Stored templates: name, item count, groups, and the questions a run asks. |
| `get_template` | One template in full, in the shape `create_template` and `update_template` take, with a `version` for `update_template`'s `expectedVersion`. |
| `template_library_check` | Every template checked at once: broken pointers, unused questions, items copied across templates, near-copies. Suggests edits; changes nothing. |
| `create_template` | **Write.** Builds a whole template in one call, and returns warnings for things it will do that were probably not meant. Needs `MCP_WRITE_TOKEN`. |
| `update_template` | **Write.** Edits a template: scalar fields by name, and `groups`, `questions` and `items` as whole lists (an item or group is kept by its id). Lists the changes, and refuses an edit made against an old `version`. Needs `MCP_WRITE_TOKEN`. |
| `apply_template` | **Write.** Runs a template: creates its tasks (and stack, project or parent task) from dates and answers, the way the apply sheet does. Reports what it left out and why, and any blanks left empty. |
| `delete_template` | **Write.** Deletes a template. Templates have no archive, so it cannot be undone from here. |
| `reorder_templates` | **Write.** Puts the listed templates first, in the order given. |
| `create_task` | **Write.** Adds one task, with the app's own defaults and title rules applied. Takes every repeat rule the app has, chains, daily or weekly targets, time windows, blockers, follow-ups and "don't do this" habits, the people it is about, a link, phone, email and location, vacation pause, a medication its completion records, and a deadline or reminder placed by rule. |
| `update_task` | **Write.** Edits a task by the app's own rules (`src/utils/taskUpdate.ts`), including the "this and later dates" fan-out on a dated series. A fixed deadline replaces a deadline rule and the result says so; a target on a task that follows the water goal is refused. |
| `create_project` | **Write.** A project and its whole plan in one transaction: steps, their checklists, and which steps wait on which. |
| `update_project` | **Write.** Rename, re-date, re-file, complete (optionally archiving what is left) or archive a project, pause it until a day, set its people, links, step order and nudge settings, set or clear its away dates and destination (what scheduled vacation mode and the away grocery list run on), or set the priority, difficulty and estimate its new tasks start with (`taskDefaults`). |
| `list_stacks` | Stacks and the open tasks in each, in order. A task's `stackId` says which one it is in. |
| `create_stack` | **Write.** A new stack, optionally with its first tasks. Its category is settled before anything is written, because it is imposed on every member. |
| `assign_to_stack` | **Write.** Files open tasks in a stack, or takes them out with a null `stackId`. Reports each category it changed. |
| `plan_meal` | **Write.** Puts a recipe, a leftover, or just a title, on the meal plan. |
| `set_meal_cooked` | **Write.** Marks a planned meal cooked (counting it, opening what it used and completing its task), or not. |
| `save_meal_as_recipe` / `copy_meals` | **Write.** Saves a typed meal as a recipe; copies a week, a slot of a week, or one meal onto other days. |
| `add_person_history` | **Write.** Records something done with someone, as the app's "Add to history" does: a completed task naming them. The only write to the people section. |
| `complete_task` | **Write.** Ticks one off, spawning whatever that spawns: the next occurrence, the next chain step, the next set of a dated series. |
| `update_food_entry` | **Write.** Corrects a food log entry (estimated ones can restate figures). |
| `delete_food_entry` | **Write.** Deletes a food log entry not yet written to Apple Health. |
| `update_mood_log` | **Write.** Corrects a mood check-in. |
| `delete_mood_log` | **Write.** Deletes a mood check-in. |
| `request_calendar_event` / `cancel_calendar_request` | **Write.** Asks the phone set to add them to put an event on the calendar the next time it syncs, or takes back one still waiting. The server never touches the calendar itself. |
| `change_calendar_event` | **Write.** Asks the phone to move, edit or delete an event an earlier `request_calendar_event` wrote. Events the person made are out of reach. |
| `list_calendar_requests` | Those requests and what became of each: pending, written, failed (with why) or cancelled. |
| `update_medication_log` | **Write.** Corrects a recorded dose. |
| `delete_medication_log` | **Write.** Deletes a recorded dose. |
| `delete_task` | **Write.** Deletes tasks with their checklists, or single checklist items (up to 100 a call). Refuses a task the app generated. Each can be restored from Activity. |
| `skip_occurrence` | **Write.** Moves a repeating task to its next date with nothing completed or missed, as the app's Skip does. |
| `reorder_tasks` | **Write.** Hand-orders a project's open steps, a task's checklist, or the Pinned block. |
| `set_task_dates` | **Write.** Puts one task on several dates (one row per date), changes the set, or takes it back to one; optionally monthly. |
| `duplicate_task` | **Write.** Copies a task and its checklist, with its progress started over. |
| `delete_tag` | **Write.** Takes a tag off every task and out of the tag list. |
| `set_completion_date` | **Write.** Corrects when a completed task was done, as the Logbook's date edit does. |
| `reopen_task` | **Write.** Reopens a completed or missed task and takes back what its completion did. Needs `MCP_WRITE_TOKEN`. |
| `update_meal` | **Write.** Moves a planned meal, swaps or renames it, sets a recipe's scale, answers its either/or choices, or sets its shopping, thaw and log answers. |
| `remove_meal` | **Write.** Takes a meal off the plan. |
| `create_person` | **Write.** Adds a person: name, nickname, notes, birthday, contact details (phone, fax, email, link), location (free text), group, archived, birthday task opt-outs. Never a cadence or nudge. |
| `delete_person` | **Write.** Deletes a person and the notes about them; tasks naming them stay. Restorable from Activity. |
| `reorder_people` / `save_person_group` | **Write.** The People screen's order, and its groups (add, rename, delete, catch up one at a time). |
| `add_person_note` / `update_person_note` / `delete_person_note` | **Write.** Gift ideas, food notes and other notes about someone, optionally about a day. |
| `update_person` | **Write.** Changes those same fields on a person. |
| `rename_stack` | **Write.** Renames a stack. Its category and members are untouched. |
| `update_stack` | **Write.** A stack's title, notes, tags, checklist, the project page it is a section of, or its category (which re-files its open tasks). |
| `delete_stack` | **Write.** Deletes a stack, taking its tasks out of it, or with `deleteTasks` deleting its open tasks too. Restorable from Activity. |
| `update_category` | **Write.** Renames a task category everywhere it is named, or sets its emoji, schedule, vacation and suggestion settings and default time of day. |
| `reorder_categories` | **Write.** Orders Today's category sections. |
| `delete_project` | **Write.** Deletes a project, leaving its tasks in no project, or with `deleteTasks` deleting them. Restorable from Activity. |
| `save_project_category` / `reorder_projects` | **Write.** The Projects screen's sections: add, rename or delete one; order the projects and the sections. |
| `start_fresh_project` | **Write.** A new copy of a project with every task open and every date cleared. |
| `save_project_as_template` | **Write.** A template that recreates a project, dated from its own date. |
| `get_rewards` | The coin balance, the reward being saved for, every reward with what it still needs, live bounties and the latest coin history. |
| `create_reward` | **Write.** Adds a reward at a cost in coins. Refused while rewards are off. |
| `update_reward` | **Write.** Changes a reward's title, cost, note, link or one-time flag. A wish-list reward is refused. |
| `delete_reward` | **Write.** Deletes a reward. Coins already spent on it stay spent. |
| `claim_reward` | **Write.** Spends a reward's cost. Returns a `claimId`. Refused when the balance is short or a one-time reward was already claimed. A wish-list reward also checks its item off, with no extra coins. |
| `unclaim_reward` | **Write.** Takes a claim back by its `claimId`, and reopens the wish-list item the claim checked off. |
| `set_reward_goal` | **Write.** Chooses the reward being saved for, or clears it. |
| `set_bounty` | **Write.** Posts extra coins on a task, or withdraws the live bounty. Same limits as the app. |
| `mark_done_by_other` | **Write.** Closes a task as done by somebody else: completes it and creates a repeat's next occurrence, with no coins and no streak change. Works on a one-off. `reopen_task` undoes it. |
| `mark_missed` | **Write.** Marks a repeating task's occurrence missed: breaks the streak, creates the next occurrence, costs coins. `reopen_task` undoes it. |
| `log_slip` / `undo_slip` | **Write.** Logs or takes back today's slip on a "don't do this" habit. A habit with a penalty is refused. |
| `update_recipe` | **Write.** Changes a recipe or moves it to another cookbook; ingredients, steps, components and prep tasks each replace the whole list. |
| `delete_recipe` | **Write.** Deletes a recipe. Not undoable from here. |
| `defer_task` | **Write.** Moves a task to a date, or clears its date. |
| `add_grocery_item` | **Write.** Puts something on the home list, re-using the shelf item the user already has where there is one. |
| `check_off_grocery_item` | **Write.** Checks something off on the home list, or un-checks it. |
| `remove_from_grocery_list` | **Write.** Takes something off the home list. Does not delete it. |
| `update_grocery_item` | **Write.** Rename, aisle, quantity, note, last price, kind-of, preferred brand, stores and substitutes. Field edits are undoable from Activity. |
| `save_grocery_box` | **Write.** Add, edit or delete a brand or variant of an item. |
| `save_store` | **Write.** Add or rename a store, or set its receipt style. |
| `update_store` | **Write.** A store's own aisles and walk order, whether it is suggested, or delete it. |
| `reorder_stores_and_lists` | **Write.** The order of the stores and of the separate lists. |
| `save_aisle` / `reorder_aisles` | **Write.** Add, rename, delete or mark non-food an aisle; the walk order. |
| `add_ingredients_to_list` | **Write.** A recipe's ingredients, or the planned meals' over a range, onto a list as the app's add-to-list sheets do. |
| `add_choice_to_list` / `settle_choice` | **Write.** An either/or on a list, and deciding it. |
| `swap_for_substitute` | **Write.** Swaps a row on a list for one of its substitutes. |
| `clear_grocery_list` | **Write.** Empties a list as the app's Clear list does, and ends a trip. |
| `set_shopping_trip` | **Write.** Starts a trip at a store with an optional budget, changes the budget, or ends it. |
| `mark_unavailable` | **Write.** A store doesn't carry an item, or its preferred brand; or does again. |
| `set_nutrition_panel` | **Write.** An item's or a brand's nutrition panel. |
| `merge_grocery_items` | **Write.** Merges one item into another, with everything recorded on it. Not undoable from Activity. |
| `delete_grocery_item` | **Write.** Deletes an item with everything attached. Restorable from Activity. |
| `create_grocery_list` / `rename_grocery_list` / `delete_grocery_list` | **Write.** Separate lists (a trip away). The grocery tools take a `list`. |
| `finish_grocery_trip` | **Write.** Records the checked-off items as bought and removes them from the list. |
| `import_receipt` | **Write.** The in-app receipt flow, from lines Claude read. |
| `update_pantry_item` | **Write.** One item's pantry state: on hand, out (with how it went), staple, frozen, opened, running low, use-by day, shelf life, use-up task. Several fields per call. |
| `update_pantry_box` | **Write.** The same for one packet or frozen portion of an item. |
| `add_to_pantry` | **Write.** "I have flour": marks a known item on hand, or adds a new one that is not on the shopping list. |
| `answer_pantry_review` | **Write.** Records the person's answers (have, low, out) to `pantry_review` cards. |
| `log_leftover` | **Write.** Logs a container of cooked food in the fridge or freezer. |
| `update_leftover` | **Write.** Renames, re-dates, weighs, freezes, thaws, finishes or reopens a container of cooked food, or sets how long it keeps. |
| `split_leftover` / `delete_leftover` | **Write.** Splits a container across the freezer line, or deletes one logged by mistake. |

`complete_task` refuses two things rather than doing them quietly, and both are
deliberate. A task that **cannot** be completed says so: a negative habit has no
completion (record a slip instead) and a recurring task shown early cannot be
completed ahead of its own day. And a task that **asks a question** on
completion is sent back for an answer rather than completing without one,
because a model in a conversation is the one caller that could have asked and
did not. Passing `deliverableValue: null` completes it without an answer, which
is what the app's own "Complete Without Answering" does. See
[`src/deliverableAsk.ts`](src/deliverableAsk.ts).

What `complete_task` does **not** do is the device half: no reminder is
cancelled or scheduled, no calendar event written, nothing sent to Apple Health.
A dose *is* recorded where the task names a medication, because that is the
app's own record rather than somebody else's. The rest belongs to whichever
device the completion syncs to.

The grocery writes lean on one property of this schema that is easy to get wrong from outside:
**there is one catalog and it is also the list.** A `GroceryItem` is the shelf item and lives for
ever; whether it is in a trolley right now is a separate membership row. So `add_grocery_item` on a
name the user has bought before writes no new shelf item at all, it re-lists the one already there,
with its aisle, purchase history, prices and pantry state intact. Singular and plural resolve to
the same item, so "serrano pepper" finds an existing "Serrano peppers" instead of minting a
near-duplicate that splits one shelf item in two.

For the same reason `remove_from_grocery_list` parks rather than deletes. `delete_grocery_item` exists
for the person who asks for it: it previews what goes with the item (brands, store links, substitutes,
receipt names), and the Activity entry carries a snapshot that puts all of it back while nothing has
re-created the item. The app itself keeps no such snapshot, which is the only reason it has no undo.

A receipt is read by Claude, not by this server (the phone reads one with on-device OCR or the user's own
API key). `match_receipt` takes the lines Claude extracted and runs the app's own matching, store's
remembered names first. `import_receipt` then does what the in-app scan flow does: on a shopping trip it
puts each line on the list, checks it off, remembers the printed text as that store's name for the item and
finishes the trip with the prices; for the pantry it marks the lines on hand without recording a purchase.
Finishing a separate list records almost nothing (no purchase counts, prices or use-by days), which is the
app's rule for a trip away.

The pantry tools are the same rows through the same rules: `src/utils/pantryWrite.ts` decides what each
change does to a row, and `useGroceryStore` and `useLeftoverStore` call it too. The one thing they
do not write is the "Use up X" task, which goes through the task store; the phone reconciles it from
the rows the next time it opens. Linking a leftover to the recipe it came from, logging cooked weight, a scanned or receipt
batch and Siri's mark-as-used-up stay in the app.

The three log tools are **empty until the phone sends the logs**: they reach the server only with
Settings → Sync → **Include health logs** turned on, which is off by default. See "The health logs
have their own switch" in the arch doc.

The three log tools take the same range: `days` counts back from today (7 by default), or pass
`from`/`to` as `YYYY-MM-DD`. There is deliberately **no weight tool** — weight lives in Apple
Health and the app stores no copy, so a replica over SQLite has nothing to read. See the arch doc.

`create_task` and `update_task` take their richer fields as small objects (`repeat`, `chain`,
`target`, `window`, `followUp`, `waitsOn`, `habit`) rather than the `Task` columns behind them,
and [`src/taskFields.ts`](src/taskFields.ts) translates them the way the app's editor does on save:
it refuses a combination the editor never offers (a month day on a weekly repeat, a one-step
chain, a follow-up on a task that doesn't repeat) and clears what the editor clears when a rule
changes type. `newTaskFromDraft` and `updateTask` trust whatever they are handed, so without this
a model could write a row the app can't render honestly.

Results about one thing carry `openInApp`, an `https://<server>/open/...` link that opens it in the
app (the server's MCP instructions ask the model to offer it after a change). On an iPhone the
domain is associated with the app, so iOS opens the app directly; anywhere else `/open/` serves a
page that hands off to the `dundundun://` scheme. See [`src/appLinks.ts`](src/appLinks.ts).

The people tools keep `docs/arch/people.md`'s rules: people come back in the user's own order,
never ranked, and the last time together is a date, never a count of days.

## Working on it

Tests run in the **repo's own jest**, from the repo root, with everything else:

```bash
cd .. && npm test          # includes mcp/src/__tests__
npx jest mcp/              # just this package
npx tsc --noEmit           # typechecks all of mcp/ except src/server.ts
```

That is not a convenience, it is the structure. Everything with a decision in it — the lenses, the
projection, the token check, the db layer standing up in Node — is kept clear of the MCP SDK so it
stays in that run. `src/server.ts` is the one file that cannot be, and it is correspondingly the
one file that should hold no logic. `npm run typecheck` in this directory covers it, against the
SDK in `mcp/node_modules`; run it after touching that file, because the root typecheck will not.

Two rules that are easy to break silently, both explained where they live:

- **Nothing under `mcp/src` may import an app module for its value** (types are free, and
  `src/types` is a carve-out). The shim has to reach Node's module cache before `database.ts` is
  evaluated, and a static import is hoisted above that. See `src/replica.ts`.
- **Never hand-write SQL against the replica.** `rowToTask` and its siblings are the reason to open
  the database this way at all. See `docs/arch/mcp-server.md`.
