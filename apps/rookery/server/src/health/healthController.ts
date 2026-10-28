import { Controller, Get } from '@nestjs/common'
import { ROUTES } from '@/routes'

export const HEALTH_STATUSES = { ok: 'ok' } as const

/** Ungated, so the container healthcheck can probe it without a session. */
@Controller()
export class HealthController {
  @Get(ROUTES.health)
  get(): { status: typeof HEALTH_STATUSES.ok } {
    return { status: HEALTH_STATUSES.ok }
  }
}
