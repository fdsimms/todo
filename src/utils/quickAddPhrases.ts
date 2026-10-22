import type { TitleSuggestion, TitleSuggestionContext } from './titleSuggestion';

/**
 * One thing quick add reads out of a title, as the "What can I type?" sheet
 * lists it: an example to type and what it becomes.
 *
 * `reads` names the parser that takes the example, so
 * `quickAddPhrases.test.ts` can run every example through it and fail when a
 * phrase listed here stops being read: a help sheet promising syntax the app
 * no longer understands is worse than none. `'title'` is `pickTitleSuggestion`
 * (with `context` for a phrase that needs, say, a repeat already set),
 * `'schedule'` is `parseTaskInput`, and `'other'` is read somewhere with no
 * pure entry point to test it from (the `#` and `@` tokens, events, doses).
 */
export type QuickAddPhrase =
  & { example: string; means: string }
  & (
    | { reads: 'title'; kind: TitleSuggestion['kind']; context?: Partial<TitleSuggestionContext> }
    | { reads: 'schedule' }
    | { reads: 'other' }
  );

export interface QuickAddPhraseSection {
  title: string;
  phrases: QuickAddPhrase[];
}

export const QUICK_ADD_PHRASES: readonly QuickAddPhraseSection[] = [
  {
    title: 'When',
    phrases: [
      { example: 'pay rent tmrw 5pm', means: 'Due tomorrow, with a 5 PM reminder offered', reads: 'schedule' },
      { example: 'gym every mon and wed', means: 'Repeats on those days', reads: 'schedule' },
      { example: 'water plants every 3 days', means: 'Repeats every 3 days', reads: 'schedule' },
      { example: 'return library books by friday', means: 'Due Friday, with a deadline that day', reads: 'schedule' },
      { example: 'walk the dog on the 10th and the 15th', means: 'One task on both dates', reads: 'schedule' },
      { example: 'remind me to call mom at 4pm', means: 'A reminder at 4 PM', reads: 'other' },
    ],
  },
  {
    title: 'Where it goes',
    phrases: [
      { example: 'clean kitchen #home #chores', means: 'The first is the category, the rest are tags you already use', reads: 'other' },
      { example: 'book hotel +japan', means: 'Files it in that project', reads: 'title', kind: 'project' },
      { example: 'lunch @sam', means: 'Who it’s with', reads: 'other' },
    ],
  },
  {
    title: 'How much',
    phrases: [
      { example: 'file taxes !high', means: 'Priority: !low, !med, !high or !urgent', reads: 'title', kind: 'priority' },
      { example: 'clean the garage ~2h', means: 'How long it takes', reads: 'title', kind: 'estimate' },
      { example: 'stretch for 15 minutes', means: 'A countdown timer', reads: 'title', kind: 'duration' },
      { example: 'drink water 8 times a day', means: 'A target to log toward', reads: 'title', kind: 'target' },
    ],
  },
  {
    title: 'Steps',
    phrases: [
      { example: 'pack: socks, charger, passport', means: 'Subtasks', reads: 'title', kind: 'subtasks' },
      { example: 'pick up cleaning -> drop off books', means: 'Steps done one after another', reads: 'title', kind: 'chain' },
      { example: 'file taxes after get W-2', means: 'Waits until that task is done', reads: 'title', kind: 'waiting' },
    ],
  },
  {
    title: 'Habits and conditions',
    phrases: [
      { example: 'Don’t check Twitter', means: 'A habit to avoid', reads: 'title', kind: 'avoid' },
      { example: 'walk the dog after sunset', means: 'Shows once the sun is down, with a saved location', reads: 'title', kind: 'sun' },
      { example: 'leave books out on the next sunny day', means: 'Waits for that weather, with weather turned on', reads: 'title', kind: 'weather' },
      {
        example: 'water the garden unless it rains',
        means: 'On a repeating task, skips a day it rained',
        reads: 'title', kind: 'rain', context: { recurrenceType: 'daily' },
      },
      {
        example: 'replace filter 6 filters left',
        means: 'On a repeating task, counts down what’s left',
        reads: 'title', kind: 'supply', context: { recurrenceType: 'monthly' },
      },
    ],
  },
  {
    title: 'Links and contacts',
    phrases: [
      { example: 'read https://example.com/article', means: 'Opens the link from the task', reads: 'title', kind: 'link' },
      { example: 'call the dentist 555-123-4567', means: 'Calls the number from the task', reads: 'title', kind: 'phone' },
      { example: 'email jane@example.com', means: 'Writes to the address from the task', reads: 'title', kind: 'email' },
    ],
  },
  {
    title: 'Not a task',
    phrases: [
      { example: 'event: lunch with @sam sat 12pm', means: 'Adds a calendar event instead', reads: 'other' },
      { example: 'took ibuprofen 400mg', means: 'Records a dose instead', reads: 'other' },
    ],
  },
];
