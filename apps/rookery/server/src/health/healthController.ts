import { Controller, Get } from '@nestjs/common'

export const HEALTH_STATUSES = { ok: 'ok' } as const

/** Ungated, so the container healthcheck can probe it without a session. */
@Controller('health')
export class HealthController {
  @Get()
  get(): { status: typeof HEALTH_STATUSES.ok } {
    return { status: HEALTH_STATUSES.ok }
  }
}
