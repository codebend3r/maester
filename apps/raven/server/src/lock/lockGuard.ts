import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { LOCKED_STATUS, isRecord, isString } from '@raven/core'
import { LockService, PRIVACIES, type Privacy } from '@/lock/lockService'

const PRIVACY = Symbol('PRIVACY')

const isPrivacy = (value: unknown): value is Privacy =>
  PRIVACIES.some((privacy) => privacy === value)

/** Marks a route whose `:id` sits in a library that may be locked, and says what the id names. */
export const PrivateBy = (privacy: Privacy) => SetMetadata(PRIVACY, privacy)

/**
 * Answers 423 Locked for a route marked `PrivateBy` whose id sits in a
 * locked library this browser has not unlocked. Unmarked routes pass.
 */
@Injectable()
export class LockGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(LockService) private readonly lock: LockService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const privacy: unknown = this.reflector.get(PRIVACY, context.getHandler())
    if (!isPrivacy(privacy)) return true
    const request: unknown = context.switchToHttp().getRequest()
    const headers = isRecord(request) && isRecord(request.headers) ? request.headers : {}
    const params = isRecord(request) && isRecord(request.params) ? request.params : {}
    const cookie = isString(headers.cookie) ? headers.cookie : undefined
    if (this.lock.viewer({ cookie }).sees({ privacy, id: Number(params.id) })) return true
    throw new HttpException('This library is locked.', LOCKED_STATUS)
  }
}
