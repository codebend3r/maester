import { CAPTION_COLOURS, CAPTION_SIZES, DEFAULT_CAPTION_STYLE } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CaptionStyles } from '@/captions/captionStyles'
import { testDatabase } from '@/test/database'
import { TEST_ACCOUNTS } from '@/test/repositories'

describe('caption styles', () => {
  const database = testDatabase('raven-caption-styles-')
  const captions = () => new CaptionStyles(database.get())

  beforeAll(() => database.open())
  afterAll(() => database.close())

  it('answers the default until the account picks a look', () => {
    expect(captions().get({ account: TEST_ACCOUNTS.a })).toEqual(DEFAULT_CAPTION_STYLE)
  })

  it('keeps the look an account sets, and its latest over an earlier one', () => {
    const account = TEST_ACCOUNTS.a
    captions().set({
      account,
      style: { size: CAPTION_SIZES.large, colour: CAPTION_COLOURS.yellow },
    })
    expect(captions().get({ account })).toEqual({
      size: CAPTION_SIZES.large,
      colour: CAPTION_COLOURS.yellow,
    })
    captions().set({
      account,
      style: { size: CAPTION_SIZES.small, colour: CAPTION_COLOURS.cyan },
    })
    expect(captions().get({ account })).toEqual({
      size: CAPTION_SIZES.small,
      colour: CAPTION_COLOURS.cyan,
    })
  })

  it("never shows one account's look to another", () => {
    captions().set({
      account: TEST_ACCOUNTS.a,
      style: { size: CAPTION_SIZES.largest, colour: CAPTION_COLOURS.green },
    })
    expect(captions().get({ account: TEST_ACCOUNTS.b })).toEqual(DEFAULT_CAPTION_STYLE)
    captions().set({
      account: TEST_ACCOUNTS.b,
      style: { size: CAPTION_SIZES.small, colour: CAPTION_COLOURS.yellow },
    })
    expect(captions().get({ account: TEST_ACCOUNTS.a })).toEqual({
      size: CAPTION_SIZES.largest,
      colour: CAPTION_COLOURS.green,
    })
  })

  it('answers the default for a kept look the contract no longer offers', () => {
    const account = '30000000-0000-4000-8000-000000000006'
    database
      .get()
      .db.prepare('INSERT INTO caption_styles (account_id, size, colour) VALUES (?, ?, ?)')
      .run(account, 'enormous', CAPTION_COLOURS.white)
    expect(captions().get({ account })).toEqual(DEFAULT_CAPTION_STYLE)
  })
})
