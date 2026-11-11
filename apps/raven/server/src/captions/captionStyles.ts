import { Inject, Injectable } from '@nestjs/common'
import { type CaptionStyle, DEFAULT_CAPTION_STYLE, isCaptionStyle } from '@raven/core'
import { DatabaseService } from '@/db/database'
import type { AccountKey, ByAccount } from '@/media/viewingAccountKeys'

type CaptionStylesGetProps = { account: AccountKey }

type CaptionStylesSetProps = { account: AccountKey; style: CaptionStyle }

/** A kept look as its row holds it: text the contract's guard has yet to read. */
type CaptionStyleRow = { size: string; colour: string }

/**
 * How each account's subtitles look, one size and one colour, kept here so
 * every device an account signs in on draws them the same.
 */
@Injectable()
export class CaptionStyles {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  /**
   * `account`'s look, or the default until it picks one. A row a later
   * release no longer offers (a size or colour since dropped) reads as the
   * default too, so no client is handed a look it cannot draw.
   */
  get({ account }: CaptionStylesGetProps): CaptionStyle {
    const row = this.db
      .prepare<ByAccount, CaptionStyleRow>(
        'SELECT size, colour FROM caption_styles WHERE account_id = @account',
      )
      .get({ account })
    return isCaptionStyle(row) ? row : DEFAULT_CAPTION_STYLE
  }

  set({ account, style }: CaptionStylesSetProps): void {
    this.db
      .prepare<ByAccount & CaptionStyle>(
        `INSERT INTO caption_styles (account_id, size, colour) VALUES (@account, @size, @colour)
         ON CONFLICT (account_id) DO UPDATE SET size = excluded.size, colour = excluded.colour`,
      )
      .run({ account, size: style.size, colour: style.colour })
  }
}
