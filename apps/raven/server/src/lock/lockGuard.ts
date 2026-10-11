import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  RequestMethod,
  SetMetadata,
  type Type,
} from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import { LOCKED_STATUS, isNumber, isRecord, isString } from '@raven/core'
import { LockService, PRIVACIES, type Privacy } from '@/lock/lockService'

const PRIVACY = Symbol('PRIVACY')

/** What a route says about the lock: what its `:id` names, or that it holds nothing back. */
export type LockMark = Privacy | 'public'

const isPrivacy = (value: unknown): value is Privacy =>
  PRIVACIES.some((privacy) => privacy === value)

const isLockMark = (value: unknown): value is LockMark => value === 'public' || isPrivacy(value)

/**
 * Marks a route, or every route of a controller, whose `:id` sits in a
 * library that may be locked, and says what the id names.
 */
export const PrivateBy = (privacy: Privacy) => SetMetadata(PRIVACY, privacy)

/**
 * Marks a route, or a controller, that takes a parameter yet holds nothing
 * back by it: what it names is not in a library, or it hides what this
 * browser may not see itself. A route's own mark wins over its controller's.
 */
export const Public = () => SetMetadata(PRIVACY, 'public')

/** A route as its decorators declare it, with the lock mark it carries. */
export type RouteMark = { method: string; path: string; mark: LockMark | null }

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
    const classMark: unknown = decorators.get(PRIVACY, controller)
    return Object.getOwnPropertyNames(prototype).flatMap((name): RouteMark[] => {
      const handler = prototype[name]
      if (name === 'constructor' || typeof handler !== 'function') return []
      const path: unknown = decorators.get(PATH_METADATA, handler)
      if (path == null) return []
      const ownMark: unknown = decorators.get(PRIVACY, handler)
      const mark = ownMark ?? classMark
      return [
        {
          method: methodName(decorators.get(METHOD_METADATA, handler)),
          path: joinPath([base, path]),
          mark: isLockMark(mark) ? mark : null,
        },
      ]
    })
  })

const takesParameter = (path: string): boolean =>
  path.split('/').some((segment) => segment.startsWith(':'))

const takesId = (path: string): boolean => path.split('/').includes(':id')

/**
 * What is wrong with the routes' marks: a route that takes a parameter must
 * say whether the lock holds it, and one the lock holds must name its `:id`.
 */
export const lockMarkProblems = (routes: readonly RouteMark[]): string[] =>
  routes.flatMap(({ method, path, mark }) => {
    if (mark == null && takesParameter(path)) {
      return [`${method} ${path} takes a parameter but is marked neither PrivateBy nor Public`]
    }
    if (isPrivacy(mark) && !takesId(path)) {
      return [`${method} ${path} is marked PrivateBy('${mark}') but has no :id`]
    }
    return []
  })

/** Refuses to start a server with a route that could serve a locked library's ids unchecked. */
export const assertLockMarked = (controllers: readonly Type[]): void => {
  const problems = lockMarkProblems(routeMarks(controllers))
  if (problems.length > 0) throw new Error(`Unmarked routes: ${problems.join('; ')}`)
}

/**
 * Answers 423 Locked for a route marked `PrivateBy`, on itself or its
 * controller, whose id sits in a locked library this browser has not
 * unlocked. `assertLockMarked` keeps every route with a parameter marked, so
 * the routes that pass unchecked take no id.
 */
@Injectable()
export class LockGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(LockService) private readonly lock: LockService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const mark: unknown = this.reflector.getAllAndOverride(PRIVACY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!isPrivacy(mark)) return true
    const request: unknown = context.switchToHttp().getRequest()
    const headers = isRecord(request) && isRecord(request.headers) ? request.headers : {}
    const params = isRecord(request) && isRecord(request.params) ? request.params : {}
    const cookie = isString(headers.cookie) ? headers.cookie : undefined
    if (this.lock.viewer({ cookie }).sees({ privacy: mark, id: Number(params.id) })) return true
    throw new HttpException('This library is locked.', LOCKED_STATUS)
  }
}
