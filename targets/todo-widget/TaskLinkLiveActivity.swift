import ActivityKit
import WidgetKit
import SwiftUI
import AppIntents

// Shown on the Lock Screen and in the Dynamic Island while a task's link
// button has sent the user off into another app (Duolingo, Spotify, a URL —
// see TaskItem.tsx's handleOpenLink / src/utils/liveActivity.ts). Ends the
// moment the user returns to this app, whether by tapping Done below or by
// switching back on their own — see useLiveActivitySync() in liveActivity.ts.

// The Done button. Reuses CompleteTaskIntent verbatim — the same intent the
// Today widget's checkbox uses (TodoTodayWidget.swift's TaskRowView). Because
// openAppWhenRun == true, tapping it queues the id into the App Group
// (addPendingCompletion) and opens the app, which then (a) drains the queue
// and plays the real completion animation via useWidgetCompletionStore, and
// (b) ends this activity on the next AppState 'active' transition. One tap
// covers both halves; no new intent type, no ActivityKit call from this
// extension process.
//
// Interactive controls only work in the Lock Screen presentation and the
// *expanded* Dynamic Island regions — compactLeading/compactTrailing/minimal
// are non-interactive, so this button only ever appears in those two places.
@available(iOS 17.0, *)
private struct LiveActivityDoneButton: View {
    let taskId: String
    let palette: WidgetPalette

    var body: some View {
        Button(intent: CompleteTaskIntent(taskId: taskId)) {
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
        .buttonStyle(.plain)
    }
}

@available(iOS 17.0, *)
private struct TaskLinkLockScreenView: View {
    let context: ActivityViewContext<TaskLinkActivityAttributes>
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
                    // The staleDate has passed — the user has been away far
                    // longer than this was meant to live. Say so rather than
                    // looking like current, urgent work.
                    if context.isStale {
                        Text("Still open?")
                            .font(.system(size: 12))
                            .foregroundColor(palette.textTertiary)
                    } else if !context.attributes.subtitle.isEmpty {
                        Text(context.attributes.subtitle)
                            .font(.system(size: 12))
                            .foregroundColor(palette.textSecondary)
                            .lineLimit(1)
                    }
                    if context.attributes.streakCount > 0 {
                        HStack(spacing: 2) {
                            Image(systemName: "flame.fill").font(.system(size: 9))
                            Text("\(context.attributes.streakCount)").font(.system(size: 11, weight: .semibold))
                        }
                        // Same literal TodoTodayWidget.swift already uses for
                        // the pin/sun glyphs; WidgetPalette has no warning token.
                        .foregroundColor(Color(hex: "FF9F0A"))
                    }
                }
            }

            Spacer(minLength: 8)

            LiveActivityDoneButton(taskId: context.attributes.taskId, palette: palette)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

@available(iOS 17.0, *)
struct TaskLinkLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TaskLinkActivityAttributes.self) { context in
            TaskLinkLockScreenView(context: context)
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
                    if context.attributes.streakCount > 0 {
                        HStack(spacing: 3) {
                            Image(systemName: "flame.fill").font(.system(size: 11))
                            Text("\(context.attributes.streakCount)")
                                .font(.system(size: 13, weight: .semibold))
                        }
                        .foregroundColor(Color(hex: "FF9F0A"))
                        .padding(.trailing, 4)
                    }
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
                    LiveActivityDoneButton(taskId: context.attributes.taskId, palette: palette)
                        .padding(.top, 2)
                }
            } compactLeading: {
                Image(systemName: context.attributes.symbolName)
                    .foregroundColor(palette.accent)
            } compactTrailing: {
                // Neither the elapsed timer nor the streak count earned their
                // place here — elapsed time isn't actionable and the streak
                // is already visible in the expanded view. Leave this region
                // empty rather than fill it with something not worth a glance.
                EmptyView()
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
