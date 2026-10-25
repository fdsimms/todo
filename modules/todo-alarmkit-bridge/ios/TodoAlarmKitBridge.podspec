require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'TodoAlarmKitBridge'
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

  # AVFoundation converts imported alarm sounds (AlarmSoundFiles.swift).
  # ActivityKit (iOS 16.1+, the alarm's AlertSound type) is weak-linked for
  # the reason todo-widget-bridge's podspec gives: this pod's floor is 15.1.
  s.frameworks = 'AVFoundation'
  s.weak_frameworks = 'ActivityKit'
end
