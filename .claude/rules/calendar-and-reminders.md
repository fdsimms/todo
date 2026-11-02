---
paths:
  - "src/utils/calendar*.ts"
  - "src/utils/*CalendarSync.ts"
  - "src/utils/remindersImport*.ts"
  - "src/utils/groceryReminderMirror.ts"
---

# Writing to the system calendar and Reminders

Moved out of `CLAUDE.md`, verbatim, so it loads only with the code it governs (see "Rules that load by path" there).

**Every expo-calendar event update goes through `rewriteEvent`, and a reminder update sends
back what its pass read.** expo-calendar's native save assigns every field it knows on each
update, so a field the call leaves out is reset rather than left alone. A moved meal or deadline
event lost its location, notes and alerts, a retitled time block lost the alert set on it in the
sheet, and the Reminders mirror erased a reminder's location each time it ticked one off (#2933).
That was one cause found three times. `rewriteEvent` (`calendarSync.ts`) reads the event first
and sends back what `carriedEventFields` says the save would clear, with the fields the app owns
written over the top. Reminders have no such helper, so `mirrorOnce` (`remindersImportSync.ts`)
keeps the location it read and passes it along. A new `updateEventAsync` goes through
`rewriteEvent`, and a new `updateReminderAsync` sends back every field the native save assigns,
not only the one it means to change.
