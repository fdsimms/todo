import SwiftUI

// The watch's two pages. Colors are WidgetPalette.dark (TodoWidgetData.swift),
// the app's own dark tokens, since a watch face is always dark.

// ==== Today ====

struct TodayView: View {
    @EnvironmentObject private var store: WatchStore
    let openGroceries: () -> Void
    /// A row whose tap has to happen on the phone, shown as an alert.
    @State private var needsPhone: WidgetTask?

    var body: some View {
        NavigationStack {
            // Re-read every minute: a deferred task reaches Today, and the
            // day turns over, without the phone writing again.
            TimelineView(.everyMinute) { context in
                List {
                    pendingAdds
                    // The workout, at the top while the Workouts area is on
                    // (or one is going here). A pushed screen, not a pager
                    // page, so the Crown stays this list's.
                    if store.workoutVisible {
                        WorkoutTodayRow()
                    }
                    tasks(at: context.date)
                }
                .undoBar()
            }
            .navigationTitle("Today")
            // Add and Groceries sit in the top corners rather than after the
            // list: below twenty tasks, Add was twenty rows of scrolling away,
            // and the pager's swipe to Groceries is something nothing says.
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: openGroceries) {
                        Image(systemName: "cart")
                    }
                    .accessibilityLabel(groceriesLabel)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    TextFieldLink(prompt: Text("New task")) {
                        Image(systemName: "plus")
                            .foregroundStyle(WidgetPalette.dark.accent)
                    } onSubmit: { title in
                        store.add(title)
                    }
                    .accessibilityLabel("Add task")
                }
            }
        }
        .alert(needsPhone.map { NeedsPhoneCopy($0.needsAppReason).title } ?? "", isPresented: needsPhoneShown, presenting: needsPhone) { _ in
            Button("OK", role: .cancel) {}
        } message: { task in
            Text(NeedsPhoneCopy(task.needsAppReason).message)
        }
    }

    private var needsPhoneShown: Binding<Bool> {
        Binding(get: { needsPhone != nil }, set: { if !$0 { needsPhone = nil } })
    }

    private var groceriesLabel: String {
        guard let list = store.snapshot?.groceries?.lists.first else { return "Groceries" }
        let remaining = store.local.remaining(list)
        return remaining > 0 ? "Groceries, \(remaining) left" : "Groceries"
    }

    @ViewBuilder
    private func tasks(at now: Date) -> some View {
        if let snapshot = store.snapshot {
            if snapshot.isStale(at: now) {
                WatchNote(text: "This list is out of date. Open dundundun on your iPhone to refresh it.")
            } else {
                let local = store.local
                let rows = snapshot.todayRows(at: now).filter { !local.isDeferred($0) }
                if rows.isEmpty {
                    WatchNote(text: "Nothing left for today.")
                }
                ForEach(rows) { task in
                    TaskRowView(task: task, done: local.isDone(task), progress: local.progress(task)) {
                        if task.needsApp {
                            needsPhone = task
                        } else {
                            store.tap(task)
                        }
                    }
                    // Moving a task asks nothing, so a row that has to be
                    // checked off on the phone can still go to tomorrow here.
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        if !local.isDone(task) {
                            Button {
                                store.deferToTomorrow(task)
                            } label: {
                                Label("Tomorrow", systemImage: "arrow.turn.up.right")
                            }
                            .tint(WidgetPalette.dark.accent)
                        }
                    }
                }
                let done = snapshot.doneToday(at: now) + rows.filter { local.isDone($0) }.count
                if done > 0 {
                    WatchNote(text: "\(done) done today")
                }
                laterToday(snapshot.laterTodayRows(at: now).filter { !local.isDeferred($0) })
            }
        } else {
            WatchNote(text: "Open dundundun on your iPhone to load your tasks.")
        }
    }

    /// What reaches Today later on: a deferred task, a time window not yet
    /// open. Read only: the watch ticks off only what is on Today, and the
    /// minute timeline moves each one up into the list when its time comes.
    @ViewBuilder
    private func laterToday(_ rows: [WidgetTask]) -> some View {
        if !rows.isEmpty {
            Section("Later today") {
                ForEach(rows.prefix(Self.laterTodayLimit)) { task in
                    LaterTodayRow(task: task)
                }
                if rows.count > Self.laterTodayLimit {
                    WatchNote(text: "\(rows.count - Self.laterTodayLimit) more later today")
                }
            }
        }
    }

    private static let laterTodayLimit = 5

    /// Tasks dictated here and not yet on the phone, at the top so the one
    /// just added is where the eye is when the dictation sheet closes.
    @ViewBuilder
    private var pendingAdds: some View {
        if !store.local.added.isEmpty {
            Section {
                ForEach(Array(store.local.added.enumerated()), id: \.offset) { _, title in
                    Label(title, systemImage: "arrow.up.circle")
                        .foregroundStyle(.secondary)
                }
            } footer: {
                Text("Added to your Inbox when dundundun next opens on your iPhone.")
            }
        }
    }
}

/// What a row that needs the phone says when it's tapped, by the phone's
/// reason for it (`WidgetNeedsAppReason` in the app). A phone too old to send
/// one gets the general line.
struct NeedsPhoneCopy {
    let title: String
    let message: String

    init(_ reason: String?) {
        switch reason {
        case "ask":
            self.init("Finish on iPhone", "This task asks a question when you check it off. Answer it in dundundun on your iPhone.")
        case "timer":
            self.init("Finish on iPhone", "This task offers to set a reminder when you check it off. Check it off in dundundun on your iPhone.")
        case "meal-log":
            self.init("Finish on iPhone", "This task asks what you ate when you check it off. Check it off in dundundun on your iPhone.")
        case "pick":
            self.init("Finish on iPhone", "This task takes turns between several things. Pick the one you did in dundundun on your iPhone.")
        case "pick-meal":
            self.init("Finish on iPhone", "Choose the meal for this task in dundundun on your iPhone.")
        case "review-project":
            self.init("Finish on iPhone", "This task opens a review of its project. Do the review in dundundun on your iPhone.")
        case "start-block":
            self.init("Finish on iPhone", "This task starts an app block before it pays out. Start it in dundundun on your iPhone.")
        case "open-log":
            self.init("Finish on iPhone", "This task is checked off by saving an entry. Save it in dundundun on your iPhone.")
        case "slip":
            self.init("Nothing to check off", "This is a habit you're avoiding, so it counts the days you go without it. To log a slip, use dundundun on your iPhone.")
        case "locked":
            self.init("Not due yet", "This task repeats, and its next day hasn't come yet. It can be checked off then.")
        default:
            self.init("Finish on iPhone", "Check this task off in dundundun on your iPhone.")
        }
    }

    private init(_ title: String, _ message: String) {
        self.title = title
        self.message = message
    }
}

struct TaskRowView: View {
    let task: WidgetTask
    let done: Bool
    let progress: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .foregroundStyle(done ? WidgetPalette.dark.done : WidgetPalette.dark.textSecondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(task.title)
                        .strikethrough(done)
                        .lineLimit(3)
                        .foregroundStyle(done ? WidgetPalette.dark.textSecondary : WidgetPalette.dark.text)
                    if let detailText {
                        detailText
                            .font(.footnote)
                            .foregroundStyle(WidgetPalette.dark.textSecondary)
                    }
                }
            }
        }
        .disabled(done)
    }

    private var symbol: String {
        if done { return "checkmark.circle.fill" }
        if task.needsApp { return "iphone" }
        return "circle"
    }

    /// The reminder's clock time, as the app's row and the iPhone widget show
    /// it (dropped once the row is done), then the detail below.
    private var detailText: Text? {
        let reminder = done ? nil : task.reminderDate
        switch (reminder, detail) {
        case let (time?, detail?): return Text("\(Text(time, style: .time)) · \(detail)")
        case let (time?, nil): return Text(time, style: .time)
        case let (nil, detail?): return Text(detail)
        case (nil, nil): return nil
        }
    }

    /// A target's count, or the calendar event a task was written for.
    private var detail: String? {
        if task.isTarget, let target = task.targetCount {
            let unit = task.targetUnit.map { " \($0)" } ?? ""
            return "\(min(progress, target)) of \(target)\(unit)"
        }
        return task.eventTitle
    }
}

/// A task that reaches Today later on, and when. Not a button: it can't be
/// checked off until it's on Today.
struct LaterTodayRow: View {
    let task: WidgetTask

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "clock")
                .foregroundStyle(WidgetPalette.dark.textSecondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title)
                    .lineLimit(2)
                    .foregroundStyle(WidgetPalette.dark.text)
                if let at = task.visibleAtDate {
                    Text(at, style: .time)
                        .font(.footnote)
                        .foregroundStyle(WidgetPalette.dark.textSecondary)
                }
            }
        }
        .listRowBackground(Color.clear)
        .accessibilityElement(children: .combine)
    }
}

// ==== Groceries ====

struct GroceriesView: View {
    @EnvironmentObject private var store: WatchStore
    let openToday: () -> Void

    var body: some View {
        NavigationStack {
            if let groceries = store.snapshot?.groceries, let first = groceries.lists.first {
                GroceryListView(
                    list: first,
                    tripShopName: groceries.tripShopName,
                    otherLists: Array(groceries.lists.dropFirst()),
                    openToday: openToday
                )
            } else {
                List {
                    WatchNote(text: "Open dundundun on your iPhone to load your grocery list.")
                }
                .undoBar()
                .navigationTitle("Groceries")
                .toolbar { todayButton(openToday) }
            }
        }
    }
}

/// The way back to Today from the top corner, mirroring Today's cart button:
/// the pager has no visible way back on its own.
private func todayButton(_ action: @escaping () -> Void) -> some ToolbarContent {
    ToolbarItem(placement: .topBarLeading) {
        Button(action: action) {
            Image(systemName: "checklist")
        }
        .accessibilityLabel("Today")
    }
}

struct GroceryListView: View {
    @EnvironmentObject private var store: WatchStore
    let list: WidgetGroceryList
    var tripShopName: String? = nil
    var otherLists: [WidgetGroceryList] = []
    /// Set on the first list only (a list pushed from it has a back button
    /// there instead); the pager has no visible way back to Today.
    var openToday: (() -> Void)? = nil
    /// An either/or row, which is chosen (the other options come off) rather than ticked.
    @State private var choiceRow: WidgetGroceryRow?

    var body: some View {
        let rows = store.local.visibleRows(list)
        let adds = store.local.groceryAdds(listId: list.id)
        List {
            // Dictated here and not yet on the phone, at the top for the same
            // reason as Today's.
            if !adds.isEmpty {
                Section {
                    ForEach(Array(adds.enumerated()), id: \.offset) { _, title in
                        Label(title, systemImage: "arrow.up.circle")
                            .foregroundStyle(.secondary)
                    }
                } footer: {
                    Text("Added to the list when dundundun next opens on your iPhone.")
                }
            }
            if let tripShopName {
                WatchNote(text: "Shopping at \(tripShopName)")
            }
            if rows.isEmpty {
                WatchNote(text: "Nothing left to buy.")
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                GroceryRowView(row: row, checked: store.local.isChecked(row, listId: list.id)) {
                    if row.canCheck {
                        store.check(row, listId: list.id)
                    } else if row.choice && !row.id.isEmpty {
                        choiceRow = row
                    }
                }
            }
            if list.remaining > list.rows.count {
                WatchNote(text: "\(list.remaining - list.rows.count) more items aren't shown here.")
            }

            if !otherLists.isEmpty {
                Section("Other lists") {
                    ForEach(Array(otherLists.enumerated()), id: \.offset) { _, other in
                        NavigationLink {
                            GroceryListView(list: other)
                        } label: {
                            HStack {
                                Text(other.name)
                                Spacer()
                                Text("\(store.local.remaining(other))")
                                    .foregroundStyle(WidgetPalette.dark.textSecondary)
                            }
                        }
                    }
                }
            }
        }
        .undoBar()
        .navigationTitle(list.name)
        .toolbar {
            if let openToday {
                todayButton(openToday)
            }
            ToolbarItem(placement: .topBarTrailing) {
                TextFieldLink(prompt: Text("New item")) {
                    Image(systemName: "plus")
                        .foregroundStyle(WidgetPalette.dark.accent)
                } onSubmit: { title in
                    store.addGrocery(title, listId: list.id)
                }
                .accessibilityLabel("Add item")
            }
        }
        .confirmationDialog(
            choiceRow.map { "Choose \($0.name)?" } ?? "",
            isPresented: choiceShown,
            titleVisibility: .visible,
            presenting: choiceRow
        ) { row in
            Button("Choose \(row.name)") {
                store.choose(row, listId: list.id)
            }
            Button("Cancel", role: .cancel) {}
        } message: { row in
            let rest = others(than: row)
            if rest.isEmpty {
                Text("This item stays on the list.")
            } else {
                Text("\(rest.joined(separator: ", ")) will come off the list.")
            }
        }
    }

    private var choiceShown: Binding<Bool> {
        Binding(get: { choiceRow != nil }, set: { if !$0 { choiceRow = nil } })
    }

    /// The other options of the row's either/or still on the list.
    private func others(than row: WidgetGroceryRow) -> [String] {
        guard let group = row.choiceGroup else { return [] }
        return store.local.visibleRows(list)
            .filter { $0.choiceGroup == group && $0.id != row.id }
            .map { $0.name }
    }
}

struct GroceryRowView: View {
    let row: WidgetGroceryRow
    let checked: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .foregroundStyle(checked ? WidgetPalette.dark.done : WidgetPalette.dark.textSecondary)
                Text(row.name)
                    .strikethrough(checked)
                    .lineLimit(2)
                    .foregroundStyle(checked ? WidgetPalette.dark.textSecondary : WidgetPalette.dark.text)
            }
        }
        .disabled(checked)
    }

    private var symbol: String {
        if checked { return "checkmark.circle.fill" }
        if row.choice { return "arrow.triangle.branch" }
        return "circle"
    }
}

// ==== Undo ====

/// The Undo button, pinned under a list while a tap is still being held (see
/// WatchStore.undoWindow). It takes back the most recent one; each press
/// takes back one more while any are held.
struct UndoBar: ViewModifier {
    @EnvironmentObject private var store: WatchStore

    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .bottom) {
            if store.undoableTap != nil {
                Button {
                    store.undoLast()
                } label: {
                    Label("Undo", systemImage: "arrow.uturn.backward")
                }
                .buttonStyle(.borderedProminent)
                .tint(WidgetPalette.dark.accent)
                .accessibilityLabel("Undo the last tap")
            }
        }
    }
}

extension View {
    func undoBar() -> some View {
        modifier(UndoBar())
    }
}

/// A line of secondary text in a list: an empty state, a count, a hint.
struct WatchNote: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(WidgetPalette.dark.textSecondary)
    }
}
