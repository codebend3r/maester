import { describe, expect, it } from 'vitest'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import { LrclibClient, LrclibError } from '@/music/lrclibClient'
import { fakeLrclib } from '@/test/fakeLrclib'

const ASK = { artist: 'Band', track: 'Song', album: 'Album', duration: 201.6 } as const

describe('LrclibClient', () => {
  it('asks by artist, track, album and whole seconds with a User-Agent that names raven', async () => {
    const fake = fakeLrclib({ records: [{ title: 'Song', synced: '[00:01.00]A', plain: 'A' }] })
    const client = new LrclibClient(fake.fetch)
    await expect(client.lyrics(ASK)).resolves.toEqual({ synced: '[00:01.00]A', plain: 'A' })
    expect(fake.requests).toEqual([
      {
        query: { artist_name: 'Band', track_name: 'Song', album_name: 'Album', duration: '202' },
        userAgent: expect.stringMatching(
          /^raven\/\S+ \(https:\/\/github\.com\/codebend3r\/maester\)$/,
        ),
      },
    ])
  })

  it('answers a track it lacks as null, and an instrumental as no words', async () => {
    const fake = fakeLrclib({ records: [{ title: 'Song', isInstrumental: true, plain: 'x' }] })
    const client = new LrclibClient(fake.fetch)
    await expect(client.lyrics(ASK)).resolves.toEqual({ synced: null, plain: null })
    await expect(client.lyrics({ ...ASK, track: 'Other' })).resolves.toBeNull()
  })

  it('fails as away, not as a miss, when LRCLIB is down, errs or sends what it cannot read', async () => {
    const fake = fakeLrclib({ records: [] })
    fake.setDown({ isDown: true })
    const busy: MetadataFetch = async () => new Response('busy', { status: 503 })
    const odd: MetadataFetch = async () => new Response('[]', { status: 200 })
    const failures = await Promise.all(
      [fake.fetch, busy, odd].map((fetch) =>
        new LrclibClient(fetch).lyrics(ASK).catch((error: unknown) => error),
      ),
    )
    expect(failures.map((failure) => failure instanceof LrclibError)).toEqual([true, true, true])
  })
})
