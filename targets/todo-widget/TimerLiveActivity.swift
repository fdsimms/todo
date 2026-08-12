import ActivityKit
import WidgetKit
import SwiftUI
import AppIntents

// Shown on the Lock Screen and in the Dynamic Island while a task's timer or
// a recipe's cook/prep timer is running (Task.timerStartedAt /
// Recipe.timerStartedAt / Recipe.prepTimerStartedAt) — see
// src/utils/liveActivity.ts, which is the only thing that starts, ends, or
// tells this what to render. This view has no idea a timer was paused; it
// only knows the activity for that key stopped existing.

// The Done button. For a task (kind == "task") this reuses CompleteTaskIntent
// verbatim — the same intent the Today widget's checkbox and the old
// link-tap activity used — so tapping it queues the id into the App Group
// completion queue and opens the app, which drains it via the real
// completeTask(). A recipe has no "complete" the same way, so for kind ==
// "cook"/"prep" this reuses StopCookingTimerIntent instead, which logs the
// elapsed time the same way tapping Stop in the app does.
//
// Interactive controls only work in the Lock Screen presentation and the
// *expanded* Dynamic Island regions — compactLeading/compactTrailing/minimal
// are non-interactive, so this button only ever appears in those two places.
@available(iOS 17.0, *)
private struct TimerDoneButton: View {
    let attributes: TimerActivityAttributes
    let palette: WidgetPalette

    var body: some View {
        Group {
            if attributes.kind == "task" {
                Button(intent: CompleteTaskIntent(taskId: attributes.itemId)) { label }
            } else {
                Button(intent: StopCookingTimerIntent(runKey: attributes.key)) { label }
            }
        }
        .buttonStyle(.plain)
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
    @Environment(\.colorScheme) var colorScheme

    var body: some View {
        let palette = WidgetPalette.forScheme(colorScheme)
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
            // appearance, so this pins to the dark palette rather than
            // reading \.colorScheme the way the Lock Screen view does.
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
