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
                    tasks(at: context.date)
                    addSection
                    groceriesLink
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

    private var groceriesLink: some View {
        Section {
            Button(action: openGroceries) {
                HStack {
                    Label("Groceries", systemImage: "cart")
                    Spacer()
                    if let remaining = store.snapshot?.groceries?.lists.first?.remaining, remaining > 0 {
                        Text("\(remaining)")
                            .foregroundStyle(WidgetPalette.dark.textSecondary)
                    }
                }
            }
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
                    todayLink(openToday)
                }
                .undoBar()
                .navigationTitle("Groceries")
            }
        }
    }
}

private func todayLink(_ action: @escaping () -> Void) -> some View {
    Section {
        Button(action: action) {
            Label("Today", systemImage: "checklist")
        }
    }
}

struct GroceryListView: View {
    @EnvironmentObject private var store: WatchStore
    let list: WidgetGroceryList
    var tripShopName: String? = nil
    var otherLists: [WidgetGroceryList] = []
    /// Set on the first list only; the pager has no visible way back to Today.
    var openToday: (() -> Void)? = nil
    /// An either/or row, which is chosen (the other options come off) rather than ticked.
    @State private var choiceRow: WidgetGroceryRow?

    var body: some View {
        let rows = store.local.visibleRows(list)
        List {
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
            Section {
                TextFieldLink(prompt: Text("New item")) {
                    Label("Add item", systemImage: "plus")
                        .foregroundStyle(WidgetPalette.dark.accent)
                } onSubmit: { title in
                    store.addGrocery(title, listId: list.id)
                }
                ForEach(Array(store.local.groceryAdds(listId: list.id).enumerated()), id: \.offset) { _, title in
                    Label(title, systemImage: "arrow.up.circle")
                        .foregroundStyle(.secondary)
                }
            } footer: {
                if !store.local.groceryAdds(listId: list.id).isEmpty {
                    Text("Added to the list when dundundun next opens on your iPhone.")
                }
            }

            if let openToday {
                todayLink(openToday)
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
