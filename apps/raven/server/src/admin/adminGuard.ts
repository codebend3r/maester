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

const ADMIN_ONLY = Symbol('ADMIN_ONLY')

/**
 * Marks a route the admin lock holds back: one that manages raven rather
 * than watches it, such as adding, scanning or matching a library, fixing a
 * match, editing an item, browsing the server's folders, changing the
 * settings, deleting a video's file, or handing out its path.
 */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true)

/** Answers 403 Forbidden for a route marked `AdminOnly` while the admin lock holds for this browser. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AdminService) private readonly admin: AdminService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const adminOnly: unknown = this.reflector.getAllAndOverride(ADMIN_ONLY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (adminOnly !== true) return true
    if (!this.admin.isLocked({ cookie: requestParts(context).cookie })) return true
    throw new ForbiddenException('The admin lock is on. Turn it off in Settings to do this.')
  }
}
