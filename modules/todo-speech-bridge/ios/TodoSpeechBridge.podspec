require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'TodoSpeechBridge'
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

  # Speech and AVFoundation are system frameworks and need no entitlement. The
  # two Info.plist keys they do need (NSMicrophoneUsageDescription and
  # NSSpeechRecognitionUsageDescription) live in app.json's `ios.infoPlist`,
  # beside the other usage strings, so no config plugin sits next to this module.
  s.frameworks = 'Speech', 'AVFoundation'

  s.source_files = '**/*.{h,m,swift}'
end
