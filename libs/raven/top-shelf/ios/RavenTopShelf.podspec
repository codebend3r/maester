require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'RavenTopShelf'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = 'raven'
  s.homepage       = 'https://github.com/codebend3r/maester'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/codebend3r/maester.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Only tvOS has a Top Shelf; the iPhone's build of the app autolinks the pod and writes nothing.
  s.tvos.frameworks = 'TVServices'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.swift'
end
