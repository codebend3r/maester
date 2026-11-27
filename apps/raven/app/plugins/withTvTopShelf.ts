import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import {
  type ConfigPlugin,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} from 'expo/config-plugins'
import { isRecord } from '@shared/http'

import {
  TV_TARGET_SETTINGS,
  XCODE,
  type XcodeProjectApi,
  addNativeTarget,
  addTargetGroup,
  hasTarget,
  isXcodeProjectApi,
  quoted,
  targetOf,
  unquoted,
} from './xcodeTargets.ts'

/** The invitation's picture a signed out Top Shelf shows, at 1x (1940 by 692) and 2x, from the app's folder. */
type TvTopShelf = { signIn: { picture: string; picture2x: string } }

/*
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

/** One of the invitation's pictures: the scale the app names it under, and the file the provider looks it up by in its bundle. */
type SignInPicture = { scale: keyof TvTopShelf['signIn']; file: string }

const SIGN_IN_PICTURES = [
  { scale: 'picture', file: 'RavenTopShelfSignIn.png' },
  { scale: 'picture2x', file: 'RavenTopShelfSignIn-2x.png' },
] as const satisfies readonly SignInPicture[]

const SIGN_IN_FILES = SIGN_IN_PICTURES.map(({ file }) => file)

/** Named for the target, since the `xcode` package reuses any file reference whose path matches. */
const INFO_PLIST = `${TARGET}-Info.plist`
const ENTITLEMENTS = `${TARGET}.entitlements`

/** The Info.plist key both the app and the extension read the App Group's id from: `RavenTopShelfStore.groupKey`. */
const GROUP_KEY = 'RavenTopShelfGroup'
const APP_GROUPS = 'com.apple.security.application-groups'

const XCODE_EXTENSION = {
  appExtension: 'com.apple.product-type.app-extension',
  application: 'com.apple.product-type.application',
  resourcesPhase: 'PBXResourcesBuildPhase',
  resourcesComment: 'Resources',
  copyFilesPhase: 'PBXCopyFilesBuildPhase',
  embedComment: 'Embed Foundation Extensions',
  // The `xcode` package's word for a copy phase into the app's PlugIns folder.
  embedDestination: 'app_extension',
  targetDependency: 'PBXTargetDependency',
  itemProxy: 'PBXContainerItemProxy',
  png: 'image.png',
} as const

/** The app's own target, the one product of type application. */
const appTargetOf = (project: XcodeProjectApi): string | null =>
  targetOf({
    project,
    matches: (target) => unquoted(target.productType) === XCODE_EXTENSION.application,
  })

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

/*
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
  ...TV_TARGET_SETTINGS,
  SKIP_INSTALL: 'YES',
  APPLICATION_EXTENSION_API_ONLY: 'YES',
  LD_RUNPATH_SEARCH_PATHS: quoted(
    '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks',
  ),
})

/** Makes sure the sections a target dependency is written into exist; a fresh Expo project has neither. */
const withDependencySections = (project: XcodeProjectApi): void => {
  const { objects } = project.hash.project
  ;[XCODE_EXTENSION.targetDependency, XCODE_EXTENSION.itemProxy]
    .filter((section) => !isRecord(objects[section]))
    .forEach((section) => Reflect.set(objects, section, {}))
}

/** Marks the invitation's pictures as PNGs, which the `xcode` package leaves of unknown type. */
const markPictures = (project: XcodeProjectApi): void =>
  Object.values(project.pbxFileReferenceSection())
    .filter(isRecord)
    .filter((file) => SIGN_IN_FILES.some((name) => unquoted(file.path) === name))
    .forEach((file) => Reflect.set(file, 'lastKnownFileType', XCODE_EXTENSION.png))

type AddTopShelfProps = {
  project: XcodeProjectApi
  app: string
  bundleId: string
  team: string | null
  swift: string[]
}

/** Adds the extension's target, builds it before the app and embeds it in the app's PlugIns. */
const addTopShelf = ({ project, app, bundleId, team, swift }: AddTopShelfProps): void => {
  const { uuid, product } = addNativeTarget({
    project,
    name: TARGET,
    productType: XCODE_EXTENSION.appExtension,
    productFile: `${TARGET}.appex`,
    productGroup: XCODE_EXTENSION.embedComment,
    buildSettings: extensionSettingsOf({ bundleId, team }),
  })
  project.addToPbxBuildFileSection(product)

  addTargetGroup({
    project,
    name: TARGET,
    files: [...swift, ...SIGN_IN_FILES, INFO_PLIST, ENTITLEMENTS],
  })
  markPictures(project)
  project.addBuildPhase(swift, XCODE.sourcesPhase, XCODE.sourcesComment, uuid)
  project.addBuildPhase(
    SIGN_IN_FILES,
    XCODE_EXTENSION.resourcesPhase,
    XCODE_EXTENSION.resourcesComment,
    uuid,
  )
  project.addBuildPhase([], XCODE.frameworksPhase, XCODE.frameworksComment, uuid)

  withDependencySections(project)
  project.addTargetDependency(app, [uuid])
  const embed = project.addBuildPhase(
    [],
    XCODE_EXTENSION.copyFilesPhase,
    XCODE_EXTENSION.embedComment,
    app,
    XCODE_EXTENSION.embedDestination,
  )
  embed.buildPhase.files.push({
    value: product.uuid,
    comment: `${product.basename} in ${XCODE_EXTENSION.embedComment}`,
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
      const file = basename(source)
      copyFileSync(join(projectRoot, PACKAGE, source), join(folder, file))
      return file
    })
    SIGN_IN_PICTURES.forEach(({ scale, file }) =>
      copyFileSync(join(projectRoot, signIn[scale]), join(folder, file)),
    )
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
    if (hasTarget({ project, name: TARGET })) return mod

    addTopShelf({ project, app, bundleId: `${appId}.top-shelf`, team, swift })
    return mod
  })
}
