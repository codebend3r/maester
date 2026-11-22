import { describe, expect, it } from 'vitest'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import { MusicBrainzClient } from '@/music/musicBrainzClient'
import { articleOf, labelsOf } from '@/music/wikidata'
import { WikimediaClient, extractOf } from '@/music/wikimediaClient'

const clientOf = (fetch: MetadataFetch): WikimediaClient =>
  new WikimediaClient(new MusicBrainzClient(fetch), fetch)

describe('WikimediaClient', () => {
  it('finds an artist photo through MusicBrainz and Wikidata', async () => {
    const fetch: MetadataFetch = async ({ url }) => {
      if (url.includes('musicbrainz.org')) {
        return new Response(
          JSON.stringify({
            relations: [
              { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q123' } },
            ],
          }),
        )
      }
      return new Response(
        JSON.stringify({
          entities: {
            Q123: { claims: { P18: [{ mainsnak: { datavalue: { value: 'Artist Photo.jpg' } } }] } },
          },
        }),
      )
    }
    await expect(clientOf(fetch).artistPhoto('artist-id')).resolves.toBe(
      'https://commons.wikimedia.org/wiki/Special:Redirect/file/Artist_Photo.jpg?width=500',
    )
  })

  it("lists an artist's Commons photos for a background: Wikidata's first, then the category's pictures, no scans", async () => {
    const fetch: MetadataFetch = async ({ url }) => {
      if (url.includes('musicbrainz.org')) {
        return Response.json({
          relations: [
            { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q123' } },
          ],
        })
      }
      if (url.includes('wikidata.org')) {
        return Response.json({
          entities: {
            Q123: {
              claims: {
                P18: [{ mainsnak: { datavalue: { value: 'Main Photo.jpg' } } }],
                P373: [{ mainsnak: { datavalue: { value: 'The Artist' } } }],
              },
            },
          },
        })
      }
      return Response.json({
        query: {
          categorymembers: [
            { title: 'File:Main Photo.jpg' },
            { title: 'File:Live.PNG' },
            { title: 'File:Scan.tif' },
            { title: 'File:Interview.webm' },
          ],
        },
      })
    }
    const base = 'https://commons.wikimedia.org/wiki/Special:Redirect/file'
    await expect(clientOf(fetch).artistBackgroundPhotos('artist-id')).resolves.toEqual([
      `${base}/Main_Photo.jpg?width=1600`,
      `${base}/Live.PNG?width=1600`,
    ])
  })

  it('lists the photos Wikidata gives when Commons does not answer', async () => {
    const fetch: MetadataFetch = async ({ url }) => {
      if (url.includes('musicbrainz.org')) {
        return Response.json({
          relations: [
            { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q123' } },
          ],
        })
      }
      if (url.includes('wikidata.org')) {
        return Response.json({
          entities: {
            Q123: {
              claims: {
                P18: [{ mainsnak: { datavalue: { value: 'Main Photo.jpg' } } }],
                P373: [{ mainsnak: { datavalue: { value: 'The Artist' } } }],
              },
            },
          },
        })
      }
      return new Response('down', { status: 503 })
    }
    await expect(clientOf(fetch).artistBackgroundPhotos('artist-id')).resolves.toEqual([
      'https://commons.wikimedia.org/wiki/Special:Redirect/file/Main_Photo.jpg?width=1600',
    ])
  })

  it('names the ids it was asked for in one Wikidata call, and asks nothing when there are none', async () => {
    const urls: string[] = []
    const fetch: MetadataFetch = async ({ url }) => {
      urls.push(url)
      return Response.json({ entities: { Q1: { labels: { en: { value: 'Toronto' } } } } })
    }
    const client = clientOf(fetch)
    expect((await client.names([]))(['Q1'])).toEqual([])
    expect(urls).toEqual([])
    expect((await client.names(['Q1']))(['Q1'])).toEqual(['Toronto'])
    expect(urls).toHaveLength(1)
  })
})

describe('articleOf', () => {
  it('finds the English Wikipedia title among the sitelinks', () => {
    const value = { entities: { Q33240: { sitelinks: { enwiki: { title: 'Drake (musician)' } } } } }
    expect(articleOf({ value, id: 'Q33240' })).toBe('Drake (musician)')
    expect(articleOf({ value: { entities: {} }, id: 'Q33240' })).toBeNull()
  })
})

describe('labelsOf', () => {
  it('names the ids in their order, each name once, skipping one with no English name', () => {
    const value = {
      entities: {
        Q1: { labels: { en: { value: 'Grammy Award for Best Rap Album' } } },
        Q2: { labels: {} },
        Q3: { labels: { en: { value: 'Grammy Award for Best Rap Album' } } },
        Q4: { labels: { en: { value: 'Juno Award' } } },
      },
    }
    expect(labelsOf({ value, ids: ['Q1', 'Q2', 'Q3', 'Q4'] })).toEqual([
      'Grammy Award for Best Rap Album',
      'Juno Award',
    ])
  })
})

describe('extractOf', () => {
  it('reads the summary, and nothing from an empty one', () => {
    expect(extractOf({ extract: ' Aubrey Drake Graham is a Canadian rapper. ' })).toBe(
      'Aubrey Drake Graham is a Canadian rapper.',
    )
    expect(extractOf({ extract: '' })).toBeNull()
    expect(extractOf(null)).toBeNull()
  })
})
