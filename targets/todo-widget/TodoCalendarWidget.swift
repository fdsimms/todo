import WidgetKit
import SwiftUI
import UIKit
import EventKit

// The Calendar widget: today's (and on the large size, tomorrow's) events and
// tasks with a time, as the Calendar screen's agenda lists them
// (calendarAgenda.ts). Written to stand in for a calendar app's own widget.
//
// **The events come from EventKit when this process may read it**, so an event
// booked on a laptop shows without the app being opened. Which calendars, their
// colors, the occurrences hidden from Today, each logical day's bounds and the
// timed tasks only ever come from the snapshot (`buildWidgetCalendar` in
// widgetCalendar.ts), since only the app knows them. When EventKit refuses this
// process, the widget draws the app's own last read of each day instead, and
// both answer the same question.
//
// Written without a compiler. The EventKit calls are the ones expo-calendar's
// own CalendarModule.swift makes (`authorizationStatus(for:)`, `calendars(for:)`,
// `predicateForEvents(withStart:end:calendars:)`, `events(matching:)`), and
// `Color(uiColor:)` was checked against Apple's declaration (iOS 15).

// ==== The model ====

/// One line of the agenda: an event or a task with a time.
struct CalendarLine: Identifiable {
    enum Kind { case event, task }

    let id: String
    let kind: Kind
    let title: String
    let start: Date
    /// Nil for a task nothing gives a length to.
    let end: Date?
    let color: Color?
    /// A location, "Video call", or a task's category.
    let detail: String?
    let completed: Bool
    let taskId: String?

    /// Over by `date`: its end has passed, or its start for a line with no length.
    func isOver(at date: Date) -> Bool { (end ?? start) <= date }
}

/// An all-day event, drawn as a chip above the lines.
struct CalendarAllDay: Identifiable {
    let id: String
    let title: String
    let color: Color?
}

struct CalendarDayModel {
    let key: String
    let start: Date
    let end: Date
    let allDay: [CalendarAllDay]
    let lines: [CalendarLine]
    let untimed: Int

    func remaining(at date: Date) -> [CalendarLine] { lines.filter { !$0.isOver(at: date) } }
}

struct CalendarEntry: TimelineEntry {
    let date: Date
    /// Today, then tomorrow; nil with a reason in `message`.
    let days: [CalendarDayModel]?
    let message: String?
}

// ==== Reading ====

private let videoHosts = [
    "zoom.us", "zoomgov.com", "meet.google.com", "teams.microsoft.com", "teams.live.com",
    "webex.com", "facetime.apple.com", "whereby.com", "gotomeeting.com", "bluejeans.com",
]

/// The same closed list of hosts `hasVideoCallLink` reads in calendarBusy.ts.
private func hasVideoCallLink(_ fields: [String?]) -> Bool {
    fields.contains { field in
        guard let text = field?.lowercased() else { return false }
        return videoHosts.contains { text.contains($0) }
    }
}

private func hexColor(_ raw: String?) -> Color? {
    guard var hex = raw?.trimmingCharacters(in: .whitespaces), !hex.isEmpty else { return nil }
    if hex.hasPrefix("#") { hex.removeFirst() }
    guard hex.count == 6 else { return nil }
    return Color(hex: hex)
}

/// What the agenda knows about one event, from either source.
private struct RawEvent {
    let id: String
    let title: String
    let start: Date
    let end: Date
    let allDay: Bool
    let calendarId: String
    let location: String?
    let videoCall: Bool
    /// EventKit's own color for the calendar, used when the app sent none.
    let fallbackColor: Color?
}

/// Every event over the two days, read here, or nil when this process may
/// not read the calendar (the app's copy is used instead).
private func readEventKit(calendarIds: [String], from: Date, to: Date) -> [RawEvent]? {
    guard EKEventStore.authorizationStatus(for: .event) == .fullAccess, !calendarIds.isEmpty else { return nil }
    let store = EKEventStore()
    let calendars = store.calendars(for: .event).filter { calendarIds.contains($0.calendarIdentifier) }
    // None of the app's calendars found: read nothing rather than every
    // calendar, which is what an empty list means to the predicate.
    guard !calendars.isEmpty else { return nil }
    let predicate = store.predicateForEvents(withStart: from, end: to, calendars: calendars)
    return store.events(matching: predicate).compactMap { event in
        guard event.status != .canceled,
              let start = event.startDate,
              let end = event.endDate else { return nil }
        var color: Color? = nil
        if let cgColor = event.calendar?.cgColor { color = Color(uiColor: UIColor(cgColor: cgColor)) }
        return RawEvent(
            id: event.calendarItemIdentifier,
            title: (event.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
            start: start,
            end: end,
            allDay: event.isAllDay,
            calendarId: event.calendar?.calendarIdentifier ?? "",
            location: event.location?.trimmingCharacters(in: .whitespacesAndNewlines),
            videoCall: hasVideoCallLink([event.url?.absoluteString, event.notes, event.location]),
            fallbackColor: color
        )
    }
}

private func rawEvents(from day: WidgetCalendarDay) -> [RawEvent]? {
    guard let events = day.events else { return nil }
    return events.compactMap { e in
        guard let start = isoDate(e.start) else { return nil }
        return RawEvent(
            id: e.id,
            title: e.title,
            start: start,
            end: isoDate(e.end) ?? start,
            allDay: e.allDay,
            calendarId: e.calendarId,
            location: e.location,
            videoCall: e.videoCall,
            fallbackColor: nil
        )
    }
}

/// The local calendar date an all-day event's instant names. The app has seen
/// EventKit give these as UTC midnight of the date whatever the device's zone
/// (`allDayRangeMs` in calendarBusy.ts, #1725), so an instant that is exactly
/// midnight in UTC is read as a UTC date; anything else is read as local.
private func allDayDate(_ instant: Date) -> (date: Date, atMidnight: Bool) {
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = TimeZone(identifier: "UTC") ?? .current
    let u = utc.dateComponents([.year, .month, .day, .hour, .minute, .second], from: instant)
    if u.hour == 0 && u.minute == 0 && u.second == 0 {
        var local = DateComponents()
        local.year = u.year
        local.month = u.month
        local.day = u.day
        return (Calendar.current.date(from: local) ?? instant, true)
    }
    let start = Calendar.current.startOfDay(for: instant)
    return (start, start == instant)
}

/// Whether an EventKit event is on a logical day. An all-day event is on a
/// date rather than at a time, so it is compared by date (its first day up to
/// the day its end falls before), never against the reset-time bounds, which
/// would put it on the day before too.
private func isOnDay(_ event: RawEvent, day: WidgetCalendarDay, start: Date, end: Date) -> Bool {
    if event.allDay {
        guard let date = dayKeyDate(day.key) else { return false }
        let first = allDayDate(event.start).date
        let last = allDayDate(event.end)
        // An end at midnight is exclusive; one later in the day (23:59:59, the
        // other way EventKit writes it) still covers that day.
        let endExclusive = last.atMidnight
            ? last.date
            : (Calendar.current.date(byAdding: .day, value: 1, to: last.date) ?? last.date)
        return first <= date && date < max(endExclusive, Calendar.current.date(byAdding: .day, value: 1, to: first) ?? endExclusive)
    }
    if event.end <= event.start { return event.start >= start && event.start < end }
    return event.start < end && event.end > start
}

/// A snapshot day with its bounds parsed.
private struct DayBounds {
    let day: WidgetCalendarDay
    let start: Date
    let end: Date
}

/// Builds the days, today first. Empty when the snapshot gave none to build from.
func buildCalendarDays(_ calendar: WidgetCalendar) -> [CalendarDayModel] {
    let bounds: [DayBounds] = calendar.days.compactMap { day in
        guard let start = isoDate(day.start), let end = isoDate(day.end) else { return nil }
        return DayBounds(day: day, start: start, end: end)
    }
    guard let first = bounds.first, let last = bounds.last else { return [] }
    let live = readEventKit(calendarIds: calendar.calendarIds, from: first.start, to: last.end)
    let hidden: [(String, Date)] = calendar.hidden.compactMap { h in
        isoDate(h.start).map { (h.id, $0) }
    }
    let isHidden: (RawEvent) -> Bool = { event in
        hidden.contains { $0.0 == event.id && abs($0.1.timeIntervalSince(event.start)) < 1 }
    }
    let colorFor: (RawEvent) -> Color? = { event in
        hexColor(calendar.colors[event.calendarId]) ?? event.fallbackColor
    }

    return bounds.map { bound in
        let day = bound.day
        let start = bound.start
        let end = bound.end
        let blockIds = Set(day.tasks.compactMap(\.blockEventId))
        let read: [RawEvent] = live.map { all in all.filter { isOnDay($0, day: day, start: start, end: end) } }
            ?? rawEvents(from: day)
            ?? []
        let events = read.filter { !isHidden($0) && !blockIds.contains($0.id) }
        let allDay = events.filter(\.allDay).map {
            CalendarAllDay(id: "\($0.id)|\($0.start.timeIntervalSince1970)", title: $0.title, color: colorFor($0))
        }
        // A task blocked out on the calendar is drawn once, as the task (the
        // same call buildDayTimeline makes), so its event was left out above.
        let taskLines: [CalendarLine] = day.tasks.compactMap { task in
            guard let taskStart = isoDate(task.start) else { return nil }
            return CalendarLine(
                id: "task:\(task.id)",
                kind: .task,
                title: task.title,
                start: taskStart,
                end: task.end.flatMap(isoDate),
                color: nil,
                detail: task.category,
                completed: task.completed,
                taskId: task.id
            )
        }
        let eventLines: [CalendarLine] = events.filter { !$0.allDay }.map { event in
            let detail = event.videoCall ? "Video call" : (event.location?.isEmpty == false ? event.location : nil)
            return CalendarLine(
                id: "event:\(event.id)|\(event.start.timeIntervalSince1970)",
                kind: .event,
                title: event.title.isEmpty ? "Event" : event.title,
                start: event.start,
                end: event.end > event.start ? event.end : nil,
                color: colorFor(event),
                detail: detail,
                completed: false,
                taskId: nil
            )
        }
        let lines = (eventLines + taskLines).sorted {
            if $0.start != $1.start { return $0.start < $1.start }
            return ($0.end ?? $0.start) < ($1.end ?? $1.start)
        }
        return CalendarDayModel(key: day.key, start: start, end: end, allDay: allDay, lines: lines, untimed: day.untimed)
    }
}

// ==== The timeline ====

private let maxCalendarEntries = 40

struct CalendarProvider: TimelineProvider {
    func placeholder(in context: Context) -> CalendarEntry {
        CalendarEntry(date: Date(), days: nil, message: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (CalendarEntry) -> Void) {
        completion(entry(at: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CalendarEntry>) -> Void) {
        let now = Date()
        let first = entry(at: now)
        guard let days = first.days else {
            let next = Calendar.current.date(byAdding: .hour, value: 1, to: now) ?? now
            completion(Timeline(entries: [first], policy: .after(next)))
            return
        }
        // A new entry wherever the list changes on its own: a line ending (it
        // drops off) and the day turning over. The days are built once, so
        // every entry draws from the same read.
        var dates = Set<Date>()
        for day in days {
            for line in day.lines { dates.insert(line.end ?? line.start) }
        }
        if days.count > 1 { dates.insert(days[1].start) }
        let later = dates.filter { $0 > now }.sorted().prefix(maxCalendarEntries - 1)
        let entries = [first] + later.map { CalendarEntry(date: $0, days: days, message: nil) }
        // Read again within half an hour, so an event booked elsewhere shows up
        // without the app. The app also reloads every widget whenever its own
        // calendar read changes.
        // Never sooner than a quarter of an hour: a snapshot whose days have
        // all ended would otherwise ask for a reload that is already due.
        let refresh = Calendar.current.date(byAdding: .minute, value: 30, to: now) ?? now
        let floor = Calendar.current.date(byAdding: .minute, value: 15, to: now) ?? now
        let lastEnd = days.last?.end ?? refresh
        completion(Timeline(entries: entries, policy: .after(max(floor, min(refresh, lastEnd)))))
    }

    private func entry(at date: Date) -> CalendarEntry {
        switch loadWidgetSnapshot() {
        case .noAppGroupAccess:
            return CalendarEntry(date: date, days: nil, message: "Can’t access shared data (App Group)")
        case .noSnapshotYet:
            return CalendarEntry(date: date, days: nil, message: "Open the app to get started")
        case .decodeFailed:
            return CalendarEntry(date: date, days: nil, message: "Couldn’t read calendar data")
        case .success(let snapshot):
            guard let calendar = snapshot.calendar else {
                return CalendarEntry(date: date, days: nil, message: "Turn on Read my calendar in the app’s Calendar settings")
            }
            let days = buildCalendarDays(calendar)
            if days.isEmpty { return CalendarEntry(date: date, days: nil, message: "Open the app to see today") }
            return CalendarEntry(date: date, days: days, message: nil)
        }
    }
}

// ==== The views ====

private func timeText(_ date: Date) -> String {
    date.formatted(date: .omitted, time: .shortened)
}

/// "3:00 – 4:00 PM", or just the start for a line with no length.
private func spanText(_ line: CalendarLine) -> String {
    guard let end = line.end else { return timeText(line.start) }
    return "\(timeText(line.start)) – \(timeText(end))"
}

struct CalendarWidgetEntryView: View {
    var entry: CalendarProvider.Entry
    @Environment(\.colorScheme) var colorScheme
    @Environment(\.widgetFamily) var family

    var body: some View {
        let palette = WidgetPalette.forScheme(colorScheme)
        // The days still running at this entry's moment: an entry past
        // midnight (the reset time) draws tomorrow as today, and a snapshot
        // the app hasn't refreshed in days asks to be opened.
        let days = (entry.days ?? []).filter { $0.end > entry.date }
        return Group {
            if let today = days.first {
                switch family {
                case .systemSmall: small(today: today, tomorrow: days.dropFirst().first, palette: palette)
                case .systemLarge: large(today: today, tomorrow: days.dropFirst().first, palette: palette)
                default: medium(today: today, tomorrow: days.dropFirst().first, palette: palette)
                }
            } else {
                WidgetEmptyState(palette: palette, message: entry.message ?? "Open the app to see today")
                    .padding(WidgetLayout.horizontalPadding)
            }
        }
        .widgetURL(calendarURL(dayKey: days.first?.key))
    }

    // ---- small: the date and what's next ----

    private func small(today: CalendarDayModel, tomorrow: CalendarDayModel?, palette: WidgetPalette) -> some View {
        let remaining = today.remaining(at: entry.date)
        let shown = Array(remaining.prefix(2))
        return VStack(alignment: .leading, spacing: 0) {
            dateHeading(today, palette: palette)
            if shown.isEmpty {
                nothingLeft(today: today, tomorrow: tomorrow, palette: palette)
                    .padding(.top, 6)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(shown) { line in
                        CalendarLineView(line: line, palette: palette, showsTime: false)
                    }
                }
                .padding(.top, 6)
                if remaining.count > shown.count {
                    Text("+\(remaining.count - shown.count) more today")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(palette.textTertiary)
                        .padding(.top, 6)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, WidgetLayout.horizontalPadding)
        .padding(.vertical, WidgetLayout.topPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // ---- medium: the date and the fortnight beside today ----

    private func medium(today: CalendarDayModel, tomorrow: CalendarDayModel?, palette: WidgetPalette) -> some View {
        let remaining = today.remaining(at: entry.date)
        let shown = Array(remaining.prefix(3))
        return HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 0) {
                dateHeading(today, palette: palette)
                Spacer(minLength: 4)
                MiniMonthView(today: dayKeyDate(today.key) ?? entry.date, palette: palette)
            }
            .frame(width: 100, alignment: .leading)
            VStack(alignment: .leading, spacing: 7) {
                if shown.isEmpty {
                    nothingLeft(today: today, tomorrow: tomorrow, palette: palette)
                } else {
                    ForEach(shown) { line in
                        lineLink(line, day: today, palette: palette, showsTime: false)
                    }
                }
                Spacer(minLength: 0)
                footer(today: today, tomorrow: tomorrow, hiddenCount: remaining.count - shown.count, palette: palette)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, WidgetLayout.horizontalPadding)
        .padding(.vertical, WidgetLayout.topPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // ---- large: today, then tomorrow ----

    private func large(today: CalendarDayModel, tomorrow: CalendarDayModel?, palette: WidgetPalette) -> some View {
        let remaining = today.remaining(at: entry.date)
        let todayShown = Array(remaining.prefix(5))
        // Tomorrow takes what today leaves of the eight lines a large widget holds.
        let tomorrowShown = Array((tomorrow?.lines ?? []).prefix(max(2, 8 - todayShown.count)))
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(weekday(today).uppercased())
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(palette.accent)
                Text(monthDay(today))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(palette.textSecondary)
                Spacer(minLength: 4)
                if today.untimed > 0 {
                    Link(destination: openAppURL) {
                        Text(today.untimed == 1 ? "1 untimed task" : "\(today.untimed) untimed tasks")
                            .font(.system(size: 11.5, weight: .semibold))
                            .foregroundColor(palette.accent)
                    }
                }
            }
            allDayChips(today.allDay, palette: palette).padding(.top, 6)
            VStack(alignment: .leading, spacing: 7) {
                if todayShown.isEmpty {
                    Text(today.lines.isEmpty ? "Nothing scheduled today" : "Nothing else today")
                        .font(.system(size: 13))
                        .foregroundColor(palette.textTertiary)
                } else {
                    ForEach(todayShown) { line in
                        lineLink(line, day: today, palette: palette, showsTime: true)
                    }
                }
            }
            .padding(.top, 8)
            if let tomorrow {
                Link(destination: calendarURL(dayKey: tomorrow.key)) {
                    Text("TOMORROW")
                        .font(.system(size: 11, weight: .bold))
                        .tracking(0.5)
                        .foregroundColor(palette.textTertiary)
                }
                .padding(.top, 12)
                allDayChips(tomorrow.allDay, palette: palette).padding(.top, 6)
                VStack(alignment: .leading, spacing: 7) {
                    if tomorrowShown.isEmpty && tomorrow.allDay.isEmpty {
                        Text("Nothing scheduled")
                            .font(.system(size: 13))
                            .foregroundColor(palette.textTertiary)
                    }
                    ForEach(tomorrowShown) { line in
                        lineLink(line, day: tomorrow, palette: palette, showsTime: true)
                    }
                }
                .padding(.top, 6)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, WidgetLayout.horizontalPadding)
        .padding(.vertical, WidgetLayout.topPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // ---- pieces ----

    private func weekday(_ day: CalendarDayModel) -> String {
        (dayKeyDate(day.key) ?? entry.date).formatted(.dateTime.weekday(.wide))
    }

    private func monthDay(_ day: CalendarDayModel) -> String {
        (dayKeyDate(day.key) ?? entry.date).formatted(.dateTime.month(.wide).day())
    }

    private func dateHeading(_ day: CalendarDayModel, palette: WidgetPalette) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(weekday(day).uppercased())
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(palette.accent)
            Text((dayKeyDate(day.key) ?? entry.date).formatted(.dateTime.day()))
                .font(.system(size: 30, weight: .light))
                .foregroundColor(palette.text)
        }
    }

    /// Today has nothing left: say so, and what tomorrow starts with.
    private func nothingLeft(today: CalendarDayModel, tomorrow: CalendarDayModel?, palette: WidgetPalette) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(today.lines.isEmpty ? "Nothing scheduled today" : "Nothing else today")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(palette.textSecondary)
            if let next = tomorrow?.lines.first {
                Text("Tomorrow · \(next.title), \(timeText(next.start))")
                    .font(.system(size: 11.5))
                    .foregroundColor(palette.textTertiary)
                    .lineLimit(2)
            }
        }
    }

    /// Under the medium's lines: what didn't fit, the untimed tasks, or tomorrow's first line.
    @ViewBuilder
    private func footer(today: CalendarDayModel, tomorrow: CalendarDayModel?, hiddenCount: Int, palette: WidgetPalette) -> some View {
        if hiddenCount > 0 {
            Text("+\(hiddenCount) more today")
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundColor(palette.textTertiary)
        } else if today.untimed > 0 {
            Link(destination: openAppURL) {
                Text(today.untimed == 1 ? "1 task without a time" : "\(today.untimed) tasks without a time")
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundColor(palette.accent)
            }
        } else if let next = tomorrow?.lines.first, !today.remaining(at: entry.date).isEmpty {
            Text("Tomorrow · \(next.title), \(timeText(next.start))")
                .font(.system(size: 11.5, weight: .medium))
                .foregroundColor(palette.textTertiary)
                .lineLimit(1)
        }
    }

    @ViewBuilder
    private func allDayChips(_ items: [CalendarAllDay], palette: WidgetPalette) -> some View {
        if !items.isEmpty {
            HStack(spacing: 6) {
                ForEach(items.prefix(3)) { item in
                    HStack(spacing: 5) {
                        Circle()
                            .fill(item.color ?? palette.accent)
                            .frame(width: 7, height: 7)
                        Text(item.title.isEmpty ? "Event" : item.title)
                            .font(.system(size: 11.5, weight: .semibold))
                            .foregroundColor(palette.text)
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .fill((item.color ?? palette.accent).opacity(0.2))
                    )
                }
            }
        }
    }

    /// A line that opens what it is: a task's editor, or the calendar on its day.
    private func lineLink(_ line: CalendarLine, day: CalendarDayModel, palette: WidgetPalette, showsTime: Bool) -> some View {
        let destination = line.taskId.map { taskURL(id: $0) } ?? calendarURL(dayKey: day.key)
        // Inline rather than wrapped in a helper view: the shared header does
        // the same, for WidgetKit's tap regions (see WidgetHeaderView).
        return Link(destination: destination) {
            CalendarLineView(line: line, palette: palette, showsTime: showsTime)
        }
    }
}

/// One agenda line. An event is marked by its calendar's color; a task by an
/// empty box, so the two read apart at a glance, as in the app.
struct CalendarLineView: View {
    let line: CalendarLine
    let palette: WidgetPalette
    /// The large size's time column; the smaller ones put the time under the title.
    let showsTime: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 7) {
            if showsTime {
                Text(timeText(line.start))
                    .font(.system(size: 11.5, weight: .semibold))
                    .monospacedDigit()
                    .foregroundColor(palette.textSecondary)
                    .frame(width: 58, alignment: .trailing)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            if line.kind == .task {
                RoundedRectangle(cornerRadius: 3.5)
                    .strokeBorder(line.completed ? palette.done : palette.textTertiary, lineWidth: 1.6)
                    .background(
                        RoundedRectangle(cornerRadius: 3.5).fill(line.completed ? palette.done : Color.clear)
                    )
                    .frame(width: 12, height: 12)
                    .padding(.top, 2)
            }
            // The event's bar is an overlay on the text rather than a sibling,
            // so it is exactly as tall as the title and detail beside it.
            VStack(alignment: .leading, spacing: 1) {
                Text(line.title)
                    .font(.system(size: 13, weight: line.kind == .event ? .semibold : .medium))
                    .foregroundColor(line.completed ? palette.textTertiary : palette.text)
                    .strikethrough(line.completed)
                    .lineLimit(1)
                Text(detailText)
                    .font(.system(size: 11.5))
                    .foregroundColor(palette.textSecondary)
                    .lineLimit(1)
            }
            .padding(.leading, line.kind == .event ? 10 : 0)
            .overlay(alignment: .leading) {
                if line.kind == .event {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(line.color ?? palette.accent)
                        .frame(width: 3.5)
                }
            }
        }
    }

    private var detailText: String {
        let parts: [String?] = showsTime
            ? [line.end.map { "until \(timeText($0))" }, line.detail]
            : [spanText(line), line.detail]
        return parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// Two weeks from the start of this week, today marked: the medium size's
/// glance at what's around the date.
struct MiniMonthView: View {
    let today: Date
    let palette: WidgetPalette

    private var days: [Date] {
        let calendar = Calendar.current
        let weekStart = calendar.dateInterval(of: .weekOfYear, for: today)?.start ?? calendar.startOfDay(for: today)
        return (0..<14).compactMap { calendar.date(byAdding: .day, value: $0, to: weekStart) }
    }

    var body: some View {
        let calendar = Calendar.current
        let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 7)
        let symbols = calendar.veryShortWeekdaySymbols
        let first = calendar.firstWeekday - 1
        let ordered = Array(symbols[first...] + symbols[..<first])
        return LazyVGrid(columns: columns, spacing: 2) {
            ForEach(Array(ordered.enumerated()), id: \.offset) { pair in
                Text(pair.element)
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundColor(palette.textTertiary)
            }
            ForEach(days, id: \.self) { day in
                let isToday = calendar.isDate(day, inSameDayAs: today)
                Text(day.formatted(.dateTime.day()))
                    .font(.system(size: 8.5, weight: .semibold))
                    .monospacedDigit()
                    .foregroundColor(isToday ? palette.bgSecondary : palette.textSecondary)
                    .frame(width: 13, height: 13)
                    .background(Circle().fill(isToday ? palette.accent : Color.clear))
            }
        }
    }
}

struct TodoCalendarWidget: Widget {
    let kind: String = "TodoCalendarWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CalendarProvider()) { entry in
            CalendarWidgetEntryView(entry: entry)
                .containerBackground(for: .widget) {
                    WidgetCardBackground()
                }
        }
        .configurationDisplayName("Calendar")
        .description("Your events and tasks with a time, today and next.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}
