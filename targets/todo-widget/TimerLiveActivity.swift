import ActivityKit
import WidgetKit
import SwiftUI

// Shown on the Lock Screen and in the Dynamic Island while a task's timer or
// a recipe's cook/prep timer is running (Task.timerStartedAt /
// Recipe.timerStartedAt / Recipe.prepTimerStartedAt) — see
// src/utils/liveActivity.ts, which is the only thing that starts, ends, or
// tells this what to render. This view has no idea a timer was paused; it
// only knows the activity for that key stopped existing.

// The Done button. This used to be an AppIntent (CompleteTaskIntent /
// StopCookingTimerIntent, the same ones the Today widget's checkbox still
// uses) with openAppWhenRun set, on the assumption that tapping it would
// both run the intent and bring the app forward the way the widget's
// checkbox does — it doesn't. Apple's own guidance (confirmed on the
// developer forums) is that a Live Activity button's intent runs in the
// background only; there is no way for it to open the containing app, so the
// button silently did nothing. A plain deep link is what already reliably
// opens the app from a Live Activity — every non-interactive tap on this
// activity, and the whole of TripLiveActivity.swift, already goes through
// one — so the Done button is one too: `dundundun://completeTask?id=<id>`
// for a task, `dundundun://stopTimer?key=<key>` for a recipe's cook/prep
// timer, both handled in src/utils/deepLinks.ts.
//
// Interactive controls only work in the Lock Screen presentation and the
// *expanded* Dynamic Island regions — compactLeading/compactTrailing/minimal
// are non-interactive, so this button only ever appears in those two places.
@available(iOS 17.0, *)
private struct TimerDoneButton: View {
    let attributes: TimerActivityAttributes
    let palette: WidgetPalette

    private var doneURL: URL {
        var components = URLComponents()
        components.scheme = "dundundun"
        if attributes.kind == "task" {
            components.host = "completeTask"
            components.queryItems = [URLQueryItem(name: "id", value: attributes.itemId)]
        } else {
            components.host = "stopTimer"
            components.queryItems = [URLQueryItem(name: "key", value: attributes.key)]
        }
        // Only fails if scheme/host is empty, which they never are above.
        return components.url!
    }

    var body: some View {
        Link(destination: doneURL) { label }
    }

    private var label: some View {
        HStack(spacing: 5) {
            Image(systemName: "checkmark")
                .font(.system(size: 11, weight: .bold))
            Text("Done")
                .font(.system(size: 13, weight: .semibold))
        }
        .foregroundColor(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Capsule().fill(palette.accent))
    }
}

// A live counter with no ContentState updates at all: SwiftUI ticks
// `Text(timerInterval:)`/`Text(_:style:.timer)` on its own from the static
// attributes below (set once, at request time — see
// TimerActivityAttributes' header for why nothing here is ever pushed an
// update). The range is re-sorted defensively even though
// src/utils/liveActivity.ts already clamps targetEndAt >= startedAt — an
// inverted ClosedRange is a crash, not a rendering glitch, and this is the
// one place nothing catches that but Swift's own precondition.
@available(iOS 17.0, *)
private struct TimerClockView: View {
    let attributes: TimerActivityAttributes
    var font: Font = .system(size: 15, weight: .semibold).monospacedDigit()
    var color: Color = .white

    var body: some View {
        Group {
            if attributes.hasTarget {
                let lower = min(attributes.startedAt, attributes.targetEndAt)
                let upper = max(attributes.startedAt, attributes.targetEndAt)
                Text(timerInterval: lower...upper, countsDown: true)
            } else {
                Text(attributes.startedAt, style: .timer)
            }
        }
        .font(font)
        .foregroundColor(color)
        .multilineTextAlignment(.center)
    }
}

@available(iOS 17.0, *)
private struct TimerLockScreenView: View {
    let context: ActivityViewContext<TimerActivityAttributes>

    var body: some View {
        // Pinned to the dark palette rather than read off \.colorScheme:
        // the activityBackgroundTint below makes this card dark in every
        // appearance, so light-scheme content would be black on #1C1C1E. See
        // WidgetPalette.forScheme's own note.
        let palette = WidgetPalette.dark
        HStack(spacing: 12) {
            Image(systemName: context.attributes.symbolName)
                .font(.system(size: 17))
                .foregroundColor(palette.accent)
                .frame(width: 34, height: 34)
                .background(Circle().fill(palette.accent.opacity(0.15)))

            VStack(alignment: .leading, spacing: 2) {
                Text(context.attributes.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(palette.text)
                    .lineLimit(2)

                HStack(spacing: 6) {
                    if !context.attributes.subtitle.isEmpty {
                        Text(context.attributes.subtitle)
                            .font(.system(size: 12))
                            .foregroundColor(palette.textSecondary)
                    }
                    TimerClockView(
                        attributes: context.attributes,
                        font: .system(size: 12).monospacedDigit(),
                        color: palette.textSecondary
                    )
                }
            }

            Spacer(minLength: 8)

            TimerDoneButton(attributes: context.attributes, palette: palette)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

@available(iOS 17.0, *)
struct TimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TimerActivityAttributes.self) { context in
            TimerLockScreenView(context: context)
                .activityBackgroundTint(WidgetPalette.dark.bgSecondary)
                .activitySystemActionForegroundColor(WidgetPalette.dark.text)
        } dynamicIsland: { context in
            // The island is always drawn on black regardless of system
            // appearance, and the Lock Screen presentation above pins to the
            // same palette for its own reason — so nothing in this file reads
            // \.colorScheme.
            let palette = WidgetPalette.dark

            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: context.attributes.symbolName)
                        .font(.system(size: 20))
                        .foregroundColor(palette.accent)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    TimerClockView(
                        attributes: context.attributes,
                        font: .system(size: 15, weight: .semibold).monospacedDigit(),
                        color: palette.text
                    )
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 2) {
                        Text(context.attributes.title)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(palette.text)
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                        if !context.attributes.subtitle.isEmpty {
                            Text(context.attributes.subtitle)
                                .font(.system(size: 11))
                                .foregroundColor(palette.textSecondary)
                                .lineLimit(1)
                        }
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    TimerDoneButton(attributes: context.attributes, palette: palette)
                        .padding(.top, 2)
                }
            } compactLeading: {
                Image(systemName: context.attributes.symbolName)
                    .foregroundColor(palette.accent)
            } compactTrailing: {
                // maxWidth 44 only fits mm:ss (e.g. "12:34"). Text(timerInterval:)
                // switches to h:mm:ss once a run passes an hour ("4:08:22"), which
                // doesn't fit and was getting clipped to "4:08:…". Widen the frame
                // to fit that format and let minimumScaleFactor shrink the digits
                // rather than truncate if it's ever still too tight.
                TimerClockView(
                    attributes: context.attributes,
                    font: .system(size: 13).monospacedDigit(),
                    color: palette.textSecondary
                )
                .frame(maxWidth: 64)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            } minimal: {
                Image(systemName: context.attributes.symbolName)
                    .foregroundColor(palette.accent)
            }
            // Tapping anywhere non-interactive opens the app — same scheme
            // the Today widget uses (TodoTodayWidget.swift).
            .widgetURL(URL(string: "dundundun://"))
            .keylineTint(palette.accent)
        }
    }
}
