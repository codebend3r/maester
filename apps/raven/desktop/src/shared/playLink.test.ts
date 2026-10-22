import { describe, expect, it } from 'bun:test'
import { type DownloadRequest, type PlayRequest, downloadLinkFor, playLinkFor } from '@raven/core'
import {
  MAX_LINK_LENGTH,
  MAX_ORIGIN_LENGTH,
  isServerOrigin,
  readDownloadLink,
  readPlayLink,
  serverOriginOf,
} from '@/shared/playLink'

describe('serverOriginOf', () => {
  it.each([
    ['https://raven.example.ts.net', 'https://raven.example.ts.net'],
    ['https://raven.example.ts.net/', 'https://raven.example.ts.net'],
    ['  HTTPS://Raven.Example.TS.net  ', 'https://raven.example.ts.net'],
    ['http://127.0.0.1:8080', 'http://127.0.0.1:8080'],
    ['http://[::1]:3000', 'http://[::1]:3000'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['https://raven.example:443', 'https://raven.example'],
    ['http://raven.example:80/', 'http://raven.example'],
    ['https://raven.example:8443', 'https://raven.example:8443'],
    ['http://2130706433', 'http://127.0.0.1'],
    ['http://127.0.0.1.:8080', 'http://127.0.0.1:8080'],
    ['http://[0:0:0:0:0:0:0:1]:3000', 'http://[::1]:3000'],
  ])('reads %p as %p', (raw, origin) => {
    expect(serverOriginOf(raw)).toBe(origin)
  })

  it('writes an international name as punycode', () => {
    expect(serverOriginOf('https://r\u0101ven.example')?.startsWith('https://xn--') ?? false).toBe(
      true,
    )
  })

  it('shows a homograph as its punycode, never as the look-alike', () => {
    const origin = serverOriginOf('https://raven.ex\u0430mple')
    expect(origin?.startsWith('https://raven.xn--') ?? false).toBe(true)
    expect(origin).not.toBe('https://raven.example')
  })

  it.each([
    'ftp://x',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'raven://play',
    'data:text/html,x',
    'ws://raven.example',
    'https://user:pw@raven.example',
    'https://@raven.example',
    'https://raven.example/watch',
    'https://raven.example/./',
    'https://raven.example//',
    'https://raven.example/?a=1',
    'https://raven.example?',
    'https://raven.example#x',
    'https://raven.example#',
    'https://raven.example\n.evil',
    'https://raven.exa\tmple',
    'https://raven.exa mple',
    'https://raven.example\u0000',
    'https://raven.example\u200b',
    'https://raven.example\u202e',
    'https://raven.example.',
    'https://raven.example./',
    'https://raven.example.:443',
    'http://raven.example:0',
    'http://raven.example:00',
    'https://',
    'https:///',
    '',
    '   ',
    'raven.example',
    'not a url',
    'https://' + 'a'.repeat(2050),
  ])('refuses %p', (raw) => {
    expect(serverOriginOf(raw)).toBeNull()
  })

  it('refuses an address over the limit even when it would parse', () => {
    const host = `${'a'.repeat(60)}.`.repeat(40)
    expect(host.length).toBeGreaterThan(MAX_ORIGIN_LENGTH)
    expect(serverOriginOf(`https://${host}example`)).toBeNull()
  })
})

describe('isServerOrigin', () => {
  it('accepts only a normalised origin', () => {
    expect(isServerOrigin('https://raven.example')).toBe(true)
    expect(isServerOrigin('http://[::1]:3000')).toBe(true)
  })

  it.each(['https://raven.example/', 'HTTPS://raven.example', 'https://raven.example:443', 'x'])(
    'rejects the unnormalised %p',
    (value) => {
      expect(isServerOrigin(value)).toBe(false)
    },
  )

  it.each([[null], [undefined], [4], [{}], [['https://raven.example']]])('rejects %p', (value) => {
    expect(isServerOrigin(value)).toBe(false)
  })
})

describe('readPlayLink', () => {
  const server = 'server=https%3A%2F%2Fraven.example'
  const base = `raven://play?${server}&media=7`

  it.each<PlayRequest>([
    { origin: 'https://raven.example', mediaId: 7, at: 12.9, next: [8, 9] },
    { origin: 'http://[::1]:3000', mediaId: 9007199254740991, at: 0, next: [] },
  ])('reads back what playLinkFor wrote for %p', (request) => {
    expect(readPlayLink(playLinkFor(request))).toEqual({ ...request, at: Math.floor(request.at) })
  })

  it('starts at 0 with nothing next when the link names only the title', () => {
    expect(readPlayLink(base)).toEqual({
      origin: 'https://raven.example',
      mediaId: 7,
      at: 0,
      next: [],
    })
  })

  it.each(['raven://PLAY', 'raven://Play/'])('reads the play host %p in any case', (host) => {
    expect(readPlayLink(`${host}?${server}&media=7`)?.mediaId ?? null).toBe(7)
  })

  it('reads next ids whose comma is escaped', () => {
    expect(readPlayLink(`${base}&next=1%2C2`)?.next ?? null).toEqual([1, 2])
  })

  it('reads the one server a long form IPv6 server names', () => {
    expect(
      readPlayLink(
        'raven://play?server=http%3A%2F%2F%5B0%3A0%3A0%3A0%3A0%3A0%3A0%3A1%5D%3A3000&media=7',
      )?.origin ?? null,
    ).toBe('http://[::1]:3000')
  })

  it('reads a numeric IPv4 watch page as its dotted origin', () => {
    expect(readPlayLink('http://2130706433:3000/watch/7')?.origin ?? null).toBe(
      'http://127.0.0.1:3000',
    )
  })

  it('reads a watch page whose path climbs back to the title', () => {
    expect(readPlayLink('https://raven.example/watch/../watch/1')?.mediaId ?? null).toBe(1)
  })

  it('keeps a fractional start', () => {
    expect(readPlayLink(`${base}&at=12.5`)?.at ?? null).toBe(12.5)
  })

  it('reads an empty next as none', () => {
    expect(readPlayLink(`${base}&next=`)?.next ?? null).toEqual([])
  })

  it('accepts exactly the most next ids', () => {
    const ids = Array.from({ length: 100 }, (_, index) => index + 1)
    expect(readPlayLink(`${base}&next=${ids.join(',')}`)?.next ?? null).toEqual(ids)
  })

  it('accepts a path of one slash after play and a padded link', () => {
    expect(readPlayLink(`  raven://play/?${server}&media=7  `)?.mediaId ?? null).toBe(7)
  })

  it('normalises the server it carries', () => {
    expect(
      readPlayLink('raven://play?server=HTTPS%3A%2F%2FRaven.Example%3A443%2F&media=7')?.origin ??
        null,
    ).toBe('https://raven.example')
  })

  it.each([
    'https://raven.example/watch/7',
    'https://raven.example/watch/7/',
    'https://raven.example/watch/7?t=30#x',
    'HTTPS://Raven.Example:443/watch/7',
  ])('reads the watch page %p', (link) => {
    expect(readPlayLink(link)).toEqual({
      origin: 'https://raven.example',
      mediaId: 7,
      at: 0,
      next: [],
    })
  })

  it('keeps the port of a watch page and ignores a hostile query', () => {
    expect(readPlayLink('http://[::1]:3000/watch/12?server=https://evil.example&media=1')).toEqual({
      origin: 'http://[::1]:3000',
      mediaId: 12,
      at: 0,
      next: [],
    })
  })

  const tooLongNext = Array.from({ length: 101 }, (_, index) => index + 1).join(',')

  it.each([
    ['media=0', `raven://play?${server}&media=0`],
    ['media=-3', `raven://play?${server}&media=-3`],
    ['media=1.5', `raven://play?${server}&media=1.5`],
    ['media=abc', `raven://play?${server}&media=abc`],
    ['media=007', `raven://play?${server}&media=007`],
    ['media=1e3', `raven://play?${server}&media=1e3`],
    ['media=+7', `raven://play?${server}&media=%2B7`],
    ['media past 16 digits', `raven://play?${server}&media=12345678901234567`],
    ['media past safe integers', `raven://play?${server}&media=9007199254740992`],
    ['missing media', `raven://play?${server}`],
    ['missing server', 'raven://play?media=7'],
    ['an empty server', 'raven://play?server=&media=7'],
    ['a javascript server', 'raven://play?server=javascript%3Aalert(1)&media=7'],
    ['a file server', 'raven://play?server=file%3A%2F%2F%2Fetc%2Fpasswd&media=7'],
    ['credentials in the server', 'raven://play?server=https%3A%2F%2Fu%3Ap%40x&media=7'],
    ['a path on the server', 'raven://play?server=https%3A%2F%2Fx%2Fpath&media=7'],
    ['a query on the server', 'raven://play?server=https%3A%2F%2Fx%3Fa%3D1&media=7'],
    ['a hash on the server', 'raven://play?server=https%3A%2F%2Fx%23a&media=7'],
    ['a trailing dot on the server', 'raven://play?server=https%3A%2F%2Fraven.example.&media=7'],
    ['port 0 on the server', 'raven://play?server=http%3A%2F%2Fraven.example%3A0&media=7'],
    ['an empty user on the server', 'raven://play?server=https%3A%2F%2F%40raven.example&media=7'],
    ['at=-1', `${base}&at=-1`],
    ['at=NaN', `${base}&at=NaN`],
    ['at=Infinity', `${base}&at=Infinity`],
    ['at=1e3', `${base}&at=1e3`],
    ['at=.5', `${base}&at=.5`],
    ['at=5.', `${base}&at=5.`],
    ['an empty at', `${base}&at=`],
    ['next=1,,2', `${base}&next=1,,2`],
    ['next=1,x', `${base}&next=1,x`],
    ['next=0', `${base}&next=0`],
    ['next=1,', `${base}&next=1,`],
    ['next=-2', `${base}&next=-2`],
    ['next=1.5', `${base}&next=1.5`],
    ['101 next ids', `${base}&next=${tooLongNext}`],
    ['a repeated media', `${base}&media=8`],
    ['a repeated server', `${base}&${server}`],
    ['a repeated at', `${base}&at=1&at=2`],
    ['a repeated next', `${base}&next=1&next=2`],
    ['an unknown key', `${base}&url=https://x`],
    ['an unknown key spelled like a known one', `${base}&Media=8`],
    ['a prototype key', `${base}&__proto__=1`],
    ['a hash', `${base}#x`],
    ['another host', `raven://open?${server}&media=7`],
    ['a path after play', `raven://play/x?${server}&media=7`],
    ['credentials on the host', `raven://u:p@play?${server}&media=7`],
    ['a port on the host', `raven://play:80?${server}&media=7`],
    ['another scheme', `ravens://play?${server}&media=7`],
    ['5,000 characters', `${base}&next=${'1,'.repeat(2500)}1`],
    ['the limit plus one', `${base}&at=${'1'.repeat(MAX_LINK_LENGTH)}`],
    ['credentials on a watch page', 'https://u:p@raven.example/watch/7'],
    ['a user on a watch page', 'https://u@raven.example/watch/7'],
    ['an empty user on a watch page', 'https://@raven.example/watch/7'],
    ['an empty password on a watch page', 'https://:@raven.example/watch/7'],
    ['a trailing dot on a watch page', 'https://raven.example./watch/7'],
    ['port 0 on a watch page', 'http://raven.example:0/watch/7'],
    ['a hash after play', `${base}#`],
    ['an edit page', 'https://raven.example/watch/7/edit'],
    ['a zero title', 'https://raven.example/watch/0'],
    ['a padded title', 'https://raven.example/watch/07'],
    ['a signed title', 'https://raven.example/watch/-7'],
    ['no title', 'https://raven.example/watch/'],
    ['a double slash', 'https://raven.example//watch/7'],
    ['a title past 16 digits', 'https://raven.example/watch/12345678901234567'],
    ['a title past safe integers', 'https://raven.example/watch/9007199254740992'],
    ['another page', 'https://raven.example/library/7'],
    ['a javascript link', 'javascript:alert(1)'],
    ['a file link', 'file:///etc/passwd'],
    ['an ftp watch page', 'ftp://raven.example/watch/7'],
    ['not a link', 'not a link'],
    ['nothing', ''],
  ])('refuses %s', (_, link) => {
    expect(readPlayLink(link)).toBeNull()
  })

  it('refuses a link of exactly the limit plus one even when it is otherwise valid', () => {
    const padding = 'a'.repeat(MAX_LINK_LENGTH)
    expect(readPlayLink(`https://raven.example/watch/7?${padding}`)).toBeNull()
  })

  it('reads a watch page that is exactly at the limit', () => {
    const query = 'a'.repeat(MAX_LINK_LENGTH - 'https://raven.example/watch/7?'.length)
    expect(readPlayLink(`https://raven.example/watch/7?${query}`)?.mediaId ?? null).toBe(7)
  })

  it('refuses a malformed percent escape', () => {
    expect(readPlayLink(`raven://play?${server}&media=%E0%A4%A`)).toBeNull()
  })
})

describe('readDownloadLink', () => {
  const server = 'server=https%3A%2F%2Fraven.example'
  const base = `raven://download?${server}`

  it.each<[string, DownloadRequest['target']]>([
    ['media=7', { kind: 'media', mediaId: 7 }],
    ['item=10', { kind: 'item', itemId: 10 }],
    ['saga=1%3A100', { kind: 'saga', libraryId: 1, tmdbId: '100' }],
  ])('reads %s', (query, target) => {
    expect(readDownloadLink(`${base}&${query}`)).toEqual({
      origin: 'https://raven.example',
      target,
    })
  })

  it.each<DownloadRequest>([
    { origin: 'https://raven.example', target: { kind: 'media', mediaId: 7 } },
    { origin: 'http://[::1]:3000', target: { kind: 'item', itemId: 9007199254740991 } },
    { origin: 'https://raven.example', target: { kind: 'saga', libraryId: 2, tmdbId: '86311' } },
  ])('reads back what downloadLinkFor wrote for %p', (request) => {
    expect(readDownloadLink(downloadLinkFor(request))).toEqual(request)
  })

  it('reads the download host in any case, with a slash and padding', () => {
    expect(readDownloadLink(`  raven://DOWNLOAD/?${server}&media=7  `)?.target ?? null).toEqual({
      kind: 'media',
      mediaId: 7,
    })
  })

  it('normalises the server it carries', () => {
    expect(
      readDownloadLink('raven://download?server=HTTPS%3A%2F%2FRaven.Example%3A443%2F&media=7')
        ?.origin ?? null,
    ).toBe('https://raven.example')
  })

  it.each([
    ['two targets at once', `${base}&media=7&item=10`],
    ['all three targets', `${base}&media=7&item=10&saga=1%3A100`],
    ['no target', base],
    ['a repeated media', `${base}&media=7&media=8`],
    ['a repeated server', `${base}&${server}&media=7`],
    ['an at key', `${base}&media=7&at=5`],
    ['a next key', `${base}&media=7&next=8`],
    ['an unknown key', `${base}&media=7&url=https://x`],
    ['a hash', `${base}&media=7#x`],
    ['a bare hash', `${base}&media=7#`],
    ['missing server', 'raven://download?media=7'],
    ['a javascript server', 'raven://download?server=javascript%3Aalert(1)&media=7'],
    ['a path on the server', 'raven://download?server=https%3A%2F%2Fx%2Fpath&media=7'],
    ['media=0', `${base}&media=0`],
    ['media=007', `${base}&media=007`],
    ['media=1.5', `${base}&media=1.5`],
    ['item=abc', `${base}&item=abc`],
    ['item past safe integers', `${base}&item=9007199254740992`],
    ['saga=1:abc', `${base}&saga=1%3Aabc`],
    ['saga with no collection', `${base}&saga=1%3A`],
    ['saga with no library', `${base}&saga=%3A100`],
    ['saga=0:100', `${base}&saga=0%3A100`],
    ['saga=1:0', `${base}&saga=1%3A0`],
    ['saga=1:007', `${base}&saga=1%3A007`],
    ['saga with a third part', `${base}&saga=1%3A100%3A2`],
    ['saga with no colon', `${base}&saga=1100`],
    ['saga with a collection past 16 digits', `${base}&saga=1%3A12345678901234567`],
    ['another host', `raven://open?${server}&media=7`],
    ['a path after download', `raven://download/x?${server}&media=7`],
    ['credentials on the host', `raven://u:p@download?${server}&media=7`],
    ['a port on the host', `raven://download:80?${server}&media=7`],
    ['another scheme', `ravens://download?${server}&media=7`],
    ['the limit plus one', `${base}&media=7&x=${'1'.repeat(MAX_LINK_LENGTH)}`],
    ['a raven://play link', `raven://play?${server}&media=7`],
    ['a watch page', 'https://raven.example/watch/7'],
    ['a javascript link', 'javascript:alert(1)'],
    ['not a link', 'not a link'],
    ['nothing', ''],
  ])('refuses %s', (_, link) => {
    expect(readDownloadLink(link)).toBeNull()
  })

  it('keeps readPlayLink from reading a download link', () => {
    expect(readPlayLink(`${base}&media=7`)).toBeNull()
  })
})
