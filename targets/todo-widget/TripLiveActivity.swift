import ActivityKit
import WidgetKit
import SwiftUI

// Shown on the Lock Screen and in the Dynamic Island while a shopping trip
// is running (tripShopId/tripStartedAt — see src/utils/activeTrip.ts and
// src/utils/tripLiveActivity.ts, which is the only thing that starts or ends
// this). Tapping anywhere non-interactive opens the app straight to the
// grocery list — `dundundun://groceries`, the same link a "Grocery run"
// task's own linkUrl carries (src/utils/deepLinks.ts).
//
// The Finish button below is a `Link` rather than an AppIntent, for the
// reason TimerLiveActivity's Done button spells out at length: a Live
// Activity button's intent runs in the background only and cannot bring the
// containing app forward, so a deep link is the one thing that reliably
// works. That constraint is why this activity had no button at all until
// now — ending a trip is a question (which of the leftovers didn't the store
// have, what did each thing cost) and not a verb, so it can only be answered
// inside the app. `dundundun://groceries?finish=1` is that question asked
// from the Lock Screen: it opens the list with FinishShoppingSheet already
// up, instead of the app-then-hunt-for-the-header-icon it replaced.
//
// It carries no count, because it can't: the attributes are fixed when the
// trip starts and nothing here is ever pushed an update, so the button can
// only ever say "Finish". GroceryScreen is what decides whether there is
// anything to finish when the link lands.

@available(iOS 17.0, *)
private struct TripFinishButton: View {
    let palette: WidgetPalette

    // Only fails if scheme/host is empty, which they never are.
    private var finishURL: URL {
        var components = URLComponents()
        components.scheme = "dundundun"
        components.host = "groceries"
        components.queryItems = [URLQueryItem(name: "finish", value: "1")]
        return components.url!
    }

    var body: some View {
        Link(destination: finishURL) { label }
    }

    private var label: some View {
        HStack(spacing: 5) {
            // Plain `checkmark`, the same glyph TimerLiveActivity's Done
            // button uses. The in-app button is `bag-check-outline`, but SF
            // Symbols has no bag-with-tick, and a systemName that doesn't
            // resolve renders as nothing at all — a silent blank next to the
            // word, which is worse than not matching the app.
            Image(systemName: "checkmark")
                .font(.system(size: 11, weight: .bold))
            Text("Finish")
                .font(.system(size: 13, weight: .semibold))
        }
        .foregroundColor(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Capsule().fill(palette.accent))
    }
}

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

    var body: some View {
        // Pinned to the dark palette rather than read off \.colorScheme:
        // the activityBackgroundTint below makes this card dark in every
        // appearance, so light-scheme content would be black on #1C1C1E. See
        // WidgetPalette.forScheme's own note.
        let palette = WidgetPalette.dark
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

            TripFinishButton(palette: palette)
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
                .widgetURL(URL(string: "dundundun://groceries"))
        } dynamicIsland: { context in
            // Dark on both presentations, same reasoning as
            // TimerLiveActivity: the island is always drawn on black, and the
            // Lock Screen card above is tinted dark by this file itself.
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
                DynamicIslandExpandedRegion(.bottom) {
                    // Interactive controls only work in the Lock Screen
                    // presentation and the *expanded* island regions —
                    // compactLeading/compactTrailing/minimal are
                    // non-interactive, same as TimerLiveActivity's Done
                    // button, so this appears in those two places only.
                    TripFinishButton(palette: palette)
                        .padding(.top, 2)
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
            // Tapping anywhere non-interactive opens the grocery list, same
            // link the Lock Screen presentation above uses — unlike
            // TimerLiveActivity and the Today widget, which just open the app.
            .widgetURL(URL(string: "dundundun://groceries"))
            .keylineTint(palette.accent)
        }
    }
}
