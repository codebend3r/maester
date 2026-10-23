import { describe, expect, it } from 'bun:test'
import { MAX_ORIGIN_LENGTH, isServerOrigin, serverOriginOf } from '@/serverOrigin'

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

  // What WHATWG's URL makes of each, which the desktop relied on before the parse moved here.
  it.each([
    ['http://0x7f.1', 'http://127.0.0.1'],
    ['http://0177.0.0.1', 'http://127.0.0.1'],
    ['http://127.1', 'http://127.0.0.1'],
    ['http://0x', 'http://0.0.0.0'],
    ['http://192.168.1.20:8484', 'http://192.168.1.20:8484'],
    ['http://[::ffff:127.0.0.1]', 'http://[::ffff:7f00:1]'],
    ['http://[::1.2.3.4]', 'http://[::102:304]'],
    ['http://[1:0:0:2:0:0:0:3]', 'http://[1:0:0:2::3]'],
    ['http://[FE80::0001]', 'http://[fe80::1]'],
    ['http://[::]', 'http://[::]'],
    ['http://[::1]:080', 'http://[::1]'],
    ['http://raven.example:', 'http://raven.example'],
    ['http://raven.example:08080', 'http://raven.example:8080'],
    ['https://raven.example:443/', 'https://raven.example'],
    ['http://ab_c.example', 'http://ab_c.example'],
    ['https://\uff32\uff21\uff36\uff25\uff2e.example', 'https://raven.example'],
    ['http://raven\u3002example', 'http://raven.example'],
    ['https://r\u0101ven.example', 'https://xn--rven-qsa.example'],
    ['http://Stra\u00dfe.de', 'http://xn--strae-oqa.de'],
    ['http://m\u00fcnchen.de', 'http://xn--mnchen-3ya.de'],
    ['http://\u{1f4a9}.la', 'http://xn--ls8h.la'],
  ])('reads %p as URL does, %p', (raw, origin) => {
    expect(serverOriginOf(raw)).toBe(origin)
  })

  // UTS 46 folds case rather than lowering it: Cherokee folds to its capitals, and a Greek
  // letter with iota subscript to the letter and an iota. Final sigma and sharp s stay.
  it.each([
    ['https://Ꭴbc.example', 'https://xn--bc-98l.example'],
    ['https://ꭴbc.example', 'https://xn--bc-98l.example'],
    ['https://bᏸ.example', 'https://xn--b-nei.example'],
    ['https://ᾚbc.example', 'https://xn--bc-z9b181z.example'],
    ['https://ᾀx.example', 'https://xn--x-fmb260s.example'],
    ['https://ᾳx.example', 'https://xn--x-ylby.example'],
    ['https://ῼx.example', 'https://xn--x-fmb1c.example'],
    ['https://ςx.example', 'https://xn--x-xmb.example'],
  ])('folds %p as URL does, %p', (raw, origin) => {
    expect(serverOriginOf(raw)).toBe(origin)
  })

  it('writes an international name as punycode', () => {
    expect(serverOriginOf('https://r\u0101ven.example')?.startsWith('https://xn--') ?? false).toBe(
      true,
    )
  })

  it('shows a homograph as its punycode, never as the look-alike', () => {
    const origin = serverOriginOf('https://r\u0430ven.example')
    expect(origin).toBe('https://xn--rven-53d.example')
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

  // URL refuses each of these too.
  it.each([
    'http://256.0.0.1',
    'http://1.2.3.4.5',
    'http://1.2.3.09',
    'http://example.1',
    'http://foo.0x10',
    'http://9.09',
    'http://raven.example:65536',
    'http://raven.example:8o',
    'http://[1::2::3]',
    'http://[1:2:3:4:5:6:7:8:9]',
    'http://[1:2:3:4::5:6:7:8]',
    'http://[1:2:3]',
    'http://[:1::]',
    'http://[1:::2]',
    'http://[12345::]',
    'http://[::1.2.3]',
    'http://[::1.2.3.04]',
    'http://[1.2.3.4::]',
    'http://[::1',
    'http://[::1]x',
    'http://a<b',
    'http://a^b',
    'http://a|b',
    'http://:8080',
  ])('refuses %p, as URL does', (raw) => {
    expect(serverOriginOf(raw)).toBeNull()
  })

  // URL takes these, but no server address needs them.
  // URL folds each of these to nothing, so `rav<it>en` would be raven.example under it; refused
  // here rather than written as a second, look-alike host.
  it.each([
    0x00ad, 0x034f, 0x061c, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180b, 0x180f, 0x3164, 0xfe00, 0xfe0f,
    0xffa0, 0xe0100,
  ])('refuses the default-ignorable code point %p inside a name', (codePoint) => {
    expect(serverOriginOf(`https://rav${String.fromCodePoint(codePoint)}en.example`)).toBeNull()
  })

  // URL refuses each of these: private use, unassigned, a lone surrogate, noncharacters, U+FFFD.
  it.each([0xe000, 0x0378, 0xd800, 0xfdd0, 0xfffe, 0xffff, 0x1fffe, 0x10ffff, 0xfffd])(
    'refuses code point %p inside a name, as URL does',
    (codePoint) => {
      expect(serverOriginOf(`https://rav${String.fromCodePoint(codePoint)}en.example`)).toBeNull()
    },
  )

  it('refuses a character whose compatibility form holds a dot, as URL does', () => {
    expect(serverOriginOf('https://⒐raven.example')).toBeNull()
  })

  it('refuses a character whose compatibility form is a full stop, as URL does', () => {
    expect(serverOriginOf('https://a\ufe12b')).toBeNull()
    expect(serverOriginOf('https://raven\ufe12example')).toBeNull()
  })

  it('refuses a label that starts with a combining mark, as URL does', () => {
    expect(serverOriginOf('https://\uff9eraven.example')).toBeNull()
  })

  it.each(['http://a..b', 'http://.raven.example', 'http://r%61ven.example'])(
    'refuses %p, which URL would rewrite',
    (raw) => {
      expect(serverOriginOf(raw)).toBeNull()
    },
  )

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
    expect(isServerOrigin('https://xn--rven-qsa.example')).toBe(true)
  })

  it.each([
    'https://raven.example/',
    'HTTPS://raven.example',
    'https://raven.example:443',
    'https://r\u0101ven.example',
    'x',
  ])('rejects the unnormalised %p', (value) => {
    expect(isServerOrigin(value)).toBe(false)
  })

  it.each([[null], [undefined], [4], [{}], [['https://raven.example']]])('rejects %p', (value) => {
    expect(isServerOrigin(value)).toBe(false)
  })
})
