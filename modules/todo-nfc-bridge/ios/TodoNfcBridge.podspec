require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'TodoNfcBridge'
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

  # Weak-linked for the reason TodoScreenTimeBridge.podspec spells out: a hard
  # -framework reference makes dyld refuse to launch the app at all on a device
  # without the framework, which fails at launch on a real phone rather than at
  # build time. CoreNFC is absent on iPads and the simulator's runtime, and
  # every call site is guarded by `canImport` and by `readingAvailable`.
  s.weak_frameworks = 'CoreNFC'
end
