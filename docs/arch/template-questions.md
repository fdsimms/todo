# Template questions

What a template run asks before it creates anything, and what the answers
decide.

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. The rules here are settled decisions with the reasoning attached: don't
re-derive them from the code, and don't re-open one without a reason the note
doesn't already cover.

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
