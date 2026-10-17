import { RequestMethod, type Type } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import { isNumber, isRecord, isString } from '@raven/core'
import { type Audience, audienceMarkProblems, audienceOf } from '@/admin/adminGuard'
import { type LockMark, lockMarkOf, lockMarkProblems } from '@/lock/lockGuard'
import { isMediaPlaneRoute } from '@/media/mediaPlaneMark'

/** Where a route's mark is read: its handler, then its controller, the first mark found winning. */
export type MarkTargets = Parameters<Reflector['getAllAndOverride']>[1]

/** A route as its decorators declare it, with what it says to the PIN lock and to the admin lock, and whether it is on the media plane. */
export type RouteMark = {
  method: string
  path: string
  lock: LockMark | null
  audience: Audience | null
  mediaPlane: boolean
}

const decorators = new Reflector()

const joinPath = (parts: readonly unknown[]): string =>
  `/${parts
    .filter(isString)
    .flatMap((part) => part.split('/'))
    .filter((segment) => segment !== '')
    .join('/')}`

const methodName = (value: unknown): string =>
  isNumber(value) ? (RequestMethod[value] ?? 'ALL') : 'ALL'

/** Every route the controllers declare, read from their decorators. */
export const routeMarks = (controllers: readonly Type[]): RouteMark[] =>
  controllers.flatMap((controller) => {
    const prototype: unknown = controller.prototype
    if (!isRecord(prototype)) return []
    const base: unknown = decorators.get(PATH_METADATA, controller)
    return Object.getOwnPropertyNames(prototype).flatMap((name): RouteMark[] => {
      const handler = prototype[name]
      // A class's prototype holds the class itself as `constructor`.
      if (handler === controller || typeof handler !== 'function') return []
      const path: unknown = decorators.get(PATH_METADATA, handler)
      if (path == null) return []
      const targets = [handler, controller]
      return [
        {
          method: methodName(decorators.get(METHOD_METADATA, handler)),
          path: joinPath([base, path]),
          lock: lockMarkOf(targets),
          audience: audienceOf(targets),
          mediaPlane: isMediaPlaneRoute(targets),
        },
      ]
    })
  })

/**
 * Refuses to start a server with a route the locks were not told about: one
 * that could serve a locked library's ids unchecked, or change something
 * with nothing said about who may.
 */
export const assertRoutesMarked = (controllers: readonly Type[]): void => {
  const routes = routeMarks(controllers)
  const problems = [...lockMarkProblems(routes), ...audienceMarkProblems(routes)]
  if (problems.length > 0) throw new Error(`Unmarked routes: ${problems.join('; ')}`)
}
