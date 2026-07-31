import WidgetKit
import SwiftUI

struct TodoEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct TodoTodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodoEntry {
        TodoEntry(date: Date(), snapshot: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (TodoEntry) -> Void) {
        completion(TodoEntry(date: Date(), snapshot: loadWidgetSnapshot()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodoEntry>) -> Void) {
        let entry = TodoEntry(date: Date(), snapshot: loadWidgetSnapshot())
        // The app calls WidgetCenter.reloadAllTimelines() after every task
        // mutation, so this fallback only matters if the app hasn't been
        // opened in a while.
        let nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

struct TaskRowView: View {
    let task: WidgetTask
    let palette: WidgetPalette

    var body: some View {
        HStack(spacing: 10) {
            Rectangle()
                .fill(priorityColor(task.priority))
                .frame(width: 3)
                .padding(.vertical, 4)

            Circle()
                .stroke(palette.separator, lineWidth: 2)
                .frame(width: 18, height: 18)

            Text(task.title)
                .font(.system(size: 13))
                .foregroundColor(palette.text)
                .lineLimit(1)

            Spacer()

            if task.focused {
                Image(systemName: "star.fill")
                    .foregroundColor(Color(hex: "FF9F0A"))
                    .font(.system(size: 10))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 5)
    }
}

struct TodoTodayWidgetEntryView: View {
    var entry: TodoTodayProvider.Entry
    @Environment(\.colorScheme) var colorScheme

    var body: some View {
        let palette = WidgetPalette.forScheme(colorScheme)
        let tasks = entry.snapshot?.visibleTasks ?? []

        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Image(systemName: "sun.max.fill")
                    .foregroundColor(Color(hex: "FF9F0A"))
                    .font(.system(size: 12))
                Text("Today")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(palette.textSecondary)
                Spacer()
                Text("\(tasks.count) tasks")
                    .font(.system(size: 12))
                    .foregroundColor(palette.textSecondary)
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 8)

            if tasks.isEmpty {
                Spacer()
                HStack {
                    Spacer()
                    Text(entry.snapshot == nil ? "Open the app to get started" : "All clear")
                        .font(.system(size: 14))
                        .foregroundColor(palette.textTertiary)
                    Spacer()
                }
                Spacer()
            } else {
                ForEach(tasks.prefix(5)) { task in
                    TaskRowView(task: task, palette: palette)
                }
                Spacer(minLength: 0)
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
