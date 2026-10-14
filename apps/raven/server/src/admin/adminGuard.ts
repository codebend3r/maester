import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AdminService } from '@/admin/adminService'
import { requestParts } from '@/requestParts'
import type { MarkTargets, RouteMark } from '@/routeMarks'

const AUDIENCE = Symbol('AUDIENCE')

/** Who a route is for: the admin alone, or anyone watching. */
const AUDIENCES = ['admin', 'viewers'] as const

export type Audience = (typeof AUDIENCES)[number]

const isAudience = (value: unknown): value is Audience =>
  AUDIENCES.some((audience) => audience === value)

const markAudience = (audience: Audience) => SetMetadata(AUDIENCE, audience)

/**
 * Marks a route, or every route of a controller, that the admin lock holds
 * back. A route that is not a GET is marked this unless it is marked
 * `ForViewers`, and the server will not start with one marked neither. A
 * GET is marked this when only managing raven needs it.
 */
export const AdminOnly = () => markAudience('admin')

/** Marks a route that is not a GET, yet stays open with the admin lock on. */
export const ForViewers = () => markAudience('viewers')

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
    if (audience == null && method !== 'GET') {
      return [`${method} ${path} is not a GET but is marked neither AdminOnly nor ForViewers`]
    }
    if (audience === 'viewers' && method === 'GET') {
      return [`${method} ${path} is marked ForViewers, but a GET is marked AdminOnly or not at all`]
    }
    return []
  })

/** Answers 403 Forbidden for a route marked `AdminOnly` while the admin lock holds for this browser. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  canActivate(context: ExecutionContext): boolean {
    if (audienceOf([context.getHandler(), context.getClass()]) !== 'admin') return true
    if (!this.admin.isLocked({ cookie: requestParts(context).cookie })) return true
    throw new ForbiddenException('The admin lock is on. Turn it off in Settings to do this.')
  }
}
