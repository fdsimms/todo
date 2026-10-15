import ActivityKit
import WidgetKit
import SwiftUI

// Shown on the Lock Screen and in the Dynamic Island before an event with a
// location: a countdown to the moment to leave. Started and ended only by
// src/utils/leaveLiveActivity.ts, from the live "Leave for X" task, so it
// ends when that task is finished. Tapping opens Today scrolled to that task
// (`leaveURL`); there is no button, because finishing the task is the way to
// end it and that needs the app anyway (see TripLiveActivity's Finish note).
//
// **It draws two states, and `context.isStale` picks between them**, the way
// TripLiveActivity's does. The bridge hands ActivityKit the leave-by time as
// the stale date, so the flag flips then with nothing pushed. Before: "Leave
// in" and a countdown. After: "Time to leave" and the time the event starts,
// with no clock. An activity started after the leave-by time has passed is
// stale from the first frame (`leaveAt <= Date()` covers the second before
// the flag flips), so a countdown range that would run backwards is never
// built: `Text(timerInterval:)` needs `start <= end`.

@available(iOS 17.0, *)
private func isTimeToLeave(_ context: ActivityViewContext<LeaveActivityAttributes>) -> Bool {
    context.isStale || context.attributes.leaveAt <= Date()
}

// `dundundun://task?id=…&locate=1` (see taskUrlWantsLocate in
// src/utils/deepLinks.ts): opens Today scrolled to the "Leave for X" task's
// row, where it can be checked off (which ends this activity).
@available(iOS 17.0, *)
private func leaveURL(_ context: ActivityViewContext<LeaveActivityAttributes>) -> URL? {
    var components = URLComponents()
    components.scheme = "dundundun"
    components.host = "task"
    components.queryItems = [
        URLQueryItem(name: "id", value: context.attributes.taskId),
        URLQueryItem(name: "locate", value: "1"),
    ]
    return components.url
}

@available(iOS 17.0, *)
private struct LeaveCountdown: View {
    let context: ActivityViewContext<LeaveActivityAttributes>
    var font: Font = .system(size: 15, weight: .semibold).monospacedDigit()
    var color: Color = .white

    var body: some View {
        // One reading of the clock for both the choice and the range, so the
        // range's bounds can't cross between the two.
        let now = Date()
        Group {
            if context.isStale || context.attributes.leaveAt <= now {
                Text(context.attributes.startAt, style: .time)
            } else {
                Text(timerInterval: now...context.attributes.leaveAt, countsDown: true)
            }
        }
        .font(font)
        .foregroundColor(color)
        .multilineTextAlignment(.center)
    }
}

@available(iOS 17.0, *)
private func leaveHeadline(_ context: ActivityViewContext<LeaveActivityAttributes>) -> String {
    isTimeToLeave(context) ? "Time to leave" : "Leave for \(context.attributes.eventTitle)"
}

@available(iOS 17.0, *)
private func leaveDetail(_ context: ActivityViewContext<LeaveActivityAttributes>) -> String? {
    if isTimeToLeave(context) {
        return "\(context.attributes.eventTitle) starts at"
    }
    return context.attributes.location
}

@available(iOS 17.0, *)
private struct LeaveLockScreenView: View {
    let context: ActivityViewContext<LeaveActivityAttributes>

    var body: some View {
        // Pinned to the dark palette: the background tint below makes this
        // card dark in every appearance. See WidgetPalette.forScheme.
        let palette = WidgetPalette.dark
        let tint = isTimeToLeave(context) ? palette.brand : palette.textSecondary
        HStack(spacing: 12) {
            Image(systemName: "figure.walk")
                .font(.system(size: 17))
                .foregroundColor(tint)
                .frame(width: 34, height: 34)
                .background(Circle().fill(tint.opacity(0.15)))

            VStack(alignment: .leading, spacing: 2) {
                Text(leaveHeadline(context))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(palette.text)
                    .lineLimit(2)
                if let detail = leaveDetail(context) {
                    Text(detail)
                        .font(.system(size: 12))
                        .foregroundColor(palette.textSecondary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 8)

            LeaveCountdown(context: context, font: .system(size: 20, weight: .semibold).monospacedDigit(), color: palette.text)
                .frame(maxWidth: 90, alignment: .trailing)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

@available(iOS 17.0, *)
struct LeaveLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LeaveActivityAttributes.self) { context in
            LeaveLockScreenView(context: context)
                .widgetURL(leaveURL(context))
                .activityBackgroundTint(WidgetPalette.dark.bgSecondary)
                .activitySystemActionForegroundColor(WidgetPalette.dark.text)
        } dynamicIsland: { context in
            // Dark on both presentations, same reasoning as TripLiveActivity.
            let palette = WidgetPalette.dark
            let tint = isTimeToLeave(context) ? palette.brand : palette.textSecondary

            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "figure.walk")
                        .font(.system(size: 20))
                        .foregroundColor(tint)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    LeaveCountdown(context: context, font: .system(size: 15, weight: .semibold).monospacedDigit(), color: palette.text)
                        .frame(maxWidth: 80, alignment: .trailing)
                        .minimumScaleFactor(0.7)
                        .lineLimit(1)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(leaveHeadline(context))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(palette.text)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if let detail = leaveDetail(context) {
                        Text(detail)
                            .font(.system(size: 12))
                            .foregroundColor(palette.textSecondary)
                            .lineLimit(1)
                    }
                }
            } compactLeading: {
                Image(systemName: "figure.walk")
                    .foregroundColor(tint)
            } compactTrailing: {
                LeaveCountdown(context: context, font: .system(size: 13).monospacedDigit(), color: palette.textSecondary)
                    .frame(maxWidth: 64)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
            } minimal: {
                Image(systemName: "figure.walk")
                    .foregroundColor(tint)
            }
            .widgetURL(leaveURL(context))
            .keylineTint(palette.brand)
        }
    }
}
