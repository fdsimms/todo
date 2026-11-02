/**
 * Where a calendar request stands (see `CalendarRequest`). `pending` until the
 * device named by `calendarRequestDeviceId` picks it up; that device moves it
 * to `written` or `failed`. `cancelled` is the requester taking it back while
 * it was still pending.
 *
 * `proposed` is a request waiting for the person's own tap in the Inbox
 * (`src/utils/agentSuggestions.ts`). Nothing writes it: the drain acts only on
 * `pending`, so approving is just moving it there, and skipping it is
 * `cancelled`. A build from before this status existed reads it as cancelled
 * (`CALENDAR_REQUEST_STATUSES` in database.ts), which is the safe direction.
 */
export type CalendarRequestStatus = 'proposed' | 'pending' | 'written' | 'failed' | 'cancelled';

/**
 * What a `CalendarRequest` row asks for. `event` is a standalone calendar event
 * (the original use). The two `task_` kinds are changes to a task's own
 * device-side fields (`Task.deadlineOnCalendar`, `Task.reminderKind`), which an
 * agent cannot write over MCP because the effect is the phone's (a calendar
 * event, an AlarmKit alarm). They are always `proposed` and are applied by the
 * device the person taps on, through `updateTask`, never by the drain.
 */
export type CalendarRequestKind = 'event' | 'task_deadline' | 'task_alarm';

/** The numbers a `task_alarm` request carries; absent keys mean the task's own. */
export interface CalendarRequestPayload {
  /** ISO instant the alarm rings at. */
  alarmAt?: string;
  /** `alarm` rings once, `persistent` repeats until the task is done. */
  ringKind?: 'alarm' | 'persistent';
}

/**
 * An event an agent asked to have put on the calendar (`request_calendar_event`
 * in the MCP server, see `docs/arch/mcp-server.md`). The server cannot reach a
 * calendar, so it writes this synced row and the one device chosen in Settings
 * writes the event when the row arrives (`src/utils/calendarRequestDrain.ts`),
 * then stamps the outcome back onto the row so the requester can see it.
 *
 * The row is a request, not a link: nothing keeps the event in step with it
 * afterwards, and the app never edits or deletes an event it wrote this way.
 */
export interface CalendarRequest {
  id: string;
  title: string;
  /** ISO. For an all-day event, local midnight of its first day. */
  startAt: string;
  /** ISO, exclusive. For an all-day event, local midnight of the day after its last. */
  endAt: string;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  status: CalendarRequestStatus;
  /** Why it failed, in words a person can read. Null unless `failed`. */
  failureReason: string | null;
  /**
   * The calendar server's id for the event written (`calendarItemExternalIdentifier`),
   * when the writing device could read one. Unlike an EventKit id it names the
   * same event on every device, which is why it is allowed to sync.
   */
  eventExternalId: string | null;
  /** ISO, when it left `pending`. Null while pending. */
  resolvedAt: string | null;
  createdAt: string;
  /**
   * What the request asks for. `create` writes a new event (the original and
   * still the common case). `update` and `delete` change or remove the event
   * an earlier `create` request wrote (`targetRequestId`), and only that one:
   * an agent never touches an event the person made.
   *
   * An update or delete row carries a start and end at the epoch, already
   * over, so a build from before these existed expires it as "already over"
   * rather than reading it as an event to create. The new values ride in
   * `changes` for the same reason.
   */
  action?: 'create' | 'update' | 'delete';
  targetRequestId?: string | null;
  changes?: CalendarRequestChanges | null;
  /**
   * `event` (or absent) is a calendar event. A `task_` kind names a task
   * (`taskId`) and carries its numbers in `payload`; it has no event of its
   * own, so its start and end sit at the epoch, already over, for the reason
   * `action` gives: a build from before the kinds existed expires it instead
   * of writing an event from it.
   */
  kind?: CalendarRequestKind;
  taskId?: string | null;
  payload?: CalendarRequestPayload | null;
}

/** What an `update` request changes on the event; absent keys stay as they are. */
export interface CalendarRequestChanges {
  title?: string;
  startAt?: string;
  endAt?: string;
  allDay?: boolean;
  location?: string | null;
  notes?: string | null;
}

/**
 * Who one calendar event occurrence is with — the app's own note about an
 * event it does not own (see `src/utils/eventPeople.ts` and
 * `docs/arch/people.md`). One synced row per occurrence.
 *
 * `eventKey` is `<event ref>#<start ISO>`, where the ref is the calendar
 * server's id for the event (`calendarItemExternalIdentifier`) when this device
 * could read it, which is what lets the same event be found on another phone,
 * and the device-local EventKit id otherwise. The row's own id is a plain
 * generated id rather than the event key, since sync splits row keys on `|`
 * and a server id may contain anything.
 */
export interface EventPeopleLink {
  id: string;
  eventKey: string;
  /** ISO, the occurrence's own start. */
  eventStart: string;
  /** ISO. */
  eventEnd: string;
  /** Title at the time of linking, so a later reader has something to show. */
  title: string;
  personIds: string[];
  createdAt: string;
}

/**
 * What a caller that already knows something about the event starts the card
 * with: the day the screen it was opened from is on, a title, and the people
 * it is with (a person's "Plan something"). All optional, and all editable.
 */
export interface QuickEventSeed {
  day?: Date;
  /** An exact span, for a task's time block proposed in a free gap. Wins over `day`. */
  start?: Date;
  end?: Date;
  title?: string;
  personIds?: readonly string[];
  /** An all-day event; `start` is its day. Used by an imported event with no clock time. */
  allDay?: boolean;
  location?: string;
  /** Notes, or a lone link, for the "Notes or link" field. */
  notes?: string;
  /** Minutes before the start for the alert chip; omitted keeps the chip's default. */
  alertMinutes?: number | null;
}
