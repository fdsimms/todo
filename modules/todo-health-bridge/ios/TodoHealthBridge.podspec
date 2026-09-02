require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'TodoHealthBridge'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = ''
  s.homepage       = 'https://github.com/fdsimms/todo'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'

  # Weak-linked for the reason TodoScreenTimeBridge.podspec and
  # TodoWidgetBridge.podspec both spell out: a hard `s.frameworks` reference
  # makes dyld refuse to launch the app on a device the framework is missing
  # from, which fails at launch on a real phone rather than at build time.
  #
  # HealthKit is old enough to be present on every device this pod's 15.1 floor
  # admits, so the guard here is not really about the OS version — it is about
  # iPad, where HealthKit exists as a framework but
  # `HKHealthStore.isHealthDataAvailable()` answers false. `isAvailable` is what
  # the JS side asks first, and the app is iPhone-only today anyway
  # (`supportsTablet: false`), so this costs nothing and removes a whole class
  # of launch failure if that ever changes.
  s.weak_frameworks = 'HealthKit'
end
