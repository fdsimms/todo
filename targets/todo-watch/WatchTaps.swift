import Foundation

// The watch's own taps, from the moment one is made until the iPhone has
// applied it.
//
// A tap can't change the snapshot: that is the phone's list, rebuilt only when
// the app on the phone applies the tap (see WatchSession.swift there). Until
// then the watch draws its taps over the snapshot, the way the widget draws its
// queued taps (QueuedQuietTaps in WidgetQuietIntents.swift), so a row ticked on
// the wrist stays ticked. This file is the log and that overlay. It compiles
// into the watch app and the complication, which share it through the watch's
// App Group (a container on the watch, unrelated to the phone's).

/// A set's numbers as the watch shows them (the weight in the unit shown),
/// sent with a set done on the phone's workout.
struct WatchSetValues: Codable, Equatable {
    var weight: Double?
    var reps: Int?
    var durationSeconds: Int?
    var distanceM: Double?
}

/// A set done on the watch, carried in a Finish on the phone's workout (see
/// `WatchTap.doneSets`).
struct WatchFinishedSet: Codable, Equatable {
    let id: String
    let exerciseId: String
    let at: Date
    let values: WatchSetValues
}

/// A note written on the watch, carried in a Finish the same way.
struct WatchFinishedNote: Codable, Equatable {
    let setId: String
    let note: String
}

/// One tap made on the watch. `id` is the watch's own and travels with the
/// tap, so the phone can say which ones it has received and applied.
struct WatchTap: Codable, Identifiable {
    let id: String
    /// "complete", "unit", "grocery", "choose", "add", "groceryAdd" or
    /// "defer" (move a task to tomorrow), or one of the workout's
    /// (`workoutKinds`).
    let kind: String
    /// The task id or grocery item id. Empty for "add" and "groceryAdd". A
    /// workout tap's is the set ("set", "setNote", "addSet"), the phone's
    /// session ("restAdd", "restSkip", "finish", "measuring",
    /// "healthWorkout"), the exercise ("addExercise", "moveExercise",
    /// "useSuggestion"), the watch's own workout ("watchSession") or a
    /// workout in Health ("healthRetracted").
    let itemId: String
    /// The grocery list the row was on; nil is the home list.
    let listId: String?
    /// The words typed, for "add" and "groceryAdd".
    let title: String?
    let at: Date
    /// Handed to WatchConnectivity. False while the session wasn't active yet,
    /// so the tap is sent once it is.
    var sent: Bool

    // The workout's (phase 8). Every one is optional and `var`, so a log
    // written before they existed still decodes.

    /// The phone's workout session the tap was made on.
    var sessionId: String? = nil
    /// The phone's rest the watch was showing, when it was the phone's.
    var restId: String? = nil
    /// "set": the numbers it was done at.
    var values: WatchSetValues? = nil
    /// "set": the unit `values.weight` is in.
    var unit: String? = nil
    /// "watchSession": the whole workout, as JSON text (WatchOwnWorkout.payload).
    var body: String? = nil
    /// "setNote": the words dictated.
    var note: String? = nil
    /// "superset": the exercise (`itemId`) is paired with this one, or taken
    /// out of its superset when nil. "addSet": the exercise the set (`itemId`) goes on. "set": the set's
    /// exercise, so a tick that overtakes the `addSet` of a set added here can
    /// add it on the phone.
    var exerciseId: String? = nil
    /// "finish": the sets done here that the phone hadn't answered for yet,
    /// so a Finish that overtakes their own taps still records them.
    var doneSets: [WatchFinishedSet]? = nil
    /// "finish": the notes written here that the phone hadn't answered for yet.
    var notes: [WatchFinishedNote]? = nil
    /// "addExercise": the ids the watch gave the sets it laid out, in order,
    /// which the phone gives the sets it writes.
    var setIds: [String]? = nil
    /// "moveExercise": "up" or "down".
    var direction: String? = nil
    /// "measuring" (phase 9): true when the watch started measuring the
    /// phone's workout, false when it stopped without saving.
    var on: Bool? = nil
    /// "healthWorkout" (phase 9): the id of the workout the watch saved to
    /// Health, nil when it saved locked with no id to give.
    var healthWorkoutId: String? = nil
    /// "healthWorkout": the times it was saved at, so the phone can tell a
    /// copy made before the person retimed the workout there.
    var workoutStart: Date? = nil
    var workoutEnd: Date? = nil

    /// The workout's kinds. Sent at once rather than held for Undo: a set's
    /// rest starts on the phone from it, and the rest screen is the answer to
    /// a tap made by mistake.
    static let workoutKinds: Set<String> = [
        "set", "restAdd", "restSkip", "finish", "watchSession",
        "setNote", "addSet", "addExercise", "moveExercise", "superset", "useSuggestion",
        // The HealthKit session's (phase 9, WatchHealthSession.swift).
        "measuring", "healthWorkout", "healthRetracted",
    ]

    var isWorkout: Bool { Self.workoutKinds.contains(kind) }

    /// What the phone's queue expects (see QuietTap in widgetQuietTaps.ts).
    var userInfo: [String: Any] {
        var info: [String: Any] = [
            "kind": kind,
            "watchTapId": id,
            "at": Self.isoText(at),
        ]
        if !itemId.isEmpty { info["id"] = itemId }
        if let listId { info["listId"] = listId }
        if let title { info["title"] = title }
        if let sessionId { info["sessionId"] = sessionId }
        if let restId { info["restId"] = restId }
        if let unit { info["unit"] = unit }
        if let values {
            if let weight = values.weight { info["weight"] = weight }
            if let reps = values.reps { info["reps"] = reps }
            if let durationSeconds = values.durationSeconds { info["durationSeconds"] = durationSeconds }
            if let distanceM = values.distanceM { info["distanceM"] = distanceM }
        }
        if let body { info["workout"] = body }
        if let note { info["note"] = note }
        if let exerciseId { info["exerciseId"] = exerciseId }
        if let setIds { info["setIds"] = setIds }
        if let direction { info["direction"] = direction }
        if let on { info["on"] = on }
        if let healthWorkoutId { info["workoutId"] = healthWorkoutId }
        if let workoutStart, let workoutEnd {
            info["start"] = Self.isoText(workoutStart)
            info["end"] = Self.isoText(workoutEnd)
        }
        if let doneSets {
            info["sets"] = doneSets.map { set -> [String: Any] in
                var entry: [String: Any] = ["id": set.id, "exerciseId": set.exerciseId, "at": Self.isoText(set.at)]
                if let weight = set.values.weight { entry["weight"] = weight }
                if let reps = set.values.reps { entry["reps"] = reps }
                if let durationSeconds = set.values.durationSeconds { entry["durationSeconds"] = durationSeconds }
                if let distanceM = set.values.distanceM { entry["distanceM"] = distanceM }
                return entry
            }
        }
        if let notes {
            info["notes"] = notes.map { ["id": $0.setId, "note": $0.note] }
        }
        return info
    }

    /// ISO text with fractional seconds, so taps made within the same second
    /// still sort in the order made (the phone orders a workout's taps by it).
    static func isoText(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

enum WatchTapLog {
    static let fileName = "watch_taps.json"

    /// A tap the phone hasn't settled in this long is dropped: the snapshot it
    /// was drawn over has gone stale by then anyway, and the phone remembers
    /// only so many received ids.
    static let maxAge: TimeInterval = 3 * 24 * 60 * 60

    private static func fileURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
            .appendingPathComponent("Library/Application Support", isDirectory: true)
            .appendingPathComponent(fileName)
    }

    static func load() -> [WatchTap] {
        guard let url = fileURL(),
              let data = try? Data(contentsOf: url),
              let taps = try? JSONDecoder().decode([WatchTap].self, from: data) else {
            return []
        }
        return taps
    }

    static func save(_ taps: [WatchTap]) {
        guard let url = fileURL(), let data = try? JSONEncoder().encode(taps) else { return }
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: url, options: .atomic)
    }
}

/// The watch's unsettled taps, as what they change on screen.
struct LocalTapState {
    let completed: Set<String>
    /// Tasks moved to tomorrow here, which leave Today at once.
    let deferred: Set<String>
    let units: [String: Int]
    let groceries: Set<String>
    /// Titles of tasks added on the watch that the phone hasn't received yet.
    let added: [String]
    /// The same for grocery items, by the list they were added to.
    let groceryAdded: [(listId: String?, title: String)]
    /// Either/or options picked here, as `groceryKey`s.
    let chosen: Set<String>
    /// Sets of the phone's workout done here, by set id: the numbers and when.
    let doneSets: [String: (values: WatchSetValues, at: Date)]
    /// The workout's taps on the phone's workout (sets, the rest, and what
    /// was added, moved or noted), in the order made: the list and the rest
    /// the watch shows are the snapshot's with these laid over it in turn.
    let workoutTaps: [WatchTap]
    /// The phone's workouts finished here.
    let finishedSessions: Set<String>
    /// Workouts the watch ran on its own, sent and not yet received.
    let sentWorkouts: [WatchTap]
    /// Health workouts this watch has retracted for the phone, still
    /// unsettled, so it doesn't delete them again while the phone catches up.
    let retractedWorkouts: Set<String>

    init(_ taps: [WatchTap]) {
        var completed = Set<String>()
        var deferred = Set<String>()
        var units: [String: Int] = [:]
        var groceries = Set<String>()
        var added: [String] = []
        var groceryAdded: [(listId: String?, title: String)] = []
        var chosen = Set<String>()
        var doneSets: [String: (values: WatchSetValues, at: Date)] = [:]
        var workoutTaps: [WatchTap] = []
        var finishedSessions = Set<String>()
        var sentWorkouts: [WatchTap] = []
        var retractedWorkouts = Set<String>()
        for tap in taps {
            switch tap.kind {
            case "set":
                doneSets[tap.itemId] = (tap.values ?? WatchSetValues(), tap.at)
                workoutTaps.append(tap)
            case "restAdd", "restSkip", "setNote", "addSet", "addExercise", "moveExercise", "superset", "useSuggestion":
                workoutTaps.append(tap)
            case "finish":
                finishedSessions.insert(tap.sessionId ?? tap.itemId)
            case "watchSession":
                sentWorkouts.append(tap)
            case "healthRetracted":
                retractedWorkouts.insert(tap.itemId)
            case "complete": completed.insert(tap.itemId)
            case "defer": deferred.insert(tap.itemId)
            case "unit": units[tap.itemId, default: 0] += 1
            case "grocery": groceries.insert(Self.groceryKey(itemId: tap.itemId, listId: tap.listId))
            case "choose":
                let key = Self.groceryKey(itemId: tap.itemId, listId: tap.listId)
                groceries.insert(key)
                chosen.insert(key)
            case "add": if let title = tap.title { added.append(title) }
            case "groceryAdd": if let title = tap.title { groceryAdded.append((tap.listId, title)) }
            default: break
            }
        }
        self.completed = completed
        self.deferred = deferred
        self.units = units
        self.groceries = groceries
        self.added = added
        self.groceryAdded = groceryAdded
        self.chosen = chosen
        self.doneSets = doneSets
        self.workoutTaps = workoutTaps
        self.finishedSessions = finishedSessions
        self.sentWorkouts = sentWorkouts
        self.retractedWorkouts = retractedWorkouts
    }

    static func groceryKey(itemId: String, listId: String?) -> String {
        "\(listId ?? "")\u{0}\(itemId)"
    }

    /// The target's count with this watch's units added on.
    func progress(_ task: WidgetTask) -> Int {
        task.progressCount + (units[task.id] ?? 0)
    }

    /// Whether the task was moved to tomorrow here and so is off Today.
    func isDeferred(_ task: WidgetTask) -> Bool {
        deferred.contains(task.id)
    }

    func isDone(_ task: WidgetTask) -> Bool {
        if completed.contains(task.id) { return true }
        guard task.tapsAreUnits, let target = task.targetCount else { return false }
        return progress(task) >= target
    }

    func isChecked(_ row: WidgetGroceryRow, listId: String?) -> Bool {
        groceries.contains(Self.groceryKey(itemId: row.id, listId: listId))
    }

    /// The rows to draw: an option that lost an either/or picked on this watch
    /// is gone, as it will be on the phone.
    func visibleRows(_ list: WidgetGroceryList) -> [WidgetGroceryRow] {
        let wonGroups = Set(list.rows.compactMap { row -> String? in
            guard chosen.contains(Self.groceryKey(itemId: row.id, listId: list.id)) else { return nil }
            return row.choiceGroup
        })
        return list.rows.filter { row in
            guard let group = row.choiceGroup, wonGroups.contains(group) else { return true }
            return chosen.contains(Self.groceryKey(itemId: row.id, listId: list.id))
        }
    }

    /// How many of `list` are left to buy as drawn here: the phone's count,
    /// less what was checked here (an either/or's losing options included),
    /// plus what was added here and hasn't reached the phone.
    func remaining(_ list: WidgetGroceryList) -> Int {
        let shown = visibleRows(list)
        let gone = (list.rows.count - shown.count) + shown.filter { isChecked($0, listId: list.id) }.count
        return max(0, list.remaining - gone) + groceryAdds(listId: list.id).count
    }

    /// Items added here to `listId` that the phone hasn't received yet.
    func groceryAdds(listId: String?) -> [String] {
        groceryAdded.filter { $0.listId == listId }.map { $0.title }
    }
}

extension WidgetSnapshot {
    /// Today's rows as of `date`: pinned ones first, then the rest, each once.
    func todayRows(at date: Date) -> [WidgetTask] {
        var seen = Set<String>()
        return (pinnedTasks + visibleTasks(at: date)).filter { seen.insert($0.id).inserted }
    }

    /// Tasks that reach Today later in the same logical day, soonest first:
    /// the snapshot's upcoming tasks whose moment hasn't come by `date`,
    /// less anything already a row (a pinned one) and anything after the day
    /// turns over. Empty from a snapshot with no day boundary to judge by.
    func laterTodayRows(at date: Date) -> [WidgetTask] {
        guard !isLaterDay(at: date), let dayEnd = nextDayStart.flatMap(isoDate) else { return [] }
        let shown = Set(todayRows(at: date).map(\.id))
        return upcomingTasks.filter { task in
            guard let at = task.visibleAtDate else { return false }
            return at > date && at < dayEnd && !shown.contains(task.id)
        }
    }
}
