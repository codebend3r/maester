import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Res,
} from '@nestjs/common'
import { type LockState, isRecord, isString } from '@raven/core'
import type { FastifyReply } from 'fastify'
import { LockService } from '@/lock/lockService'

@Controller('api/lock')
export class LockController {
  constructor(@Inject(LockService) private readonly lock: LockService) {}

  @Get()
  state(@Headers('cookie') cookie: string | undefined): LockState {
    return this.lock.state({ cookie })
  }

  /** `{ pin }`: opens every locked library for this browser. */
  @Post('unlock')
  @HttpCode(200)
  unlock(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply): LockState {
    const pin = isRecord(body) && isString(body.pin) ? body.pin : ''
    const unlocking = this.lock.unlock(pin)
    if (!unlocking.ok) throw new HttpException(unlocking.message, unlocking.status)
    reply.header('set-cookie', unlocking.cookie)
    return { available: true, unlocked: true }
  }

  /** Shuts the locked libraries again for this browser. */
  @Post('lock')
  @HttpCode(200)
  relock(@Res({ passthrough: true }) reply: FastifyReply): LockState {
    reply.header('set-cookie', this.lock.lockCookie())
    return { available: this.lock.available, unlocked: false }
  }
}
