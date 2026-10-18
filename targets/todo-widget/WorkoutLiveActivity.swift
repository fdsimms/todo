import ActivityKit
import WidgetKit
import SwiftUI

// Shown on the Lock Screen and in the Dynamic Island while a workout is in
// progress — see docs/arch/workouts.md ("Phase 6, as built") and
// src/utils/workoutLiveActivity.ts, which writes every word drawn here. The
// approved mock is docs/arch/workouts-mocks/workout-live-activity.png.
//
// **Everything drawn is the ContentState**, which the bridge updates in place
// as the workout moves (the one kind in the app that is updated rather than
// restarted; see WorkoutActivityAttributes.swift). The attributes hold only the
// session and when it started, which the clock during a set counts from.
//
// Three states. `set`: the exercise, "Set 3 of 4 · 82.5 kg × 8", the time
// since the workout started, and Done set. `rest`: "Rest", what is next, a
// countdown, +30 s and Skip rest. And "Rest is over", which is no phase of its
// own: it is the rest once `context.isStale` flips at the rest's end (the stale
// date), or once the bridge has written `restOver`. It counts *up* in orange
// and offers Done set for the set that is next, the way FocusLiveActivity draws
// an over-run step. A rest that runs out still moves nothing on.
//
// Every button is a `Link`, never an AppIntent, for the reason
// TimerLiveActivity.swift's header gives: a Live Activity button's intent runs
// in the background only and cannot bring the app forward. They are all
// `dundundun://workout?do=…`, handled in src/utils/deepLinks.ts, which applies
// the action only if the workout is still where this card says it is, then
// opens workout mode. Interactive controls work on the Lock Screen and in the
// *expanded* island only, so the buttons appear in those two places.

@available(iOS 17.0, *)
private struct WorkoutButton: View {
    let label: String
    let url: String
    let symbol: String
    let fill: Color
    let ink: Color

    // The bare link is a safe fallback rather than a force-unwrap of the
    // payload's string: a Live Activity that crashed on a malformed one would
    // take the Lock Screen presentation down with it.
    private var destination: URL {
        URL(string: url) ?? URL(string: "dundundun://workout")!
    }

    var body: some View {
        Link(destination: destination) {
            HStack(spacing: 5) {
                if !symbol.isEmpty {
                    Image(systemName: symbol)
                        .font(.system(size: 11, weight: .bold))
                }
                Text(label)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
            }
            .foregroundColor(ink)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Capsule().fill(fill))
        }
    }
}

// The buttons for the state on screen: the over state's one, or the quiet
// secondary beside the gold primary. Ink on the gold and the orange alike,
// as FocusActionButton has it; text on the quiet one.
@available(iOS 17.0, *)
private struct WorkoutButtons: View {
    let state: WorkoutActivityAttributes.ContentState
    let over: Bool
    let palette: WidgetPalette

    var body: some View {
        HStack(spacing: 6) {
            if over {
                if !state.overLabel.isEmpty {
                    WorkoutButton(label: state.overLabel, url: state.overUrl, symbol: state.overSymbol, fill: palette.orange, ink: palette.onBrand)
                }
            } else {
                if !state.secondaryLabel.isEmpty {
                    WorkoutButton(label: state.secondaryLabel, url: state.secondaryUrl, symbol: "", fill: palette.separator, ink: palette.text)
                }
                if !state.primaryLabel.isEmpty {
                    WorkoutButton(label: state.primaryLabel, url: state.primaryUrl, symbol: state.primarySymbol, fill: palette.brand, ink: palette.onBrand)
                }
            }
        }
    }
}

@available(iOS 17.0, *)
private func workoutHasButtons(_ state: WorkoutActivityAttributes.ContentState, over: Bool) -> Bool {
    over ? !state.overLabel.isEmpty : (!state.primaryLabel.isEmpty || !state.secondaryLabel.isEmpty)
}

// The rest counting down, the rest's over-run counting up, or, during a set,
// the time since the workout started. All three tick on their own from dates
// fixed in the state; nothing is pushed to make them move.
@available(iOS 17.0, *)
private struct WorkoutClockView: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState
    let over: Bool
    var font: Font = .system(size: 15, weight: .semibold).monospacedDigit()
    var color: Color = .white

    var body: some View {
        Group {
            if state.phase == "rest", let end = state.restEndsAt {
                if over {
                    // Signed the way workout mode's footer signs it. An HStack
                    // rather than `Text("+") + Text(_:style:)`: a date-style Text
                    // renders specially and doesn't survive concatenation.
                    HStack(spacing: 0) {
                        Text("+")
                        Text(end, style: .timer)
                    }
                } else {
                    // Re-sorted defensively even though workoutLiveActivity.ts
                    // already clamps the end to never precede the start: an
                    // inverted ClosedRange is a crash, not a rendering glitch.
                    // Same guard TimerClockView and FocusClockView keep.
                    let start = state.restStartedAt ?? end
                    let lower = min(start, end)
                    let upper = max(start, end)
                    Text(timerInterval: lower...upper, countsDown: true)
                }
            } else {
                Text(attributes.startedAt, style: .timer)
            }
        }
        .font(font)
        .foregroundColor(color)
        .multilineTextAlignment(.trailing)
    }
}

@available(iOS 17.0, *)
private struct WorkoutLockScreenView: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>

    var body: some View {
        // Pinned to the dark palette rather than read off \.colorScheme, for
        // the reason every activity here gives: the background tint below makes
        // the card dark in every appearance. See WidgetPalette.forScheme.
        let palette = WidgetPalette.dark
        let state = context.state
        let resting = state.phase == "rest"
        let over = resting && (state.restOver || context.isStale)
        let tint = over ? palette.orange : palette.brand

        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Image(systemName: resting ? "timer" : "dumbbell.fill")
                    .font(.system(size: 17))
                    .foregroundColor(tint)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(tint.opacity(0.15)))

                VStack(alignment: .leading, spacing: 2) {
                    Text(over ? state.overTitle : state.title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(palette.text)
                        .lineLimit(1)
                    Text(state.subtitle)
                        .font(.system(size: 12).monospacedDigit())
                        .foregroundColor(palette.textSecondary)
                        .lineLimit(2)
                }
                .layoutPriority(1)

                Spacer(minLength: 8)

                // The countdown is the thing to read while resting, so it is
                // the large figure; during a set the workout's running time is
                // only context, so it is smaller and dimmer.
                WorkoutClockView(
                    attributes: context.attributes,
                    state: state,
                    over: over,
                    font: resting
                        ? .system(size: 20, weight: .semibold).monospacedDigit()
                        : .system(size: 15, weight: .semibold).monospacedDigit(),
                    color: over ? palette.orange : (resting ? palette.text : palette.textSecondary)
                )
                .frame(maxWidth: 96, alignment: .trailing)
            }

            if workoutHasButtons(state, over: over) {
                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    WorkoutButtons(state: state, over: over, palette: palette)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

@available(iOS 17.0, *)
struct WorkoutLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
            WorkoutLockScreenView(context: context)
                .activityBackgroundTint(WidgetPalette.dark.bgSecondary)
                .activitySystemActionForegroundColor(WidgetPalette.dark.text)
                .widgetURL(URL(string: "dundundun://workout"))
        } dynamicIsland: { context in
            // Dark on both presentations, as every activity here is.
            let palette = WidgetPalette.dark
            let state = context.state
            let resting = state.phase == "rest"
            let over = resting && (state.restOver || context.isStale)
            let tint = over ? palette.orange : palette.brand
            let symbol = resting ? "timer" : "dumbbell.fill"

            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: symbol)
                        .font(.system(size: 20))
                        .foregroundColor(tint)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    WorkoutClockView(
                        attributes: context.attributes,
                        state: state,
                        over: over,
                        font: .system(size: 15, weight: .semibold).monospacedDigit(),
                        color: over ? palette.orange : (resting ? palette.text : palette.textSecondary)
                    )
                    .frame(maxWidth: 72, alignment: .trailing)
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 2) {
                        Text(over ? state.overTitle : state.title)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(palette.text)
                            .lineLimit(1)
                            .multilineTextAlignment(.center)
                        Text(state.subtitle)
                            .font(.system(size: 11).monospacedDigit())
                            .foregroundColor(palette.textSecondary)
                            .lineLimit(1)
                            .multilineTextAlignment(.center)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if workoutHasButtons(state, over: over) {
                        WorkoutButtons(state: state, over: over, palette: palette)
                            .padding(.top, 2)
                    }
                }
            } compactLeading: {
                Image(systemName: symbol)
                    .foregroundColor(tint)
            } compactTrailing: {
                // Resting: the countdown, gold, or orange once it has run out.
                // During a set: where you are ("3 / 4"), or the workout's
                // running time when there is no set to name. The maxWidth and
                // scale are TimerLiveActivity's, for a clock past an hour.
                if resting || state.compact.isEmpty {
                    WorkoutClockView(
                        attributes: context.attributes,
                        state: state,
                        over: over,
                        font: .system(size: 13).monospacedDigit(),
                        color: resting ? tint : palette.textSecondary
                    )
                    .frame(maxWidth: 64)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                } else {
                    Text(state.compact)
                        .font(.system(size: 13).monospacedDigit())
                        .foregroundColor(palette.textSecondary)
                        .frame(maxWidth: 64)
                        .minimumScaleFactor(0.7)
                        .lineLimit(1)
                }
            } minimal: {
                Image(systemName: symbol)
                    .foregroundColor(tint)
            }
            // Tapping anywhere non-interactive opens workout mode, the same
            // link the Lock Screen presentation above uses.
            .widgetURL(URL(string: "dundundun://workout"))
            .keylineTint(tint)
        }
    }
}
