import ActivityKit
import WidgetKit
import SwiftUI

// Shown on the Lock Screen and in the Dynamic Island while a focus session is
// running — see docs/arch/focus-sessions.md and
// src/utils/focusLiveActivity.ts, which is the only thing that starts or ends
// this. Third of the three activities, after TimerLiveActivity and
// TripLiveActivity, and it borrows both of their layouts.
//
// **It draws two states, and `context.isStale` is what picks between them.**
// The bridge module hands ActivityKit the current step's own end as the
// stale date, so the flag flips at the moment the step runs out with nothing
// pushed to this — which is the whole reason the session's central rule
// survives the trip to the Lock Screen. Before the step runs out: a countdown,
// and a Pause button. After: the same figure counting *up* as an over-run, in
// orange, and a button that moves to the next step. A step that reaches zero
// still doesn't advance on its own; it waits, here as in the app.
//
// A paused session draws neither clock — `pausedRemaining` is a frozen string
// computed JS-side, since there's nothing for SwiftUI to tick — and its
// button says Resume.
//
// Every button is a `Link`, never an AppIntent, for the reason
// TimerLiveActivity.swift's header spells out at length: a Live Activity
// button's intent runs in the background only and cannot bring the app
// forward. All of them are `dundundun://focus?do=…`, handled in
// src/utils/deepLinks.ts, which applies the action and opens the session
// sheet. Interactive controls work in the Lock Screen presentation and the
// *expanded* island regions only, so the button appears in those two places.

@available(iOS 17.0, *)
private struct FocusActionButton: View {
    let attributes: FocusActivityAttributes
    let isStale: Bool
    let palette: WidgetPalette

    private var label: String {
        isStale && !attributes.paused ? attributes.advanceLabel : attributes.primaryLabel
    }

    private var symbol: String {
        if isStale && !attributes.paused { return "arrow.forward" }
        return attributes.paused ? "play.fill" : "pause.fill"
    }

    // The bare scheme is a safe fallback rather than a force-unwrap: these
    // strings are written by focusLiveActivity.ts and always parse, but a
    // Live Activity that crashed on a malformed one would take the Lock
    // Screen presentation down with it.
    private var destination: URL {
        let raw = isStale && !attributes.paused ? attributes.advanceUrl : attributes.primaryUrl
        return URL(string: raw) ?? URL(string: "dundundun://focus")!
    }

    var body: some View {
        Link(destination: destination) {
            HStack(spacing: 5) {
                Image(systemName: symbol)
                    .font(.system(size: 11, weight: .bold))
                Text(label)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
            }
            .foregroundColor(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Capsule().fill(isStale && !attributes.paused ? palette.orange : palette.accent))
        }
    }
}

@available(iOS 17.0, *)
private struct FocusClockView: View {
    let attributes: FocusActivityAttributes
    let isStale: Bool
    var font: Font = .system(size: 15, weight: .semibold).monospacedDigit()
    var color: Color = .white

    var body: some View {
        Group {
            if attributes.paused {
                Text(attributes.pausedRemaining)
            } else if isStale {
                // Counting up from the step's target, signed the way FocusBar
                // and the session sheet sign it. An HStack rather than
                // `Text("+") + Text(_:style:)`: a date-style Text renders
                // specially and doesn't survive concatenation.
                HStack(spacing: 0) {
                    Text("+")
                    Text(attributes.targetEndAt, style: .timer)
                }
            } else {
                // Re-sorted defensively even though focusLiveActivity.ts
                // already clamps targetEndAt >= startedAt — an inverted
                // ClosedRange is a crash, not a rendering glitch, and this is
                // the one place nothing catches that but Swift's own
                // precondition. Same guard TimerClockView keeps.
                let lower = min(attributes.startedAt, attributes.targetEndAt)
                let upper = max(attributes.startedAt, attributes.targetEndAt)
                Text(timerInterval: lower...upper, countsDown: true)
            }
        }
        .font(font)
        .foregroundColor(color)
        .multilineTextAlignment(.center)
    }
}

@available(iOS 17.0, *)
private struct FocusLockScreenView: View {
    let context: ActivityViewContext<FocusActivityAttributes>
    @Environment(\.colorScheme) var colorScheme

    var body: some View {
        let palette = WidgetPalette.forScheme(colorScheme)
        let overrun = context.isStale && !context.attributes.paused
        let tint = overrun ? palette.orange : palette.accent

        HStack(spacing: 12) {
            Image(systemName: context.attributes.symbolName)
                .font(.system(size: 17))
                .foregroundColor(tint)
                .frame(width: 34, height: 34)
                .background(Circle().fill(tint.opacity(0.15)))

            VStack(alignment: .leading, spacing: 2) {
                Text(context.attributes.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(palette.text)
                    .lineLimit(2)

                HStack(spacing: 6) {
                    Text(context.attributes.subtitle)
                        .font(.system(size: 12))
                        .foregroundColor(palette.textSecondary)
                    FocusClockView(
                        attributes: context.attributes,
                        isStale: context.isStale,
                        font: .system(size: 12).monospacedDigit(),
                        color: overrun ? palette.orange : palette.textSecondary
                    )
                }
            }

            Spacer(minLength: 8)

            FocusActionButton(
                attributes: context.attributes,
                isStale: context.isStale,
                palette: palette
            )
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

@available(iOS 17.0, *)
struct FocusLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FocusActivityAttributes.self) { context in
            FocusLockScreenView(context: context)
                .activityBackgroundTint(WidgetPalette.dark.bgSecondary)
                .activitySystemActionForegroundColor(WidgetPalette.dark.text)
                .widgetURL(URL(string: "dundundun://focus"))
        } dynamicIsland: { context in
            // The island is always drawn on black regardless of system
            // appearance, same reasoning as the other two activities.
            let palette = WidgetPalette.dark
            let overrun = context.isStale && !context.attributes.paused
            let tint = overrun ? palette.orange : palette.accent

            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: context.attributes.symbolName)
                        .font(.system(size: 20))
                        .foregroundColor(tint)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    FocusClockView(
                        attributes: context.attributes,
                        isStale: context.isStale,
                        font: .system(size: 15, weight: .semibold).monospacedDigit(),
                        color: overrun ? palette.orange : palette.text
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
                        Text(context.attributes.subtitle)
                            .font(.system(size: 11))
                            .foregroundColor(palette.textSecondary)
                            .lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    FocusActionButton(
                        attributes: context.attributes,
                        isStale: context.isStale,
                        palette: palette
                    )
                    .padding(.top, 2)
                }
            } compactLeading: {
                Image(systemName: context.attributes.symbolName)
                    .foregroundColor(tint)
            } compactTrailing: {
                // Same maxWidth/scale reasoning as TimerLiveActivity's
                // compactTrailing: a step's clock switches to h:mm:ss past an
                // hour, which doesn't fit the 44 the digits alone would want.
                FocusClockView(
                    attributes: context.attributes,
                    isStale: context.isStale,
                    font: .system(size: 13).monospacedDigit(),
                    color: overrun ? palette.orange : palette.textSecondary
                )
                .frame(maxWidth: 64)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            } minimal: {
                Image(systemName: context.attributes.symbolName)
                    .foregroundColor(tint)
            }
            // Tapping anywhere non-interactive opens the session sheet, the
            // same link the Lock Screen presentation above uses.
            .widgetURL(URL(string: "dundundun://focus"))
            .keylineTint(tint)
        }
    }
}
