require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'TodoScreenTimeBridge'
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

  # All three Screen Time frameworks are above this pod's 15.1 floor, and the
  # APIs actually used here (FamilyActivityPicker, ManagedSettingsStore(named:),
  # individual authorization) are 16.0. Weak-linked rather than `s.frameworks`
  # for the reason TodoWidgetBridge.podspec spells out for ActivityKit: a hard
  # -framework reference makes dyld refuse to launch the app at all on a device
  # below the floor, which fails at launch on a real phone rather than at build
  # time, so nothing here would catch it. Every call site is guarded by
  # `#available(iOS 16.0, *)`.
  s.weak_frameworks = 'FamilyControls', 'ManagedSettings', 'DeviceActivity'
end
