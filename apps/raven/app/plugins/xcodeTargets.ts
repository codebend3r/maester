/*
 * What the TV plugins share to add a native target to the `xcode` package's project Expo hands
 * an Xcode mod: its types, the guard that finds its methods, and the target itself.
 */

export const XCODE = {
  builtProducts: 'BUILT_PRODUCTS_DIR',
  sourcesPhase: 'PBXSourcesBuildPhase',
  sourcesComment: 'Sources',
  frameworksPhase: 'PBXFrameworksBuildPhase',
  frameworksComment: 'Frameworks',
  configuration: 'XCBuildConfiguration',
  nativeTarget: 'PBXNativeTarget',
  release: 'Release',
  debug: 'Debug',
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

/** A product file as `addProductFile` answers it. */
type ProductFile = { uuid: string; fileRef: string; basename: string; group: string }

type AddProductFileProps = { group: string; target: string; sourceTree: string }

type BuildPhaseFile = { value: string; comment: string }

/**
 * The part of the `xcode` package's project Expo hands a mod that the plugins call. The
 * package ships no types; these are its own methods, with their own positional signatures.
 */
export type XcodeProjectApi = {
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

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const hasObjects = (value: unknown): boolean => {
  const project: unknown = isRecord(value) && isRecord(value.hash) && value.hash.project
  return isRecord(project) && isRecord(project.objects)
}

export const isXcodeProjectApi = (value: unknown): value is XcodeProjectApi =>
  isRecord(value) &&
  XCODE_METHODS.every((method) => typeof Reflect.get(value, method) === 'function') &&
  hasObjects(value)

/** Quoted as a pbxproj value that holds a space, a slash or a hyphen must be. */
export const quoted = (value: string): string => `"${value}"`

export const unquoted = (value: unknown): unknown =>
  typeof value === 'string' ? value.replace(/^"(.*)"$/, '$1') : value

type TargetOfProps = {
  project: XcodeProjectApi
  matches: (target: Record<string, unknown>) => boolean
}

/** The uuid of the first native target `matches` picks; null when none does. */
export const targetOf = ({ project, matches }: TargetOfProps): string | null =>
  Object.entries(project.pbxNativeTargetSection()).find(
    ([, target]) => isRecord(target) && matches(target),
  )?.[0] ?? null

type HasTargetProps = { project: XcodeProjectApi; name: string }

/**
 * Whether the project has the target already: the mod has run on this project before. A
 * prebuild, with `--clean` or without, hands it a fresh project file, so only a second run on
 * the same one finds it.
 */
export const hasTarget = ({ project, name }: HasTargetProps): boolean =>
  targetOf({ project, matches: (target) => unquoted(target.name) === name }) !== null

/** What every tvOS target the plugins add is built for. */
export const TV_TARGET_SETTINGS = {
  SDKROOT: 'appletvos',
  SUPPORTED_PLATFORMS: quoted('appletvos appletvsimulator'),
  TARGETED_DEVICE_FAMILY: '3',
  // The app's own, so the target runs on any Apple TV the app does; unset, it is the newest SDK's.
  TVOS_DEPLOYMENT_TARGET: '16.4',
  SWIFT_VERSION: '5.0',
} as const

type AddNativeTargetProps = {
  project: XcodeProjectApi
  name: string
  productType: string
  /** The product's file name, `<name>.appex` or `<name>.xctest`. */
  productFile: string
  /** The group `addProductFile` files the product under. */
  productGroup: string
  buildSettings: Record<string, string>
}

type AddedTarget = { uuid: string; product: ProductFile }

/** Adds a native target with its Debug and Release settings and its product, and no phases yet. */
export const addNativeTarget = ({
  project,
  name,
  productType,
  productFile,
  productGroup,
  buildSettings,
}: AddNativeTargetProps): AddedTarget => {
  const uuid = project.generateUuid()
  const configurations = project.addXCConfigurationList(
    [XCODE.debug, XCODE.release].map((configuration) => ({
      name: configuration,
      isa: XCODE.configuration,
      buildSettings,
    })),
    XCODE.release,
    `Build configuration list for PBXNativeTarget "${name}"`,
  )
  const product = project.addProductFile(productFile, {
    group: productGroup,
    target: uuid,
    sourceTree: XCODE.builtProducts,
  })
  const target: NativeTarget = {
    uuid,
    pbxNativeTarget: {
      isa: XCODE.nativeTarget,
      name: quoted(name),
      productName: quoted(name),
      productReference: product.fileRef,
      productType: quoted(productType),
      buildConfigurationList: configurations.uuid,
      buildPhases: [],
      buildRules: [],
      dependencies: [],
    },
  }
  project.addToPbxNativeTargetSection(target)
  project.addToPbxProjectSection(target)
  return { uuid, product }
}

type AddTargetGroupProps = { project: XcodeProjectApi; name: string; files: string[] }

/** The target's folder in `ios/` as a group under the project's main group. */
export const addTargetGroup = ({ project, name, files }: AddTargetGroupProps): void => {
  const group = project.addPbxGroup(files, name, name)
  project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup)
}
