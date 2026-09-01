require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'TodoVisionBridge'
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

  # Vision has been available since iOS 11 and needs no entitlement and no
  # Info.plist key, so unlike AlarmKit there is no config plugin beside this
  # module — Swift's own `import Vision` is the whole link. Named here anyway
  # so the dependency is legible in the podspec rather than only in a source
  # file.
  s.frameworks = 'Vision'

  s.source_files = '**/*.{h,m,swift}'
end
