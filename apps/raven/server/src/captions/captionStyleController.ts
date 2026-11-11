import { Body, Controller, Get, Header, Inject, Put, Req } from '@nestjs/common'
import { CAPTION_PATHS, type CaptionStyle, isCaptionStyle } from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import type { FastifyRequest } from 'fastify'
import { ForViewers } from '@/admin/adminGuard'
import { CaptionStyles } from '@/captions/captionStyles'
import { ServerEvents } from '@/events/serverEvents'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { parseBody } from '@/parseBody'

/** How an account's subtitles look, the same on every device it signs in on. */
@Controller()
export class CaptionStyleController {
  constructor(
    @Inject(CaptionStyles) private readonly captions: CaptionStyles,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
    @Inject(ServerEvents) private readonly events: ServerEvents,
  ) {}

  /** The caller's own look, or the default until it picks one. */
  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @Get(CAPTION_PATHS.style)
  get(@Req() request: FastifyRequest): CaptionStyle {
    return this.captions.get({ account: this.accounts.keyOf({ request }) })
  }

  /** Keeps the caller's look and tells its other devices, which read it again. */
  @ForViewers()
  @Put(CAPTION_PATHS.style)
  set(@Req() request: FastifyRequest, @Body() body: unknown): CaptionStyle {
    const style = parseBody({
      guard: isCaptionStyle,
      body,
      message: 'Send { size, colour }, each one the subtitles offer.',
    })
    const account = this.accounts.keyOf({ request })
    this.captions.set({ account, style })
    this.events.captionsChanged(account)
    return this.captions.get({ account })
  }
}
