import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AUTH_REFUSALS } from '@raven/core'
import { HTTP_METHODS } from '@shared/server'
import type { FastifyRequest } from 'fastify'
import { authFailure } from '@/auth/authFailure'
import { Management } from '@/auth/management'
import type { MarkTargets, RouteMark } from '@/routeMarks'

const AUDIENCE = Symbol('AUDIENCE')

/** Who a route is for: the admin alone, or anyone watching. */
export const AUDIENCES = { admin: 'admin', viewers: 'viewers' } as const

export type Audience = (typeof AUDIENCES)[keyof typeof AUDIENCES]

const isAudience = (value: unknown): value is Audience =>
  Object.values(AUDIENCES).some((audience) => audience === value)

const markAudience = (audience: Audience) => SetMetadata(AUDIENCE, audience)

/**
 * Marks a route, or every route of a controller, that the admin lock holds
 * back. A route that is not a GET is marked this unless it is marked
 * `ForViewers`, and the server will not start with one marked neither. A
 * GET is marked this when only managing raven needs it.
 */
export const AdminOnly = () => markAudience(AUDIENCES.admin)

/** Marks a route that is not a GET, yet stays open with the admin lock on. */
export const ForViewers = () => markAudience(AUDIENCES.viewers)

const decorators = new Reflector()

/** A route's audience, else its controller's, read the same by the guard and the route inventory. */
export const audienceOf = (targets: MarkTargets): Audience | null => {
  const audience: unknown = decorators.getAllAndOverride(AUDIENCE, targets)
  return isAudience(audience) ? audience : null
}

/**
 * What is wrong with the routes' audiences: a route that is not a GET must
 * say who it is for, and a GET, which changes nothing, has no viewers to
 * let through.
 */
export const audienceMarkProblems = (routes: readonly RouteMark[]): string[] =>
  routes.flatMap(({ method, path, audience }) => {
    if (audience == null && method !== HTTP_METHODS.get) {
      return [`${method} ${path} is not a GET but is marked neither AdminOnly nor ForViewers`]
    }
    if (audience === AUDIENCES.viewers && method === HTTP_METHODS.get) {
      return [`${method} ${path} is marked ForViewers, but a GET is marked AdminOnly or not at all`]
    }
    return []
  })

/**
 * Holds back a route marked `AdminOnly` from whoever cannot manage raven.
 * With accounts off that is a browser the admin lock holds, answered 403
 * Forbidden; once they are ready it is any account but the owner, answered
 * 403 `not_owner`. While they are unavailable the account gate has already
 * answered 503.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(Management) private readonly management: Pick<Management, 'canManage' | 'isLegacy'>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (audienceOf([context.getHandler(), context.getClass()]) !== AUDIENCES.admin) return true
    const request = context.switchToHttp().getRequest<FastifyRequest>()
    if (this.management.canManage({ request })) return true
    if (!this.management.isLegacy()) throw authFailure(AUTH_REFUSALS.notOwner)
    throw new ForbiddenException('The admin lock is on. Turn it off in Settings to do this.')
  }
}
