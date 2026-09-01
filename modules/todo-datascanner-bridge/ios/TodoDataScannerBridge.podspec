require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'TodoDataScannerBridge'
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

  # VisionKit carries DataScannerViewController, which is iOS 16+. The
  # deployment target stays at 15.1 and every use of the class is gated behind
  # `if #available(iOS 16, *)` in the Swift, so this links normally rather than
  # weakly — the framework itself has existed since iOS 13.
  s.frameworks = 'VisionKit'

  s.source_files = '**/*.{h,m,swift}'
end
