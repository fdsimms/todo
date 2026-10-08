# Template questions

What a template run asks before it creates anything, and what the answers
decide.

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. The rules here are strong defaults with the reasoning
attached: read the reason before deviating from one. Where this note and the
code disagree, the code is what ships, so fix the note.

---

## Template questions — what a run is asked, and what the answers decide

A template collected two anchor dates, a run name and a value for every `{blank}` its items
happened to mention. What it couldn't do is *ask*, so a packing list's counts had to be typed into
every title and "it's a work trip" could only be said by ticking the laptop by hand every time
(#553, #1749). `TaskTemplate.questions` is the declaration those needed;
`src/utils/templateQuestions.ts` is everything they mean, pure and store-free like `templateUtils`
beside it.

- **A question is a *declared* blank, not a second mechanism beside them.** It fills the `{name}`
  of its own name exactly as an inferred one does — what the declaration buys is a type, a prompt,
  and a fixed set of answers to condition on. An undeclared `{blank}` still works and is still
  asked for under its own heading; a declared one is asked once, up in Questions.
- **A number's answer can come off the anchor dates**, which is the whole of "if I say a trip is 7
  days". `fromDates` is `days` or `nights` rather than one "length" because the 3rd to the 10th is
  both — 7 nights, 8 days — and which one you mean depends on whether you're counting hotel nights
  or shirts. A typed answer always wins; an emptied field hands it back to the dates.
- **Titles can do one sum on a blank** — `{nights}`, `{nights - 2}`, `{nights / 2}` — and
  deliberately no more. One operator and a literal number, no parentheses and no blank on the
  right: what a title needs is a multiple of the one number the run is about, and everything past
  that is a formula editor nobody asked for. A fraction **rounds up** and a result never goes below
  zero (these are counts of things to take with you). A token that doesn't fit the shape falls back
  to being a name, exactly as before it existed — and `normalizePlaceholderName` now refuses to
  mint a blank that *would* fit it, so `{nights-2}` can only ever mean one thing.
- **A sum can be capped, and a token can switch on a choice answer.** `{days + 1 max 7}` limits a
  count (a long trip doesn't pack more than a week of shirts); `{laundry access = Yes ? days / 2 :
  days + 1}` picks one of two counts by a choice question's answer, so one item serves both without a
  second copy. Both stay inside the rule above rather than loosening it:
  - `max N` is a whole number applied **after** rounding up, and works with or without an operator
    (`{days max 7}`).
  - A switch has exactly one comparison, `=`, against one option (case-insensitive), and each branch
    is a plain blank, a sum, either with a cap, or a literal number. No nesting, no `!=`, no `and`:
    a third answer is a second token, not a longer one.
  - **The existing rules carry over unchanged.** A blank answer drops the token (an empty condition
    blank, or an empty blank in the chosen branch), a fraction rounds up, a result never goes below
    zero, and a malformed token stays literal text. A switch is not a condition: it changes a *number
    in a title*, while the Only when conditions below still decide what is ticked, and only a choice
    question can be the left side.
  - A token reports every blank it reads (the condition and both branches), so each is asked once.
    `normalizePlaceholderName` refuses a name that would parse as `x max N`, for the same reason it
    refuses `x-2`.
  - It does not make the answer a choice for you: the left side is just a blank, so it only does
    anything when that blank is a choice question's name.
  - The syntax is described to MCP clients in `BLANK_SYNTAX` (`mcp/src/server.ts`), appended to the
    `create_template` and `update_template` descriptions.
- **An item can say something different for an answer, and only its words.** `TemplateItem.variants`
  holds `{questionId, answer, title?, notes?}`: when the run's answer to that choice question is
  `answer`, the variant's title and/or notes replace the item's own (`applyItemVariant`), so a
  packing item needs one row for "laundry access" and not two.
  - **Text only, on purpose.** Dates, category, subtasks, the chain and everything else stay the
    item's. A variant that changed those would be a second item under one name, and two items is
    what `conditions` already does.
  - **Replaces, never merges, and a blank field keeps the item's own.** The first variant matching
    wins. Because of that, clearing both fields deletes the variant (`setVariantText`), which is how
    an answer goes back to the base text.
  - **Not a condition.** `conditions` decide what is ticked; a variant changes what the task says.
    An item can have both, and the apply sheet's checklist previews the variant's title.
  - **Resolved at apply time from answers keyed by question id**, passed as `answers` in the run's
    options (the apply sheet, a scheduled run and the MCP `apply_template` all pass it). A variant
    for a deleted question never matches, and `deleteQuestion` removes it anyway. Blanks used only
    in a variant are still asked for (`extractPlaceholders` reads it), and the blank syntax above
    works inside it.
  - Over MCP a variant names its question by `name`, like a condition (`variants: [{question,
    answer, title?, notes?}]`), and `update_template` treats it as part of the item's plan.
- **A condition decides an item's default tick, not whether it's offered.** Everything the template
  holds stays on screen and stays overridable — the request was "includes my laptop *by default*",
  and a hard filter is how a wrong answer hides items you then can't get back without editing the
  template.
- **Conditions replace `optional` on the item that carries them**, rather than stacking with it.
  Both fields answer "is this ticked to begin with", and an item that's off for one answer and on
  for another is exactly what `optional` was being used to approximate — so the authored condition
  is the more specific answer and wins. An optional *nested-template block* still suppresses what's
  under it: its items answer to their own template's questions, not the parent's.
- **A choice defaults to its first option**, deliberately rather than to unanswered — the same call
  `RecipeComponent.choiceGroup` makes, so ordering the options *is* saying which is usual. An
  unanswered third state would be one every condition then had to have an opinion about.
- **A choice can take several answers** (`TemplateQuestion.multiple`, an author's switch, off by
  default so a Yes/No can't be given two). The run's answer is then a JSON array of the picked
  options, the way a `'people'` answer is a set of ids, so the model stays one string per question.
  `answerValues` reads either form without needing the question, which is what lets `applyItemVariant`
  (answers by id only) match.
  - **Any picked answer matches.** A condition lists values and matches when one is picked, and a
    variant applies when its answer is among the picks (first variant wins, as before). Several
    questions still AND.
  - **It starts on the first option and the last pick can't be turned off.** An empty answer reads as
    untouched and falls back to the first option (`resolveAnswers`), so letting the last one go would
    look like a dead tap or quietly select something else. Same default rule as a single choice.
  - **A title shows the picks joined with ", "** (`placeholderValuesFor`), never the stored JSON.
  - **A `{x = Camping ? a : b}` switch matches any pick.** A multi-answer choice reaches the
    placeholder engine in its stored form, and `readBlank` (`templateUtils`) decides how to read it: a
    title gets the picks joined, a switch gets them as a set. A hand-typed blank that happens to be a
    JSON array of strings reads the same way, the price of not threading a second map through every
    substitution.
  - Over MCP the answer is the picks joined with commas (`apply_template`), and `multiple` rides
    `create_template`/`update_template` like any question field.
- **A Yes/No pair is always shown Yes, then No** (`displayOptions`). The first option is the default,
  so an author who wanted "International trip?" to start on No typed No first, which flipped that one
  pair against every other. Only the display is reordered; the default is untouched.
- **A question can show the destination's forecast under it** (`showForecast`, an author's switch).
  It is the sentence `tripForecast.ts` already writes for the project page ("Paris, 48 to 66°F, rain
  on 2 of 7 days"), fetched through `useDestinationForecast` for the run's place and dates, and
  **it only states.** It never fills in the answer, ticks an item or becomes a condition, for the
  reason `away-dates.md` gives: nobody should stake a coat on a ten-day forecast, and a reader
  drawing their own conclusion from a range is both more useful and more honest.
  - **Where and when.** The place is the project the run lands in (`Project.destination`), else a
    `{destination}` blank the run answers (debounced, so typing doesn't geocode every key). The dates
    are the two anchors picked above, else that project's away span. Neither: nothing is drawn.
  - **No extra switch.** It rides `destinationForecastEnabled`, which the fetch already checks along
    with demo mode, so nothing here adds a way to make that call.
- **Answering re-decides the conditioned items and only those** (`reselectForAnswers`). Ticking one
  extra thing on by hand is safe whatever gets answered afterwards; a conditioned item is re-decided
  because that's what answering the question it rides on *means*.
- **A nested template contributes its own questions** to the run that reaches it, rather than being
  answered on its author's behalf. Ids are globally unique so conditions resolve across the tree;
  two questions claiming one blank name is a mistake with no good answer, and the outer one wins.
- **Deleting a question takes it off the items conditioned on it.** Every reader shrugs a dangling
  condition off anyway (`liveConditions`, the house rule for cross-row pointers), but an item still
  carrying one would render an "Only when" with nothing under it.
- **Only a choice can gate an item** — a number, free-text or people answer has no fixed set to
  tick, so the item editor's Only when field lists choice questions alone, and hides itself entirely
  when the template has none.
- **A `'people'` question is the one kind that fills no blank and offers no authored set.**
  `normalizeTemplateQuestion` forces its `name` to `''` (nothing for `placeholderValuesFor` to key
  on) the same way it forces `defaultValue` to `''` (nothing to default to but nobody). It still
  flows through `resolveAnswers`/`defaultAnswer` like every other kind — it just answers with a set
  of ids rather than a string a title could use, and gates nothing (see above). What that answer
  means and where it goes is `docs/arch/people.md`, "Templates that ask who" — this file stays about
  the question mechanism, that one's about the person it names.
