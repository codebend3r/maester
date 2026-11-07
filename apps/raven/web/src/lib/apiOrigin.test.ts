import { describe, expect, it } from 'bun:test'
import { mediaOriginOf } from '@/lib/apiOrigin'

describe('mediaOriginOf', () => {
  it("names raven's public origin when /api is a proxy, so media never goes through it", () => {
    expect(mediaOriginOf({ apiOrigin: 'https://raven-player.synology.me:8443' })).toEqual({
      kind: 'public',
      url: 'https://raven-player.synology.me:8443',
    })
  })

  it("names none when /api is raven itself, so media plays from the page's own address", () => {
    expect(mediaOriginOf({ apiOrigin: '' })).toBeNull()
  })
})
