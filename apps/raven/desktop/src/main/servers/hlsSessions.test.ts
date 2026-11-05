import { AUTH_REFUSALS, HTTP_METHODS } from '@raven/core'
import { afterEach, describe, expect, test } from 'bun:test'
import { TICKET_OUTCOMES } from '@/main/servers/accountTickets'
import { RELAYED_MEDIA_KINDS } from '@/main/servers/mediaRelay'
import {
  type Answer,
  type AnswerProps,
  closeRelayServers,
  OPEN,
  refusalBody,
  setupRelay,
} from '@/main/test/relayFakes'
import { HTTP_HEADERS } from '@/shared/httpHeaders'

afterEach(closeRelayServers)

describe('a relayed HLS transcode', () => {
  const SESSION_A = 'aaaaaaaaaaaaaaaaaaaaaa'
  const SESSION_B = 'bbbbbbbbbbbbbbbbbbbbbb'
  const PLAYLIST_TYPE = 'application/vnd.apple.mpegurl'

  const HLS_OPEN = {
    ...OPEN,
    sidecarTrackIds: ['external-0'],
    media: { kind: RELAYED_MEDIA_KINDS.transcode, quality: 'high720' },
  } as const

  type MasterOfProps = { session: string; key: string }

  const masterOf = ({ session, key }: MasterOfProps): string =>
    [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",URI="/api/media/7/hls/${session}/subtitles/external-0?t=${key}"`,
      '#EXT-X-STREAM-INF:BANDWIDTH=4000000,CODECS="avc1.640028",RESOLUTION=1280x720,SUBTITLES="subs"',
      `/api/media/7/hls/${session}/video.m3u8?t=${key}`,
      '',
    ].join('\n')

  const videoOf = ({ session, key }: MasterOfProps): string =>
    [
      '#EXTM3U',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      `#EXT-X-MAP:URI="/api/media/7/hls/${session}/init?t=${key}"`,
      '#EXTINF:6.000,',
      `/api/media/7/hls/${session}/segment/0?t=${key}`,
      '#EXT-X-ENDLIST',
      '',
    ].join('\n')

  const playlist = (body: string): Answer => ({
    status: 200,
    headers: { [HTTP_HEADERS.contentType]: PLAYLIST_TYPE },
    body,
  })

  const segment: Answer = {
    status: 200,
    headers: { [HTTP_HEADERS.contentType]: 'video/iso.segment', [HTTP_HEADERS.contentLength]: '3' },
    body: 'seg',
  }

  type HlsServerProps = { lost?: Set<string> }

  /** The server: a master opens session A, then B, and the session parts answer for the live one. */
  const hlsServer = ({ lost = new Set<string>() }: HlsServerProps = {}) => {
    const masters = { count: 0 }
    const answer = ({ heard }: AnswerProps): Answer => {
      const url = new URL(heard.url)
      if (url.pathname === '/api/media/7/hls/master.m3u8') {
        masters.count += 1
        const session = masters.count === 1 ? SESSION_A : SESSION_B
        return playlist(masterOf({ session, key: `cap-${session}` }))
      }
      const [, session = ''] = /\/hls\/([^/]+)\//u.exec(url.pathname) ?? []
      if (lost.has(session)) return { status: 404, body: '' }
      if (url.pathname.endsWith('/video.m3u8')) {
        return playlist(videoOf({ session, key: `cap-${session}` }))
      }
      return segment
    }
    return { answer, masters }
  }

  test('mpv opens the master under the secret, and the server hears a ticketed transcode at the size', async () => {
    const { answer } = hlsServer()
    const { relay, heard } = setupRelay({ answer })
    const opened = await relay.open(HLS_OPEN)
    expect(opened.fileUrl).toBe(`${opened.base}/hls/master.m3u8`)
    expect(opened.sidecarUrls).toEqual([`${opened.base}/subtitles/external-0`])
    const response = await fetch(opened.fileUrl)
    expect(response.status).toBe(200)
    expect(response.headers.get(HTTP_HEADERS.contentType)).toBe(PLAYLIST_TYPE)
    const text = await response.text()
    expect(text).toBe(
      [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-STREAM-INF:BANDWIDTH=4000000,CODECS="avc1.640028",RESOLUTION=1280x720',
        'video.m3u8',
        '',
      ].join('\n'),
    )
    expect(response.headers.get(HTTP_HEADERS.contentLength)).toBe(String(text.length))
    expect(heard.map(({ url }) => url)).toEqual([
      'https://raven.example/api/media/7/hls/master.m3u8?mode=transcode&quality=high720&t=account.t1',
    ])
  })

  test("the video playlist, init and segments go to the master's session with its key, never in mpv's URLs", async () => {
    const { answer } = hlsServer()
    const { relay, heard, asked } = setupRelay({ answer })
    const { base, fileUrl } = await relay.open(HLS_OPEN)
    await (await fetch(fileUrl)).text()
    const video = await (await fetch(`${base}/hls/video.m3u8`)).text()
    expect(video).toBe(
      [
        '#EXTM3U',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        '#EXT-X-MAP:URI="init.mp4"',
        '#EXTINF:6.000,',
        'segment/0.m4s',
        '#EXT-X-ENDLIST',
        '',
      ].join('\n'),
    )
    expect(video).not.toContain('cap-')
    expect((await fetch(`${base}/hls/init.mp4`)).status).toBe(200)
    const piece = await fetch(`${base}/hls/segment/0.m4s`, {
      headers: { [HTTP_HEADERS.range]: 'bytes=0-2' },
    })
    expect(await piece.text()).toBe('seg')
    const session = `https://raven.example/api/media/7/hls/${SESSION_A}`
    expect(heard.slice(1).map(({ url, headers }) => ({ url, headers }))).toEqual([
      { url: `${session}/video.m3u8?t=cap-${SESSION_A}`, headers: {} },
      { url: `${session}/init?t=cap-${SESSION_A}`, headers: {} },
      {
        url: `${session}/segment/0?t=cap-${SESSION_A}`,
        headers: { [HTTP_HEADERS.range]: 'bytes=0-2' },
      },
    ])
    // The session's key opens its parts: no ticket is minted past the master's.
    expect(asked).toHaveLength(1)
  })

  test('a playlist asked for in part is still read whole, with no Range upstream', async () => {
    const { answer } = hlsServer()
    const { relay, heard } = setupRelay({ answer })
    const { fileUrl } = await relay.open(HLS_OPEN)
    const response = await fetch(fileUrl, { headers: { [HTTP_HEADERS.range]: 'bytes=0-' } })
    expect(response.status).toBe(200)
    expect(heard.map(({ headers }) => headers)).toEqual([{}])
  })

  test('a segment before mpv read the master opens a session first', async () => {
    const { answer, masters } = hlsServer()
    const { relay, heard } = setupRelay({ answer })
    const { base } = await relay.open(HLS_OPEN)
    expect(await (await fetch(`${base}/hls/segment/0.m4s`)).text()).toBe('seg')
    expect(masters.count).toBe(1)
    expect(heard.at(-1)?.url).toBe(
      `https://raven.example/api/media/7/hls/${SESSION_A}/segment/0?t=cap-${SESSION_A}`,
    )
  })

  test('a session the server lost is opened again from the master once, and mpv goes on in the new one', async () => {
    const lost = new Set<string>()
    const { answer, masters } = hlsServer({ lost })
    const { relay, heard } = setupRelay({ answer })
    const { base, fileUrl } = await relay.open(HLS_OPEN)
    await (await fetch(fileUrl)).text()
    lost.add(SESSION_A)
    const [first, second] = await Promise.all([
      fetch(`${base}/hls/segment/0.m4s`),
      fetch(`${base}/hls/init.mp4`),
    ])
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(masters.count).toBe(2)
    expect(heard.at(-1)?.url).toContain(`/hls/${SESSION_B}/`)
    expect(heard.filter(({ url }) => url.includes(SESSION_B))).toHaveLength(2)
  })

  test('a session lost twice over is passed back as the server said', async () => {
    const { answer } = hlsServer({ lost: new Set([SESSION_A, SESSION_B]) })
    const { relay } = setupRelay({ answer })
    const { base } = await relay.open(HLS_OPEN)
    expect((await fetch(`${base}/hls/segment/0.m4s`)).status).toBe(404)
  })

  test("a refused session part is the title's refusal, and a refused master's too", async () => {
    const refusing = setupRelay({
      answer: ({ heard }) =>
        heard.url.includes('/master.m3u8')
          ? hlsServer().answer({ heard, count: 1 })
          : { status: 403, body: refusalBody(AUTH_REFUSALS.revoked) },
    })
    const opened = await refusing.relay.open(HLS_OPEN)
    await (await fetch(opened.fileUrl)).text()
    expect((await fetch(`${opened.base}/hls/segment/0.m4s`)).status).toBe(403)
    expect(refusing.relay.refusalOf(opened.loadId)).toBe(AUTH_REFUSALS.revoked)

    const minting = setupRelay({
      answer: hlsServer().answer,
      outcomes: [{ kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.pending }],
    })
    const second = await minting.relay.open(HLS_OPEN)
    expect((await fetch(`${second.base}/hls/segment/0.m4s`)).status).toBe(403)
    expect(minting.relay.refusalOf(second.loadId)).toBe(AUTH_REFUSALS.pending)
  })

  test('a playlist naming what the relay does not know is a 502, and nothing of it reaches mpv', async () => {
    const { relay, warnings } = setupRelay({
      answer: () => playlist('#EXTM3U\nhttps://evil.example/api/media/7/file?t=x\n'),
    })
    const { fileUrl } = await relay.open(HLS_OPEN)
    const response = await fetch(fileUrl)
    expect(response.status).toBe(502)
    expect(await response.text()).toBe('')
    expect(warnings).toEqual(['Vhagar sent a playlist the relay does not pass on'])
  })

  test('HEAD of a playlist answers its type and no body', async () => {
    const { answer } = hlsServer()
    const { relay, heard } = setupRelay({ answer })
    const { fileUrl } = await relay.open(HLS_OPEN)
    const response = await fetch(fileUrl, { method: HTTP_METHODS.head })
    expect(response.status).toBe(200)
    expect(response.headers.get(HTTP_HEADERS.contentType)).toBe(PLAYLIST_TYPE)
    expect(heard.map(({ method }) => method)).toEqual([HTTP_METHODS.head])
  })

  test('a file load serves no HLS path, and an HLS load no /file', async () => {
    const { answer } = hlsServer()
    const { relay, heard } = setupRelay({ answer, capacity: 2 })
    const file = await relay.open(OPEN)
    const hls = await relay.open(HLS_OPEN)
    expect((await fetch(`${file.base}/hls/master.m3u8`)).status).toBe(404)
    expect((await fetch(`${file.base}/hls/segment/0.m4s`)).status).toBe(404)
    expect((await fetch(`${hls.base}/file`)).status).toBe(404)
    expect((await fetch(`${hls.base}/hls/segment/0`)).status).toBe(404)
    expect(
      (await fetch(`${hls.base}/hls/segment/0.m4s`, { method: HTTP_METHODS.post })).status,
    ).toBe(404)
    expect(heard).toEqual([])
  })

  test('retiring the load ends its segments, and no warning holds a key', async () => {
    const { answer } = hlsServer()
    const { relay, warnings } = setupRelay({ answer })
    const opened = await relay.open(HLS_OPEN)
    await (await fetch(opened.fileUrl)).text()
    relay.close(opened.loadId)
    expect((await fetch(`${opened.base}/hls/segment/0.m4s`)).status).toBe(404)
    expect(warnings.join('\n')).not.toContain('cap-')
  })
})
