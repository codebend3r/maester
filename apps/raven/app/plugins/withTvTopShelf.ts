import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  type ConfigPlugin,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} from 'expo/config-plugins'

/** The invitation's picture a signed out Top Shelf shows, at 1x (1940 by 692) and 2x, from the app's folder. */
type TvTopShelf = { signIn: { picture: string; picture2x: string } }

/**
 * The extension's target, its folder in `ios/` and its product. Never the module's pod's name,
 * `RavenTopShelf`: the extension's Swift module would then answer the app's `import RavenTopShelf`.
 */
const TARGET = 'RavenTopShelfExtension'

/** `@raven/top-shelf`, as bun links it beside the app; its Swift is copied into the target. */
const PACKAGE = join('node_modules', '@raven', 'top-shelf')

/** The Swift the extension compiles: its provider, and the store it shares with the module's pod. */
const SWIFT_SOURCES = [
  join('extension', 'RavenTopShelfProvider.swift'),
  join('ios', 'RavenTopShelfStore.swift'),
] as const

/** The names the provider looks the invitation's picture up by in its bundle. */
const SIGN_IN_FILES = {
  picture: 'RavenTopShelfSignIn.png',
  picture2x: 'RavenTopShelfSignIn-2x.png',
}

/** Named for the target, since the `xcode` package reuses any file reference whose path matches. */
const INFO_PLIST = `${TARGET}-Info.plist`
const ENTITLEMENTS = `${TARGET}.entitlements`

/** The Info.plist key both the app and the extension read the App Group's id from: `RavenTopShelfStore.groupKey`. */
const GROUP_KEY = 'RavenTopShelfGroup'
const APP_GROUPS = 'com.apple.security.application-groups'

const XCODE = {
  appExtension: 'com.apple.product-type.app-extension',
  application: 'com.apple.product-type.application',
  productsGroup: 'Products',
  builtProducts: 'BUILT_PRODUCTS_DIR',
  sourcesPhase: 'PBXSourcesBuildPhase',
  sourcesComment: 'Sources',
  resourcesPhase: 'PBXResourcesBuildPhase',
  resourcesComment: 'Resources',
  frameworksPhase: 'PBXFrameworksBuildPhase',
  frameworksComment: 'Frameworks',
  copyFilesPhase: 'PBXCopyFilesBuildPhase',
  embedComment: 'Embed Foundation Extensions',
  // The `xcode` package's word for a copy phase into the app's PlugIns folder.
  embedDestination: 'app_extension',
  configuration: 'XCBuildConfiguration',
  nativeTarget: 'PBXNativeTarget',
  targetDependency: 'PBXTargetDependency',
  itemProxy: 'PBXContainerItemProxy',
  release: 'Release',
  debug: 'Debug',
  png: 'image.png',
} as const

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

type ProductFile = { uuid: string; fileRef: string; basename: string; group: string }

type AddProductFileProps = { group: string; target: string; sourceTree: string }

type BuildPhaseFile = { value: string; comment: string }

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
  addProductFile: (path: string, options: AddProductFileProps) => ProductFile
  addToPbxBuildFileSection: (file: ProductFile) => void
  addToPbxNativeTargetSection: (target: NativeTarget) => void
  addToPbxProjectSection: (target: NativeTarget) => void
  addTargetDependency: (target: string, dependencies: string[]) => unknown
  addPbxGroup: (files: string[], name: string, path: string) => { uuid: string }
  addToPbxGroup: (group: string, parent: string) => void
  addBuildPhase: (
    files: string[],
    type: string,
    comment: string,
    target: string,
    destination?: string,
  ) => { buildPhase: { files: BuildPhaseFile[] } }
  getFirstProject: () => { firstProject: { mainGroup: string } }
  pbxNativeTargetSection: () => Record<string, unknown>
  pbxFileReferenceSection: () => Record<string, unknown>
  hash: { project: { objects: Record<string, unknown> } }
}

const XCODE_METHODS = [
  'generateUuid',
  'addXCConfigurationList',
  'addProductFile',
  'addToPbxBuildFileSection',
  'addToPbxNativeTargetSection',
  'addToPbxProjectSection',
  'addTargetDependency',
  'addPbxGroup',
  'addToPbxGroup',
  'addBuildPhase',
  'getFirstProject',
  'pbxNativeTargetSection',
  'pbxFileReferenceSection',
] as const satisfies readonly (keyof XcodeProjectApi)[]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const hasObjects = (value: unknown): boolean => {
  const project: unknown = isRecord(value) && isRecord(value.hash) && value.hash.project
  return isRecord(project) && isRecord(project.objects)
}

const isXcodeProjectApi = (value: unknown): value is XcodeProjectApi =>
  isRecord(value) &&
  XCODE_METHODS.every((method) => typeof Reflect.get(value, method) === 'function') &&
  hasObjects(value)

/** Quoted as a pbxproj value that holds a space, a slash or a hyphen must be. */
const quoted = (value: string): string => `"${value}"`

const unquoted = (value: unknown): unknown =>
  typeof value === 'string' ? value.replace(/^"(.*)"$/, '$1') : value

type TargetOfProps = {
  project: XcodeProjectApi
  matches: (target: Record<string, unknown>) => boolean
}

/** The uuid of the first native target `matches` picks; null when none does. */
const targetOf = ({ project, matches }: TargetOfProps): string | null =>
  Object.entries(project.pbxNativeTargetSection()).find(
    ([, target]) => isRecord(target) && matches(target),
  )?.[0] ?? null

/** The app's own target, the one product of type application. */
const appTargetOf = (project: XcodeProjectApi): string | null =>
  targetOf({ project, matches: (target) => unquoted(target.productType) === XCODE.application })

/** Whether a prebuild ran on this project before: a fresh `ios/` never has the extension. */
const hasTopShelf = (project: XcodeProjectApi): boolean =>
  targetOf({ project, matches: (target) => unquoted(target.name) === TARGET }) !== null

type InfoPlistOfProps = { group: string; version: string; build: string; name: string }

/** The extension's Info.plist: the app's version, the Top Shelf extension point and the App Group. */
const infoPlistOf = ({
  group,
  version,
  build,
  name,
}: InfoPlistOfProps): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>${name}</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleVersion</key>
  <string>${build}</string>
  <key>${GROUP_KEY}</key>
  <string>${group}</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.tv-top-shelf</string>
    <key>NSExtensionPrincipalClass</key>
    <string>$(PRODUCT_MODULE_NAME).RavenTopShelfProvider</string>
  </dict>
</dict>
</plist>
`

const entitlementsOf = (group: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>${APP_GROUPS}</key>
  <array>
    <string>${group}</string>
  </array>
</dict>
</plist>
`

type ExtensionSettingsOfProps = { bundleId: string; team: string | null }

/**
 * The extension's settings: a tvOS app extension, signed as the app is (the deploy scripts pass
 * the team and automatic signing on the command line, which reaches every target).
 */
const extensionSettingsOf = ({ bundleId, team }: ExtensionSettingsOfProps) => ({
  PRODUCT_NAME: quoted(TARGET),
  PRODUCT_BUNDLE_IDENTIFIER: quoted(bundleId),
  INFOPLIST_FILE: quoted(`${TARGET}/${INFO_PLIST}`),
  CODE_SIGN_ENTITLEMENTS: quoted(`${TARGET}/${ENTITLEMENTS}`),
  CODE_SIGN_STYLE: 'Automatic',
  ...(team === null ? {} : { DEVELOPMENT_TEAM: team }),
  SDKROOT: 'appletvos',
  SUPPORTED_PLATFORMS: quoted('appletvos appletvsimulator'),
  TARGETED_DEVICE_FAMILY: '3',
  // The app's own, so the extension loads on any Apple TV the app runs on.
  TVOS_DEPLOYMENT_TARGET: '16.4',
  SWIFT_VERSION: '5.0',
  SKIP_INSTALL: 'YES',
  APPLICATION_EXTENSION_API_ONLY: 'YES',
  LD_RUNPATH_SEARCH_PATHS: quoted(
    '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks',
  ),
})

/** Makes sure the sections a target dependency is written into exist; a fresh Expo project has neither. */
const withDependencySections = (project: XcodeProjectApi): void => {
  const { objects } = project.hash.project
  ;[XCODE.targetDependency, XCODE.itemProxy]
    .filter((section) => !isRecord(objects[section]))
    .forEach((section) => Reflect.set(objects, section, {}))
}

/** Marks the invitation's pictures as PNGs, which the `xcode` package leaves of unknown type. */
const markPictures = (project: XcodeProjectApi): void =>
  Object.values(project.pbxFileReferenceSection())
    .filter(isRecord)
    .filter((file) => Object.values(SIGN_IN_FILES).some((name) => unquoted(file.path) === name))
    .forEach((file) => Reflect.set(file, 'lastKnownFileType', XCODE.png))

type AddTopShelfProps = {
  project: XcodeProjectApi
  app: string
  bundleId: string
  team: string | null
  files: { swift: string[]; pictures: string[]; other: string[] }
}

/** Adds the extension's target, builds it before the app and embeds it in the app's PlugIns. */
const addTopShelf = ({ project, app, bundleId, team, files }: AddTopShelfProps): void => {
  const uuid = project.generateUuid()
  const configurations = project.addXCConfigurationList(
    [XCODE.debug, XCODE.release].map((name) => ({
      name,
      isa: XCODE.configuration,
      buildSettings: extensionSettingsOf({ bundleId, team }),
    })),
    XCODE.release,
    `Build configuration list for PBXNativeTarget "${TARGET}"`,
  )
  const product = project.addProductFile(`${TARGET}.appex`, {
    group: XCODE.embedComment,
    target: uuid,
    sourceTree: XCODE.builtProducts,
  })
  project.addToPbxBuildFileSection(product)
  const target: NativeTarget = {
    uuid,
    pbxNativeTarget: {
      isa: XCODE.nativeTarget,
      name: quoted(TARGET),
      productName: quoted(TARGET),
      productReference: product.fileRef,
      productType: quoted(XCODE.appExtension),
      buildConfigurationList: configurations.uuid,
      buildPhases: [],
      buildRules: [],
      dependencies: [],
    },
  }
  project.addToPbxNativeTargetSection(target)
  project.addToPbxProjectSection(target)

  const group = project.addPbxGroup(
    [...files.swift, ...files.pictures, ...files.other],
    TARGET,
    TARGET,
  )
  project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup)
  markPictures(project)
  project.addBuildPhase(files.swift, XCODE.sourcesPhase, XCODE.sourcesComment, uuid)
  project.addBuildPhase(files.pictures, XCODE.resourcesPhase, XCODE.resourcesComment, uuid)
  project.addBuildPhase([], XCODE.frameworksPhase, XCODE.frameworksComment, uuid)

  withDependencySections(project)
  project.addTargetDependency(app, [uuid])
  const embed = project.addBuildPhase(
    [],
    XCODE.copyFilesPhase,
    XCODE.embedComment,
    app,
    XCODE.embedDestination,
  )
  embed.buildPhase.files.push({
    value: product.uuid,
    comment: `${product.basename} in ${XCODE.embedComment}`,
  })
}

/**
 * Gives the Apple TV app a Top Shelf of its own: a TV Services extension (`RavenTopShelfProvider`
 * from `@raven/top-shelf`) the system asks whenever the app's tile in the top row takes focus,
 * and an App Group the app and the extension share, where the app writes what the shelf shows.
 * The Swift and the invitation's pictures are copied into `ios/RavenTopShelfExtension/` on every
 * prebuild; a project that has the target already only gets them copied afresh.
 */
export const withTvTopShelf: ConfigPlugin<TvTopShelf> = (config, { signIn }) => {
  const appId = config.ios?.bundleIdentifier
  if (appId === undefined) throw new Error('The Top Shelf needs the app’s bundle identifier')
  const group = `group.${appId}`
  const team = config.ios?.appleTeamId ?? null

  const withGroupKey = withInfoPlist(config, (mod) => ({
    ...mod,
    modResults: { ...mod.modResults, [GROUP_KEY]: group },
  }))
  const withGroup = withEntitlementsPlist(withGroupKey, (mod) => {
    const groups: unknown = mod.modResults[APP_GROUPS]
    const others = Array.isArray(groups) ? groups.filter((entry) => entry !== group) : []
    return { ...mod, modResults: { ...mod.modResults, [APP_GROUPS]: [...others, group] } }
  })

  return withXcodeProject(withGroup, (mod) => {
    const project = mod.modResults
    if (!isXcodeProjectApi(project)) throw new Error('The Xcode project has no API to add a target')
    const { projectRoot, platformProjectRoot } = mod.modRequest
    const app = appTargetOf(project)
    if (app === null)
      throw new Error('The Xcode project has no app target to embed the Top Shelf in')

    const folder = join(platformProjectRoot, TARGET)
    mkdirSync(folder, { recursive: true })
    const swift = SWIFT_SOURCES.map((source) => {
      const file = source.split('/').at(-1) ?? source
      copyFileSync(join(projectRoot, PACKAGE, source), join(folder, file))
      return file
    })
    copyFileSync(join(projectRoot, signIn.picture), join(folder, SIGN_IN_FILES.picture))
    copyFileSync(join(projectRoot, signIn.picture2x), join(folder, SIGN_IN_FILES.picture2x))
    writeFileSync(
      join(folder, INFO_PLIST),
      infoPlistOf({
        group,
        version: mod.version ?? '1.0.0',
        build: mod.ios?.buildNumber ?? '1',
        name: mod.name,
      }),
    )
    writeFileSync(join(folder, ENTITLEMENTS), entitlementsOf(group))
    if (hasTopShelf(project)) return mod

    addTopShelf({
      project,
      app,
      bundleId: `${appId}.top-shelf`,
      team,
      files: { swift, pictures: Object.values(SIGN_IN_FILES), other: [INFO_PLIST, ENTITLEMENTS] },
    })
    return mod
  })
}
