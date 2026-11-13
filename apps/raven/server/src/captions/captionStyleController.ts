import { Body, Controller, Get, Header, Inject, Put } from '@nestjs/common'
import { CAPTION_PATHS, type CaptionStyle, isCaptionStyle } from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import { ForViewers } from '@/admin/adminGuard'
import { CaptionStyles } from '@/captions/captionStyles'
import { ServerEvents } from '@/events/serverEvents'
import { parseBody } from '@/parseBody'
import { ViewingAccount } from '@/media/viewingAccountParam'
import type { AccountKey } from '@/media/viewingAccountKeys'

/** How an account's subtitles look, the same on every device it signs in on. */
@Controller()
export class CaptionStyleController {
  constructor(
    @Inject(CaptionStyles) private readonly captions: CaptionStyles,
    @Inject(ServerEvents) private readonly events: ServerEvents,
  ) {}

  /** The caller's own look, or the default until it picks one. */
  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @Get(CAPTION_PATHS.style)
  get(@ViewingAccount() account: AccountKey): CaptionStyle {
    return this.captions.get({ account })
  }

  /** Keeps the caller's look and tells its other devices, which read it again. */
  @ForViewers()
  @Put(CAPTION_PATHS.style)
  set(@Body() body: unknown, @ViewingAccount() account: AccountKey): CaptionStyle {
    const style = parseBody({
      guard: isCaptionStyle,
      body,
      message: 'Send { size, colour }, each one the subtitles offer.',
    })
    this.captions.set({ account, style })
    this.events.captionsChanged(account)
    return this.captions.get({ account })
  }
}
