require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'TodoKeyCommands'
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

  # UIKit only: no entitlement, no Info.plist key, no permission, so no config
  # plugin beside it. UIKeyCommand.wantsPriorityOverSystemBehavior is the
  # newest API here (iOS 15.0), under the 15.1 deployment target.
  s.frameworks = 'UIKit'

  s.source_files = '**/*.{h,m,swift}'
end
