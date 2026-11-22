import { describe, expect, it } from 'vitest'
import { RAVEN_ENV, readServerConfig } from '@/config'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import { ArtistArtClient } from '@/music/artistArtClient'

const MBID = '9fff2f8a-21e6-47de-a2b8-7f449929d43f'

const AUDIO_DB_ARTIST = {
  strArtist: 'Band',
  strArtistThumb: 'https://r2.theaudiodb.com/thumb.jpg',
  strArtistWideThumb: 'https://r2.theaudiodb.com/wide.jpg',
  strArtistFanart: 'https://r2.theaudiodb.com/fanart1.jpg',
  strArtistFanart2: 'https://r2.theaudiodb.com/fanart2.jpg',
  strArtistFanart3: null,
  strArtistFanart4: '',
  strArtistLogo: 'https://r2.theaudiodb.com/logo.png',
} as const

const FANART_TV_ARTIST = {
  name: 'Band',
  artistbackground: [{ id: '1', url: 'https://assets.fanart.tv/bg1.jpg', likes: '3' }, { id: '2' }],
  artistthumb: [{ id: '3', url: 'https://r2.theaudiodb.com/fanart1.jpg' }],
  hdmusiclogo: [{ id: '4', url: 'https://assets.fanart.tv/logo.png' }],
} as const

type FakeArtProps = { audioDb: unknown; fanartTv: unknown }

/** Both databases as a test's fetch, each answering its body, or failing as a network does for an Error. */
const fakeArt = ({ audioDb, fanartTv }: FakeArtProps) => {
  const urls: string[] = []
  const answer = (body: unknown): Promise<Response> =>
    body instanceof Error ? Promise.reject(body) : Promise.resolve(Response.json(body))
  const fetch: MetadataFetch = ({ url }) => {
    urls.push(url)
    return answer(new URL(url).host === 'webservice.fanart.tv' ? fanartTv : audioDb)
  }
  return { fetch, urls }
}

type ClientWithProps = { env: NodeJS.ProcessEnv; fetch: MetadataFetch }

const clientWith = ({ env, fetch }: ClientWithProps) =>
  new ArtistArtClient(readServerConfig(env), fetch)

describe('ArtistArtClient', () => {
  it("lists TheAudioDB's fanart, then its wide and square thumbs, on its free key", async () => {
    const fake = fakeArt({ audioDb: { artists: [AUDIO_DB_ARTIST] }, fanartTv: {} })
    const client = clientWith({ env: {}, fetch: fake.fetch })
    await expect(client.backgrounds(MBID)).resolves.toEqual([
      'https://r2.theaudiodb.com/fanart1.jpg',
      'https://r2.theaudiodb.com/fanart2.jpg',
      'https://r2.theaudiodb.com/wide.jpg',
      'https://r2.theaudiodb.com/thumb.jpg',
    ])
    expect(fake.urls).toEqual([
      `https://www.theaudiodb.com/api/v1/json/123/artist-mb.php?i=${MBID}`,
    ])
  })

  it("puts fanart.tv's backgrounds first with a key set, and lists a picture both hold once", async () => {
    const fake = fakeArt({ audioDb: { artists: [AUDIO_DB_ARTIST] }, fanartTv: FANART_TV_ARTIST })
    const client = clientWith({
      env: { [RAVEN_ENV.fanartTvApiKey]: 'fan-key', [RAVEN_ENV.theAudioDbApiKey]: 'paid' },
      fetch: fake.fetch,
    })
    await expect(client.backgrounds(MBID)).resolves.toEqual([
      'https://assets.fanart.tv/bg1.jpg',
      'https://r2.theaudiodb.com/fanart1.jpg',
      'https://r2.theaudiodb.com/fanart2.jpg',
      'https://r2.theaudiodb.com/wide.jpg',
      'https://r2.theaudiodb.com/thumb.jpg',
    ])
    expect(fake.urls.toSorted()).toEqual([
      `https://webservice.fanart.tv/v3/music/${MBID}?api_key=fan-key`,
      `https://www.theaudiodb.com/api/v1/json/paid/artist-mb.php?i=${MBID}`,
    ])
  })

  it('gives none from a database that lacks the artist, is away or answers what it cannot read', async () => {
    const lacking = fakeArt({ audioDb: { artists: null }, fanartTv: { status: 'error' } })
    const away = fakeArt({ audioDb: new TypeError('fetch failed'), fanartTv: [] })
    const env = { [RAVEN_ENV.fanartTvApiKey]: 'fan-key' }
    await expect(clientWith({ env, fetch: lacking.fetch }).backgrounds(MBID)).resolves.toEqual([])
    await expect(clientWith({ env, fetch: away.fetch }).backgrounds(MBID)).resolves.toEqual([])
  })
})
