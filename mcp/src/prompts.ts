/**
 * MCP prompts: the routines a person can start by name from the Claude apps
 * (they appear as slash commands or in the attachment menu), each one a script
 * over the tools.
 *
 * They exist because the useful things to do with this app are sequences, not
 * calls. A weekly review is history, then what slipped, then what is coming,
 * then a few decisions, and a model left to improvise one reads three lists and
 * summarizes them. Writing the sequence down once makes it the same review
 * every week, and puts the "ask before changing anything" step where it cannot
 * be skipped.
 *
 * Plain data and a template function, so `prompts.test.ts` can check every
 * tool a script names is one the server registers. A prompt that names a tool
 * that was renamed is worse than none: the model tries it, fails, and
 * improvises anyway.
 */
export interface PromptArg {
  name: string;
  description: string;
  required?: boolean;
}

export interface PromptDef {
  name: string;
  title: string;
  description: string;
  args?: PromptArg[];
  text(args: Record<string, string | undefined>): string;
}

const ASK_FIRST = 'Before changing anything, show me exactly what you would change and wait for me to say yes. Apply what I agree to in one batch_update_tasks call (preview first, then apply: true).';

export const PROMPTS: PromptDef[] = [
  {
    name: 'weekly_review',
    title: 'Weekly review',
    description: 'What got done this week, what slipped, what is coming, and a few decisions.',
    text: () => `Run my weekly review.

1. Call get_overview so you know my day, lists and what I have switched off.
2. Call completion_history for the last 7 days. Tell me what I got done in a few lines: totals, which categories and projects moved, anything I finished that had been waiting a long time. Counts and names only; don't grade the week.
3. Call review_tasks. Walk me through what is overdue, what has sat in the Inbox, likely duplicates and quiet projects, one group at a time, and ask what I want to do with each (do it this week, move it, drop it, or leave it).
4. Call get_agenda for the next 7 days. Point out heavy days and deadlines that won't fit. If a day is overloaded, offer rebalance_week.
5. Finish with the three things that matter most this week, in my own words where you can.

${ASK_FIRST}`,
  },
  {
    name: 'inbox_zero',
    title: 'Clear my Inbox',
    description: 'Go through untriaged tasks one at a time and file each one.',
    text: () => `Help me clear my Inbox.

1. Call get_overview for my categories, tags and projects, then list_tasks with view "inbox".
2. Go through them in small groups of about five. For each, suggest one of: a day (or "someday", meaning unscheduled with a category), a category, a project, or deleting it. Base the suggestion on its title and on how I have filed similar tasks; say when you are guessing.
3. After each group, wait for my answers, then apply them with batch_update_tasks (preview, then apply: true). There is no delete tool: for a task I want gone, tell me to swipe it away in the app, or mark it complete if it is already done.
4. Stop when the Inbox is empty or I say stop, and tell me how many are left.`,
  },
  {
    name: 'plan_my_day',
    title: 'Plan my day',
    description: 'An hour-by-hour plan for today around your meetings.',
    args: [{ name: 'busy', description: 'Meetings or blocks today, like "10-11 standup, 2-3:30 dentist". Optional.' }],
    text: ({ busy }) => `Plan my day.

1. Call get_overview, then habit_patterns so you know when I actually tend to get things done.
2. ${busy
      ? `My busy times today are: ${busy}. Turn those into HH:MM blocks.`
      : 'Ask me what meetings or fixed commitments I have today, unless you can read my calendar with another tool, in which case use that.'}
3. Call plan_day with those busy blocks. Show me the plan as a short timeline, and tell me what does not fit.
4. Offer to pin the first few things and to move what does not fit to another day (rebalance_week can suggest which day).

${ASK_FIRST}`,
  },
  {
    name: 'plan_my_week',
    title: 'Plan my week',
    description: 'Look at the coming week, even out heavy days, and settle the big things.',
    text: () => `Plan my week.

1. Call get_overview and get_agenda for 7 days. Summarize each day in one line: how much is on it and anything with a deadline.
2. If any day is heavy, call rebalance_week and walk me through its moves. Ask about any that move something I care about.
3. Ask whether anything is missing: things I need to do this week that are not in the app yet. Add them with quick_add (show me how each line reads first).
4. Check habit_patterns for anything I have been missing lately and ask whether to schedule time for it.

${ASK_FIRST}`,
  },
  {
    name: 'clean_up_project',
    title: 'Clean up a project',
    description: 'Get a project unstuck: what is left, what is blocking it, and the next step.',
    args: [{ name: 'project', description: 'The project\'s name.', required: true }],
    text: ({ project }) => `Help me clean up my project "${project ?? ''}".

1. Find it with list_projects, then call get_project.
2. Tell me where it stands: how much is done, what is left, what is waiting on something, and when anything last got finished.
3. Point out steps that look stale, duplicated, or too big to start, and suggest a smaller first step for anything vague.
4. Agree a next step with me and offer to schedule it (a date this week, or pinned for today).

${ASK_FIRST}`,
  },
  {
    name: 'improve_my_setup',
    title: 'Improve my setup',
    description: 'Features the app has that my own tasks suggest I would use.',
    text: () => `Look at how I use the app and suggest better ways of working.

1. Call get_overview, then unused_features.
2. For each suggestion, say what you saw in my data, what the feature does, and where to turn it on (the Settings path, or what to tap). Skip anything in an area get_overview says is off.
3. Offer them as options, a few at a time, never as something I have been doing wrong. If I pass on one, offer to remember that (naming its id in the note) so it does not come back.
4. If a suggestion is something you can do for me with these tools, offer that, and apply it only after I say yes.`,
  },
  {
    name: 'how_do_i',
    title: 'How do I…',
    description: 'Ask how to do something in the app.',
    args: [{ name: 'question', description: 'What you want to do.', required: true }],
    text: ({ question }) => `How do I do this in the app: ${question ?? ''}

Call app_help with my question (try a shorter rephrasing if the first search finds little). Answer in a few plain steps using the app's own names for screens and settings, and give the Settings path when one applies. If app_help finds nothing relevant, say you are not sure the app does that, rather than guessing. If it can be done for me with these tools instead, offer that too.`,
  },
];
