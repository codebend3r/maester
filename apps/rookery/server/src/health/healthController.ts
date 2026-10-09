import { Controller, Get } from '@nestjs/common'

/** Ungated, so the container healthcheck can probe it without a session. */
@Controller('health')
export class HealthController {
  @Get()
  get(): { status: 'ok' } {
    return { status: 'ok' }
  }
}
