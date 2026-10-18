import SwiftUI

// The workout's screens (docs/arch/workouts-mocks/watch-workout.png, and
// watch-workout-more.png for the load card, notes, an exercise's sets and Add
// exercise): the row on Today, the start list, a set, the rest, the list with
// Finish, and the finished screen. Pushed from Today's row rather than added as a pager page,
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
            // A fresh view per set, and per change to its numbers (a
            // suggestion used, an edit on the phone), so the numbers start
            // from the set's own.
            WorkoutSetView(screen: screen, set: set)
                .id("\(set.id)|\(set.weight ?? -1)|\(set.reps ?? -1)|\(set.durationSeconds ?? -1)|\(set.distanceM ?? -1)")
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

/// The exercise, which set, the load card while it is offered, its one or
/// two numbers (the Crown turns the outlined one; tapping the other moves the
/// Crown to it), the set's note, and Done set with the pencil beside it.
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
            if let suggestion = screen.offeredSuggestion(set.exerciseId) {
                suggestionCard(suggestion)
            }
            HStack(spacing: 6) {
                box(.first, field: fields[0], value: $first)
                if fields.count > 1 {
                    box(.second, field: fields[1], value: $second)
                }
            }
            if let note = set.note {
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text("Note:")
                        .foregroundStyle(palette.textSecondary)
                    Text(note)
                        .lineLimit(2)
                        .foregroundStyle(palette.text)
                }
                .font(.caption2)
                .accessibilityElement(children: .combine)
            }
            HStack(spacing: 6) {
                Button {
                    store.doneSet(set, values: values, in: screen)
                } label: {
                    Label("Done set", systemImage: "checkmark")
                        .fontWeight(.bold)
                        .foregroundStyle(palette.onDone)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(palette.done)
                // Dictation, as Add task on Today does.
                TextFieldLink(prompt: Text("Note")) {
                    Image(systemName: "pencil")
                        .fontWeight(.semibold)
                        .foregroundStyle(palette.text)
                        .frame(width: 38, height: 38)
                        .background(Circle().fill(palette.separator))
                } onSubmit: { text in
                    store.noteSet(set, text: text, in: screen)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(noteLabel)
            }
        }
        .onAppear {
            DispatchQueue.main.async { focus = .first }
        }
    }

    private var noteLabel: String { set.note == nil ? "Add a note" : "Change the note" }

    /// "Use 82.5 kg", with the unit the button leaves off.
    private func useLabel(_ suggestion: WatchSuggestion) -> String {
        guard Set(suggestion.sets.map(\.weight)).count == 1 else { return "Use these weights" }
        return "Use \(Self.format(suggestion.weight, as: .weight)) \(screen.unit)"
    }

    /// "All sets hit 8 last time" and Use, worked out on the phone. Use writes
    /// it onto the planned sets; the numbers below then start from them.
    private func suggestionCard(_ suggestion: WatchSuggestion) -> some View {
        HStack(spacing: 6) {
            Text(suggestion.reason)
                .font(.caption2)
                .lineLimit(2)
                .foregroundStyle(palette.text)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                store.useSuggestion(for: set.exerciseId, in: screen)
            } label: {
                Text(suggestion.use)
                    .font(.footnote)
                    .fontWeight(.bold)
                    .lineLimit(1)
                    .foregroundStyle(palette.onDone)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(palette.done))
            }
            .buttonStyle(.plain)
            .fixedSize()
            .accessibilityLabel(useLabel(suggestion))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background {
            RoundedRectangle(cornerRadius: 10).fill(palette.done.opacity(0.14))
        }
        .overlay {
            RoundedRectangle(cornerRadius: 10).stroke(palette.done.opacity(0.35), lineWidth: 1)
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
                NavigationLink {
                    WorkoutExerciseSetsView(exerciseId: exercise.id)
                } label: {
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
                // Moves the exercise (a superset as one) a place, with its
                // sets. Listed from the edge in: down outermost, as drawn.
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    if screen.canMove(exercise.id, up: false) {
                        Button {
                            store.moveExercise(exercise.id, up: false, in: screen)
                        } label: {
                            Label("Move down", systemImage: "arrow.down")
                        }
                        .tint(palette.separator)
                    }
                    if screen.canMove(exercise.id, up: true) {
                        Button {
                            store.moveExercise(exercise.id, up: true, in: screen)
                        } label: {
                            Label("Move up", systemImage: "arrow.up")
                        }
                        .tint(palette.accent)
                    }
                }
            }
            NavigationLink {
                WorkoutAddExerciseView()
            } label: {
                Label("Add exercise", systemImage: "plus")
                    .foregroundStyle(palette.accent)
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

// ---- an exercise's sets ----

/// Every set of one exercise, done or still to do, with its numbers and its
/// note, and Add set, which lays one more out like the last.
struct WorkoutExerciseSetsView: View {
    @EnvironmentObject private var store: WatchStore
    let exerciseId: String

    var body: some View {
        // Read from the store, not handed in, so a set added here shows at once.
        if let screen = store.workoutScreen, let exercise = screen.exercise(exerciseId) {
            let sets = screen.sets.filter { $0.exerciseId == exerciseId }
            List {
                ForEach(Array(numbered(sets).enumerated()), id: \.offset) { _, entry in
                    row(entry.set, number: entry.number, exercise: exercise, unit: screen.unit)
                }
                Button {
                    store.addSet(to: exerciseId, in: screen)
                } label: {
                    Label("Add set", systemImage: "plus")
                        .foregroundStyle(palette.accent)
                }
            }
            .navigationTitle(exercise.name)
        } else {
            WatchNote(text: "This workout has ended.")
        }
    }

    /// Each set with what its row leads with: "W", "D", or the working set's number.
    private func numbered(_ sets: [WatchWorkoutSet]) -> [(set: WatchWorkoutSet, number: String)] {
        var count = 0
        return sets.map { set in
            if let badge = set.badge { return (set, badge) }
            count += 1
            return (set, String(count))
        }
    }

    private func row(_ set: WatchWorkoutSet, number: String, exercise: WatchWorkoutExercise, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(number)
                    .fontWeight(set.badge == nil ? .regular : .bold)
                    .foregroundStyle(set.badge == nil ? palette.text : palette.orange)
                Text(numbers(set, exercise: exercise))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundStyle(palette.text)
                Spacer(minLength: 0)
                if set.isDone {
                    Image(systemName: "checkmark")
                        .foregroundStyle(palette.done)
                        .accessibilityLabel("Done")
                }
            }
            if let note = set.note {
                Text(note)
                    .font(.caption2)
                    .lineLimit(2)
                    .foregroundStyle(palette.textSecondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// "82.5 × 8", "1:00", "400 m": the numbers the exercise records, a dash
    /// for one not filled in yet.
    private func numbers(_ set: WatchWorkoutSet, exercise: WatchWorkoutExercise) -> String {
        exercise.fields.map { field -> String in
            switch field {
            case .weight: return set.weight.map { WorkoutSetView.format($0, as: .weight) } ?? "–"
            case .reps: return set.reps.map { String($0) } ?? "–"
            case .duration: return set.durationSeconds.map(clockText) ?? "–"
            case .distance: return set.distanceM.map { "\(WorkoutSetView.format($0, as: .distance)) m" } ?? "–"
            }
        }
        .joined(separator: " × ")
    }
}

// ---- adding an exercise ----

/// What was logged in the last 90 days, A to Z, less what the workout already
/// has, and Search, which filters it by a dictated name. Picking one adds it
/// last, with last time's sets.
struct WorkoutAddExerciseView: View {
    @EnvironmentObject private var store: WatchStore
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        let inWorkout = Set(store.workoutScreen?.exercises.map(\.id) ?? [])
        let available = (store.workoutSection?.recent ?? []).filter { !inWorkout.contains($0.id) }
        let matches = available.filter { Self.matches($0.name, query) }
        List {
            TextFieldLink(prompt: Text("Exercise name")) {
                Label(query.isEmpty ? "Search" : query, systemImage: "mic")
                    .lineLimit(1)
                    .foregroundStyle(query.isEmpty ? palette.textSecondary : palette.text)
            } onSubmit: { text in
                query = text.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            if !query.isEmpty {
                Button("Clear search") { query = "" }
                    .foregroundStyle(palette.accent)
            }
            if available.isEmpty {
                WatchNote(text: "Exercises you've logged in the last 90 days show here.")
            } else if matches.isEmpty {
                WatchNote(text: "Nothing you've logged lately matches “\(query)”.")
            } else {
                Section(query.isEmpty ? "Recent" : "Matches") {
                    ForEach(matches) { recent in
                        Button {
                            if let screen = store.workoutScreen {
                                store.addExercise(recent, in: screen)
                            }
                            dismiss()
                        } label: {
                            Text(recent.name)
                                .lineLimit(2)
                                .foregroundStyle(palette.text)
                        }
                    }
                }
            }
        }
        .navigationTitle("Add")
    }

    /// Whether a name answers a dictated search: every word of it found in the
    /// name, ignoring case, accents, spaces and hyphens, since dictation
    /// writes "push down" for "pushdown".
    static func matches(_ name: String, _ query: String) -> Bool {
        let words = query.split(whereSeparator: { $0.isWhitespace }).map { fold(String($0)) }.filter { !$0.isEmpty }
        guard !words.isEmpty else { return true }
        let folded = fold(name)
        return folded.contains(words.joined()) || words.allSatisfy { folded.contains($0) }
    }

    private static func fold(_ text: String) -> String {
        String(text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
            .filter { $0.isLetter || $0.isNumber })
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
