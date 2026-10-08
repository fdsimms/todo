import WidgetKit
import SwiftUI
import AppIntents

// The Medications widget: each as-needed medication with a button that records
// the last dose again, the home-screen version of the Medications screen's
// quick button. The button runs LogMedicationIntent (shared into this target
// from the bridge module, see plugins/withWidgetExtension.js), which queues the
// dose and opens the app; the app records it, checks the limit you set and the
// supply, and writes a fresh snapshot back here.
//
// Home screen only, no lock-screen families: a list of what somebody takes is
// health information, and the lock screen is the one surface anybody holding
// the phone can read.

struct MedicationEntry: TimelineEntry {
    let date: Date
    let result: WidgetLoadResult
}

struct MedicationProvider: TimelineProvider {
    func placeholder(in context: Context) -> MedicationEntry {
        MedicationEntry(date: Date(), result: .noSnapshotYet)
    }

    func getSnapshot(in context: Context, completion: @escaping (MedicationEntry) -> Void) {
        completion(MedicationEntry(date: Date(), result: loadWidgetSnapshot()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MedicationEntry>) -> Void) {
        // Nothing here changes with the clock alone except the "last taken"
        // times, which are drawn relative to now; an hourly refresh keeps them
        // close enough, and every dose the app records reloads it anyway.
        let now = Date()
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: now) ?? now
        completion(Timeline(entries: [MedicationEntry(date: now, result: loadWidgetSnapshot())], policy: .after(next)))
    }
}

struct MedicationWidgetEntryView: View {
    var entry: MedicationProvider.Entry
    @Environment(\.colorScheme) var colorScheme
    @Environment(\.widgetFamily) var family

    private var medications: [WidgetMedication] { entry.result.snapshot?.medications ?? [] }

    private var emptyStateMessage: String {
        switch entry.result {
        case .noAppGroupAccess: return "Can't access shared data (App Group)"
        case .noSnapshotYet: return "Open the app to get started"
        case .decodeFailed: return "Couldn't read medication data"
        case .success(let snapshot):
            return snapshot.medications == nil
                ? "Open the app to get started"
                : "Nothing taken as needed yet"
        }
    }

    private func lastTaken(_ iso: String) -> String? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: iso) else { return nil }
        let calendar = Calendar.current
        if calendar.isDate(date, inSameDayAs: entry.date) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }

    var body: some View {
        let palette = WidgetPalette.forScheme(colorScheme)
        let perColumn = WidgetLayout.rowsPerColumn(for: family)
        let columns = family == .systemSmall ? 1 : 2
        let shown = Array(medications.prefix(perColumn * columns))
        let header = WidgetHeaderView(
            palette: palette,
            symbolName: "pills",
            symbolColor: palette.accent,
            title: "Medications",
            countLabel: nil,
            actionURL: nil,
            actionLabel: "Open medications"
        )

        return GeometryReader { geo in
            let rowHeight = WidgetLayout.rowHeight(forWidgetHeight: geo.size.height, rows: perColumn)
            let gridHeight = rowHeight * CGFloat(perColumn)

            WidgetFrame(header: header, holdsTop: !shown.isEmpty) {
                Group {
                    if shown.isEmpty {
                        WidgetEmptyState(palette: palette, message: emptyStateMessage)
                    } else {
                        HStack(alignment: .top, spacing: WidgetLayout.columnGap) {
                            column(Array(shown.prefix(perColumn)), palette: palette, rowHeight: rowHeight)
                            if columns > 1 {
                                column(Array(shown.dropFirst(perColumn)), palette: palette, rowHeight: rowHeight)
                            }
                        }
                        .frame(height: gridHeight, alignment: .top)
                    }
                }
            }
        }
        .widgetURL(medicationsURL)
    }

    private func column(
        _ rows: [WidgetMedication],
        palette: WidgetPalette,
        rowHeight: CGFloat
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(rows) { row in
                MedicationRowView(row: row, detail: lastTaken(row.lastTakenAt), palette: palette, height: rowHeight)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One medication: a round "+" that records the last dose again, the name,
/// and when it was last taken. The name takes the row's slack and the time is
/// the short, fixed half, the rule `WidgetTextRow` keeps.
struct MedicationRowView: View {
    let row: WidgetMedication
    let detail: String?
    let palette: WidgetPalette
    let height: CGFloat

    var body: some View {
        HStack(spacing: 6) {
            Button(intent: LogMedicationIntent(medication: MedicationEntity(id: row.id, name: row.name))) {
                ZStack {
                    Circle().fill(palette.accent.opacity(0.18))
                    Image(systemName: "plus")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(palette.accent)
                }
                .frame(width: 18, height: 18)
                .padding(.horizontal, 5)
                .frame(height: height)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Text(row.name)
                .font(.system(size: 12))
                .foregroundColor(palette.text)
                .lineLimit(1)
                .truncationMode(.tail)
                .layoutPriority(1)
            Spacer(minLength: 4)
            if let detail {
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundColor(palette.textSecondary)
                    .lineLimit(1)
            }
        }
        .frame(height: height)
    }
}

struct TodoMedicationWidget: Widget {
    let kind: String = "TodoMedicationWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MedicationProvider()) { entry in
            MedicationWidgetEntryView(entry: entry)
                .containerBackground(for: .widget) {
                    WidgetCardBackground()
                }
        }
        .configurationDisplayName("Medications")
        .description("Record a dose of something you take as needed.")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
    }
}
