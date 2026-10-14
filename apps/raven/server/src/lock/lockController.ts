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
import { type LockState, isUnlockRequest } from '@raven/core'
import type { FastifyReply } from 'fastify'
import { ForViewers } from '@/admin/adminGuard'
import { LockService } from '@/lock/lockService'
import { parseBody } from '@/parseBody'

@Controller('api/lock')
export class LockController {
  constructor(@Inject(LockService) private readonly lock: LockService) {}

  @Get()
  state(@Headers('cookie') cookie: string | undefined): LockState {
    return this.lock.state({ cookie })
  }

  /** `{ pin }`: opens every locked library for this browser. */
  @ForViewers()
  @Post('unlock')
  @HttpCode(200)
  unlock(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply): LockState {
    const { pin } = parseBody({ guard: isUnlockRequest, body, message: 'pin must be text' })
    const unlocking = this.lock.unlock(pin)
    if (!unlocking.ok) throw new HttpException(unlocking.message, unlocking.status)
    reply.header('set-cookie', unlocking.cookie)
    return { available: true, unlocked: true }
  }

  /** Shuts the locked libraries again for this browser. */
  @ForViewers()
  @Post('lock')
  @HttpCode(200)
  relock(@Res({ passthrough: true }) reply: FastifyReply): LockState {
    reply.header('set-cookie', this.lock.lockCookie())
    return { available: this.lock.available, unlocked: false }
  }
}
