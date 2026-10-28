import { describe, expect, test } from 'bun:test'
import { prebuilt } from '@/build/windowsLock'
import { isPrebuilt } from '@/windows'

describe('the Windows libmpv lock', () => {
  test('names one release archive by digest, with the DLL digest inside it', async () => {
    const locked = await prebuilt()
    expect(locked.name).toBe('libmpv')
    expect(locked.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(locked.libmpvSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(locked.url).toStartWith(`${locked.repository}/releases/download/${locked.release}/`)
    expect(isPrebuilt({ ...locked, url: locked.url.replace('https:', 'http:') })).toBe(false)
    expect(isPrebuilt({ ...locked, release: 'latest' })).toBe(false)
    expect(isPrebuilt({ ...locked, mpvCommit: 'main' })).toBe(false)
    expect(isPrebuilt({ ...locked, sha256: 'unverified' })).toBe(false)
    expect(isPrebuilt({ ...locked, repository: 'https://untrusted.invalid/mpv' })).toBe(false)
    expect(isPrebuilt(null)).toBe(false)
  })
})
