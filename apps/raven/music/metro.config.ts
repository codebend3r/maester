import path from 'node:path'

import { getDefaultConfig } from 'expo/metro-config'

const appRoot = __dirname
const workspaceRoot = path.resolve(appRoot, '../../..')
const sourceRoot = path.join(appRoot, 'src')
const SOURCE_ALIAS = '@/'

const config = getDefaultConfig(appRoot)

type Resolver = NonNullable<NonNullable<typeof config.resolver>['resolveRequest']>

// `@/` means the app's own src only when the app imports it: a package in
// node_modules that writes `@/` means something of its own.
const isAppModule = (modulePath: string): boolean =>
  modulePath.startsWith(`${appRoot}${path.sep}`) &&
  !modulePath.includes(`${path.sep}node_modules${path.sep}`)

const resolveRequest: Resolver = (context, moduleName, platform) => {
  const isAliased = moduleName.startsWith(SOURCE_ALIAS) && isAppModule(context.originModulePath)
  const target = isAliased
    ? path.join(sourceRoot, moduleName.slice(SOURCE_ALIAS.length))
    : moduleName
  return context.resolveRequest(context, target, platform)
}

export default {
  ...config,
  // The workspace packages (@raven/core, @raven/ui) and Bun's package store
  // live above the app, so Metro watches the whole workspace.
  watchFolders: [workspaceRoot],
  resolver: {
    ...config.resolver,
    nodeModulesPaths: [
      path.join(appRoot, 'node_modules'),
      path.join(workspaceRoot, 'node_modules'),
    ],
    // @raven/ui's entries (`@raven/ui/headless`, `@raven/ui/designTokens`)
    // exist only in its package exports.
    unstable_enablePackageExports: true,
    resolveRequest,
  },
} satisfies typeof config
