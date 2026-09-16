require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'TodoPrivacyShield'
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

  # UIKit only, so there is no config plugin beside this module and nothing to
  # request at runtime: no entitlement, no Info.plist key, no permission. The
  # one API here that isn't ancient is UIWindowScene.keyWindow (iOS 15.0), and
  # the deployment target above is 15.1, so it needs no availability gate.
  s.frameworks = 'UIKit'

  s.source_files = '**/*.{h,m,swift}'
end
