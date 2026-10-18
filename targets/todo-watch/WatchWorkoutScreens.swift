import SwiftUI

// The workout's screens (docs/arch/workouts-mocks/watch-workout.png): the row
// on Today, the start list, a set, the rest, the list with Finish, and the
// finished screen. Pushed from Today's row rather than added as a pager page,
// so the Digital Crown isn't fought over: Today's list scrolls with it, and a
// set's numbers turn with it. What each button does is WatchWorkout.swift.

private let palette = WidgetPalette.dark

// ==== Today's row ====

/// "Workout · Push A is on today", or the workout going and the set it is on.
struct WorkoutTodayRow: View {
    @EnvironmentObject private var store: WatchStore

    var body: some View {
        NavigationLink {
            WorkoutRootView()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "dumbbell.fill")
                    .foregroundStyle(palette.done)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .lineLimit(2)
                        .foregroundStyle(palette.text)
                    if let subtitle {
                        Text(subtitle)
                            .font(.footnote)
                            .lineLimit(2)
                            .foregroundStyle(palette.textSecondary)
                    }
                }
            }
        }
    }

    private var title: String {
        if let screen = store.workoutScreen { return screen.title }
        return "Workout"
    }

    private var subtitle: String? {
        if let screen = store.workoutScreen {
            if let next = screen.nextSet { return next.label }
            return screen.moreSets > 0 ? "More sets on your iPhone" : "All sets done"
        }
        if let today = store.startRoutines.first(where: \.fromToday) {
            return "\(today.name) is on today"
        }
        return nil
    }
}

// ==== Where the row leads ====

struct WorkoutRootView: View {
    @EnvironmentObject private var store: WatchStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        if let summary = store.finishedSummary {
            WorkoutFinishedView(summary: summary) {
                store.finishedSummary = nil
                dismiss()
            }
        } else if let screen = store.workoutScreen {
            WorkoutSessionView(screen: screen) { dismiss() }
        } else {
            WorkoutStartView()
        }
    }
}

// ==== Start ====

/// Today's workout first, then every routine. Works with no phone in reach:
/// each routine carries what starting it lays out.
struct WorkoutStartView: View {
    @EnvironmentObject private var store: WatchStore

    var body: some View {
        List {
            let routines = store.startRoutines
            if store.workoutSection == nil {
                WatchNote(text: "Open dundundun on your iPhone to load your routines.")
            } else if routines.isEmpty {
                WatchNote(text: "Add a routine in dundundun on your iPhone to start it here.")
            }
            ForEach(routines.filter(\.fromToday)) { routine in
                routineRow(routine, detail: "From Today · \(exercises(routine.exerciseCount))")
            }
            let others = routines.filter { !$0.fromToday }
            if !others.isEmpty {
                Section("Routines") {
                    ForEach(others) { routine in
                        routineRow(routine, detail: exercises(routine.exerciseCount))
                    }
                }
            }
        }
        .navigationTitle("Start")
    }

    private func routineRow(_ routine: WatchRoutine, detail: String) -> some View {
        Button {
            store.startOwnWorkout(routine)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(routine.name)
                    .lineLimit(2)
                    .foregroundStyle(palette.text)
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(palette.textSecondary)
            }
        }
    }

    private func exercises(_ count: Int) -> String {
        count == 1 ? "1 exercise" : "\(count) exercises"
    }
}

// ==== A workout going ====

/// The set (or the rest) on top, and the list with Finish a swipe below.
struct WorkoutSessionView: View {
    let screen: WatchWorkoutScreen
    let onEnded: () -> Void

    var body: some View {
        TabView {
            WorkoutCurrentPage(screen: screen)
            WorkoutListPage(screen: screen, onEnded: onEnded)
        }
        .tabViewStyle(.verticalPage)
        .navigationTitle(screen.title)
    }
}

struct WorkoutCurrentPage: View {
    @EnvironmentObject private var store: WatchStore
    let screen: WatchWorkoutScreen

    var body: some View {
        if let rest = screen.rest {
            WorkoutRestView(screen: screen, rest: rest)
        } else if let set = screen.nextSet {
            // A fresh view per set, so the numbers start from that set's own.
            WorkoutSetView(screen: screen, set: set)
                .id(set.id)
        } else {
            VStack(spacing: 8) {
                Image(systemName: "checkmark")
                    .font(.title2)
                    .foregroundStyle(palette.done)
                Text(screen.moreSets > 0 ? "More sets on your iPhone" : "All sets done")
                    .font(.headline)
                    .multilineTextAlignment(.center)
                WatchNote(text: "Scroll down for Finish workout.")
                    .multilineTextAlignment(.center)
            }
        }
    }
}

// ---- a set ----

/// The exercise, which set, its one or two numbers (the Crown turns the
/// outlined one; tapping the other moves the Crown to it), and Done set.
struct WorkoutSetView: View {
    @EnvironmentObject private var store: WatchStore
    let screen: WatchWorkoutScreen
    let set: WatchWorkoutSet

    private enum Box: Hashable { case first, second }

    @State private var first: Double
    @State private var second: Double
    @FocusState private var focus: Box?

    init(screen: WatchWorkoutScreen, set: WatchWorkoutSet) {
        self.screen = screen
        self.set = set
        let fields = screen.exercise(set.exerciseId)?.fields ?? [.weight, .reps]
        _first = State(initialValue: Self.value(of: fields[0], in: set))
        _second = State(initialValue: fields.count > 1 ? Self.value(of: fields[1], in: set) : 0)
    }

    private var exercise: WatchWorkoutExercise? { screen.exercise(set.exerciseId) }
    private var fields: [WatchSetField] { exercise?.fields ?? [.weight, .reps] }

    var body: some View {
        VStack(spacing: 6) {
            Text(exercise?.name ?? "")
                .font(.headline)
                .lineLimit(2)
                .multilineTextAlignment(.center)
            HStack(spacing: 4) {
                if let badge = set.badge {
                    Text(badge)
                        .fontWeight(.bold)
                        .foregroundStyle(palette.orange)
                }
                Text(set.label)
                    .foregroundStyle(palette.textSecondary)
            }
            .font(.footnote)
            HStack(spacing: 6) {
                box(.first, field: fields[0], value: $first)
                if fields.count > 1 {
                    box(.second, field: fields[1], value: $second)
                }
            }
            Button {
                store.doneSet(set, values: values, in: screen)
            } label: {
                Label("Done set", systemImage: "checkmark")
                    .fontWeight(.bold)
                    .foregroundStyle(palette.onDone)
            }
            .buttonStyle(.borderedProminent)
            .tint(palette.done)
        }
        .onAppear {
            DispatchQueue.main.async { focus = .first }
        }
    }

    private func box(_ which: Box, field: WatchSetField, value: Binding<Double>) -> some View {
        let selected = focus == which
        return VStack(spacing: 0) {
            Text(Self.format(value.wrappedValue, as: field))
                .font(.system(size: 26, weight: .bold, design: .rounded).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .foregroundStyle(palette.text)
            Text(caption(field))
                .font(.caption2)
                .foregroundStyle(palette.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background {
            RoundedRectangle(cornerRadius: 12).fill(palette.bgSecondary)
        }
        .overlay {
            RoundedRectangle(cornerRadius: 12).stroke(selected ? palette.accent : Color.clear, lineWidth: 2)
        }
        .focusable()
        .digitalCrownRotation(
            value,
            from: 0,
            through: Self.ceiling(field),
            by: step(field),
            sensitivity: .medium,
            isContinuous: false,
            isHapticFeedbackEnabled: true
        )
        .focused($focus, equals: which)
        .onTapGesture { focus = which }
        .accessibilityLabel("\(caption(field)), \(Self.format(value.wrappedValue, as: field))")
        .accessibilityHint("Turn the Digital Crown to change it.")
    }

    /// The numbers the set is done at: only the ones this exercise records.
    private var values: WatchSetValues {
        var out = WatchSetValues()
        for (index, field) in fields.enumerated() {
            let v = index == 0 ? first : second
            switch field {
            case .weight: out.weight = v
            case .reps: out.reps = Int(v.rounded())
            case .duration: out.durationSeconds = Int(v.rounded())
            case .distance: out.distanceM = v
            }
        }
        return out
    }

    private func caption(_ field: WatchSetField) -> String {
        switch field {
        case .weight: return exercise?.weightIsAssistance == true ? "−\(screen.unit)" : screen.unit
        case .reps: return "reps"
        case .duration: return "time"
        case .distance: return "m"
        }
    }

    private func step(_ field: WatchSetField) -> Double {
        switch field {
        case .weight: return screen.weightStep > 0 ? screen.weightStep : 2.5
        case .reps: return 1
        case .duration: return 5
        case .distance: return 10
        }
    }

    private static func ceiling(_ field: WatchSetField) -> Double {
        switch field {
        case .weight: return 2000
        case .reps: return 100
        case .duration: return 3600
        case .distance: return 50000
        }
    }

    private static func value(of field: WatchSetField, in set: WatchWorkoutSet) -> Double {
        switch field {
        case .weight: return set.weight ?? 0
        case .reps: return Double(set.reps ?? 0)
        case .duration: return Double(set.durationSeconds ?? 0)
        case .distance: return set.distanceM ?? 0
        }
    }

    static func format(_ value: Double, as field: WatchSetField) -> String {
        switch field {
        case .weight, .distance:
            if value == value.rounded() { return String(Int(value)) }
            let formatter = NumberFormatter()
            formatter.minimumFractionDigits = 0
            formatter.maximumFractionDigits = 2
            return formatter.string(from: NSNumber(value: value)) ?? String(value)
        case .reps:
            return String(Int(value.rounded()))
        case .duration:
            return clockText(Int(value.rounded()))
        }
    }
}

/// "1:24", "12:05": whole seconds as minutes and seconds.
func clockText(_ seconds: Int) -> String {
    let s = max(0, seconds)
    return "\(s / 60):\(String(format: "%02d", s % 60))"
}

// ---- the rest ----

/// The countdown with +30 s and Skip; once it runs out, "Rest is over"
/// counting up in orange, waiting for "Go to the set". It never moves on by
/// itself.
struct WorkoutRestView: View {
    @EnvironmentObject private var store: WatchStore
    let screen: WatchWorkoutScreen
    let rest: WatchRestSpan

    var body: some View {
        TimelineView(.periodic(from: Date(), by: 1)) { context in
            let remaining = rest.endsAt.timeIntervalSince(context.date)
            VStack(spacing: 6) {
                if remaining > 0 {
                    Text("Rest")
                        .font(.headline)
                    Text(clockText(Int(remaining.rounded(.up))))
                        .font(.system(size: 44, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(palette.text)
                    nextLine
                    HStack(spacing: 6) {
                        Button("+30 s") { store.addRestTime(in: screen) }
                            .accessibilityLabel("Add 30 seconds")
                        Button {
                            store.skipRest(in: screen)
                        } label: {
                            Text("Skip")
                                .fontWeight(.bold)
                                .foregroundStyle(palette.onDone)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(palette.done)
                        .accessibilityLabel("Skip rest")
                    }
                } else {
                    Text("Rest is over")
                        .font(.headline)
                        .foregroundStyle(palette.orange)
                    Text("+\(clockText(Int((-remaining).rounded(.down))))")
                        .font(.system(size: 44, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(palette.orange)
                    nextLine
                    Button("Go to the set") { store.goToSet(from: screen) }
                }
            }
        }
    }

    private var nextLine: some View {
        Text(screen.nextSet?.next ?? (screen.moreSets > 0 ? "More sets on your iPhone" : "All sets done"))
            .font(.footnote)
            .lineLimit(2)
            .multilineTextAlignment(.center)
            .foregroundStyle(palette.textSecondary)
    }
}

// ---- the list, and Finish ----

struct WorkoutListPage: View {
    @EnvironmentObject private var store: WatchStore
    let screen: WatchWorkoutScreen
    let onEnded: () -> Void
    @State private var confirming: WatchWorkoutScreen?

    var body: some View {
        List {
            ForEach(screen.exercises) { exercise in
                let sets = screen.sets.filter { $0.exerciseId == exercise.id }
                let done = sets.filter(\.isDone).count
                HStack(spacing: 8) {
                    Image(systemName: done == sets.count && !sets.isEmpty ? "checkmark" : "circle")
                        .foregroundStyle(done == sets.count && !sets.isEmpty ? palette.done : palette.textSecondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(exercise.name)
                            .lineLimit(2)
                            .foregroundStyle(palette.text)
                        Text("\(done) of \(sets.count)")
                            .font(.footnote)
                            .foregroundStyle(palette.textSecondary)
                    }
                }
            }
            if screen.moreSets > 0 {
                WatchNote(text: "\(screen.moreSets) more sets are on your iPhone.")
            }
            Section {
                Button {
                    confirming = screen
                } label: {
                    Text("Finish workout")
                        .fontWeight(.bold)
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(palette.onDone)
                }
                .listRowBackground(RoundedRectangle(cornerRadius: 22).fill(palette.done))
            }
        }
        .confirmationDialog(
            confirming.map { "Finish \($0.title)?" } ?? "",
            isPresented: confirmingShown,
            titleVisibility: .visible,
            presenting: confirming
        ) { screen in
            Button(endsWithNothing(screen) ? "End workout" : "Finish workout") {
                let nothing = endsWithNothing(screen)
                store.finishWorkout(screen)
                if nothing { onEnded() }
            }
            Button("Cancel", role: .cancel) {}
        } message: { screen in
            Text(message(screen))
        }
    }

    private var confirmingShown: Binding<Bool> {
        Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } })
    }

    /// The watch's own workout with nothing done records nothing.
    private func endsWithNothing(_ screen: WatchWorkoutScreen) -> Bool {
        screen.source == .own && screen.setsDone == 0
    }

    private func message(_ screen: WatchWorkoutScreen) -> String {
        if endsWithNothing(screen) { return "No sets are done, so nothing is saved." }
        if screen.setsDone == 0 { return "No sets are done yet." }
        let sets = screen.setsDone == 1 ? "1 set" : "\(screen.setsDone) sets"
        return "\(sets) done. Sets you haven't done are left off."
    }
}

// ==== Finished ====

struct WorkoutFinishedView: View {
    let summary: WatchFinishedSummary
    let onDone: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                Image(systemName: "checkmark")
                    .font(.title2)
                    .foregroundStyle(palette.done)
                Text("Workout saved")
                    .font(.headline)
                Text(line)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(palette.textSecondary)
                Button("Done", action: onDone)
            }
        }
        .navigationTitle(summary.title)
        .navigationBarBackButtonHidden(true)
    }

    private var line: String {
        let sets = summary.setsDone == 1 ? "1 set" : "\(summary.setsDone) sets"
        let head = summary.elapsed.isEmpty ? "\(sets)." : "\(summary.elapsed) · \(sets)."
        return summary.queued ? "\(head) It moves to your iPhone the next time it's nearby." : head
    }
}
