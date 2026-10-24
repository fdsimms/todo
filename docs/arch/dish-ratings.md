# Dish ratings

A restaurant dish and whether you would order it again. Its own record (`DishRating`,
`dish_ratings`), a screen under Groceries & meals (`DishesScreen`), a sheet (`DishSheet`), a
question after a meal you described (`DishRatingOffer`), and `list_dishes`/`add_dish`/
`update_dish`/`delete_dish` over MCP.

The rules live in `src/utils/dishRating.ts` with no store or database in them; the store
(`useDishRatingStore`) keeps only the `set()`.

## Decisions, and why

- **Its own record, not a field on `FoodLogEntry`.** An eaten-out meal has no identity in the food
  log beyond its label, entries are snapshots that can be deleted, and the food log can be switched
  off. A rating is about the dish, and outlives the entry that prompted it. A dish is the pair
  (place, name) after `dishTextKey` (`groceryNameKey`, plus the letters of other scripts it would
  drop), so a retyped dish is the same dish; a dish with no place never borrows one from another row
  of the same name. An edit that makes a dish the same as another folds the two into one row
  (`mergeDishes`), as `addDish` does for a retyped one.
- **Three answers and null, no stars.** `loved`, `fine`, `avoid` (`DishVerdict`), the shape
  `ProductRating` has and for its reason: nobody reproduces a 4 versus a 3, and "fine" exists so a
  shrug is not the same as never having tried it. **Null is no opinion, and nothing infers one**,
  not a recall, not the food log, not an agent reading how a meal was described. The reason lives
  in the note, never a second field.
- **The place is text.** As typed, never looked up and never a coordinate. The sheet offers the
  places already saved as one-tap suggestions so one restaurant isn't typed three ways. Apple Maps
  suggestions (`placeSearch.ts`) are deliberately not wired in: they would need their own switch
  (`placeSuggestionsEnabled`) and put a request behind a field that has worked offline until now.
- **Plain data for sync.** In neither the health nor the journal gate (`syncTracking.ts`): a rating
  is a verdict about a dish, not a record of eating, and it should reach the MCP server whatever
  the health-logs switch says. It is in `BACKUP_TABLES`.
- **No natural-key fold.** Two devices that add the same dish before they sync end up with two rows,
  which a person can see and delete. A fold's mistake is a deletion nobody sees, the reason
  `recipes` was taken out of `NATURAL_KEYS`.
- **The offer asks, never answers.** `isEatenOutDraft` reads a meal as eaten out when it was
  described and estimated with nothing in the app behind it. It only decides whether to *ask*.
  A dish that already has an answer is never asked about again (`dishOfferFor`), the offer is
  session-only, and ignoring it writes nothing.
- **Recall shows the answer you gave.** A recalled food in the Describe sheet's "You've had this
  before" says "Loved it" when `dishForLabel` finds a rated dish of that name. A dish with no answer
  adds nothing to the row.

## One photo per dish

`DishRating.photo` is a file name in the `dish-photos` folder (`dishPhotos.ts`), minted with a
`dish-` prefix. It travels exactly as a task file does: the name rides the row, the file rides the
image sync (`dishPhotoSync.ts`), and the prefix is how a name a peer sends finds its folder
(`routeStoredFileName` in `taskFileSync.ts`, three ways now). It is in backups
(`storedFileBackup.ts`, a `plain` column holding one name rather than a JSON list).

**A photo is never deleted with its dish or when it is replaced**, for the undo's sake, so the only
delete is the launch sweep (`sweepDishPhotos`), which takes a file once no dish names it. The sweep
checks the store has loaded, because an unloaded store reads as no dishes and would take every photo.
The MCP server holds no image files, so a row there only says `hasPhoto`.

## What isn't built

- Bulk selection and swipe actions on the list. A row opens the sheet, which has Delete.
- A count or share of dishes (loved, eaten out) on Stats. If one is added it prints its coverage
  and passes no verdict, as the other counts do (`health-data.md`).
- A "dinner at X" calendar event offering a rating, and a suggestion drawn from loved dishes.
