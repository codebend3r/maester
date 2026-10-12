import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Res,
} from '@nestjs/common'
import { type AdminLock, isAdminUnlockRequest } from '@raven/core'
import type { FastifyReply } from 'fastify'
import { type AdminChange, AdminService } from '@/admin/adminService'
import { parseBody } from '@/parseBody'

/** The lock as a change leaves it, with the cookie that carries it set on the reply. */
const applied = ({ change, reply }: { change: AdminChange; reply: FastifyReply }): AdminLock => {
  reply.header('set-cookie', change.cookie)
  return change.lock
}

@Controller('api/admin')
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get()
  state(@Headers('cookie') cookie: string | undefined): AdminLock {
    return this.admin.state({ cookie })
  }

  /** `{ password }`: turns the admin lock off for this browser. */
  @Post('unlock')
  @HttpCode(200)
  unlock(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply): AdminLock {
    const { password } = parseBody({
      guard: isAdminUnlockRequest,
      body,
      message: 'password must be text',
    })
    const unlocking = this.admin.unlock(password)
    if (!unlocking.ok) throw new HttpException(unlocking.message, unlocking.status)
    reply.header('set-cookie', unlocking.cookie)
    return { state: 'off' }
  }

  /** Turns the admin lock back on for this browser, after a wait in which it can be taken back. */
  @Post('lock')
  @HttpCode(200)
  lock(
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): AdminLock {
    const change = this.admin.lock({ cookie })
    return change ? applied({ change, reply }) : this.admin.state({ cookie })
  }

  /** Takes back a lock still on its way; once it holds, only the password turns it off. */
  @Post('keep-unlocked')
  @HttpCode(200)
  keepUnlocked(
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): AdminLock {
    const change = this.admin.keepUnlocked({ cookie })
    if (!change) {
      throw new ConflictException(
        'The admin lock is on already. Enter the password to turn it off.',
      )
    }
    return applied({ change, reply })
  }
}
