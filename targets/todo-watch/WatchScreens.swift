import SwiftUI

// The watch's two pages. Colors are WidgetPalette.dark (TodoWidgetData.swift),
// the app's own dark tokens, since a watch face is always dark.

// ==== Today ====

struct TodayView: View {
    @EnvironmentObject private var store: WatchStore
    /// A row whose tap has to happen on the phone, shown as an alert.
    @State private var needsPhone: WidgetTask?

    var body: some View {
        NavigationStack {
            // Re-read every minute: a deferred task reaches Today, and the
            // day turns over, without the phone writing again.
            TimelineView(.everyMinute) { context in
                List {
                    tasks(at: context.date)
                    addSection
                }
                .undoBar()
            }
            .navigationTitle("Today")
        }
        .alert("Finish on iPhone", isPresented: needsPhoneShown, presenting: needsPhone) { _ in
            Button("OK", role: .cancel) {}
        } message: { _ in
            Text("This task has a follow-up step, so check it off in dundundun on your iPhone.")
        }
    }

    private var needsPhoneShown: Binding<Bool> {
        Binding(get: { needsPhone != nil }, set: { if !$0 { needsPhone = nil } })
    }

    @ViewBuilder
    private func tasks(at now: Date) -> some View {
        if let snapshot = store.snapshot {
            if snapshot.isStale(at: now) {
                WatchNote(text: "This list is out of date. Open dundundun on your iPhone to refresh it.")
            } else {
                let rows = snapshot.todayRows(at: now)
                let local = store.local
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
                }
                let done = snapshot.doneToday(at: now) + rows.filter { local.isDone($0) }.count
                if done > 0 {
                    WatchNote(text: "\(done) done today")
                }
            }
        } else {
            WatchNote(text: "Open dundundun on your iPhone to load your tasks.")
        }
    }

    private var addSection: some View {
        Section {
            TextFieldLink(prompt: Text("New task")) {
                Label("Add task", systemImage: "plus")
                    .foregroundStyle(WidgetPalette.dark.accent)
            } onSubmit: { title in
                store.add(title)
            }
            ForEach(Array(store.local.added.enumerated()), id: \.offset) { _, title in
                Label(title, systemImage: "arrow.up.circle")
                    .foregroundStyle(.secondary)
            }
        } footer: {
            if !store.local.added.isEmpty {
                Text("Added to your Inbox when dundundun next opens on your iPhone.")
            }
        }
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
                    if let detail {
                        Text(detail)
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

    /// A target's count, or the calendar event a task was written for.
    private var detail: String? {
        if task.isTarget, let target = task.targetCount {
            let unit = task.targetUnit.map { " \($0)" } ?? ""
            return "\(min(progress, target)) of \(target)\(unit)"
        }
        return task.eventTitle
    }
}

// ==== Groceries ====

struct GroceriesView: View {
    @EnvironmentObject private var store: WatchStore

    var body: some View {
        NavigationStack {
            if let groceries = store.snapshot?.groceries, let first = groceries.lists.first {
                GroceryListView(
                    list: first,
                    tripShopName: groceries.tripShopName,
                    otherLists: Array(groceries.lists.dropFirst())
                )
            } else {
                List {
                    WatchNote(text: "Open dundundun on your iPhone to load your grocery list.")
                }
                .undoBar()
                .navigationTitle("Groceries")
            }
        }
    }
}

struct GroceryListView: View {
    @EnvironmentObject private var store: WatchStore
    let list: WidgetGroceryList
    var tripShopName: String? = nil
    var otherLists: [WidgetGroceryList] = []
    /// An either/or row, which is chosen on the phone rather than ticked.
    @State private var choiceRow: WidgetGroceryRow?

    var body: some View {
        List {
            if let tripShopName {
                WatchNote(text: "Shopping at \(tripShopName)")
            }
            if list.rows.isEmpty {
                WatchNote(text: "Nothing left to buy.")
            }
            ForEach(Array(list.rows.enumerated()), id: \.offset) { _, row in
                GroceryRowView(row: row, checked: store.local.isChecked(row, listId: list.id)) {
                    if row.canCheck {
                        store.check(row, listId: list.id)
                    } else {
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
                                Text("\(other.remaining)")
                                    .foregroundStyle(WidgetPalette.dark.textSecondary)
                            }
                        }
                    }
                }
            }
        }
        .undoBar()
        .navigationTitle(list.name)
        .alert("Choose on iPhone", isPresented: choiceShown, presenting: choiceRow) { _ in
            Button("OK", role: .cancel) {}
        } message: { _ in
            Text("This item is one of a choice. Pick which one in dundundun on your iPhone.")
        }
    }

    private var choiceShown: Binding<Bool> {
        Binding(get: { choiceRow != nil }, set: { if !$0 { choiceRow = nil } })
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
