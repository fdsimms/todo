import type { ItemPick } from './grocery';
import type { MealSlot } from './mealPlan';
import type { HealthRuleMetric } from './rules';

/**
 * The vitamins and minerals a supplement panel can state. Part of `NutrientKey`;
 * split out so the panel form can group them and the barcode parsers can say
 * (by not listing any) that none of them is read from a source.
 *
 * Each has an Apple Health dietary type, which is the list's other constraint:
 * a key with no write type would be a nutrient the food log records and the
 * Health record can never hold.
 */
export type MicronutrientKey =
  | 'vitaminAMcg' | 'vitaminCMg' | 'vitaminDMcg' | 'vitaminEMg' | 'vitaminKMcg'
  | 'thiaminMg' | 'riboflavinMg' | 'niacinMg' | 'vitaminB6Mg' | 'folateMcg'
  | 'vitaminB12Mcg' | 'biotinMcg' | 'pantothenicAcidMg'
  | 'magnesiumMg' | 'zincMg' | 'phosphorusMg' | 'seleniumMcg' | 'copperMg'
  | 'manganeseMg' | 'chromiumMcg' | 'molybdenumMcg' | 'iodineMcg' | 'chlorideMg';

/** The vitamins, in the order a supplement panel prints them. */
export const VITAMIN_KEYS: readonly MicronutrientKey[] = [
  'vitaminAMcg', 'vitaminCMg', 'vitaminDMcg', 'vitaminEMg', 'vitaminKMcg',
  'thiaminMg', 'riboflavinMg', 'niacinMg', 'vitaminB6Mg', 'folateMcg',
  'vitaminB12Mcg', 'biotinMcg', 'pantothenicAcidMg',
];

/** The minerals, in the order a supplement panel prints them. */
export const MINERAL_KEYS: readonly MicronutrientKey[] = [
  'magnesiumMg', 'zincMg', 'phosphorusMg', 'seleniumMcg', 'copperMg',
  'manganeseMg', 'chromiumMcg', 'molybdenumMcg', 'iodineMcg', 'chlorideMg',
];

/**
 * The nutrients a food can be recorded as holding, keyed the way the
 * health rules already key theirs.
 *
 * **Eight of these are `HealthRuleMetric`'s own nutrient keys, character for
 * character**, and that alignment is the point rather than a coincidence.
 * `healthRules.ts` already watches those eight, reading them out of Apple
 * Health — which today means reading figures some *other* food logger wrote.
 * A figure recorded here has to be able to answer a rule the user has already
 * set up, and a second vocabulary spelling it `protein_g` beside one spelling
 * it `proteinG` is how the two would drift apart. `foodNutrition.test.ts` pins
 * the containment, so a ninth metric over there can't quietly end up with no
 * home here.
 *
 * **`carbsG` and `fatG` are two of the five that aren't**, and they are
 * deliberately not added to `HealthRuleMetric` to match: a rule metric costs a
 * HealthKit read type and a wider permission sheet (see the note beside
 * `readTypes` in the bridge), and nobody has asked to be nudged about
 * carbohydrate. They are here because a label panel prints them, and a food
 * record dropping them would be visibly missing two of the numbers on the
 * packet. The three minerals below are here on the same terms.
 *
 * **`calciumMg`, `ironMg` and `potassiumMg` are the three minerals, and they
 * are three rather than the four a US label prints.** #2430 asked whether the
 * Cronometer panel — twenty-odd vitamins and minerals — is reachable from the
 * two sources this app queries, and measured it: 200 US products from Open
 * Food Facts, counted per nutrient. The answer is that coverage tracks US
 * label law rather than nutrition. The nutrients that make a micronutrient
 * tracker worth using are the ones that are missing (vitamin B12 8%, folate
 * 4%, magnesium 10%), while the minerals the FDA has mandated on a panel
 * since 2016 carry a real figure on about two thirds of products: calcium
 * 68%, iron 64%, potassium 68%. So these three are here and the rest of the
 * panel is not, which is a decision about the data rather than about the
 * design.
 *
 * **The vitamins and minerals after `caffeineMg` and `waterMl` are typed by
 * hand, or read off a photographed label, and that is what lets them in.** The measurement above is why the barcode
 * sources can't fill them, not a reason to keep them out: a supplement's panel
 * is typed once, by someone holding the bottle, and then every dose of it
 * adds the same figures (`supplementDose.ts`). A photographed label is print
 * the person checks against the bottle before saving, so it may fill them too
 * (`PRINTED_NUTRIENT_KEYS`). `nutritionParse.ts` maps none of them, so a scanned or searched food never states a figure it can't vouch
 * for. Vitamin D is the clearest case: 41% of products state an explicit zero,
 * the shape of a bulk-defaulted field, and a wrong zero written to a health
 * record is the failure `docs/arch/health-data.md` is entirely about. A typed
 * 25 mcg off a bottle is a different claim from that, and an absent key is
 * still unknown, never zero, so a day's vitamin D total counts only the
 * entries that stated it.
 *
 * **The three are written to Health and never read from it**, which is
 * `carbsG` and `fatG`'s arrangement rather than a new one: a rule metric costs
 * a HealthKit *read* type and a wider permission sheet, and nothing in this app
 * watches calcium. They are written because the consumer isn't this app — a
 * meal reaching the Health app with the label's mineral block missing reads as
 * incomplete rather than deliberate.
 *
 * **`transFatG`, `cholesterolMg` and `addedSugarG` are the three a person
 * watching their cholesterol reads first**, and every US label prints them, so
 * the barcode sources carry them about as often as saturated fat. They are
 * recorded, and cholesterol is written to Health with the rest of a meal. Trans
 * fat and added sugars are never written: HealthKit has no type for either. So
 * those two sit outside `HEALTH_WRITABLE_NUTRIENTS` below, which is the list
 * every Health-facing reader walks instead of this one. Cholesterol's share
 * type arrived after people had already allowed nutrition, so for them it reads
 * as not yet asked until they allow it, the minerals' arrangement.
 *
 * The unit is in the name, the same convention the health metrics use, because
 * a figure stored in one unit and read in another is the bug with no symptom
 * until somebody's sodium reads a thousand times too high.
 */
export type NutrientKey =
  | 'calorieKcal' | 'proteinG' | 'carbsG' | 'fatG' | 'satFatG' | 'transFatG'
  | 'cholesterolMg' | 'fiberG' | 'sugarG' | 'addedSugarG' | 'sodiumMg'
  | 'calciumMg' | 'ironMg' | 'potassiumMg'
  | 'caffeineMg' | 'alcoholG' | 'waterMl'
  | MicronutrientKey;

/**
 * Every `NutrientKey`, in the order a nutrition label prints them (trans fat
 * and cholesterol under saturated fat, added sugars under total sugars), which is
 * why the three minerals sit together after sodium, where a US panel prints
 * its own mineral block. Caffeine and water follow, since no label prints either,
 * and the manual-only vitamins and minerals (`MicronutrientKey`) come last.
 */
export const NUTRIENT_KEYS: readonly NutrientKey[] = [
  'calorieKcal', 'fatG', 'satFatG', 'transFatG', 'cholesterolMg',
  'carbsG', 'fiberG', 'sugarG', 'addedSugarG', 'proteinG', 'sodiumMg',
  'calciumMg', 'ironMg', 'potassiumMg',
  'caffeineMg', 'alcoholG', 'waterMl',
  ...VITAMIN_KEYS, ...MINERAL_KEYS,
];

/**
 * The nutrients asked for from a source that states a default or a model that
 * estimates: a barcode source, a model's estimate of a meal or a recipe. Every
 * `NutrientKey` except the vitamins and minerals (see the note on
 * `NutrientKey`). A model asked to estimate a restaurant meal's selenium would
 * produce a confident figure with nothing behind it, and it would be written to
 * a health record, so the request never names them and a reply that does is
 * read past.
 *
 * A photographed label is the exception, and reads `PRINTED_NUTRIENT_KEYS`.
 */
export const EXTERNAL_NUTRIENT_KEYS: readonly NutrientKey[] = NUTRIENT_KEYS.filter(
  key => !(VITAMIN_KEYS as readonly string[]).includes(key) && !(MINERAL_KEYS as readonly string[]).includes(key),
);

/**
 * The nutrients a photographed label can state: all of them but alcohol. A
 * label photo is a transcription of print, not an estimate and not a source's
 * default, so a supplement's vitamin rows are read like any other and the
 * person checks the fields against the bottle before saving. Alcohol is the
 * exception because a label prints it as a percentage by volume ("5% vol"),
 * which this transcription would file as grams.
 */
export const PRINTED_NUTRIENT_KEYS: readonly NutrientKey[] = NUTRIENT_KEYS.filter(key => key !== 'alcoholG');

/**
 * The nutrients a logged meal can carry into Apple Health: one per row of the
 * bridge's `nutrientWriteTable`, and so every key above except the two
 * HealthKit has no type for (see `NutrientKey`). The Health settings'
 * per-nutrient choice, the default write selection, the write itself and a
 * task's "log to Health" picker all walk this, so a key the native side would
 * silently skip is never offered as though it were written.
 */
export const HEALTH_WRITABLE_NUTRIENTS: readonly NutrientKey[] = NUTRIENT_KEYS.filter(
  key => key !== 'transFatG' && key !== 'addedSugarG',
);

/**
 * Nothing but an identity, whose constraint does the work: it accepts a union
 * only if every member of it is a `NutrientKey`, and fails the build naming the
 * member that isn't.
 */
type WithNutrientKeyHome<M extends NutrientKey> = M;

/**
 * The health-rule metrics that name a nutrient rather than an activity reading
 * — `HealthRuleMetric` less steps and sleep.
 *
 * **The alignment `NutrientKey`'s own note describes, enforced by the
 * compiler.** A figure recorded here has to be able to answer a rule the user
 * already set up against Apple Health, so a ninth nutrient metric over there
 * with no home in `NutrientKey` would be a rule this app could never satisfy
 * from its own data. Adding one now fails `tsc` on this line, pointing at the
 * metric that has nowhere to live, rather than failing a test that has to be
 * remembered and run.
 *
 * It sits here rather than in `healthRules.ts` because it is the join between
 * the two vocabularies, and both of them are declared in this file — which is
 * the reason `HealthRuleMetric` was moved here in the first place.
 */
export type HealthNutrientMetric =
  WithNutrientKeyHome<Exclude<HealthRuleMetric, 'steps' | 'sleepHours' | 'exerciseMinutes'>>;

/**
 * One stated portion of a food, and what it weighs — "1 cup, chopped = 160g".
 *
 * **The only non-guessed way to turn a recipe line into grams.** Nutrient data
 * is per 100g; a recipe line says "2 cups chopped onion" or "2 large onions".
 * Relating the two needs a weight per stated portion, and it has to be *per
 * food*, because a cup of flour and a cup of honey differ by nearly a factor
 * of three. A global density table would be wrong at both ends while looking
 * entirely plausible in the middle, which is why there isn't one.
 *
 * Modelled on FoodData Central's `foodPortions` rows, which is where these
 * come from. Worth knowing about that source: the portion table is on the
 * *detail* endpoint (`/food/{id}`), not on the search endpoint the barcode
 * path uses, whose `foodMeasures` comes back empty. A barcode record therefore
 * carries no portions at all, which is correct rather than a gap — a packaged
 * product states a serving, not a set of culinary measures.
 */
export interface FoodPortion {
  /**
   * How many of `label` the weight is for. Usually 1, but FoodData Central
   * genuinely writes rows like "10 rings = 60g", so dividing is not optional.
   */
  amount: number;
  /**
   * The portion as the source words it — "cup, chopped", "medium (2-1/2\" dia)",
   * "large", "clove". Free text, deliberately kept verbatim: it is matched
   * against rather than parsed into fields, because the vocabulary is open and
   * every attempt to normalise it upfront loses the prep word that tells a
   * chopped cup from a sliced one.
   */
  label: string;
  /** What `amount` of them weighs, in grams. */
  grams: number;
  /**
   * True for a portion the user weighed themselves, rather than one the
   * source stated. Load-bearing the same way `FoodNutrition.source` is: a
   * self-weighed cup is one person's measurement of one container, not a
   * manufacturer's declared figure, and a reader showing portions back to a
   * person must be able to tell the two apart. Absent (not `false`) on every
   * row a source stated, so it costs nothing on the far more common case.
   */
  custom?: boolean;
}

/** Where a `FoodNutrition` record's figures came from. See that type's `source`. */
export type FoodNutritionSource = 'fdc' | 'openFoodFacts' | 'manual' | 'estimated';

/**
 * What one food is made of, as some source stated it.
 *
 * **One JSON column rather than thirteen**, for the reason `FollowUpTaskDraft`
 * is one: these are only ever read and written together, by whatever established
 * a food's nutrition, and a column apiece would be thirteen migrations for a
 * field set that is this feature's alone. It also passes the test `ItemProduct`'s
 * own note sets for going the other way — nothing outside the row holds a
 * pointer at a nutrition record, so there is no id for a separate table to hang
 * off.
 *
 * **It hangs off both `GroceryItem` and `ItemProduct`, and the product wins.**
 * A catalog row is the generic food ("onion", "chicken breast") and is what a
 * recipe ingredient resolves to; a product is the box on the shelf, and Fage 5%
 * and Chobani 0% are two different sets of numbers under one "yogurt". Read the
 * pair through `nutritionFor` (`foodNutrition.ts`); nothing reads either field
 * raw.
 */
/**
 * How a food's weight changes when it is cooked, so an amount weighed in the
 * other state can be logged against the one panel it has.
 *
 * `panelState` is the state the panel's figures describe (a source's "Rice,
 * raw" panel is `'raw'`), and `cookedPerRaw` is cooked grams per raw gram: about
 * 2.8 for white rice, about 0.75 for chicken breast. Typed or measured by the
 * person, never looked up. See `cookedState.ts`.
 */
export interface FoodCooking {
  panelState: 'raw' | 'cooked';
  cookedPerRaw: number;
}

/** A NOVA food processing group: 1 minimally processed, 2 culinary ingredient, 3 processed, 4 ultra-processed. */
export type NovaGroup = 1 | 2 | 3 | 4;

export const NOVA_GROUPS: readonly NovaGroup[] = [1, 2, 3, 4];

export interface FoodNutrition {
  /**
   * What the figures in `amounts` are measured against.
   *
   * **Not optional and not defaultable.** "240 calories" means nothing until you
   * know whether it is per 100g or per serving, and the two differ by whatever a
   * serving happens to weigh — so a record that lost this would be wrong by an
   * unknown factor while looking entirely ordinary. It is carried rather than
   * assumed because a source that changed its mind would otherwise rewrite
   * every stored figure's meaning without touching a byte of it.
   *
   * **`per100ml` is separate from `per100g` because a drink is not the same
   * weight as its volume**, and both barcode sources blur exactly that: they
   * label a beverage's panel "per 100g" and mean per 100ml. Folding the two
   * together would make every drink wrong by its own density, silently and
   * with nothing on screen to say so. Which one a barcode record gets is
   * decided by the unit the source states the *product* is sold in, not by any
   * guess about the food — see `basisFor` in `nutritionParse.ts`. Nothing here
   * converts between the two, since that needs a density this app does not
   * have; a reader wanting grams from a `per100ml` record has to refuse, the
   * same way `servingGrams` being null makes it refuse.
   *
   * A typed or estimated record is whatever its writer measured.
   */
  basis: 'per100g' | 'per100ml' | 'perServing';
  /**
   * What one serving weighs, when the source said so. Null when it didn't.
   *
   * Needed to relate a `perServing` record to any amount other than exactly one
   * serving, so such a record without it can answer "one serving of this" and
   * nothing else. That refusal belongs to whichever reader wants the grams;
   * nothing here guesses a serving weight.
   *
   * **A product sold by volume has none**, and that is the honest answer rather
   * than a gap: this is a mass, a 250ml can states a volume, and converting the
   * one to the other needs a density nothing here knows. Such a record carries
   * its serving in `servingText` for a person to read, and `per100ml` figures
   * to compute with.
   */
  servingGrams: number | null;
  /**
   * The serving as the packet prints it — "1 cup (240ml)", "2 cookies".
   * Rendered, never parsed for arithmetic; `servingGrams` is the number
   * anything is allowed to compute with. Same split `Quantity.container`
   * already draws between a size as written and a number.
   */
  servingText: string | null;
  /**
   * The figures themselves, every one of them optional.
   *
   * **An absent key is unknown, and is emphatically not zero.** Open Food Facts
   * is crowd-sourced and routinely partial, and a US label only has to declare a
   * short list, so a food reporting calories and protein but no fibre is the
   * ordinary case rather than a broken row. Summing an absent value as 0 yields
   * a total that is quietly wrong with nothing on screen to say so — the same
   * rule `countOrNull` enforces on the Health read side, and the one
   * `moodInsights` states generally as "a day you didn't log is not a zero". A
   * real 0 survives as 0, since a food genuinely containing no fat is a thing a
   * source can state.
   *
   * A map rather than ten sibling fields so that summing, counting coverage and
   * rendering a panel are each one walk over `NUTRIENT_KEYS`, instead of a
   * hand-written list that an eleventh nutrient would have to be added to in
   * four places.
   */
  amounts: Partial<Record<NutrientKey, number>>;
  /**
   * Where these figures came from, which decides what a reader may claim about
   * them.
   *
   * **Load-bearing, not bookkeeping.** A barcode's figures are a manufacturer's
   * declared label, a typed one is the user's own transcription, and an
   * estimated one is a guess a model made. Those are three different things to
   * put in front of somebody, and a different three again to write into a health
   * record — see `docs/arch/health-data.md` on why a write costs more to get
   * wrong than a read. Nothing downstream may render an estimate the way it
   * renders a label.
   */
  source: FoodNutritionSource;
  /**
   * The source's own id for this food — an FDC `fdcId`, an Open Food Facts
   * code — or null for anything typed by hand. Resolve-or-shrug: nothing
   * re-fetches from it, so an id whose source has since forgotten the food is
   * simply an id nobody asks about.
   */
  sourceId: string | null;
  /**
   * The source's own portion table, empty when it stated none.
   *
   * **Carried with the nutrients rather than in a column of its own**, because
   * they describe one food and arrive in one answer: split apart, a row could
   * end up with one food's calories and another's gram weights, which is a
   * wrong calorie count with nothing on screen to say so. Same reasoning that
   * made `amounts` one JSON blob.
   *
   * Empty is ordinary. Open Food Facts states no portions, and FoodData
   * Central's search endpoint does not return them either. See `FoodPortion`.
   */
  portions: FoodPortion[];
  /** ISO instant these figures were recorded. */
  recordedAt: string;
  /**
   * The database's own food category ("Vegetables and Vegetable Products"),
   * kept only so the vegetable and fruit estimate can classify a food its name
   * lexicon does not know (`produceServings.ts`). A fact about what the food is,
   * not a figure: nothing scales it and nothing but that estimate reads it.
   * Absent for every source that states no category, which is the ordinary case.
   */
  foodCategory?: string | null;
  /**
   * The food's NOVA processing group (1 unprocessed or minimally processed, 2
   * culinary ingredient, 3 processed, 4 ultra-processed), when a source stated
   * it or the person set it by hand. A classification of the food rather than a
   * figure, so nothing scales it, and it is carried onto a logged helping like
   * `source` is (`scalePanelToAmount`).
   *
   * **Never derived from a name or an ingredient list here.** Open Food Facts
   * publishes a group per product and that is the only automatic source; a food
   * nobody classified has no key, and a reader counts it as unclassified rather
   * than as group 1. Absent is the ordinary case. See `processingStats.ts`.
   */
  novaGroup?: NovaGroup | null;
  /**
   * What the whole package weighs in grams, when the person typed it from the
   * label ("Net wt 8 oz (227 g)"). A fact about the packet, not a figure, so
   * nothing scales it and a logged helping never carries it
   * (`scalePanelToAmount` builds its panel field by field).
   *
   * **A mass only.** A pack sold by volume has none, for the reason
   * `servingGrams` gives: turning millilitres into grams needs a density.
   * Absent is the ordinary case, and a barcode source states its pack size as a
   * string on the scan rather than here, so this is set only by a person.
   * `servingsPerPackage` (`scanPortion.ts`) prefers it to that string, since
   * the person typed it against the packet in their hand.
   */
  packageGrams?: number | null;
  /**
   * What an estimated meal's total was made of, one line per thing the
   * description named ("birch beer", "soft pretzel"), kept so the split the
   * person saw before logging is still there on the row afterwards.
   *
   * Only an `estimated` panel carries one, and only when the model split the
   * meal. Each line states figures and nothing else: no source and no
   * confidence, since the claim is still the meal's (`nutritionEstimate.ts`).
   * It scales with the total in `estimateAmountPatch` and is dropped by every
   * path that builds a panel from more than one food (`combineFoodNutrition`),
   * because that panel is no longer the estimate the lines were split from.
   */
  /**
   * The raw-to-cooked weight ratio, when the person set one. Lets an amount be
   * typed in the state the panel isn't in ("100 g raw" on a cooked panel),
   * converted by `panelGramsFor`. Absent is the ordinary case, and then a raw or
   * cooked amount is refused rather than read as plain grams. A property of the
   * food, so a logged helping does not carry it (`scalePanelToAmount` builds its
   * panel field by field).
   */
  cooking?: FoodCooking;
  breakdown?: FoodBreakdownLine[];
}

/** One component of an estimated meal. See `FoodNutrition.breakdown`. */
export interface FoodBreakdownLine {
  label: string;
  amounts: Partial<Record<NutrientKey, number>>;
}

/**
 * One thing eaten, at one moment.
 *
 * **The app plans meals and tracks cooking and has had no concept of eating.**
 * `MealPlanEntry.cookedAt` is when a dish was made; `Leftover.outcome` says a
 * container ended up empty. Neither says a person consumed a known amount, and
 * both types say so outright. Cooked and eaten are genuinely different: a
 * dinner cooked for four, eaten by two, with half going in the fridge, is one
 * cooking and two servings and one leftover.
 *
 * **It is a log, not a task and not a quota.** `MoodLog` is the precedent and
 * the reasoning transfers whole: there is nothing here to complete, schedule or
 * defer, and `progressCount`/`targetCount` count toward a target within a day
 * where this records an arbitrary amount with no target to reach. A 2,000
 * calorie day is not a `targetCount`, which is clamped to 99, and 340 calories
 * is not a tap. What it is closest to is a Logbook row.
 *
 * **It is also not a `MealPlanEntry`.** That is a square on a calendar and is
 * about intent, which is why it deliberately has no UNIQUE on `(date, slot)`.
 * This is about what happened. They point at each other and are not the same
 * row.
 */
export interface FoodLogEntry {
  id: string;
  /**
   * The logical day this counts toward (`2026-08-17`), stamped at write time
   * from `dayResetTime` rather than derived from `atISO` on read.
   *
   * Stored for the reason `MoodLog.dayKey` is stored, and the stakes are higher
   * here: `dayResetTime` is a setting, so deriving on read means moving your
   * day boundary to 02:00 silently rewrites which day last month's late-night
   * eating belongs to, shifting every total the screen shows. And it is
   * `getLogicalDayKey`, never `dayKeyOf(new Date())` — this is the grace-window
   * rule from CLAUDE.md and a food log is where it bites hardest, since an 11pm
   * snack recorded at 12:30am belongs to the evening it happened in.
   */
  dayKey: string;
  /**
   * The real instant, for ordering within a day and for a Health sample's own
   * timestamp.
   *
   * **This and `dayKey` are allowed to disagree, by design.** HealthKit buckets
   * by wall clock, and the user's own day boundary is this app's idea rather
   * than Apple's, so the sample belongs at the moment it happened while the
   * day's total belongs to the logical day. Do not "fix" one to match the
   * other.
   */
  atISO: string;
  /** Which meal it was, or null for something eaten outside of one. */
  slot: MealSlot | null;
  /**
   * What was eaten, in words. Always captured and always what renders.
   *
   * Resolve-or-shrug, the same call `MealPlanEntry.title` and
   * `TemplateItem.refTemplateName` make: a deleted recipe leaves an entry that
   * still says what you ate.
   */
  label: string;
  /**
   * Where it came from, all optional and any of them free to dangle. None of
   * them is what renders and none of them cascades on delete.
   */
  recipeId: string | null;
  itemId: string | null;
  productId: string | null;
  mealPlanEntryId: string | null;
  /**
   * Which of two interchangeable items this dish was made with
   * (`ItemSubLink.either`), kept so re-measuring the dish later (`refresh_dish_entry`,
   * the entry sheet) reads the same lines the log did. `nutrition` is still the
   * snapshot; this is only what a re-measure needs. Optional: absent and empty
   * read the same.
   */
  itemPicks?: ItemPick[];
  /**
   * The task whose completion wrote this entry (`Task.logSavedMealId`), so
   * un-completing it can take the entry back, the way `MedicationLog.taskId`
   * does for a dose. Provenance only and free to dangle: deleting the task
   * leaves the entry, because the food was still eaten. Optional because absent
   * and null read the same everywhere.
   */
  taskId?: string | null;
  /** The amount as entered — "1 serving", "2 cups", "340g". */
  quantity: string;
  /** What that amount resolved to in grams, or null when nothing could resolve it. */
  grams: number | null;
  /**
   * What it was made of, **snapshotted at log time and never re-derived**.
   *
   * This is the single most important field on the row. Editing a recipe next
   * month must not silently rewrite what you ate last Tuesday, and a Health
   * sample already written could not be rewritten by a later recipe edit
   * anyway. The app already makes this call in exactly this shape twice over:
   * `MealPlanEntry.title` is captured at plan time so a renamed recipe does not
   * rewrite history, and `RecipeComponent.name` does the same. Same reasoning,
   * higher stakes.
   *
   * Its `basis` is always `perServing` here and its figures are the amounts
   * actually eaten, not per 100g: an entry records one helping rather than a
   * food, so scaling has already happened by the time it is stored. See
   * `helpingNutrition` in `foodLog.ts`.
   */
  nutrition: FoodNutrition;
  /**
   * The panel `nutrition` was measured against, kept on the entry because no
   * catalog row holds it. Null (or absent) on everything else.
   *
   * **Written for two cases, both linked to nothing** (#2914). The main one is
   * a food a database answered that nobody filed, below. The other is an
   * estimate once its amount has been changed (more or less of it than the
   * model was told about): then this is the whole meal the model described,
   * `source: 'estimated'` like the helping, so every later change is taken of
   * the whole rather than of the last one (see `wholeEstimate`). A Describe
   * sheet recall at a new count writes it too, for the same reason. The source
   * tells the two apart, and only the first is something an amount can be
   * re-measured against.
   *
   * **The database food.** `nutrition` is one helping with its portion table
   * emptied, so an entry like that had nothing left to re-measure a corrected
   * amount against, and "I logged 200 g, it was 170 g" could only be a delete
   * and a fresh search. This is the database's own panel, per 100 g with its portions,
   * snapshotted at log time on `nutrition`'s rule: a later lookup of the same
   * food must not rewrite what was measured. `foodLogEntryEdit` reopens such
   * an entry on it exactly as it reopens a linked food on its row's panel.
   *
   * **Not written for a linked entry**, whose row already holds the panel, and
   * a correction that re-measures against a row (or picks a different food)
   * clears it: from then on it would describe how a helping *used* to be
   * measured. It travels in sync and backups with the row, since it describes
   * the entry rather than the device.
   *
   * Optional on the type rather than required-nullable because absent and
   * null read identically at every reader, and every entry built in memory
   * without one (most of what a saved meal logs, a test) is the ordinary case.
   */
  sourcePanel?: FoodNutrition | null;
  /**
   * Health sample identifiers this entry wrote, so an edit or a delete can
   * retract them.
   *
   * **Empty on every row today**, because nothing writes nutrients to Health
   * yet. It is on the schema from the start rather than added later because the
   * failure it prevents is the one the whole feature is arranged around: a
   * typo'd entry that cannot be unwritten from a medical record. See
   * `docs/arch/health-data.md` on why a bad write costs more than a bad read.
   */
  healthSampleIds: string[];
  /**
   * Set on an entry the MCP server logged: the server has no HealthKit, so it
   * leaves the entry for the phone to write on its next foreground
   * (`writePendingHealthEntries` in `useFoodLogStore`), which stores the sample
   * ids and clears this. Never set by the app's own logging, which writes at the
   * moment of logging, so an entry without it that has no ids stays unwritten
   * exactly as `docs/arch/health-data.md` says. An entry still pending after
   * `PENDING_WRITE_MAX_AGE_DAYS` is cleared without a write.
   * Optional because absent and false read the same everywhere.
   */
  healthWritePending?: boolean;
  /**
   * The saved meal this entry was logged as part of, and its name as it was
   * called at the time. Provenance only, the way `taskId` is: free to dangle
   * (deleting or renaming the meal leaves what was eaten untouched, which is
   * why the name is a snapshot rather than a lookup), and never read for a
   * total. The food log draws the entries that share one (and one logged
   * moment) as a single tray under the meal's name (`savedMealRuns`).
   * Absent on everything logged any other way, and on every entry that
   * predates the column.
   */
  savedMealId?: string | null;
  savedMealName?: string | null;
  /**
   * Hand-set position within the day, in the same running-number-space `Task.sortOrder`
   * uses across a whole category list rather than one per section — a drag that
   * re-slots an entry needs one number space it can carry across the boundary.
   * Defaults to `0` for every row that predates the column, so an existing
   * install reads as unordered (falling back to `atISO`) until something is
   * actually dragged.
   */
  sortOrder: number;
  createdAt: string;
}

/**
 * One food within a `SavedMeal`, shaped like the parts of a `FoodLogEntry`
 * that re-logging needs and none of the parts that are about where it landed
 * (`slot`, `atISO`, `sortOrder`) — those are decided fresh each time the meal
 * is logged again, not carried from the entries it was built from.
 *
 * `nutrition` is a snapshot, same rule and same reason as `FoodLogEntry.nutrition`:
 * editing the recipe or catalog row next month must not change what a saved
 * meal logs today.
 */
export interface SavedMealItem {
  label: string;
  recipeId: string | null;
  itemId: string | null;
  productId: string | null;
  quantity: string;
  grams: number | null;
  nutrition: FoodNutrition;
  /**
   * The panel the entry it was built from kept (`FoodLogEntry.sourcePanel`),
   * handed on to every entry the saved meal logs. Absent or null for an item
   * built from an entry that kept none, which is most of them.
   *
   * Without it a database food nobody filed, saved as part of a meal, logged
   * back as an entry that could only be renamed (#2914), and an estimate cut
   * to a share came back with no whole to take a different share of. It is a
   * snapshot on `nutrition`'s rule, copied verbatim both ways: the saved meal
   * logs the same helping, so the same panel describes how it was measured.
   *
   * Optional because saved meals stored before it hold no such key, and it
   * rides inside the `items` JSON blob, so sync and backups carry it as-is.
   */
  sourcePanel?: FoodNutrition | null;
}

/**
 * Several food log entries, bundled under one name so the whole combination
 * can be logged again with one tap instead of re-finding and re-amounting
 * each food.
 *
 * Deliberately not a trimmed `Recipe`: a recipe is a dish with steps,
 * sourcing and planning fields this has no use for, and building one that
 * way would either drag that machinery in unused or need a second "list of
 * foods with amounts" shape living beside the one `Recipe.ingredients`
 * already is. This is closer to `FoodLogDraft` repeated N times — the
 * bulk-select bar's "Save as meal" action is the one place it's built, from
 * whichever entries are selected.
 */
export interface SavedMeal {
  id: string;
  name: string;
  items: SavedMealItem[];
  createdAt: string;
}
