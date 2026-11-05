import { describe, expect, it } from 'bun:test'
import {
  HLS_MASTER_PATH,
  HLS_PARTS,
  hlsPartOf,
  masterRequestOf,
  REWRITE_OUTCOMES,
  rewritePlaylist,
  sessionUrlOf,
} from '@/main/servers/hlsRelay'

const SESSION_ID = 'abcdefghijklmnopqrstuv'
const KEY = 'capability-secret'
const SESSION = { id: SESSION_ID, key: KEY }

const under = `/api/media/7/hls/${SESSION_ID}`

const MASTER = [
  '#EXTM3U',
  '#EXT-X-VERSION:7',
  '#EXT-X-INDEPENDENT-SEGMENTS',
  `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=NO,FORCED=NO,URI="${under}/subtitles/external-0?t=${KEY}"`,
  '#EXT-X-STREAM-INF:BANDWIDTH=4000000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1280x720,SUBTITLES="subs"',
  `${under}/video.m3u8?t=${KEY}`,
  '',
].join('\n')

const VIDEO = [
  '#EXTM3U',
  '#EXT-X-VERSION:7',
  '#EXT-X-PLAYLIST-TYPE:VOD',
  '#EXT-X-TARGETDURATION:6',
  `#EXT-X-MAP:URI="${under}/init?t=${KEY}"`,
  '#EXTINF:6.000,',
  `${under}/segment/0?t=${KEY}`,
  '#EXTINF:4.500,',
  `${under}/segment/1?t=${KEY}`,
  '#EXT-X-ENDLIST',
  '',
].join('\n')

describe('hlsPartOf', () => {
  it('reads the names mpv asks for under a secret', () => {
    expect(hlsPartOf('hls/video.m3u8')).toEqual({ kind: HLS_PARTS.video })
    expect(hlsPartOf('hls/init.mp4')).toEqual({ kind: HLS_PARTS.init })
    expect(hlsPartOf('hls/segment/12.m4s')).toEqual({ kind: HLS_PARTS.segment, n: 12 })
  })

  it.each([
    HLS_MASTER_PATH,
    'hls/segment/12',
    'hls/segment/-1.m4s',
    'hls/segment/1e3.m4s',
    'hls/segment/1234567.m4s',
    'hls/segment/1.m4s?t=x',
    'hls/../file',
    'file',
  ])('takes %p for no session part', (path) => {
    expect(hlsPartOf(path)).toBeNull()
  })
})

describe('the server paths', () => {
  it('asks for the master as a transcode at the size given', () => {
    expect(masterRequestOf({ mediaId: 7, quality: 'high720' })).toEqual({
      path: '/api/media/7/hls/master.m3u8',
      query: { mode: 'transcode', quality: 'high720' },
    })
  })

  it("asks for each session part with the session's key", () => {
    expect(sessionUrlOf({ mediaId: 7, session: SESSION, part: { kind: HLS_PARTS.video } })).toBe(
      `${under}/video.m3u8?t=${KEY}`,
    )
    expect(sessionUrlOf({ mediaId: 7, session: SESSION, part: { kind: HLS_PARTS.init } })).toBe(
      `${under}/init?t=${KEY}`,
    )
    expect(
      sessionUrlOf({ mediaId: 7, session: SESSION, part: { kind: HLS_PARTS.segment, n: 3 } }),
    ).toBe(`${under}/segment/3?t=${KEY}`)
  })
})

describe('rewritePlaylist', () => {
  it('rewrites the master to the relay name, without subtitle renditions or the key', () => {
    expect(rewritePlaylist({ text: MASTER, mediaId: 7 })).toEqual({
      kind: REWRITE_OUTCOMES.rewritten,
      text: [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-INDEPENDENT-SEGMENTS',
        '#EXT-X-STREAM-INF:BANDWIDTH=4000000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1280x720',
        'video.m3u8',
        '',
      ].join('\n'),
      session: SESSION,
    })
  })

  it('rewrites the video playlist: its init and each segment, with extensions lavf takes', () => {
    const rewritten = rewritePlaylist({ text: VIDEO, mediaId: 7 })
    expect(rewritten).toEqual({
      kind: REWRITE_OUTCOMES.rewritten,
      text: [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        '#EXT-X-TARGETDURATION:6',
        '#EXT-X-MAP:URI="init.mp4"',
        '#EXTINF:6.000,',
        'segment/0.m4s',
        '#EXTINF:4.500,',
        'segment/1.m4s',
        '#EXT-X-ENDLIST',
        '',
      ].join('\n'),
      session: SESSION,
    })
    expect(JSON.stringify(rewritten)).not.toContain(`?t=`)
  })

  it.each([
    ['another host', VIDEO.replace(`${under}/segment/1`, `https://evil.example${under}/segment/1`)],
    [
      'another media',
      VIDEO.replace(`${under}/segment/1`, `/api/media/8/hls/${SESSION_ID}/segment/1`),
    ],
    ['a session id that is no id', VIDEO.replaceAll(SESSION_ID, 'short')],
    ['a part the relay does not know', VIDEO.replace(`${under}/segment/1`, `${under}/other/1`)],
    ['a URI with no key', VIDEO.replace(`${under}/segment/1?t=${KEY}`, `${under}/segment/1`)],
    ['two keys', VIDEO.replace(`segment/1?t=${KEY}`, 'segment/1?t=another')],
    [
      'a segment number that is no number',
      VIDEO.replace(`${under}/segment/1`, `${under}/segment/x`),
    ],
    [
      'two URI attributes on the map',
      VIDEO.replace(
        `#EXT-X-MAP:URI="${under}/init?t=${KEY}"`,
        `#EXT-X-MAP:URI="${under}/init?t=${KEY}",URI="https://evil.example/init"`,
      ),
    ],
    [
      'a URI on a tag the server never writes',
      VIDEO.replace('#EXT-X-ENDLIST', '#EXT-X-KEY:METHOD=AES-128,URI="https://evil.example/key"'),
    ],
    [
      'a URI on a known tag that takes none',
      VIDEO.replace('#EXTINF:4.500,', '#EXTINF:4.500,URI="https://evil.example/x"'),
    ],
    [
      'a map URI off the server, from the root of another host',
      VIDEO.replace(`URI="${under}/init?t=${KEY}"`, `URI="//evil.example${under}/init?t=${KEY}"`),
    ],
    ['a lowercase map attribute', VIDEO.replace('#EXT-X-MAP:URI=', '#EXT-X-MAP:uri=')],
    [
      'an odd-quoted map attribute',
      VIDEO.replace(`URI="${under}/init?t=${KEY}"`, `URI='${under}/init?t=${KEY}'`),
    ],
    [
      'an unquoted map attribute',
      VIDEO.replace(`URI="${under}/init?t=${KEY}"`, `URI=${under}/init?t=${KEY}`),
    ],
    ['a rendition that is not a subtitle', MASTER.replace('TYPE=SUBTITLES', 'TYPE=AUDIO')],
    [
      'a second variant URI after another tag',
      VIDEO.replace('#EXT-X-ENDLIST', '#EXT-X-I-FRAME-STREAM-INF:URI="https://evil.example/i"'),
    ],
  ])('refuses a playlist naming %s', (_name, text) => {
    expect(rewritePlaylist({ text, mediaId: 7 })).toEqual({ kind: REWRITE_OUTCOMES.refused })
  })

  it.each([
    [
      'a lone carriage return hiding a URI line',
      VIDEO.replace('#EXT-X-ENDLIST', '#EXT-X-ENDLIST\rhttps://evil.example/x'),
    ],
    [
      'a NUL inside a line',
      VIDEO.replace('#EXT-X-ENDLIST', '#EXT-X-ENDLIST\u0000https://evil.example/x'),
    ],
    [
      'a vertical tab inside a line',
      VIDEO.replace('#EXT-X-ENDLIST', '#EXT-X-ENDLIST\u000Bhttps://evil.example/x'),
    ],
  ])('refuses a playlist with %s', (_name, text) => {
    expect(rewritePlaylist({ text, mediaId: 7 })).toEqual({ kind: REWRITE_OUTCOMES.refused })
  })

  it('reads CRLF line endings as the server may write them', () => {
    expect(rewritePlaylist({ text: VIDEO.replaceAll('\n', '\r\n'), mediaId: 7 }).kind).toBe(
      REWRITE_OUTCOMES.rewritten,
    )
  })

  it('drops comments, which lavf ignores, whatever they hold', () => {
    const text = VIDEO.replace(
      '#EXTINF:4.500,',
      '# URI="https://evil.example/x"\n#ext-x-map:URI="x"\n#EXTINF:4.500,',
    )
    const rewritten = rewritePlaylist({ text, mediaId: 7 })
    expect(rewritten.kind).toBe(REWRITE_OUTCOMES.rewritten)
    expect(JSON.stringify(rewritten)).not.toContain('evil.example')
    expect(JSON.stringify(rewritten)).not.toContain('ext-x-map')
  })

  it('names no session for a playlist with no URI', () => {
    expect(rewritePlaylist({ text: '#EXTM3U\n', mediaId: 7 })).toEqual({
      kind: REWRITE_OUTCOMES.rewritten,
      text: '#EXTM3U\n',
      session: null,
    })
  })
})
