import ActivityKit
import WidgetKit
import SwiftUI

// Shown on the Lock Screen and in the Dynamic Island for the ten minutes
// before a repeating alarm rings: a countdown to the ring and a "Skip today"
// button. Requested by src/utils/alarmLiveActivity.ts, which on iOS 26+ gives
// it a start date so it appears on its own with the app closed.
//
// **The button is a link into the app, not an action.** The alarm lives in the
// app's database and on the device's alarm schedule, and a widget extension
// can reach neither, so `Link` opens `dundundun://alarm-skip?id=…` and the app
// asks "Skip the 7:00 AM alarm today?" before it does anything (see
// src/utils/alarmSkipPrompt.ts). Tapping elsewhere on the card opens the same.
//
// **It draws two states, and `context.isStale` picks between them**, the way
// LeaveLiveActivity does. The stale date is the ring time: before it, a
// countdown and the button; after it, "Rang at 7:00 AM" with neither, since
// there is nothing left to skip. `ringAt <= Date()` covers a card seen in the
// second before the flag flips, so a range that would run backwards is never
// built: `Text(timerInterval:)` needs `start <= end`.

@available(iOS 17.0, *)
private func hasRung(_ context: ActivityViewContext<AlarmActivityAttributes>) -> Bool {
    context.isStale || context.attributes.ringAt <= Date()
}

// `dundundun://alarm-skip?id=…`, matched by `isAlarmSkipUrl` in
// src/utils/deepLinks.ts.
@available(iOS 17.0, *)
private func skipURL(_ context: ActivityViewContext<AlarmActivityAttributes>) -> URL? {
    var components = URLComponents()
    components.scheme = "dundundun"
    components.host = "alarm-skip"
    components.queryItems = [URLQueryItem(name: "id", value: context.attributes.alarmId)]
    return components.url
}

@available(iOS 17.0, *)
private struct AlarmCountdown: View {
    let context: ActivityViewContext<AlarmActivityAttributes>
    var font: Font = .system(size: 15, weight: .semibold).monospacedDigit()
    var color: Color = .white

    var body: some View {
        // One reading of the clock for both the choice and the range.
        let now = Date()
        Group {
            if context.isStale || context.attributes.ringAt <= now {
                Text(context.attributes.ringAt, style: .time)
            } else {
                Text(timerInterval: now...context.attributes.ringAt, countsDown: true)
            }
        }
        .font(font)
        .foregroundColor(color)
        .multilineTextAlignment(.center)
    }
}

@available(iOS 17.0, *)
private struct SkipTodayButton: View {
    let context: ActivityViewContext<AlarmActivityAttributes>

    var body: some View {
        let palette = WidgetPalette.dark
        if let url = skipURL(context) {
            Link(destination: url) {
                Label("Skip today", systemImage: "forward.end")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(palette.brand)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 7)
                    .background(Capsule().fill(palette.brand.opacity(0.18)))
            }
        }
    }
}

@available(iOS 17.0, *)
private struct AlarmLockScreenView: View {
    let context: ActivityViewContext<AlarmActivityAttributes>

    var body: some View {
        // Pinned to the dark palette: the background tint below makes this
        // card dark in every appearance. See WidgetPalette.forScheme.
        let palette = WidgetPalette.dark
        let rung = hasRung(context)
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                Image(systemName: "alarm.fill")
                    .font(.system(size: 17))
                    .foregroundColor(palette.brand)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(palette.brand.opacity(0.15)))

                VStack(alignment: .leading, spacing: 2) {
                    Text(context.attributes.title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(palette.text)
                        .lineLimit(1)
                    Text(rung ? "Rang at" : "Rings in")
                        .font(.system(size: 12))
                        .foregroundColor(palette.textSecondary)
                }

                Spacer(minLength: 8)

                AlarmCountdown(context: context, font: .system(size: 22, weight: .semibold).monospacedDigit(), color: palette.text)
                    .frame(maxWidth: 90, alignment: .trailing)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
            }
            if !rung {
                SkipTodayButton(context: context)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

@available(iOS 17.0, *)
struct AlarmLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AlarmActivityAttributes.self) { context in
            AlarmLockScreenView(context: context)
                .widgetURL(skipURL(context))
                .activityBackgroundTint(WidgetPalette.dark.bgSecondary)
                .activitySystemActionForegroundColor(WidgetPalette.dark.text)
        } dynamicIsland: { context in
            // Dark on both presentations, same reasoning as LeaveLiveActivity.
            let palette = WidgetPalette.dark

            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "alarm.fill")
                        .font(.system(size: 17))
                        .foregroundColor(palette.brand)
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(palette.brand.opacity(0.15)))
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 0) {
                        AlarmCountdown(context: context, font: .system(size: 22, weight: .semibold).monospacedDigit(), color: palette.text)
                            .frame(maxWidth: 96, alignment: .trailing)
                            .minimumScaleFactor(0.7)
                            .lineLimit(1)
                        Text(hasRung(context) ? "Rang at" : "Rings in")
                            .font(.system(size: 11))
                            .foregroundColor(palette.textSecondary)
                    }
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        Text(context.attributes.title)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(palette.text)
                            .lineLimit(1)
                        if !hasRung(context) {
                            SkipTodayButton(context: context)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
            } compactLeading: {
                Image(systemName: "alarm.fill")
                    .foregroundColor(palette.brand)
            } compactTrailing: {
                AlarmCountdown(context: context, font: .system(size: 13).monospacedDigit(), color: palette.textSecondary)
                    .frame(maxWidth: 64)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
            } minimal: {
                Image(systemName: "alarm.fill")
                    .foregroundColor(palette.brand)
            }
            .widgetURL(skipURL(context))
            .keylineTint(palette.brand)
        }
    }
}
