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
//
// **It draws two states, and `context.isStale` picks between them**, the way
// FocusLiveActivity's does. The bridge module hands ActivityKit the moment the
// app stops counting the trip as live (TRIP_MAX_MS after it started) as the
// stale date, so the flag flips then with nothing pushed. Before: "Shopping
// at X" and a running clock. After: "Trip to X ended", no clock ("Ended" in
// the compact island, which has no title), and the icon dimmed, because the activity is only ended by the app's own sync, which
// doesn't run until the app is next opened, and until then the Lock Screen
// was still claiming a trip the app had let go of hours before (#2937). The
// Finish button stays: a cart can still be finished without a trip, which is
// what the in-app card offers once one has expired.

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
        .foregroundColor(palette.onBrand)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Capsule().fill(palette.brand))
    }
}

@available(iOS 17.0, *)
private struct TripClockView: View {
    let startedAt: Date
    // Past the stale date the trip is over as far as the app is concerned, so
    // the clock stops rather than counting on past six hours. See the header.
    // Only the compact island reads it: it has no title to say so, where the
    // Lock Screen and the expanded island drop the clock instead.
    var isStale: Bool = false
    var font: Font = .system(size: 15, weight: .semibold).monospacedDigit()
    var color: Color = .white

    var body: some View {
        Group {
            if isStale {
                Text("Ended")
            } else {
                Text(startedAt, style: .timer)
            }
        }
        .font(font)
        .foregroundColor(color)
        .multilineTextAlignment(.center)
    }
}

/// "Shopping at X" while the trip is live, "Trip to X ended" once it's stale.
@available(iOS 17.0, *)
private func tripTitle(_ context: ActivityViewContext<TripActivityAttributes>) -> String {
    context.isStale
        ? "Trip to \(context.attributes.shopName) ended"
        : "Shopping at \(context.attributes.shopName)"
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
        let tint = context.isStale ? palette.textSecondary : palette.brand
        HStack(spacing: 12) {
            Image(systemName: "storefront")
                .font(.system(size: 17))
                .foregroundColor(tint)
                .frame(width: 34, height: 34)
                .background(Circle().fill(tint.opacity(0.15)))

            VStack(alignment: .leading, spacing: 2) {
                Text(tripTitle(context))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(palette.text)
                    .lineLimit(2)

                // Gone once stale rather than saying "Ended" under a title
                // that already says so.
                if !context.isStale {
                    TripClockView(
                        startedAt: context.attributes.startedAt,
                        font: .system(size: 12).monospacedDigit(),
                        color: palette.textSecondary
                    )
                }
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
            let tint = context.isStale ? palette.textSecondary : palette.brand

            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "storefront")
                        .font(.system(size: 20))
                        .foregroundColor(tint)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    // Same as the Lock Screen: the center title says the trip
                    // ended, so the clock just goes.
                    if !context.isStale {
                        TripClockView(
                            startedAt: context.attributes.startedAt,
                            font: .system(size: 15, weight: .semibold).monospacedDigit(),
                            color: palette.text
                        )
                        .padding(.trailing, 4)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(tripTitle(context))
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
                    .foregroundColor(tint)
            } compactTrailing: {
                // Same maxWidth/scale reasoning as TimerLiveActivity's
                // compactTrailing: Text(_:style:.timer) grows from mm:ss to
                // h:mm:ss past an hour, and a trip can easily run that long.
                TripClockView(
                    startedAt: context.attributes.startedAt,
                    isStale: context.isStale,
                    font: .system(size: 13).monospacedDigit(),
                    color: palette.textSecondary
                )
                .frame(maxWidth: 64)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            } minimal: {
                Image(systemName: "storefront")
                    .foregroundColor(tint)
            }
            // Tapping anywhere non-interactive opens the grocery list, same
            // link the Lock Screen presentation above uses — unlike
            // TimerLiveActivity and the Today widget, which just open the app.
            .widgetURL(URL(string: "dundundun://groceries"))
            .keylineTint(palette.brand)
        }
    }
}
