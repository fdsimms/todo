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
  # No config plugin and no Info.plist key of its own: it reads and writes
  # events under the calendar usage string the expo-calendar plugin already
  # writes (app.json). MapKit's place search needs no permission (it is not
  # given the user's location), and CoreLocation is only for the coordinate
  # types.
  s.frameworks = 'EventKit', 'MapKit', 'CoreLocation'

  s.source_files = '**/*.{h,m,swift}'
end
