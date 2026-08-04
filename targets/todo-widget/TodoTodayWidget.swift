import WidgetKit
import SwiftUI
import AppIntents

struct TodoEntry: TimelineEntry {
    let date: Date
    let result: WidgetLoadResult
    let pendingCompletionIds: Set<String>
}

struct TodoTodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodoEntry {
        TodoEntry(date: Date(), result: .noSnapshotYet, pendingCompletionIds: [])
    }

    func getSnapshot(in context: Context, completion: @escaping (TodoEntry) -> Void) {
        completion(TodoEntry(date: Date(), result: loadWidgetSnapshot(), pendingCompletionIds: loadPendingCompletionIds()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodoEntry>) -> Void) {
        let entry = TodoEntry(date: Date(), result: loadWidgetSnapshot(), pendingCompletionIds: loadPendingCompletionIds())
        // The app calls WidgetCenter.reloadAllTimelines() after every task
        // mutation (and CompleteTaskIntent does the same), so this fallback
        // only matters if the app hasn't been opened in a while.
        let nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

struct TaskRowView: View {
    let task: WidgetTask
    let palette: WidgetPalette
    let isPendingCompletion: Bool

    var body: some View {
        HStack(spacing: 8) {
            if task.priority > 0 {
                Rectangle()
                    .fill(priorityColor(task.priority))
                    .frame(width: 3)
                    .padding(.vertical, 3)
            }

            Button(intent: CompleteTaskIntent(taskId: task.id)) {
                ZStack {
                    Circle()
                        .stroke(palette.separator, lineWidth: 2)
                    if isPendingCompletion {
                        Circle()
                            .fill(palette.accent)
                        Image(systemName: "checkmark")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundColor(.white)
                    }
                }
                .frame(width: 16, height: 16)
                // Padding here (not on the row) widens the actual tap
                // target beyond the visible circle without affecting layout.
                .padding(6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Text(task.title)
                .font(.system(size: 12))
                .foregroundColor(isPendingCompletion ? palette.textTertiary : palette.text)
                .strikethrough(isPendingCompletion)
                .lineLimit(1)
                .truncationMode(.tail)

            if task.focused && !isPendingCompletion {
                Image(systemName: "star.fill")
                    .foregroundColor(Color(hex: "FF9F0A"))
                    .font(.system(size: 8))
            }
        }
        .padding(.leading, 10)
        .padding(.trailing, 6)
        .padding(.vertical, 1)
    }
}

// Shown only while at least one checkbox tap is queued but not yet applied
// (see CompleteTaskIntent.swift). Tapping it opens the app via
// SyncPendingCompletionsIntent, which is what actually runs completeTask()
// for real — recurrence, streaks, and chains all need the JS app running.
struct PendingSyncBar: View {
    let count: Int
    let palette: WidgetPalette

    var body: some View {
        Button(intent: SyncPendingCompletionsIntent()) {
            HStack(spacing: 4) {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 10, weight: .semibold))
                Text(count == 1 ? "Tap to sync 1 completed task" : "Tap to sync \(count) completed tasks")
                    .font(.system(size: 11, weight: .medium))
            }
            .foregroundColor(palette.accent)
            .frame(maxWidth: .infinity)
            .padding(.top, 6)
            .padding(.bottom, 10)
        }
        .buttonStyle(.plain)
    }
}

struct TodoTodayWidgetEntryView: View {
    var entry: TodoTodayProvider.Entry
    @Environment(\.colorScheme) var colorScheme

    var emptyStateMessage: String {
        switch entry.result {
        case .noAppGroupAccess: return "Can't access shared data (App Group)"
        case .noSnapshotYet: return "Open the app to get started"
        case .decodeFailed: return "Couldn't read task data"
        case .success: return "All clear"
        }
    }

    var body: some View {
        let palette = WidgetPalette.forScheme(colorScheme)
        let snapshot: WidgetSnapshot? = {
            if case .success(let snapshot) = entry.result { return snapshot }
            return nil
        }()
        let allTasks = snapshot?.visibleTasks ?? []
        // Two columns of up to 4 rows each fit the medium widget's fixed
        // height without the last row getting clipped.
        let shown = Array(allTasks.prefix(8))
        let leftColumn = Array(shown.prefix(4))
        let rightColumn = Array(shown.dropFirst(4))
        let remaining = max(0, allTasks.count - entry.pendingCompletionIds.count)

        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Image(systemName: "sun.max.fill")
                    .foregroundColor(Color(hex: "FF9F0A"))
                    .font(.system(size: 12))
                Text("Today")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(palette.textSecondary)
                Spacer()
                Text("\(remaining) tasks")
                    .font(.system(size: 12))
                    .foregroundColor(palette.textSecondary)
            }
            .padding(.horizontal, 14)
            .padding(.top, 20)
            .padding(.bottom, 8)

            if allTasks.isEmpty {
                Spacer()
                HStack {
                    Spacer()
                    Text(emptyStateMessage)
                        .font(.system(size: 14))
                        .foregroundColor(palette.textTertiary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 20)
                    Spacer()
                }
                Spacer()
            } else {
                HStack(alignment: .top, spacing: 0) {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(leftColumn) { task in
                            TaskRowView(
                                task: task,
                                palette: palette,
                                isPendingCompletion: entry.pendingCompletionIds.contains(task.id)
                            )
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    if !rightColumn.isEmpty {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(rightColumn) { task in
                                TaskRowView(
                                    task: task,
                                    palette: palette,
                                    isPendingCompletion: entry.pendingCompletionIds.contains(task.id)
                                )
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                if !entry.pendingCompletionIds.isEmpty {
                    PendingSyncBar(count: entry.pendingCompletionIds.count, palette: palette)
                } else {
                    Spacer(minLength: 0)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(URL(string: "dundundun://"))
    }
}

struct TodoTodayWidget: Widget {
    let kind: String = "TodoTodayWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TodoTodayProvider()) { entry in
            TodoTodayWidgetEntryView(entry: entry)
                .containerBackground(for: .widget) {
                    Color(UIColor.secondarySystemGroupedBackground)
                }
        }
        .configurationDisplayName("Today")
        .description("Your tasks for today.")
        .supportedFamilies([.systemMedium])
    }
}
