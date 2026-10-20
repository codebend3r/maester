import { HEADERS } from '@shared/server'
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common'
import { type LockState, isUnlockRequest } from '@raven/core'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { ForViewers } from '@/admin/adminGuard'
import { LockService } from '@/lock/lockService'
import { parseBody } from '@/parseBody'

@Controller('api/lock')
export class LockController {
  constructor(@Inject(LockService) private readonly lock: LockService) {}

  @Get()
  state(@Req() request: FastifyRequest): LockState {
    return this.lock.state({ request })
  }

  /** `{ pin }`: opens every locked library for this browser, to the owner once accounts are ready. */
  @ForViewers()
  @Post('unlock')
  @HttpCode(200)
  unlock(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): LockState {
    const { pin } = parseBody({ guard: isUnlockRequest, body, message: 'pin must be text' })
    const unlocking = this.lock.unlock({ pin, request })
    if (!unlocking.ok) throw new HttpException(unlocking.message, unlocking.status)
    reply.header(HEADERS.setCookie, unlocking.cookie)
    return { available: true, unlocked: true }
  }

  /** Shuts the locked libraries again for this browser. */
  @ForViewers()
  @Post('lock')
  @HttpCode(200)
  relock(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): LockState {
    reply.header(HEADERS.setCookie, this.lock.lockCookie())
    return { ...this.lock.state({ request }), unlocked: false }
  }
}
