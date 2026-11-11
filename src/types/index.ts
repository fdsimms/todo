/**
 * Every model's shape, one file per area. Import from `@/types` (this file) as
 * before; nothing outside `src/types/` names an area file. They exist so that a
 * change to one area's types can be read, and merged, on its own: this was one
 * 9,500-line file that most PRs touched.
 *
 * A new type goes in the area file it is read with. A new area gets its own file
 * and a line here. Each file is still one commented type per block.
 */
export * from './task'; // Task, TaskDraft, categories, chains, rotations, stacks (TaskGroup), GeneratedKind, alarms' task fields
export * from './rules'; // weather, Screen Time, speed bump, block offer, Health, calendar-event and reminder-capture rules
export * from './focus'; // focus sessions and their steps
export * from './unattended'; // the record of what the app did unattended
export * from './project'; // Project, ProjectLink
export * from './people'; // Person, PersonDate, PersonGroup, PersonNote
export * from './wellbeing'; // mood, symptoms, journal, fasts, milestones, experiments, medication doses
export * from './workouts'; // exercises, routines, programs, sessions, sets, gyms
export * from './copyFlags'; // CopyFlag (temporary dev tooling)
export * from './rewards'; // coins and rewards
export * from './alarms'; // alarms and their missions
export * from './template'; // templates, their items, questions and schedules
export * from './grocery'; // the grocery catalog, lists, products, stores, prices, substitutes
export * from './nutrition'; // nutrient keys, food nutrition, the food log, saved meals
export * from './recipes'; // recipes, ingredients, components, steps, timers, cookbooks, cookware
export * from './mealPlan'; // meal slots, the meal plan, leftovers
export * from './calendar'; // calendar requests, event people, the quick event card
export * from './today'; // rows on Today that are not tasks (ContextRow)
