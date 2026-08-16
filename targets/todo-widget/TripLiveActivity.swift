import ActivityKit
import WidgetKit
import SwiftUI

// Shown on the Lock Screen and in the Dynamic Island while a shopping trip
// is running (tripShopId/tripStartedAt — see src/utils/activeTrip.ts and
// src/utils/tripLiveActivity.ts, which is the only thing that starts or ends
// this). No interactive controls, unlike TimerLiveActivity's Done button:
// ending a trip means Finish (mark what a store didn't have) or Clear, and
// both only make sense inside the app, so tapping the activity just opens it
// — the same tap-to-open every other non-interactive region here already
// uses.

@available(iOS 17.0, *)
private struct TripClockView: View {
    let startedAt: Date
    var font: Font = .system(size: 15, weight: .semibold).monospacedDigit()
    var color: Color = .white

    var body: some View {
        Text(startedAt, style: .timer)
            .font(font)
            .foregroundColor(color)
            .multilineTextAlignment(.center)
    }
}

@available(iOS 17.0, *)
private struct TripLockScreenView: View {
    let context: ActivityViewContext<TripActivityAttributes>
    @Environment(\.colorScheme) var colorScheme

    var body: some View {
        let palette = WidgetPalette.forScheme(colorScheme)
        HStack(spacing: 12) {
            Image(systemName: "storefront")
                .font(.system(size: 17))
                .foregroundColor(palette.accent)
                .frame(width: 34, height: 34)
                .background(Circle().fill(palette.accent.opacity(0.15)))

            VStack(alignment: .leading, spacing: 2) {
                Text("Shopping at \(context.attributes.shopName)")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(palette.text)
                    .lineLimit(2)

                TripClockView(
                    startedAt: context.attributes.startedAt,
                    font: .system(size: 12).monospacedDigit(),
                    color: palette.textSecondary
                )
            }

            Spacer(minLength: 8)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

@available(iOS 17.0, *)
struct TripLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TripActivityAttributes.self) { context in
            TripLockScreenView(context: context)
                .activityBackgroundTint(WidgetPalette.dark.bgSecondary)
                .activitySystemActionForegroundColor(WidgetPalette.dark.text)
        } dynamicIsland: { context in
            // The island is always drawn on black regardless of system
            // appearance, same reasoning as TimerLiveActivity.
            let palette = WidgetPalette.dark

            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "storefront")
                        .font(.system(size: 20))
                        .foregroundColor(palette.accent)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    TripClockView(
                        startedAt: context.attributes.startedAt,
                        font: .system(size: 15, weight: .semibold).monospacedDigit(),
                        color: palette.text
                    )
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text("Shopping at \(context.attributes.shopName)")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(palette.text)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                }
            } compactLeading: {
                Image(systemName: "storefront")
                    .foregroundColor(palette.accent)
            } compactTrailing: {
                // Same maxWidth/scale reasoning as TimerLiveActivity's
                // compactTrailing: Text(_:style:.timer) grows from mm:ss to
                // h:mm:ss past an hour, and a trip can easily run that long.
                TripClockView(
                    startedAt: context.attributes.startedAt,
                    font: .system(size: 13).monospacedDigit(),
                    color: palette.textSecondary
                )
                .frame(maxWidth: 64)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            } minimal: {
                Image(systemName: "storefront")
                    .foregroundColor(palette.accent)
            }
            // Tapping anywhere non-interactive opens the app — same scheme
            // TimerLiveActivity and the Today widget use.
            .widgetURL(URL(string: "dundundun://"))
            .keylineTint(palette.accent)
        }
    }
}
