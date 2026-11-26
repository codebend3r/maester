import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type ConfigPlugin, withXcodeProject } from 'expo/config-plugins'

import {
  TV_TARGET_SETTINGS,
  XCODE,
  addNativeTarget,
  addTargetGroup,
  hasTarget,
  isXcodeProjectApi,
  quoted,
} from './xcodeTargets.ts'

/** The UI test target the plugin adds and its bundle: raven's unless the app names its own. */
type RemoteTests = { target: string; bundleId: string }

const RAVEN_REMOTE_TESTS: RemoteTests = {
  target: 'RavenRemoteTests',
  bundleId: 'io.github.codebend3r.raven.app.remote-tests',
}

/** Where the test's Swift lives in the app's folder. */
const REMOTE_TEST_SOURCES = 'tvos-e2e'

const XCODE_TESTS = {
  uiTests: 'com.apple.product-type.bundle.ui-testing',
  productsGroup: 'Products',
  schemesFolder: join('xcshareddata', 'xcschemes'),
} as const

const SWIFT = '.swift'

/*
 * The test bundle's settings: a tvOS UI test bundle that drives the installed app by its bundle
 * id, so it names no app target, and building it never builds the app.
 */
const testSettingsOf = (tests: RemoteTests) => ({
  PRODUCT_NAME: quoted(tests.target),
  PRODUCT_BUNDLE_IDENTIFIER: quoted(tests.bundleId),
  ...TV_TARGET_SETTINGS,
  GENERATE_INFOPLIST_FILE: 'YES',
  CODE_SIGN_STYLE: 'Manual',
  LD_RUNPATH_SEARCH_PATHS: quoted(
    '$(inherited) @executable_path/Frameworks @loader_path/Frameworks',
  ),
})

type SchemeOfProps = {
  target: string
  project: string
  tests: RemoteTests
}

/** A shared scheme whose Test action runs the bundle, which `xcodebuild test` needs. */
const schemeOf = ({
  target,
  project,
  tests,
}: SchemeOfProps): string => `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "1600" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
   </BuildAction>
   <TestAction buildConfiguration = "${XCODE.debug}" shouldUseLaunchSchemeArgsEnv = "YES">
      <Testables>
         <TestableReference skipped = "NO">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "${target}"
               BuildableName = "${tests.target}.xctest"
               BlueprintName = "${tests.target}"
               ReferencedContainer = "container:${project}.xcodeproj">
            </BuildableReference>
         </TestableReference>
      </Testables>
   </TestAction>
</Scheme>
`

/**
 * Adds the Apple TV's remote-driven end to end test to the generated Xcode project, since
 * `ios/` is made afresh by each prebuild: the Swift in `tvos-e2e/` is copied into
 * `ios/<target>/` (`RavenRemoteTests`, or the target the app names: Wren on TV's
 * `WrenRemoteTests`), a UI test target compiles it, and a shared scheme of the same name runs it. A project that has the target already only gets the Swift copied afresh. The `xcode`
 * package's project is changed in place, as every Xcode mod does.
 */
export const withTvRemoteTests: ConfigPlugin<RemoteTests | void> = (config, named) =>
  withXcodeProject(config, (mod) => {
    const tests = typeof named === 'object' ? named : RAVEN_REMOTE_TESTS
    const project = mod.modResults
    if (!isXcodeProjectApi(project)) throw new Error('The Xcode project has no API to add a target')
    const { projectRoot, platformProjectRoot, projectName } = mod.modRequest
    if (projectName === undefined) throw new Error('The Xcode project has no name')

    const sources = join(projectRoot, REMOTE_TEST_SOURCES)
    const copied = join(platformProjectRoot, tests.target)
    const files = readdirSync(sources).filter((file) => file.endsWith(SWIFT))
    mkdirSync(copied, { recursive: true })
    files.forEach((file) => copyFileSync(join(sources, file), join(copied, file)))
    if (hasTarget({ project, name: tests.target })) return mod

    const { uuid } = addNativeTarget({
      project,
      name: tests.target,
      productType: XCODE_TESTS.uiTests,
      productFile: `${tests.target}.xctest`,
      productGroup: XCODE_TESTS.productsGroup,
      buildSettings: testSettingsOf(tests),
    })
    addTargetGroup({ project, name: tests.target, files })
    project.addBuildPhase(files, XCODE.sourcesPhase, XCODE.sourcesComment, uuid)
    project.addBuildPhase([], XCODE.frameworksPhase, XCODE.frameworksComment, uuid)

    const schemes = join(platformProjectRoot, `${projectName}.xcodeproj`, XCODE_TESTS.schemesFolder)
    mkdirSync(schemes, { recursive: true })
    writeFileSync(
      join(schemes, `${tests.target}.xcscheme`),
      schemeOf({ target: uuid, project: projectName, tests }),
    )
    return mod
  })
