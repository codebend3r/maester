import { Controller, Get } from '@nestjs/common'
import { ROUTES } from '@rookery/core'

export const HEALTH_STATUSES = { ok: 'ok' } as const

type HealthAnswer = { status: typeof HEALTH_STATUSES.ok }

/** Ungated, so the container healthcheck can probe it without a session. */
@Controller()
export class HealthController {
  @Get(ROUTES.health)
  get(): HealthAnswer {
    return { status: HEALTH_STATUSES.ok }
  }
}
