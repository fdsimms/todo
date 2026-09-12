import SwiftUI
import WidgetKit

/// The pieces all three home-screen widgets are built from.
///
/// They were one widget's private views until there were three, and the header
/// in particular had to stop being private the moment a second widget wanted
/// the same glyph-plus-title-plus-count line — three hand-rolled copies of a
/// header is exactly the drift `SheetHeaderButton` exists to undo on the app
/// side, one process over.

// ==== Layout ====

/// Every fixed measurement the system-family layouts are built from. They're
/// collected here because they have to add up: the grid is what's left after
/// the header and the padding are taken out of the widget's height, so changing
/// one without looking at the rest is how rows end up clipped off the bottom
/// edge again.
enum WidgetLayout {
    /// Own padding, in place of the container margins the widgets opt out of.
    static let horizontalPadding: CGFloat = 14
    static let topPadding: CGFloat = 12
    static let bottomPadding: CGFloat = 12
    /// The header's own height — the add button, the tallest thing in it.
    static let headerHeight: CGFloat = 22
    /// Gap between the header and the first row.
    static let headerGap: CGFloat = 8
    /// Gap between two columns of rows.
    static let columnGap: CGFloat = 6
    /// A row can't go below the checkbox plus a hairline, or grow tall enough
    /// on a big device that the grid stops reading as a grid.
    static let minRowHeight: CGFloat = 22
    static let maxRowHeight: CGFloat = 30

    /// How many rows one column holds, per family. Medium's four is the number
    /// every other measurement here was tuned against; small is half a medium
    /// with one column, large is roughly twice its height.
    static func rowsPerColumn(for family: WidgetFamily) -> Int {
        switch family {
        case .systemSmall: return 4
        case .systemLarge: return 10
        default: return 4
        }
    }

    /// Splits whatever height is left after the header and padding into
    /// `rows` equal slots. Measured rather than hardcoded because a
    /// medium widget is ~141pt tall on a 4" phone and ~170pt on a Max — a
    /// single row height that fits the tallest clips the shortest.
    static func rowHeight(forWidgetHeight height: CGFloat, rows: Int) -> CGFloat {
        guard rows > 0 else { return minRowHeight }
        let available = height - topPadding - bottomPadding - headerHeight - headerGap
        return min(maxRowHeight, max(minRowHeight, available / CGFloat(rows)))
    }
}

// ==== Header ====

/// The add button: one filled shape with the plus punched *out* of it, rather
/// than a white glyph drawn on top of a filled circle.
///
/// Colour can't be relied on to separate the two. The Home Screen's tinted
/// appearance, StandBy and the system Grayscale colour filter all flatten a
/// widget to a single tone, keeping only the alpha channel — so a white plus
/// over an accent circle collapses into one solid blob and the glyph vanishes.
/// `.widgetAccentable()` doesn't help, because it moves the circle and the
/// glyph into the *same* group. A hole is alpha 0, so it survives every mode:
/// whatever sits behind the button shows through it.
struct AddButtonShape: Shape {
    /// Both are fractions of the circle's diameter, so the glyph scales with
    /// the header height instead of needing a second constant kept in step.
    /// Sized to match the 11pt bold SF `plus` this replaced.
    private let armFraction: CGFloat = 0.45
    private let barFraction: CGFloat = 0.11

    func path(in rect: CGRect) -> Path {
        let diameter = min(rect.width, rect.height)
        let circle = CGRect(
            x: rect.midX - diameter / 2,
            y: rect.midY - diameter / 2,
            width: diameter,
            height: diameter
        )
        let arm = diameter * armFraction
        let bar = diameter * barFraction
        let horizontal = CGRect(
            x: circle.midX - arm / 2, y: circle.midY - bar / 2, width: arm, height: bar
        )
        let vertical = CGRect(
            x: circle.midX - bar / 2, y: circle.midY - arm / 2, width: bar, height: arm
        )
        // Unioned, not added as two overlapping subpaths: an even-odd fill
        // counts the region they share twice and fills it back in, which would
        // leave a square of accent sitting in the middle of the plus.
        let cross = CGPath(
            roundedRect: horizontal, cornerWidth: bar / 2, cornerHeight: bar / 2, transform: nil
        ).union(
            CGPath(roundedRect: vertical, cornerWidth: bar / 2, cornerHeight: bar / 2, transform: nil)
        )

        var path = Path()
        path.addEllipse(in: circle)
        path.addPath(Path(cross))
        return path
    }
}

/// One entry in a header's `shortcutLinks`: a plain SF Symbol, no background,
/// jumping straight to another part of the app.
struct WidgetHeaderShortcut {
    let symbolName: String
    let label: String
    let destination: URL
}

/// One widget's title line: a tinted glyph, a name, an optional count, any
/// shortcut links, and an optional round button on the trailing edge.
struct WidgetHeaderView: View {
    let palette: WidgetPalette
    let symbolName: String
    let symbolColor: Color
    let title: String
    let countLabel: String?
    /// Icon-only buttons to other screens, shown before the add button.
    /// Empty on the widgets and sizes with nothing to offer one — see
    /// `showsShortcuts` at the Today widget's call site.
    let shortcutLinks: [WidgetHeaderShortcut]
    /// Nil leaves the trailing slot empty — the kitchen widget has nothing for
    /// a button to do that its whole-widget tap doesn't already do.
    let actionURL: URL?
    let actionLabel: String

    init(
        palette: WidgetPalette,
        symbolName: String,
        symbolColor: Color,
        title: String,
        countLabel: String?,
        shortcutLinks: [WidgetHeaderShortcut] = [],
        actionURL: URL?,
        actionLabel: String
    ) {
        self.palette = palette
        self.symbolName = symbolName
        self.symbolColor = symbolColor
        self.title = title
        self.countLabel = countLabel
        self.shortcutLinks = shortcutLinks
        self.actionURL = actionURL
        self.actionLabel = actionLabel
    }

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: symbolName)
                .foregroundColor(symbolColor)
                .font(.system(size: 12))
            // layoutPriority for the same reason the task rows have it: the
            // title names the widget, and the count and the buttons beside it
            // are short and fixed. Without it a small family's 158pt row let
            // "11 tasks" and the button claim their width first and the title
            // came out as "T…", which is the one thing the header has to say.
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(palette.textSecondary)
                .lineLimit(1)
                .layoutPriority(1)

            if let countLabel {
                Text(countLabel)
                    .font(.system(size: 12))
                    .foregroundColor(palette.textSecondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            // Each Link is written directly here rather than through a helper
            // view — WidgetKit's static tap-region pass can fail to see a Link
            // nested inside a separate View type, and the app-side symptom is
            // indistinguishable from no link at all: every one of these opened
            // to wherever the app was last left, exactly what a bare app-icon
            // tap does. The add button below has always been a Link written
            // in place for the same reason (see its own comment); this now
            // matches it.
            ForEach(shortcutLinks, id: \.label) { shortcut in
                Link(destination: shortcut.destination) {
                    Image(systemName: shortcut.symbolName)
                        .font(.system(size: 13))
                        .foregroundColor(palette.textSecondary)
                        .frame(width: WidgetLayout.headerHeight, height: WidgetLayout.headerHeight)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(shortcut.label)
            }

            if let actionURL {
                // A Link rather than an AppIntent: there's nothing for the
                // extension to do on its own, the whole point is to land in the
                // app. Sized to the header so the header's height never depends
                // on which of these pieces is showing.
                Link(destination: actionURL) {
                    // See AddButtonShape: the plus is a hole, not a white glyph.
                    AddButtonShape()
                        .fill(palette.accent, style: FillStyle(eoFill: true))
                        .frame(width: WidgetLayout.headerHeight, height: WidgetLayout.headerHeight)
                        .contentShape(Circle())
                }
                // Keeps the button in the accent group, so a tinted Home Screen
                // renders it a step brighter than the text beside it. Safe to do
                // now that the plus reads by shape rather than by colour.
                .widgetAccentable()
                .accessibilityLabel(actionLabel)
            }
        }
        .frame(height: WidgetLayout.headerHeight)
    }
}

/// The centred line a widget shows when it has nothing to list.
///
/// `maxHeight: .infinity`, not a fixed grid-height box: row heights clamp at
/// `WidgetLayout.maxRowHeight` on most widget sizes, so the grid is shorter
/// than the space actually available below the header. Centering in the fixed
/// box left the leftover to the trailing Spacer alone, which put the text above
/// the widget's true center instead of in it.
struct WidgetEmptyState: View {
    let palette: WidgetPalette
    let message: String

    var body: some View {
        Text(message)
            .font(.system(size: 13))
            .foregroundColor(palette.textTertiary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }
}

/// The chrome every system-family widget shares: header, then content, then the
/// padding that buys the bottom gutter back from `contentMarginsDisabled()`.
struct WidgetFrame<Content: View>: View {
    let header: WidgetHeaderView
    /// True while the content is a fixed-height grid that has to stay put at
    /// the top; an empty state fills the space itself.
    let holdsTop: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // First child of the VStack, not an overlay sibling: there is
            // then nothing below it that can push it down.
            header
            content().padding(.top, WidgetLayout.headerGap)
            if holdsTop { Spacer(minLength: 0) }
        }
        .padding(.horizontal, WidgetLayout.horizontalPadding)
        .padding(.top, WidgetLayout.topPadding)
        .padding(.bottom, WidgetLayout.bottomPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// ==== Rows ====

/// A plain text row, for the widgets whose rows aren't completable.
struct WidgetTextRow: View {
    let palette: WidgetPalette
    let title: String
    /// The short, fixed-width half of the row. Never a button, and never
    /// something that can grow — the title is what the row exists to show, so
    /// it takes the slack (see the same rule in CLAUDE.md's design section).
    let detail: String?
    let detailColor: Color?
    let bulletColor: Color?
    let height: CGFloat

    var body: some View {
        HStack(spacing: 6) {
            if let bulletColor {
                Circle().fill(bulletColor).frame(width: 5, height: 5)
            }
            Text(title)
                .font(.system(size: 12))
                .foregroundColor(palette.text)
                .lineLimit(1)
                .truncationMode(.tail)
                .layoutPriority(1)
            Spacer(minLength: 4)
            if let detail {
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundColor(detailColor ?? palette.textSecondary)
                    .lineLimit(1)
            }
        }
        .frame(height: height)
    }
}

// ==== Accessory families ====

/// The ring the circular Lock Screen accessory draws a fraction in.
struct AccessoryRing: View {
    let fraction: Double
    let label: String
    let caption: String?

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            Circle()
                .stroke(.tertiary, lineWidth: 4)
            Circle()
                .trim(from: 0, to: max(0, min(1, fraction)))
                .stroke(.primary, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: -1) {
                Text(label)
                    .font(.system(size: 15, weight: .semibold))
                if let caption {
                    Text(caption)
                        .font(.system(size: 8))
                        .foregroundStyle(.secondary)
                }
            }
        }
        // The Lock Screen renders accessories as a single-tone vibrant layer, so
        // nothing here sets a colour — `.primary`/`.secondary`/`.tertiary` are
        // what that layer understands, and a hex would be flattened anyway.
        .padding(2)
    }
}

// ==== Deep links ====

/// Opens the app straight into quick add — `dundundun://add` with no title,
/// handled by isQuickAddUrl in src/utils/deepLinks.ts.
let quickAddURL = URL(string: "dundundun://add")!
let openAppURL = URL(string: "dundundun://")!
let groceriesURL = URL(string: "dundundun://groceries")!
let mealPlanURL = URL(string: "dundundun://mealplan")!
let kitchenURL = URL(string: "dundundun://kitchen")!
let moodURL = URL(string: "dundundun://mood")!
let foodLogURL = URL(string: "dundundun://foodlog")!

// ==== Formatting ====

func taskCountLabel(_ count: Int) -> String {
    count == 1 ? "1 task" : "\(count) tasks"
}

/// The trailing detail on a task row: a streak worth mentioning, or nothing.
func taskRowDetail(_ task: WidgetTask) -> String? {
    task.streakCount > 1 ? "\(task.streakCount)" : nil
}

func taskRowDetailSymbol(_ task: WidgetTask) -> String? {
    task.streakCount > 1 ? "flame.fill" : nil
}
