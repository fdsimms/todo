require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'TodoWidgetBridge'
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

  # ActivityKit is iOS 16.1+ and this pod's platform floor is 15.1 above, so it
  # must be weak-linked, not `s.frameworks` — a hard -framework reference makes
  # dyld refuse to launch the app at all on iOS 15, which fails at launch time
  # on a real device rather than at build time, so nothing here would catch it.
  # Every call site into ActivityKit (TodoWidgetBridgeModule.swift) is guarded
  # by `#available(iOS 17.0, *)`.
  s.weak_frameworks = 'ActivityKit'
end
