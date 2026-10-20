import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type ConfigPlugin, withXcodeProject } from 'expo/config-plugins'

/** The UI test target the plugin adds, its bundle, and where its Swift lives in the repo. */
const REMOTE_TESTS = {
  target: 'RavenRemoteTests',
  bundleId: 'io.github.codebend3r.raven.app.remote-tests',
  sources: 'tvos-e2e',
} as const

const XCODE = {
  uiTests: 'com.apple.product-type.bundle.ui-testing',
  productsGroup: 'Products',
  builtProducts: 'BUILT_PRODUCTS_DIR',
  sourcesPhase: 'PBXSourcesBuildPhase',
  sourcesComment: 'Sources',
  frameworksPhase: 'PBXFrameworksBuildPhase',
  frameworksComment: 'Frameworks',
  schemesFolder: join('xcshareddata', 'xcschemes'),
  configuration: 'XCBuildConfiguration',
  nativeTarget: 'PBXNativeTarget',
  release: 'Release',
  debug: 'Debug',
} as const

const SWIFT = '.swift'

type BuildConfiguration = {
  name: string
  isa: typeof XCODE.configuration
  buildSettings: Record<string, string>
}

type NativeTarget = {
  uuid: string
  pbxNativeTarget: {
    isa: typeof XCODE.nativeTarget
    name: string
    productName: string
    productReference: string
    productType: string
    buildConfigurationList: string
    buildPhases: never[]
    buildRules: never[]
    dependencies: never[]
  }
}

/**
 * The part of the `xcode` package's project Expo hands a mod that the plugin calls. The
 * package ships no types; these are its own methods, with their own positional signatures.
 */
type XcodeProjectApi = {
  generateUuid: () => string
  addXCConfigurationList: (
    configurations: BuildConfiguration[],
    defaultName: string,
    comment: string,
  ) => { uuid: string }
  addProductFile: (
    path: string,
    options: { group: string; target: string; sourceTree: string },
  ) => { fileRef: string }
  addToPbxNativeTargetSection: (target: NativeTarget) => void
  addToPbxProjectSection: (target: NativeTarget) => void
  addPbxGroup: (files: string[], name: string, path: string) => { uuid: string }
  addToPbxGroup: (group: string, parent: string) => void
  addBuildPhase: (files: string[], type: string, comment: string, target: string) => unknown
  getFirstProject: () => { firstProject: { mainGroup: string } }
}

const XCODE_METHODS = [
  'generateUuid',
  'addXCConfigurationList',
  'addProductFile',
  'addToPbxNativeTargetSection',
  'addToPbxProjectSection',
  'addPbxGroup',
  'addToPbxGroup',
  'addBuildPhase',
  'getFirstProject',
] as const satisfies readonly (keyof XcodeProjectApi)[]

const isXcodeProjectApi = (value: unknown): value is XcodeProjectApi =>
  typeof value === 'object' &&
  value !== null &&
  XCODE_METHODS.every((method) => typeof Reflect.get(value, method) === 'function')

/** Quoted as a pbxproj value that holds a space, a slash or a hyphen must be. */
const quoted = (value: string): string => `"${value}"`

/**
 * The test bundle's settings: a tvOS UI test bundle that drives the installed app by its bundle
 * id, so it names no app target, and building it never builds the app.
 */
const TEST_SETTINGS = {
  PRODUCT_NAME: quoted(REMOTE_TESTS.target),
  PRODUCT_BUNDLE_IDENTIFIER: quoted(REMOTE_TESTS.bundleId),
  SDKROOT: 'appletvos',
  SUPPORTED_PLATFORMS: quoted('appletvos appletvsimulator'),
  TARGETED_DEVICE_FAMILY: '3',
  GENERATE_INFOPLIST_FILE: 'YES',
  SWIFT_VERSION: '5.0',
  CODE_SIGN_STYLE: 'Manual',
  LD_RUNPATH_SEARCH_PATHS: quoted(
    '$(inherited) @executable_path/Frameworks @loader_path/Frameworks',
  ),
} as const

/** A shared scheme whose Test action runs the bundle, which `xcodebuild test` needs. */
const schemeOf = ({
  target,
  project,
}: {
  target: string
  project: string
}): string => `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "1600" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
   </BuildAction>
   <TestAction buildConfiguration = "${XCODE.debug}" shouldUseLaunchSchemeArgsEnv = "YES">
      <Testables>
         <TestableReference skipped = "NO">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "${target}"
               BuildableName = "${REMOTE_TESTS.target}.xctest"
               BlueprintName = "${REMOTE_TESTS.target}"
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
 * `ios/RavenRemoteTests/`, a UI test target compiles it, and a shared scheme of the same name
 * runs it. The `xcode` package's project is changed in place, as every Xcode mod does.
 */
export const withTvRemoteTests: ConfigPlugin = (config) =>
  withXcodeProject(config, (mod) => {
    const project = mod.modResults
    if (!isXcodeProjectApi(project)) throw new Error('The Xcode project has no API to add a target')
    const { projectRoot, platformProjectRoot, projectName } = mod.modRequest
    if (projectName === undefined) throw new Error('The Xcode project has no name')

    const sources = join(projectRoot, REMOTE_TESTS.sources)
    const copied = join(platformProjectRoot, REMOTE_TESTS.target)
    const files = readdirSync(sources).filter((file) => file.endsWith(SWIFT))
    mkdirSync(copied, { recursive: true })
    files.forEach((file) => copyFileSync(join(sources, file), join(copied, file)))

    const uuid = project.generateUuid()
    const configurations = project.addXCConfigurationList(
      [XCODE.debug, XCODE.release].map((name) => ({
        name,
        isa: XCODE.configuration,
        buildSettings: { ...TEST_SETTINGS },
      })),
      XCODE.release,
      `Build configuration list for PBXNativeTarget "${REMOTE_TESTS.target}"`,
    )
    const product = project.addProductFile(`${REMOTE_TESTS.target}.xctest`, {
      group: XCODE.productsGroup,
      target: uuid,
      sourceTree: XCODE.builtProducts,
    })
    const target: NativeTarget = {
      uuid,
      pbxNativeTarget: {
        isa: XCODE.nativeTarget,
        name: quoted(REMOTE_TESTS.target),
        productName: quoted(REMOTE_TESTS.target),
        productReference: product.fileRef,
        productType: quoted(XCODE.uiTests),
        buildConfigurationList: configurations.uuid,
        buildPhases: [],
        buildRules: [],
        dependencies: [],
      },
    }
    project.addToPbxNativeTargetSection(target)
    project.addToPbxProjectSection(target)

    const group = project.addPbxGroup(files, REMOTE_TESTS.target, REMOTE_TESTS.target)
    project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup)
    project.addBuildPhase(files, XCODE.sourcesPhase, XCODE.sourcesComment, uuid)
    project.addBuildPhase([], XCODE.frameworksPhase, XCODE.frameworksComment, uuid)

    const schemes = join(platformProjectRoot, `${projectName}.xcodeproj`, XCODE.schemesFolder)
    mkdirSync(schemes, { recursive: true })
    writeFileSync(
      join(schemes, `${REMOTE_TESTS.target}.xcscheme`),
      schemeOf({ target: uuid, project: projectName }),
    )
    return mod
  })
