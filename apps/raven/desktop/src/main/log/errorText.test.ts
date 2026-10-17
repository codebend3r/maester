import { describe, expect, it } from 'bun:test'
import { readdir, realpath } from 'node:fs/promises'
import { errorText, isFsError } from '@/main/log/errorText'

const MISSING = '/Volumes/raven-missing-volume/Secret Film.mkv'

const rejectionOf = (run: () => Promise<unknown>): Promise<unknown> =>
  run().then(
    () => null,
    (error: unknown) => error,
  )

describe('errorText', () => {
  it('names only the call and the code of a real file system error, never its path', async () => {
    const error = await rejectionOf(() => realpath(MISSING))
    expect(isFsError(error)).toBe(true)
    // Node names the call `realpath`, Bun `lstat`.
    expect(errorText(error)).toMatch(/^[a-z]+ ENOENT$/)
    const listing = await rejectionOf(() => readdir('/Volumes/raven-missing-volume'))
    expect(errorText(listing)).toBe('scandir ENOENT')
  })

  it('is the message of any other error, and the text of anything else thrown', () => {
    expect(errorText(new Error('its page is gone.'))).toBe('its page is gone.')
    expect(errorText(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }))).toBe(
      'timed out',
    )
    expect(errorText('plain')).toBe('plain')
  })
})
