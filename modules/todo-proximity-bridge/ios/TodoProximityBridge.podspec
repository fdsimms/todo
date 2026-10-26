require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'TodoProximityBridge'
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

  # The proximity sensor needs no entitlement or permission. The depth reader
  # needs camera permission, whose Info.plist string expo-camera's config
  # plugin already writes (app.json), so there is no config plugin here either.
  s.frameworks = 'UIKit', 'AVFoundation', 'CoreMedia', 'CoreVideo'

  s.source_files = '**/*.{h,m,swift}'
end
