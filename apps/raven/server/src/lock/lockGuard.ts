import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { LOCKED_STATUS, isString } from '@raven/core'
import { AdminService } from '@/admin/adminService'
import { LockService, PRIVACIES, type Privacy } from '@/lock/lockService'
import { isMediaPlaneRoute } from '@/media/mediaPlaneMark'
import { MediaTickets } from '@/media/mediaTickets'
import { requestParts } from '@/requestParts'
import type { MarkTargets, RouteMark } from '@/routeMarks'

const PRIVACY = Symbol('PRIVACY')

/** What the routes answer for an id that names nothing, so one held out of sight reads the same. */
const NOT_FOUND: Record<Privacy, string> = {
  library: 'No library',
  media: 'No media',
  item: 'No item',
}

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

const decorators = new Reflector()

/** A route's lock mark, else its controller's, read the same by the guard and the route inventory. */
export const lockMarkOf = (targets: MarkTargets): LockMark | null => {
  const mark: unknown = decorators.getAllAndOverride(PRIVACY, targets)
  return isLockMark(mark) ? mark : null
}

const takesParameter = (path: string): boolean =>
  path.split('/').some((segment) => segment.startsWith(':'))

const takesId = (path: string): boolean => path.split('/').includes(':id')

/**
 * What is wrong with the routes' marks: a route that takes a parameter must
 * say whether the lock holds it, and one the lock holds must name its `:id`.
 */
export const lockMarkProblems = (routes: readonly RouteMark[]): string[] =>
  routes.flatMap(({ method, path, lock, mediaPlane }) => {
    if (mediaPlane && method !== 'GET') {
      return [`${method} ${path} is marked MediaPlane but is not a GET`]
    }
    if (mediaPlane && isPrivacy(lock) && lock !== 'media') {
      return [
        `${method} ${path} is marked MediaPlane but is held by PrivateBy('${lock}') rather than 'media'`,
      ]
    }
    if (lock == null && takesParameter(path)) {
      return [`${method} ${path} takes a parameter but is marked neither PrivateBy nor Public`]
    }
    if (isPrivacy(lock) && !takesId(path)) {
      return [`${method} ${path} is marked PrivateBy('${lock}') but has no :id`]
    }
    return []
  })

/**
 * Answers 423 Locked for a route marked `PrivateBy`, on itself or its
 * controller, whose id sits in a locked library this browser has not
 * unlocked. While the admin lock holds it answers 404 instead, as if there
 * were no such library, so nothing asks for the PIN. A media plane route
 * held by `PrivateBy('media')` also opens to a media ticket for its id in
 * `?t=`, for the origins a browser sends no cookie to. `assertRoutesMarked`
 * keeps every route with a parameter marked, so the routes that pass
 * unchecked take no id.
 */
@Injectable()
export class LockGuard implements CanActivate {
  constructor(
    @Inject(LockService) private readonly lock: Pick<LockService, 'viewer'>,
    @Inject(AdminService) private readonly admin: Pick<AdminService, 'isLocked'>,
    @Inject(MediaTickets) private readonly tickets: Pick<MediaTickets, 'verify'>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const mark = lockMarkOf([context.getHandler(), context.getClass()])
    if (!isPrivacy(mark)) return true
    const { params, query, cookie } = requestParts(context)
    const id = Number(params.id)
    const ticket = query.t
    if (
      mark === 'media' &&
      isMediaPlaneRoute([context.getHandler(), context.getClass()]) &&
      isString(ticket) &&
      this.tickets.verify({ ticket, id })
    ) {
      return true
    }
    if (this.lock.viewer({ cookie }).sees({ privacy: mark, id })) return true
    if (this.admin.isLocked({ cookie })) throw new NotFoundException(`${NOT_FOUND[mark]} ${id}`)
    throw new HttpException('This library is locked.', LOCKED_STATUS)
  }
}
