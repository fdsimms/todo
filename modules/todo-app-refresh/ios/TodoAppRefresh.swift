import BackgroundTasks
import ExpoModulesCore

// Short background refreshes (BGAppRefreshTask): iOS wakes the app for about
// thirty seconds, a few times a day for an app that is opened daily, at times
// it picks. expo-background-task only asks for the other kind, a processing
// task, which iOS mostly runs overnight on the charger. This adds the daytime
// kind without a second JS path: each refresh asks expo-task-manager's task
// service to run the background-task tasks, exactly the call
// expo-background-task's own handler makes (BackgroundTaskAppDelegate.swift),
// so the JS task in src/utils/backgroundRefresh.ts runs either way. With that
// task unregistered (Settings › Automations › Add tasks while the app is
// closed, off) a refresh runs nothing.
//
// Written without a compiler, like the other bridges here. Every
// BackgroundTasks call is the shape Apple's "Using background tasks to update
// your app" sample uses and expo-background-task already compiles; the task
// service call is copied from expo-background-task.
enum AppRefreshScheduler {
  // Must match plugins/withAppRefresh.js, which lists it in the Info.plist.
  static let identifier = "com.fdsimms.dundundun.app-refresh"

  // The interval JS last asked for, kept so the handler can queue the next
  // refresh without JS. Zero (absent) means off.
  private static let minutesKey = "todoAppRefreshMinutes"

  private(set) static var registered = false

  // Registering an identifier the Info.plist doesn't permit raises an
  // exception at launch, so this is checked rather than assumed: a build
  // whose plugin didn't run gets no refreshes instead of a crash. Without the
  // "fetch" mode, iOS refuses the request, so that is checked too.
  static var isPermitted: Bool {
    let ids = Bundle.main.object(forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers") as? [String] ?? []
    let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
    return ids.contains(identifier) && modes.contains("fetch")
  }

  static var minutes: Int {
    return UserDefaults.standard.integer(forKey: minutesKey)
  }

  // Called once, from the app delegate's didFinishLaunching: iOS requires
  // every handler to be registered before launch ends.
  static func register() {
    guard !registered, isPermitted else { return }
    registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
      AppRefreshScheduler.run(task)
    }
  }

  static func setMinutes(_ minutes: Int) {
    if minutes > 0 {
      UserDefaults.standard.set(minutes, forKey: minutesKey)
      schedule()
    } else {
      UserDefaults.standard.removeObject(forKey: minutesKey)
      BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
    }
  }

  // Replaces any pending request with this identifier, so calling it again
  // (each time the app goes to the background) only moves the earliest time.
  static func schedule() {
    let minutes = self.minutes
    guard minutes > 0, registered else { return }
    let request = BGAppRefreshTaskRequest(identifier: identifier)
    request.earliestBeginDate = Date(timeIntervalSinceNow: TimeInterval(minutes * 60))
    do {
      try BGTaskScheduler.shared.submit(request)
    } catch {
      print("TodoAppRefresh: could not schedule a refresh: \(error)")
    }
  }

  private static func run(_ task: BGTask) {
    // The next one first, so a run that is cut short still leaves one queued.
    schedule()
    let completion = TodoAppRefreshCompletion(task)
    task.expirationHandler = {
      completion.finish(success: false)
    }
    guard let taskService = TodoAppRefreshTaskService.sharedTaskService() else {
      completion.finish(success: false)
      return
    }
    taskService.runTasks(with: EXTaskLaunchReasonBackgroundTask, userInfo: nil, completionHandler: { _ in
      completion.finish(success: true)
    })
  }
}

// Expiry and the JS task finishing can both arrive; iOS is told once.
private final class TodoAppRefreshCompletion {
  private let lock = NSLock()
  private var done = false
  private let task: BGTask

  init(_ task: BGTask) {
    self.task = task
  }

  func finish(success: Bool) {
    lock.lock()
    defer { lock.unlock() }
    if done { return }
    done = true
    task.setTaskCompleted(success: success)
  }
}

public class TodoAppRefreshAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    AppRefreshScheduler.register()
    return true
  }

  // Apple's sample queues the next refresh as the app leaves the screen.
  public func applicationDidEnterBackground(_ application: UIApplication) {
    AppRefreshScheduler.schedule()
  }
}

public class TodoAppRefreshModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TodoAppRefresh")

    // Whether refreshes can happen at all on this build: the Info.plist
    // permits them and the handler registered at launch.
    Function("isAvailable") { () -> Bool in
      return AppRefreshScheduler.registered
    }

    // Minutes between refreshes at the earliest; 0 turns them off. Double,
    // the numeric argument type the other bridges here already pass.
    Function("setIntervalMinutes") { (minutes: Double) -> Bool in
      AppRefreshScheduler.setMinutes(minutes.isFinite && minutes > 0 ? Int(minutes) : 0)
      return AppRefreshScheduler.registered
    }
  }
}
