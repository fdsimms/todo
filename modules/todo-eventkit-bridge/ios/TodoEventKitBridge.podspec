require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'TodoEventKitBridge'
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
  # EventKit only. No config plugin and no Info.plist key of its own: it reads
  # events the app can already read, under the calendar usage string the
  # expo-calendar plugin already writes (app.json).
  s.frameworks = 'EventKit'

  s.source_files = '**/*.{h,m,swift}'
end
