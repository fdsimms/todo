import Foundation
import SwiftUI
import UserNotifications
import WatchConnectivity
import WatchKit

// The workout on the watch (phase 8, "Watch W1"; docs/arch/workouts.md).
//
// Two ways a workout runs here, and the screens draw both the same way:
//
// - **The phone's.** A workout going on the iPhone arrives in the snapshot's
//   workout section (`WatchLiveWorkout`). A set done here goes back as a tap
//   ("set", with its numbers), as do the rest's +30 s and Skip and Finish
//   workout, and the watch draws them over the snapshot until the phone has
//   applied them, the way it draws a ticked task (LocalTapState).
// - **Its own.** With no workout going on the phone, Start lays a routine out
//   from the plan the snapshot carries (what the phone would lay out right
//   now), and the watch runs it with no phone at all: the sets, their numbers
//   and the rest are kept in this file's `WatchOwnWorkout`, in the watch's App
//   Group so it outlives the app being closed. Finish sends the whole workout
//   once ("watchSession"), queued until the phone is in reach.
//
// **The rules are the phone's.** Each set arrives in the order it is done
// (supersets alternated), worded, with the rest ticking it starts already
// worked out (`WatchWorkoutSet.rest`): this file walks the list in order and
// reads those answers, and has no superset or rest rule of its own.
//
// **A rest never moves anything on.** When it runs out the screen turns to
// "Rest is over", counts up, and waits for "Go to the set".

// ==== From the phone ====

/// The boxes a set shows, in the order a row shows them (`setFieldsFor` in the app).
enum WatchSetField: Hashable {
    case weight, reps, duration, distance
}

/// Accepts any element, so an element that failed to decode can be passed
/// over: an unkeyed container moves on only after a decode that succeeds.
private struct WatchSkippedElement: Decodable {
    init(from decoder: Decoder) throws {}
}

extension KeyedDecodingContainer {
    /// An array of `T` with any element that doesn't decode left out, rather
    /// than failing the whole section over one bad set. Empty when the key is
    /// missing or isn't an array.
    func decodeLossy<T: Decodable>(_ type: T.Type, forKey key: Key) -> [T] {
        guard var items = try? nestedUnkeyedContainer(forKey: key) else { return [] }
        var out: [T] = []
        while !items.isAtEnd {
            if let value = try? items.decode(T.self) {
                out.append(value)
            } else if (try? items.decode(WatchSkippedElement.self)) == nil {
                break
            }
        }
        return out
    }
}

/// The next load for an exercise, worked out on the phone by the rules
/// workout mode's card uses (`WatchSuggestion` in watchWorkout.ts), in the
/// unit shown. Applied only on a tap of Use.
struct WatchSuggestion: Codable, Equatable {
    struct Step: Codable, Equatable {
        let weight: Double
        let reps: Int?
    }

    /// The first working set's weight.
    let weight: Double
    /// "Use 82.5", or "Use these" when the sets differ.
    let use: String
    /// "All sets hit 8 last time".
    let reason: String
    /// The working sets proposed, in order.
    let sets: [Step]
    /// The warm-ups a ramp lays out from the new weight, when the exercise has one.
    let ramp: [Step]

    enum CodingKeys: String, CodingKey { case weight, use, reason, sets, ramp }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        weight = try c.decodeIfPresent(Double.self, forKey: .weight) ?? 0
        use = try c.decodeIfPresent(String.self, forKey: .use) ?? "Use"
        reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
        sets = c.decodeLossy(Step.self, forKey: .sets)
        ramp = c.decodeLossy(Step.self, forKey: .ramp)
    }
}

struct WatchWorkoutExercise: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    /// The app's `ExerciseKind`.
    let kind: String
    /// The rest after one of its sets, which a set added here starts.
    let rest: Int
    /// The load card's proposal, when the phone has one.
    let suggestion: WatchSuggestion?

    enum CodingKeys: String, CodingKey { case id, name, kind, rest, suggestion }

    init(id: String, name: String, kind: String, rest: Int, suggestion: WatchSuggestion? = nil) {
        self.id = id
        self.name = name
        self.kind = kind
        self.rest = rest
        self.suggestion = suggestion
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "weight_reps"
        rest = try c.decodeIfPresent(Int.self, forKey: .rest) ?? 90
        suggestion = try? c.decodeIfPresent(WatchSuggestion.self, forKey: .suggestion)
    }

    var fields: [WatchSetField] {
        switch kind {
        case "bodyweight_reps": return [.reps]
        case "duration": return [.duration]
        case "distance": return [.distance]
        case "weight_distance": return [.weight, .distance]
        default: return [.weight, .reps]
        }
    }

    /// An assisted exercise's weight is the help, which the phone's column calls "−kg".
    var weightIsAssistance: Bool { kind == "assisted_reps" }
}

/// One set, as the phone words it (`WatchWorkoutSet` in watchWorkout.ts), and
/// as the watch's own workout keeps it.
struct WatchWorkoutSet: Codable, Identifiable, Equatable {
    /// The phone's set id on a live workout's set, the watch's own on its own
    /// workout's. Empty on a routine's plan until Start gives it one.
    var id: String
    let exerciseId: String
    var position: Int
    var setIndex: Int
    /// "warmup", "working", "drop" or "amrap".
    var kind: String
    /// "Set 3 of 4", "Warm-up", "Drop set".
    var label: String
    /// "W" or "D", drawn in orange in front of the label.
    var badge: String?
    /// "Next: Bench press, set 4".
    var next: String
    /// The rest this set starts when it is done: more than 0 starts one, 0
    /// drops the one going, -1 leaves it as it is (mid superset round).
    var rest: Int
    var weight: Double?
    var reps: Int?
    var durationSeconds: Int?
    var distanceM: Double?
    /// When it was done, as ISO text, or nil while it is still to do.
    var doneAt: String?
    /// The note written on it, dictated here or typed on the phone.
    var note: String?
    /// The superset it belongs to: its exercise is done round by round with
    /// the others sharing it, and a workout run here brings it back.
    var supersetKey: String?

    enum CodingKeys: String, CodingKey {
        case id, exerciseId, position, setIndex, kind, label, badge, next, rest
        case weight, reps, durationSeconds, distanceM, doneAt, note, supersetKey
    }

    /// A set laid out here ("Add set", "Add exercise", a ramp's warm-up),
    /// worded by `WatchWorkoutList.relabel` once it is in the list.
    init(id: String, exerciseId: String, kind: String, rest: Int, values: WatchSetValues, supersetKey: String? = nil) {
        self.id = id
        self.exerciseId = exerciseId
        position = 0
        setIndex = 0
        self.kind = kind
        label = ""
        badge = nil
        next = ""
        self.rest = rest
        weight = values.weight
        reps = values.reps
        durationSeconds = values.durationSeconds
        distanceM = values.distanceM
        doneAt = nil
        note = nil
        self.supersetKey = supersetKey
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        exerciseId = try c.decode(String.self, forKey: .exerciseId)
        position = try c.decodeIfPresent(Int.self, forKey: .position) ?? 0
        setIndex = try c.decodeIfPresent(Int.self, forKey: .setIndex) ?? 0
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "working"
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        badge = try c.decodeIfPresent(String.self, forKey: .badge)
        next = try c.decodeIfPresent(String.self, forKey: .next) ?? ""
        rest = try c.decodeIfPresent(Int.self, forKey: .rest) ?? 0
        weight = try c.decodeIfPresent(Double.self, forKey: .weight)
        reps = try c.decodeIfPresent(Int.self, forKey: .reps)
        durationSeconds = try c.decodeIfPresent(Int.self, forKey: .durationSeconds)
        distanceM = try c.decodeIfPresent(Double.self, forKey: .distanceM)
        doneAt = try c.decodeIfPresent(String.self, forKey: .doneAt)
        note = try c.decodeIfPresent(String.self, forKey: .note)
        supersetKey = try c.decodeIfPresent(String.self, forKey: .supersetKey)
    }

    var isDone: Bool { doneAt != nil }
    /// A set the load card counts as work: not a warm-up or a drop set.
    var isWorking: Bool { kind == "working" || kind == "amrap" }
    var doneDate: Date? { doneAt.flatMap(isoDate) }

    var values: WatchSetValues {
        WatchSetValues(weight: weight, reps: reps, durationSeconds: durationSeconds, distanceM: distanceM)
    }

    /// Done now, with these numbers.
    func done(_ values: WatchSetValues, at date: Date) -> WatchWorkoutSet {
        var copy = self
        if let weight = values.weight { copy.weight = weight }
        if let reps = values.reps { copy.reps = reps }
        if let durationSeconds = values.durationSeconds { copy.durationSeconds = durationSeconds }
        if let distanceM = values.distanceM { copy.distanceM = distanceM }
        copy.doneAt = watchISO(date)
        return copy
    }
}

/// The phone's rest, as two fixed instants.
struct WatchPhoneRest: Codable, Equatable {
    let id: String
    let startedAt: String
    let endsAt: String
}

struct WatchLiveWorkout: Decodable {
    let sessionId: String
    let title: String
    let startedAt: String
    let exercises: [WatchWorkoutExercise]
    let sets: [WatchWorkoutSet]
    /// Sets past what the phone sent, which only the phone shows.
    let moreSets: Int
    let rest: WatchPhoneRest?

    enum CodingKeys: String, CodingKey { case sessionId, title, startedAt, exercises, sets, moreSets, rest }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try c.decode(String.self, forKey: .sessionId)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        startedAt = try c.decodeIfPresent(String.self, forKey: .startedAt) ?? ""
        exercises = c.decodeLossy(WatchWorkoutExercise.self, forKey: .exercises)
        sets = c.decodeLossy(WatchWorkoutSet.self, forKey: .sets)
        moreSets = (try? c.decodeIfPresent(Int.self, forKey: .moreSets)) ?? 0
        rest = try? c.decodeIfPresent(WatchPhoneRest.self, forKey: .rest)
    }
}

/// A routine on the start list, with what starting it lays out.
struct WatchRoutine: Decodable, Identifiable {
    let id: String
    let name: String
    let exerciseCount: Int
    let fromToday: Bool
    let taskId: String?
    let programId: String?
    let exercises: [WatchWorkoutExercise]
    let plan: [WatchWorkoutSet]
    /// Sets of the routine the phone left off (whole exercises past its cap),
    /// which a workout started here says it doesn't have.
    let moreSets: Int

    enum CodingKeys: String, CodingKey { case id, name, exerciseCount, fromToday, taskId, programId, exercises, plan, moreSets }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        exerciseCount = try c.decodeIfPresent(Int.self, forKey: .exerciseCount) ?? 0
        fromToday = try c.decodeIfPresent(Bool.self, forKey: .fromToday) ?? false
        taskId = try c.decodeIfPresent(String.self, forKey: .taskId)
        programId = try c.decodeIfPresent(String.self, forKey: .programId)
        exercises = c.decodeLossy(WatchWorkoutExercise.self, forKey: .exercises)
        plan = c.decodeLossy(WatchWorkoutSet.self, forKey: .plan)
        moreSets = (try? c.decodeIfPresent(Int.self, forKey: .moreSets)) ?? 0
    }
}

/// The quiet-hours window ("HH:MM"), which the watch's own rest alert keeps to
/// as the phone's rest does (`isWithinQuietHours` in notifications.ts).
struct WatchQuietHours: Codable, Equatable {
    let start: String
    let end: String

    private static func minutes(_ hhmm: String) -> Int? {
        let parts = hhmm.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
        return h * 60 + m
    }

    func contains(_ date: Date) -> Bool {
        guard let startMin = Self.minutes(start), let endMin = Self.minutes(end), startMin != endMin else { return false }
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        let m = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
        return startMin < endMin ? (m >= startMin && m < endMin) : (m >= startMin || m < endMin)
    }
}

/// An exercise logged lately, for "Add exercise", with the sets adding it
/// lays out (last time's), so a workout here can add it with no phone in reach.
struct WatchRecentExercise: Decodable, Identifiable, Equatable {
    struct PlannedSet: Decodable, Equatable {
        let kind: String
        var weight: Double?
        let reps: Int?
        let durationSeconds: Int?
        let distanceM: Double?
    }

    let id: String
    let name: String
    let kind: String
    let rest: Int
    var sets: [PlannedSet]

    enum CodingKeys: String, CodingKey { case id, name, kind, rest, sets }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "weight_reps"
        rest = try c.decodeIfPresent(Int.self, forKey: .rest) ?? 90
        sets = c.decodeLossy(PlannedSet.self, forKey: .sets)
    }

    var exercise: WatchWorkoutExercise { WatchWorkoutExercise(id: id, name: name, kind: kind, rest: rest) }

    /// Its weights in `unit`, from the unit the list was sent in (`shown`). A
    /// workout run here keeps the unit it started in, and the phone's unit can
    /// change while it runs.
    func inUnit(_ unit: String, from shown: String) -> WatchRecentExercise {
        guard unit != shown else { return self }
        var copy = self
        copy.sets = sets.map { set in
            var converted = set
            converted.weight = set.weight.map { watchConvertWeight($0, from: shown, to: unit) }
            return converted
        }
        return copy
    }
}

/// A weight shown in one unit, as the other unit shows it, rounded the way the
/// app rounds (`weightFromDisplay`: three places of a kilogram;
/// `weightToDisplay`: two places of a kilogram, one of a pound).
func watchConvertWeight(_ value: Double, from: String, to: String) -> Double {
    guard from != to else { return value }
    let kgPerLb = 0.45359237
    let kg = from == "lb" ? (value * kgPerLb * 1000).rounded() / 1000 : value
    return to == "lb" ? (kg / kgPerLb * 10).rounded() / 10 : (kg * 100).rounded() / 100
}

/// A workout of the phone's that finished lately, and when (phase 9): where a
/// measurement of it reads the moment it ended.
struct WatchFinishedWorkout: Decodable, Equatable {
    let sessionId: String
    let endedAt: String
}

struct WatchWorkoutSection: Decodable {
    let unit: String
    /// One click of the Crown on a weight, in `unit`.
    let weightStep: Double
    let live: WatchLiveWorkout?
    let routines: [WatchRoutine]
    /// "Add exercise"'s list, A to Z.
    let recent: [WatchRecentExercise]
    let quietHours: WatchQuietHours?
    /// Whether a workout run here is measured with a HealthKit session and
    /// saved to Health from the watch: the phone's three switches (phase 9).
    /// False from a phone that predates it, which is phase 8's behavior.
    let healthWrite: Bool
    /// The phone's workouts finished in the last day, newest first.
    let finished: [WatchFinishedWorkout]
    /// Health workouts the watch saved that the phone asks it to retract.
    let retractWorkouts: [String]
    /// Sessions deleted on the phone whose measurement is to be thrown away.
    let dropSessions: [String]

    enum CodingKeys: String, CodingKey {
        case unit, weightStep, live, routines, recent, quietHours, healthWrite, finished, retractWorkouts, dropSessions
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        unit = (try? c.decodeIfPresent(String.self, forKey: .unit)) ?? "kg"
        weightStep = (try? c.decodeIfPresent(Double.self, forKey: .weightStep)) ?? 2.5
        live = try? c.decodeIfPresent(WatchLiveWorkout.self, forKey: .live)
        routines = c.decodeLossy(WatchRoutine.self, forKey: .routines)
        recent = c.decodeLossy(WatchRecentExercise.self, forKey: .recent)
        quietHours = try? c.decodeIfPresent(WatchQuietHours.self, forKey: .quietHours)
        healthWrite = (try? c.decodeIfPresent(Bool.self, forKey: .healthWrite)) ?? false
        finished = c.decodeLossy(WatchFinishedWorkout.self, forKey: .finished)
        retractWorkouts = c.decodeLossy(String.self, forKey: .retractWorkouts)
        dropSessions = c.decodeLossy(String.self, forKey: .dropSessions)
    }
}

/// The one key the watch reads out of the snapshot for itself.
struct WatchWorkoutEnvelope: Decodable {
    let workout: WatchWorkoutSection?

    enum CodingKeys: String, CodingKey { case workout }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workout = try c.decodeIfPresent(WatchWorkoutSection.self, forKey: .workout)
    }
}

// ==== The watch's own workout ====

/// A rest as the watch shows it.
struct WatchRestSpan: Codable, Equatable {
    var startedAt: Date
    var endsAt: Date
    /// The phone's rest it is, when it is one; a +30 s or Skip names it.
    var phoneRestId: String?

    /// Whole seconds of its start: the phone's copy of a rest the watch
    /// started has the same start to the second, so "Go to the set" holds
    /// across the phone taking over the rest the watch was drawing.
    var key: Int { Int(startedAt.timeIntervalSince1970.rounded(.down)) }
}

struct WatchOwnWorkout: Codable {
    let id: String
    let routineId: String
    let programId: String?
    let taskId: String?
    let title: String
    let startedAt: Date
    let unit: String
    let weightStep: Double
    var exercises: [WatchWorkoutExercise]
    var sets: [WatchWorkoutSet]
    var rest: WatchRestSpan?
    let quietHours: WatchQuietHours?
    /// Sets of the routine the watch never got (`WatchRoutine.moreSets`).
    /// Optional so a workout saved before it existed still reads back.
    var moreSets: Int?

    /// What Finish sends: the done sets, in the unit shown (the phone
    /// converts), as JSON text (`parseWatchSession` in widgetQuietTaps.ts).
    /// With `health` saved, the id of the workout the watch saved to Health
    /// (an empty object for one saved locked with no id), so the phone writes
    /// no copy of its own; absent otherwise, and the phone writes as Save does.
    func payload(endedAt: Date, health: WatchHealthOutcome? = nil) -> String? {
        let sets: [[String: Any]] = self.sets.compactMap { set in
            guard let doneAt = set.doneAt else { return nil }
            var entry: [String: Any] = [
                "id": set.id,
                "exerciseId": set.exerciseId,
                "position": set.position,
                "setIndex": set.setIndex,
                "kind": set.kind,
                "completedAt": doneAt,
            ]
            if let weight = set.weight { entry["weight"] = weight }
            if let reps = set.reps { entry["reps"] = reps }
            if let durationSeconds = set.durationSeconds { entry["durationSeconds"] = durationSeconds }
            if let distanceM = set.distanceM { entry["distanceM"] = distanceM }
            if let note = set.note { entry["note"] = note }
            if let supersetKey = set.supersetKey { entry["supersetKey"] = supersetKey }
            return entry
        }
        var body: [String: Any] = [
            "id": id,
            "routineId": routineId,
            "title": title,
            "startedAt": watchISO(startedAt),
            "endedAt": watchISO(endedAt),
            "unit": unit,
            "sets": sets,
        ]
        if let programId { body["programId"] = programId }
        if let taskId { body["taskId"] = taskId }
        if case .saved(let workoutId)? = health {
            var saved: [String: Any] = [:]
            if let workoutId { saved["workoutId"] = workoutId }
            body["health"] = saved
        }
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

/// The watch's own workout on disk, in the watch's App Group, under the same
/// path shape as the snapshot and the tap log.
enum WatchOwnWorkoutFile {
    static let fileName = "watch_workout.json"

    private static func fileURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
            .appendingPathComponent("Library/Application Support", isDirectory: true)
            .appendingPathComponent(fileName)
    }

    static func load() -> WatchOwnWorkout? {
        guard let url = fileURL(), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WatchOwnWorkout.self, from: data)
    }

    static func save(_ workout: WatchOwnWorkout?) {
        guard let url = fileURL() else { return }
        guard let workout, let data = try? JSONEncoder().encode(workout) else {
            try? FileManager.default.removeItem(at: url)
            return
        }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }

    /// Removes the file only while it still holds workout `id`: a workout
    /// finished while its Health save was on its way keeps its file until it
    /// is sent, and another started meanwhile must not lose its own.
    static func clear(ifStill id: String) {
        guard load()?.id == id else { return }
        save(nil)
    }
}

/// What the finished screen says.
struct WatchFinishedSummary: Equatable {
    let title: String
    let elapsed: String
    let setsDone: Int
    /// The phone wasn't in reach when it was finished, so it says the workout
    /// reaches the phone later.
    let queued: Bool
}

/// ISO text with fractional seconds, which the app's own stamps carry too.
func watchISO(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

// ==== Changing the list ====

/// One change the watch makes to a workout's list: a note on a set, a set or
/// an exercise added, an exercise moved a place, or a load suggestion used.
/// On the watch's own workout it is the change. On the phone's it is also
/// sent as a tap, which the phone makes with workout mode's own store action;
/// this is only what the watch draws until then, and each is refused here
/// where the phone's planner refuses it (`planQuietTaps`), so a repeat does
/// nothing.
enum WatchWorkoutEdit {
    case note(setId: String, text: String)
    case addSet(exerciseId: String, setId: String)
    case addExercise(WatchRecentExercise, setIds: [String])
    case move(exerciseId: String, up: Bool)
    /// `idSeed` names any warm-ups a ramp adds, so they keep one id however
    /// many times the change is drawn.
    case useSuggestion(exerciseId: String, idSeed: String)
}

/// A workout's exercises and its sets in walking order, and the changes on them.
struct WatchWorkoutList {
    var exercises: [WatchWorkoutExercise]
    var sets: [WatchWorkoutSet]

    /// The longest note kept (WATCH_NOTE_MAX in widgetQuietTaps.ts).
    static let noteMax = 500

    func exerciseSets(_ exerciseId: String) -> [WatchWorkoutSet] { sets.filter { $0.exerciseId == exerciseId } }

    /// The suggestion while the load card offers it, by workout mode's two
    /// rules (`workingSetLogged`, `proposalApplied`): not once a working set of
    /// the exercise is done, and not while its planned working sets already
    /// ask for what it proposes.
    func offeredSuggestion(_ exerciseId: String) -> WatchSuggestion? {
        guard let suggestion = exercises.first(where: { $0.id == exerciseId })?.suggestion,
              !suggestion.sets.isEmpty else { return nil }
        let own = exerciseSets(exerciseId)
        if own.contains(where: { $0.isDone && $0.isWorking }) { return nil }
        let planned = own.filter { !$0.isDone && $0.isWorking }
        guard !planned.isEmpty else { return nil }
        let applied = planned.enumerated().allSatisfy { index, set in
            guard index < suggestion.sets.count else { return true }
            let want = suggestion.sets[index]
            guard let weight = set.weight else { return false }
            return Self.sameLoad(weight, want.weight) && (want.reps == nil || set.reps == want.reps)
        }
        return applied ? nil : suggestion
    }

    /// Two weights in the unit shown that load the same, to the hundredth (`sameLoad`).
    static func sameLoad(_ a: Double, _ b: Double) -> Bool {
        (a * 100).rounded() == (b * 100).rounded()
    }

    func canMove(_ exerciseId: String, up: Bool) -> Bool { moved(exerciseId, up: up) != nil }

    /// Makes `edit`, and says whether it changed anything.
    @discardableResult
    mutating func apply(_ edit: WatchWorkoutEdit) -> Bool {
        switch edit {
        case let .note(setId, text):
            let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !words.isEmpty, let index = sets.firstIndex(where: { $0.id == setId }) else { return false }
            sets[index].note = String(words.prefix(Self.noteMax))
            return true

        case let .addSet(exerciseId, setId):
            // `copyLastSet`: one more like the exercise's last, laid out after
            // it, a warm-up copied as a working set.
            guard !setId.isEmpty, !sets.contains(where: { $0.id == setId }),
                  let exercise = exercises.first(where: { $0.id == exerciseId }),
                  let lastIndex = sets.lastIndex(where: { $0.exerciseId == exerciseId }) else { return false }
            let last = sets[lastIndex]
            let added = WatchWorkoutSet(
                id: setId, exerciseId: exerciseId, kind: last.kind == "warmup" ? "working" : last.kind,
                rest: exercise.rest, values: last.values, supersetKey: last.supersetKey
            )
            sets.insert(added, at: lastIndex + 1)
            // In a superset, the phone's walking order (`walkOrder`): round by
            // round, so a third set of the first exercise comes after the
            // second round, not straight after its own second set.
            if last.supersetKey != nil { rewalkSuperset(of: exerciseId) }
            relabel(exerciseId)
            return true

        case let .addExercise(recent, setIds):
            // Last in the workout, with last time's sets, as
            // `addSessionExercise` lays them out (one empty working set for an
            // exercise with none to copy).
            guard !exercises.contains(where: { $0.id == recent.id }) else { return false }
            let planned = recent.sets.isEmpty
                ? [WatchSetValues()]
                : recent.sets.map { WatchSetValues(weight: $0.weight, reps: $0.reps, durationSeconds: $0.durationSeconds, distanceM: $0.distanceM) }
            let kinds = recent.sets.isEmpty ? ["working"] : recent.sets.map(\.kind)
            var taken = Set(sets.map(\.id))
            for (index, values) in planned.enumerated() {
                var id = index < setIds.count ? setIds[index] : ""
                if id.isEmpty || taken.contains(id) { id = UUID().uuidString }
                taken.insert(id)
                sets.append(WatchWorkoutSet(id: id, exerciseId: recent.id, kind: kinds[index], rest: recent.rest, values: values))
            }
            exercises.append(recent.exercise)
            relabel(recent.id)
            return true

        case let .move(exerciseId, up):
            guard let reordered = moved(exerciseId, up: up) else { return false }
            sets = reordered
            let order = firstAppearance
            exercises.sort { (order[$0.id] ?? Int.max) < (order[$1.id] ?? Int.max) }
            return true

        case let .useSuggestion(exerciseId, idSeed):
            guard let suggestion = offeredSuggestion(exerciseId),
                  let exercise = exercises.first(where: { $0.id == exerciseId }) else { return false }
            // `proposalEdits`: the proposal onto the planned working sets, in
            // order, and a ramp's planned warm-ups worked out again from the
            // new weight, each by its place among all the warm-ups.
            var working = 0
            var warmups = 0
            for index in sets.indices where sets[index].exerciseId == exerciseId {
                if sets[index].kind == "warmup" {
                    let step = warmups
                    warmups += 1
                    guard !sets[index].isDone, step < suggestion.ramp.count else { continue }
                    sets[index].weight = suggestion.ramp[step].weight
                    sets[index].reps = suggestion.ramp[step].reps
                } else if sets[index].isWorking, !sets[index].isDone {
                    let place = working
                    working += 1
                    guard place < suggestion.sets.count else { continue }
                    sets[index].weight = suggestion.sets[place].weight
                    sets[index].reps = suggestion.sets[place].reps
                }
            }
            // `rampWarmupsToAdd`: a ramp's warm-ups, ahead of the exercise's
            // sets, when it laid out none (no weight to ramp to at the start).
            if warmups == 0, !suggestion.ramp.isEmpty, let first = sets.firstIndex(where: { $0.exerciseId == exerciseId }) {
                let added = suggestion.ramp.enumerated().map { step, value in
                    WatchWorkoutSet(
                        id: "\(idSeed)-w\(step)", exerciseId: exerciseId, kind: "warmup", rest: exercise.rest,
                        values: WatchSetValues(weight: value.weight, reps: value.reps), supersetKey: sets[first].supersetKey
                    )
                }
                sets.insert(contentsOf: added, at: first)
                relabel(exerciseId)
            }
            return true
        }
    }

    /// Each exercise's first place in the walk.
    private var firstAppearance: [String: Int] {
        var out: [String: Int] = [:]
        for (index, set) in sets.enumerated() where out[set.exerciseId] == nil { out[set.exerciseId] = index }
        return out
    }

    /// The exercises as blocks, in walking order: a superset, whose sets
    /// alternate, is one block, as the phone's `movedExerciseOrder` reads it.
    private var blocks: [[WatchWorkoutSet]] {
        var lastIndex: [String: Int] = [:]
        for (index, set) in sets.enumerated() { lastIndex[set.exerciseId] = index }
        var out: [[WatchWorkoutSet]] = []
        var start = 0
        var end = 0
        for (index, set) in sets.enumerated() {
            // Past the last set of every exercise seen since `start`: that
            // block is whole.
            if index > end {
                out.append(Array(sets[start...end]))
                start = index
            }
            end = max(end, lastIndex[set.exerciseId] ?? index)
        }
        if !sets.isEmpty { out.append(Array(sets[start...end])) }
        return out
    }

    /// The sets with `exerciseId`'s block swapped with the one above or
    /// below it, or nil when it is already first or last.
    private func moved(_ exerciseId: String, up: Bool) -> [WatchWorkoutSet]? {
        var all = blocks
        guard let from = all.firstIndex(where: { block in block.contains { $0.exerciseId == exerciseId } }) else { return nil }
        let to = up ? from - 1 : from + 1
        guard all.indices.contains(to) else { return nil }
        all.swapAt(from, to)
        return all.flatMap { $0 }
    }

    /// Lays the superset `exerciseId` is in back out round by round
    /// (`roundRobin` in workoutSession.ts): the run of exercises, in order,
    /// that share its superset key, each exercise's sets in their own order.
    private mutating func rewalkSuperset(of exerciseId: String) {
        // Each exercise's key is the first one its sets carry (`sessionExercises`).
        var order: [String] = []
        var keyOf: [String: String] = [:]
        for set in sets {
            if !order.contains(set.exerciseId) { order.append(set.exerciseId) }
            if keyOf[set.exerciseId] == nil, let key = set.supersetKey { keyOf[set.exerciseId] = key }
        }
        guard let key = keyOf[exerciseId], let at = order.firstIndex(of: exerciseId) else { return }
        var start = at
        while start > 0, keyOf[order[start - 1]] == key { start -= 1 }
        var end = at
        while end < order.count - 1, keyOf[order[end + 1]] == key { end += 1 }
        let group = Array(order[start...end])
        let members = Set(group)
        let indices = sets.indices.filter { members.contains(sets[$0].exerciseId) }
        guard let lo = indices.first, let hi = indices.last, hi - lo + 1 == indices.count else { return }
        let byExercise = group.map { id in sets[lo...hi].filter { $0.exerciseId == id } }
        var walked: [WatchWorkoutSet] = []
        let rounds = byExercise.map(\.count).max() ?? 0
        for round in 0..<rounds {
            for exerciseSets in byExercise where round < exerciseSets.count { walked.append(exerciseSets[round]) }
        }
        sets.replaceSubrange(lo...hi, with: walked)
    }

    /// Words an exercise's sets as the phone does (`setLabels`, `setName`):
    /// working sets numbered "Set 2 of 4", warm-ups and drop sets lettered.
    mutating func relabel(_ exerciseId: String) {
        guard let name = exercises.first(where: { $0.id == exerciseId })?.name else { return }
        let indices = sets.indices.filter { sets[$0].exerciseId == exerciseId }
        let count = indices.filter { Self.badge(sets[$0].kind) == nil }.count
        var number = 0
        for index in indices {
            let badge = Self.badge(sets[index].kind)
            sets[index].badge = badge
            if badge == nil {
                number += 1
                sets[index].label = "Set \(number) of \(count)"
                sets[index].next = "Next: \(name), set \(number)"
            } else {
                let warmup = sets[index].kind == "warmup"
                sets[index].label = warmup ? "Warm-up" : "Drop set"
                sets[index].next = "Next: \(name), \(warmup ? "warm-up" : "drop set")"
            }
        }
    }

    static func badge(_ kind: String) -> String? {
        switch kind {
        case "warmup": return "W"
        case "drop": return "D"
        default: return nil
        }
    }

    /// The order the sets carry to the phone with a workout run here: each
    /// exercise's place, and each set's place in its exercise.
    mutating func renumber() {
        let order = firstAppearance.sorted { $0.value < $1.value }.map(\.key)
        var counts: [String: Int] = [:]
        for index in sets.indices {
            let id = sets[index].exerciseId
            sets[index].position = order.firstIndex(of: id) ?? 0
            sets[index].setIndex = counts[id, default: 0]
            counts[id, default: 0] += 1
        }
    }
}

// ==== What a screen draws ====

enum WatchWorkoutSource {
    case phone, own
}

/// A workout as the screens draw it, whichever device is running it.
struct WatchWorkoutScreen {
    let source: WatchWorkoutSource
    let sessionId: String
    let title: String
    let startedAt: Date?
    let unit: String
    let weightStep: Double
    let exercises: [WatchWorkoutExercise]
    /// In the order they are done, with what was done here drawn in.
    let sets: [WatchWorkoutSet]
    let moreSets: Int
    /// The rest to show, already past the "is it about the last set" and
    /// "Go to the set" checks; nil shows the next set.
    let rest: WatchRestSpan?

    var nextSet: WatchWorkoutSet? { sets.first { !$0.isDone } }
    var setsDone: Int { sets.filter(\.isDone).count }

    /// What the screens say once every set the watch has is done: never
    /// "All sets done" while sets it never got are still to do.
    var noSetsLeftText: String {
        guard moreSets > 0 else { return "All sets done" }
        return source == .phone ? "More sets on your iPhone" : "No more sets on your watch"
    }

    /// The line under the list about the sets the watch doesn't have, or nil.
    var moreSetsNote: String? {
        guard moreSets > 0 else { return nil }
        switch source {
        case .phone:
            return moreSets == 1 ? "1 more set is on your iPhone." : "\(moreSets) more sets are on your iPhone."
        case .own:
            return moreSets == 1
                ? "1 set of this routine didn't fit on your watch, so it isn't saved."
                : "\(moreSets) sets of this routine didn't fit on your watch, so they aren't saved."
        }
    }

    func exercise(_ id: String) -> WatchWorkoutExercise? { exercises.first { $0.id == id } }

    var list: WatchWorkoutList { WatchWorkoutList(exercises: exercises, sets: sets) }
    func offeredSuggestion(_ exerciseId: String) -> WatchSuggestion? { list.offeredSuggestion(exerciseId) }
    func canMove(_ exerciseId: String, up: Bool) -> Bool { list.canMove(exerciseId, up: up) }

    /// A rest is shown only while it is about the newest set done: a rest
    /// older than that (left going by a superset partner) belongs to a set
    /// already moved past. And not once "Go to the set" has put it away.
    static func shownRest(_ rest: WatchRestSpan?, sets: [WatchWorkoutSet], dismissedKey: Int?) -> WatchRestSpan? {
        guard let rest else { return nil }
        if let latest = sets.compactMap(\.doneDate).max(), rest.startedAt < latest.addingTimeInterval(-1.5) { return nil }
        if dismissedKey == rest.key { return nil }
        return rest
    }
}

// ==== Actions ====

extension WatchStore {
    static let restNotificationId = "watch-workout-rest"
    /// What +30 s adds, the phone's REST_NUDGE_FORWARD_SECONDS.
    static let restNudgeSeconds: TimeInterval = 30

    /// Whether the Workout row belongs on Today: the area is on, or a workout
    /// is going here regardless (it must stay reachable).
    var workoutVisible: Bool { workoutSection != nil || ownWorkout != nil }

    /// The routines to start from, today's first.
    var startRoutines: [WatchRoutine] { workoutSection?.routines ?? [] }

    /// The workout the screens draw: this watch's own first (one started here
    /// carries on even if a workout is started on the phone meanwhile), else
    /// the phone's, unless it was finished here.
    var workoutScreen: WatchWorkoutScreen? {
        if let own = ownWorkout {
            return WatchWorkoutScreen(
                source: .own,
                sessionId: own.id,
                title: own.title,
                startedAt: own.startedAt,
                unit: own.unit,
                weightStep: own.weightStep,
                exercises: own.exercises,
                sets: own.sets,
                moreSets: own.moreSets ?? 0,
                rest: WatchWorkoutScreen.shownRest(own.rest, sets: own.sets, dismissedKey: dismissedRestKey)
            )
        }
        guard let section = workoutSection, let live = section.live else { return nil }
        let local = self.local
        guard !local.finishedSessions.contains(live.sessionId) else { return nil }
        let (list, rest) = phoneOverlay(live, recent: section.recent, local)
        return WatchWorkoutScreen(
            source: .phone,
            sessionId: live.sessionId,
            title: live.title,
            startedAt: isoDate(live.startedAt),
            unit: section.unit,
            weightStep: section.weightStep,
            exercises: list.exercises,
            sets: list.sets,
            moreSets: live.moreSets,
            rest: WatchWorkoutScreen.shownRest(rest, sets: list.sets, dismissedKey: dismissedRestKey)
        )
    }

    /// The phone's workout and rest as the snapshot has them, with the taps
    /// made here since laid over them in order: a set done here is drawn done
    /// and starts its own rest (from the moment it was done, as the phone
    /// will), +30 s moves the end, Skip ends it, and a note, a set or an
    /// exercise added, a move and a suggestion used are made to the list.
    private func phoneOverlay(
        _ live: WatchLiveWorkout,
        recent: [WatchRecentExercise],
        _ local: LocalTapState
    ) -> (WatchWorkoutList, WatchRestSpan?) {
        var list = WatchWorkoutList(exercises: live.exercises, sets: live.sets)
        var rest: WatchRestSpan? = live.rest.flatMap { r in
            guard let start = isoDate(r.startedAt), let end = isoDate(r.endsAt) else { return nil }
            return WatchRestSpan(startedAt: start, endsAt: end, phoneRestId: r.id)
        }
        for tap in local.workoutTaps where tap.sessionId == live.sessionId {
            switch tap.kind {
            case "set":
                guard let index = list.sets.firstIndex(where: { $0.id == tap.itemId }) else { continue }
                let set = list.sets[index]
                if !set.isDone { list.sets[index] = set.done(tap.values ?? WatchSetValues(), at: tap.at) }
                if set.rest > 0 {
                    rest = WatchRestSpan(startedAt: tap.at, endsAt: tap.at.addingTimeInterval(TimeInterval(set.rest)), phoneRestId: nil)
                } else if set.rest == 0 {
                    rest = nil
                }
            case "restAdd":
                if var r = rest {
                    r.endsAt = max(r.endsAt, tap.at).addingTimeInterval(Self.restNudgeSeconds)
                    rest = r
                }
            case "restSkip":
                rest = nil
            default:
                if let edit = Self.edit(for: tap, recent: recent) { list.apply(edit) }
            }
        }
        return (list, rest)
    }

    /// The change a tap on the phone's workout makes to the list.
    private static func edit(for tap: WatchTap, recent: [WatchRecentExercise]) -> WatchWorkoutEdit? {
        switch tap.kind {
        case "setNote": return tap.note.map { .note(setId: tap.itemId, text: $0) }
        case "addSet": return tap.exerciseId.map { .addSet(exerciseId: $0, setId: tap.itemId) }
        case "addExercise":
            return recent.first(where: { $0.id == tap.itemId }).map { .addExercise($0, setIds: tap.setIds ?? []) }
        case "moveExercise": return tap.direction.map { .move(exerciseId: tap.itemId, up: $0 == "up") }
        case "useSuggestion": return .useSuggestion(exerciseId: tap.itemId, idSeed: tap.id)
        default: return nil
        }
    }

    private var phoneReachable: Bool {
        WCSession.isSupported() && WCSession.default.activationState == .activated && WCSession.default.isReachable
    }

    // ---- starting ----

    /// Starts `routine` on this watch, laid out from its plan with ids of the
    /// watch's own. Asks once for the notification that taps the wrist when a
    /// rest ends with the app closed; without it, only the in-app tap comes.
    func startOwnWorkout(_ routine: WatchRoutine) {
        guard ownWorkout == nil, let section = workoutSection, !routine.plan.isEmpty else { return }
        let sets = routine.plan.map { set -> WatchWorkoutSet in
            var copy = set
            copy.id = UUID().uuidString
            copy.doneAt = nil
            return copy
        }
        let workout = WatchOwnWorkout(
            id: UUID().uuidString,
            routineId: routine.id,
            programId: routine.programId,
            taskId: routine.taskId,
            title: routine.name,
            startedAt: Date(),
            unit: section.unit,
            weightStep: section.weightStep,
            exercises: routine.exercises,
            sets: sets,
            rest: nil,
            quietHours: section.quietHours,
            moreSets: routine.moreSets > 0 ? routine.moreSets : nil
        )
        ownWorkout = workout
        dismissedRestKey = nil
        finishedSummary = nil
        WatchOwnWorkoutFile.save(workout)
        WKInterfaceDevice.current().play(.start)
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        // Measured from the start while the phone says workouts go to Health.
        syncHealthSession()
    }

    // ---- a set ----

    func doneSet(_ set: WatchWorkoutSet, values: WatchSetValues, in screen: WatchWorkoutScreen) {
        let now = Date()
        WKInterfaceDevice.current().play(.success)
        switch screen.source {
        case .own:
            guard var workout = ownWorkout, let index = workout.sets.firstIndex(where: { $0.id == set.id }),
                  !workout.sets[index].isDone else { return }
            workout.sets[index] = workout.sets[index].done(values, at: now)
            if set.rest > 0 {
                workout.rest = WatchRestSpan(startedAt: now, endsAt: now.addingTimeInterval(TimeInterval(set.rest)), phoneRestId: nil)
            } else if set.rest == 0 {
                workout.rest = nil
            }
            ownWorkout = workout
            WatchOwnWorkoutFile.save(workout)
            scheduleRestNotification(for: workout.rest, title: workout.title, quietHours: workout.quietHours)
        case .phone:
            guard !set.id.isEmpty, local.doneSets[set.id] == nil else { return }
            recordWorkoutTap(
                kind: "set", itemId: set.id, sessionId: screen.sessionId, values: values, unit: screen.unit,
                exerciseId: set.exerciseId
            )
            // The phone rings for its own rest, and its notification reaches
            // the wrist while it is locked. Out of reach it starts nothing
            // until the tap arrives, so the watch rings for it then.
            if !phoneReachable, set.rest > 0, let rest = workoutScreen?.rest {
                scheduleRestNotification(for: rest, title: screen.title, quietHours: workoutSection?.quietHours)
            } else if set.rest >= 0 {
                cancelRestNotification()
            }
        }
        refreshRestAlarm()
    }

    // ---- the rest ----

    func addRestTime(in screen: WatchWorkoutScreen) {
        let now = Date()
        switch screen.source {
        case .own:
            guard var workout = ownWorkout, var rest = workout.rest else { return }
            rest.endsAt = max(rest.endsAt, now).addingTimeInterval(Self.restNudgeSeconds)
            workout.rest = rest
            ownWorkout = workout
            WatchOwnWorkoutFile.save(workout)
            scheduleRestNotification(for: rest, title: workout.title, quietHours: workout.quietHours)
        case .phone:
            recordWorkoutTap(kind: "restAdd", itemId: screen.sessionId, sessionId: screen.sessionId, restId: screen.rest?.phoneRestId)
            if !phoneReachable, let rest = workoutScreen?.rest {
                scheduleRestNotification(for: rest, title: screen.title, quietHours: workoutSection?.quietHours)
            }
        }
        refreshRestAlarm()
    }

    func skipRest(in screen: WatchWorkoutScreen) {
        switch screen.source {
        case .own:
            guard var workout = ownWorkout else { return }
            workout.rest = nil
            ownWorkout = workout
            WatchOwnWorkoutFile.save(workout)
        case .phone:
            recordWorkoutTap(kind: "restSkip", itemId: screen.sessionId, sessionId: screen.sessionId, restId: screen.rest?.phoneRestId)
        }
        cancelRestNotification()
        refreshRestAlarm()
    }

    /// "Go to the set" on a rest that has run out. Nothing is sent: the rest
    /// waited, and the set is still the one it was.
    func goToSet(from screen: WatchWorkoutScreen) {
        dismissedRestKey = screen.rest?.key
        cancelRestNotification()
        refreshRestAlarm()
    }

    // ---- changing the list ----

    /// A note on a set, dictated with the pencil.
    func noteSet(_ set: WatchWorkoutSet, text: String, in screen: WatchWorkoutScreen) {
        let words = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(WatchWorkoutList.noteMax))
        guard !set.id.isEmpty, !words.isEmpty else { return }
        change(.note(setId: set.id, text: words), in: screen) {
            _ = recordWorkoutTap(kind: "setNote", itemId: set.id, sessionId: screen.sessionId, note: words)
        }
    }

    /// "Add set": one more like the exercise's last.
    func addSet(to exerciseId: String, in screen: WatchWorkoutScreen) {
        let setId = UUID().uuidString
        change(.addSet(exerciseId: exerciseId, setId: setId), in: screen) {
            _ = recordWorkoutTap(kind: "addSet", itemId: setId, sessionId: screen.sessionId, exerciseId: exerciseId)
        }
    }

    /// "Add exercise", from what was logged lately, with last time's sets.
    /// The ids the watch gives those sets travel with the tap, so the phone's
    /// rows are the ones drawn here.
    func addExercise(_ recent: WatchRecentExercise, in screen: WatchWorkoutScreen) {
        // The list comes in the unit the phone shows now; a workout run here
        // keeps the unit it started in.
        let recent = recent.inUnit(screen.unit, from: workoutSection?.unit ?? screen.unit)
        let setIds = (0..<max(recent.sets.count, 1)).map { _ in UUID().uuidString }
        change(.addExercise(recent, setIds: setIds), in: screen) {
            _ = recordWorkoutTap(kind: "addExercise", itemId: recent.id, sessionId: screen.sessionId, setIds: setIds)
        }
    }

    /// An exercise (a superset as one) moved a place, with its sets.
    func moveExercise(_ exerciseId: String, up: Bool, in screen: WatchWorkoutScreen) {
        change(.move(exerciseId: exerciseId, up: up), in: screen) {
            _ = recordWorkoutTap(kind: "moveExercise", itemId: exerciseId, sessionId: screen.sessionId, direction: up ? "up" : "down")
        }
    }

    /// The load card's Use: the suggestion written onto the exercise's
    /// planned sets. Never done without this tap.
    func useSuggestion(for exerciseId: String, in screen: WatchWorkoutScreen) {
        change(.useSuggestion(exerciseId: exerciseId, idSeed: UUID().uuidString), in: screen) {
            _ = recordWorkoutTap(kind: "useSuggestion", itemId: exerciseId, sessionId: screen.sessionId)
        }
    }

    /// Makes `edit` on the workout on screen: on the watch's own, to the list
    /// kept here; on the phone's, by sending the tap `send` records, which the
    /// phone applies and the watch draws over the snapshot until it has. Tried
    /// on the list on screen first either way, so a change it refuses (an
    /// exercise already in the workout, a move past the end, a suggestion no
    /// longer offered) sends nothing, as `tickSet` refuses a set already done.
    private func change(_ edit: WatchWorkoutEdit, in screen: WatchWorkoutScreen, send: () -> Void) {
        switch screen.source {
        case .own:
            guard var workout = ownWorkout else { return }
            var list = WatchWorkoutList(exercises: workout.exercises, sets: workout.sets)
            guard list.apply(edit) else { return }
            list.renumber()
            workout.exercises = list.exercises
            workout.sets = list.sets
            ownWorkout = workout
            WatchOwnWorkoutFile.save(workout)
        case .phone:
            var list = screen.list
            guard list.apply(edit) else { return }
            send()
        }
        WKInterfaceDevice.current().play(.click)
        refreshRestAlarm()
    }

    // ---- finishing ----

    func finishWorkout(_ screen: WatchWorkoutScreen) {
        let now = Date()
        let queued = !phoneReachable
        let elapsed = screen.startedAt.map { describeElapsed(since: $0, now: now) } ?? ""
        let health = WatchHealthSession.shared
        switch screen.source {
        case .own:
            guard let workout = ownWorkout else { return }
            let done = workout.sets.filter(\.isDone).count
            let measured = health.measuring?.sessionId == workout.id
            // A workout with nothing done records nothing, as finishing on the
            // phone drops every set never done; there is nothing to send, and
            // nothing saved to Health either (`discardWorkout`).
            if done > 0 {
                finishedSummary = WatchFinishedSummary(title: workout.title, elapsed: elapsed, setsDone: done, queued: queued)
                if measured {
                    // Saved first, so the workout reaches the phone carrying
                    // the id of what the watch saved and the phone writes no
                    // copy of its own. The file stays until then.
                    health.finish(at: now) { [weak self] outcome in
                        guard let self else { return }
                        self.heartRate = nil
                        self.sendOwnWorkout(workout, endedAt: now, health: outcome)
                        self.syncHealthSession()
                    }
                } else {
                    sendOwnWorkout(workout, endedAt: now, health: nil)
                }
            } else {
                if measured { health.discard() }
                heartRate = nil
                WatchOwnWorkoutFile.save(nil)
            }
            ownWorkout = nil
        case .phone:
            // The phone's workout ends here: the measurement of it is saved
            // ending now, and its id follows the Finish to the phone.
            if let measurement = health.measuring, measurement.phone, measurement.sessionId == screen.sessionId {
                saveMeasurement(measurement, at: now)
            }
            // The sets done and notes written here that the phone hasn't
            // answered for, carried in the Finish itself: a message can
            // overtake their own taps, and the phone records each once.
            let mine = local.workoutTaps.filter { $0.sessionId == screen.sessionId }
            let doneSets = mine.compactMap { tap -> WatchFinishedSet? in
                guard tap.kind == "set" else { return nil }
                let exerciseId = tap.exerciseId ?? screen.sets.first(where: { $0.id == tap.itemId })?.exerciseId
                guard let exerciseId else { return nil }
                return WatchFinishedSet(id: tap.itemId, exerciseId: exerciseId, at: tap.at, values: tap.values ?? WatchSetValues())
            }
            let notes = mine.compactMap { tap -> WatchFinishedNote? in
                guard tap.kind == "setNote", let note = tap.note else { return nil }
                return WatchFinishedNote(setId: tap.itemId, note: note)
            }
            recordWorkoutTap(
                kind: "finish", itemId: screen.sessionId, sessionId: screen.sessionId, unit: screen.unit,
                doneSets: doneSets.isEmpty ? nil : doneSets, notes: notes.isEmpty ? nil : notes
            )
            finishedSummary = WatchFinishedSummary(title: screen.title, elapsed: elapsed, setsDone: screen.setsDone, queued: queued)
        }
        dismissedRestKey = nil
        cancelRestNotification()
        refreshRestAlarm()
        WKInterfaceDevice.current().play(.success)
    }

    /// Sends a workout run here to the phone, once, and lets its file go.
    private func sendOwnWorkout(_ workout: WatchOwnWorkout, endedAt: Date, health: WatchHealthOutcome?) {
        if let body = workout.payload(endedAt: endedAt, health: health) {
            recordWorkoutTap(kind: "watchSession", itemId: workout.id, title: workout.title, body: body)
        }
        WatchOwnWorkoutFile.clear(ifStill: workout.id)
    }

    // ---- the wrist ----

    /// Taps the wrist when the rest on screen ends, while the app is in front
    /// (a notification does it otherwise). Rescheduled on every change; a
    /// late wake (the app was suspended through the end) stays silent.
    func refreshRestAlarm() {
        restAlarm?.cancel()
        restAlarm = nil
        guard let rest = workoutScreen?.rest else { return }
        let delay = rest.endsAt.timeIntervalSinceNow
        guard delay > 0 else { return }
        let key = rest.key
        let item = DispatchWorkItem { [weak self] in
            guard let self, self.isActive, let now = self.workoutScreen?.rest,
                  now.key == key, abs(now.endsAt.timeIntervalSinceNow) < 2 else { return }
            WKInterfaceDevice.current().play(.notification)
        }
        restAlarm = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }

    /// The notification for the end of a rest the watch is keeping, outside
    /// quiet hours. One at a time, replaced on every change.
    func scheduleRestNotification(for rest: WatchRestSpan?, title: String, quietHours: WatchQuietHours?) {
        cancelRestNotification()
        guard let rest else { return }
        let interval = rest.endsAt.timeIntervalSinceNow
        // A time-interval trigger refuses anything not above zero.
        guard interval >= 1, quietHours?.contains(rest.endsAt) != true else { return }
        let content = UNMutableNotificationContent()
        content.title = "Rest is over"
        content.body = title.isEmpty ? "Time for your next set." : "\(title): time for your next set."
        content.sound = UNNotificationSound.default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
        let request = UNNotificationRequest(identifier: Self.restNotificationId, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
    }

    func cancelRestNotification() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [Self.restNotificationId])
    }
}
