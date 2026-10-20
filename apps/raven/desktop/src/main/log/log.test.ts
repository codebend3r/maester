import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { appendFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'
import {
  LOG_BURST_LINES,
  LOG_BURST_MS,
  LOG_FILE,
  LOG_FILES,
  LOG_LINE_MAX,
  LOG_MAX_BYTES,
  LOG_FS_OPS,
  LOG_QUEUE_MAX,
  SILENT_LOG,
  createLog,
  logFsFrom,
  logLine,
  redact,
  rotationMoves,
  type LogFs,
} from '@/main/log/log'
import { ERROR_CODES, isMissingFile, type Timers } from '@/main/stateStore'

const DIR = '/logs'
const FILE = `${DIR}/${LOG_FILE}`
const STAMP = '1970-01-01T00:00:00.000Z '

type FsOp = keyof LogFs
type Call = { op: FsOp; args: unknown[] }
type Refusal = { op: FsOp; path: string }

const fsError = ({ code, path }: { code: string; path: string }): Error =>
  Object.assign(new Error(`${code}: refused, '${path}'`), { code })

const bytes = (text: string): number => Buffer.byteLength(text)

const createFakeFs = (initial: Record<string, string> = {}) => {
  const disk = new Map(Object.entries(initial))
  const calls: Call[] = []
  const holds: Array<{ entered: () => void; released: Promise<void> }> = []
  const appended: Array<() => void> = []
  const inFlight = { now: 0, max: 0 }
  const state: { refuse: (refusal: Refusal) => string | null } = { refuse: () => null }

  const check = ({ op, path }: Refusal) => {
    const code = state.refuse({ op, path })
    if (code !== null) throw fsError({ code, path })
  }

  const fs: LogFs = {
    mkdir: async ({ path, options }) => {
      calls.push({ op: LOG_FS_OPS.mkdir, args: [path, options] })
      check({ op: LOG_FS_OPS.mkdir, path })
    },
    size: async (path) => {
      calls.push({ op: LOG_FS_OPS.size, args: [path] })
      check({ op: LOG_FS_OPS.size, path })
      const text = disk.get(path)
      return text === undefined ? null : bytes(text)
    },
    appendFile: async ({ path, data, options }) => {
      calls.push({ op: LOG_FS_OPS.appendFile, args: [path, data, options] })
      inFlight.now += 1
      inFlight.max = Math.max(inFlight.max, inFlight.now)
      const hold = holds.shift()
      if (hold) {
        hold.entered()
        await hold.released
      }
      inFlight.now -= 1
      check({ op: LOG_FS_OPS.appendFile, path })
      disk.set(path, `${disk.get(path) ?? ''}${data}`)
      appended.splice(0).forEach((resolve) => resolve())
    },
    rename: async ({ from, to }) => {
      calls.push({ op: LOG_FS_OPS.rename, args: [from, to] })
      check({ op: LOG_FS_OPS.rename, path: from })
      const text = disk.get(from)
      if (text === undefined) throw fsError({ code: ERROR_CODES.enoent, path: from })
      disk.delete(from)
      disk.set(to, text)
    },
    remove: async (path) => {
      calls.push({ op: LOG_FS_OPS.remove, args: [path] })
      check({ op: LOG_FS_OPS.remove, path })
      if (!disk.has(path)) throw fsError({ code: ERROR_CODES.enoent, path })
      disk.delete(path)
    },
  }

  const holdNextAppend = () => {
    const entered = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()
    holds.push({ entered: entered.resolve, released: released.promise })
    return { entered: entered.promise, release: () => released.resolve() }
  }

  const whenAppended = () => {
    const done = Promise.withResolvers<void>()
    appended.push(done.resolve)
    return done.promise
  }

  return { fs, disk, calls, state, inFlight, holdNextAppend, whenAppended }
}

const createFakeTimers = () => {
  const pending = new Map<number, () => void>()
  const delays: number[] = []
  const counter = { next: 1 }
  const timers: Timers = {
    set: ({ run, ms }) => {
      const handle = counter.next
      counter.next += 1
      pending.set(handle, run)
      delays.push(ms)
      return handle
    },
    clear: (handle) => {
      if (typeof handle === 'number') pending.delete(handle)
    },
  }
  const fire = () => {
    const runs = [...pending.values()]
    pending.clear()
    runs.forEach((run) => run())
  }
  return { timers, fire, pending, delays }
}

const setup = ({
  files = {},
  onError,
}: { files?: Record<string, string>; onError?: (error: unknown) => void } = {}) => {
  const fake = createFakeFs(files)
  const clock = createFakeTimers()
  const errors: unknown[] = []
  const time = { now: 0 }
  const log = createLog({
    dir: DIR,
    fs: fake.fs,
    now: () => time.now,
    timers: clock.timers,
    onError: onError ?? ((error) => errors.push(error)),
  })
  return { ...fake, ...clock, log, errors, time }
}

const ops = ({ calls, wanted }: { calls: Call[]; wanted: FsOp[] }) =>
  calls.filter((call) => wanted.includes(call.op))

const lines = (text: string | undefined): string[] =>
  (text ?? '').split('\n').filter((line) => line !== '')

describe('redact', () => {
  it('blanks cookie headers, unlock cookies and JSON secrets', () => {
    expect(redact('mpv http: Cookie: raven_unlock=a.b; raven_admin=c')).toBe(
      'mpv http: Cookie: [redacted]',
    )
    expect(redact('url?x=1 raven_admin=zz; other=1')).toBe(
      'url?x=1 raven_admin=[redacted]; other=1',
    )
    expect(redact('{"pin":"3001","x":1}')).toBe('{"pin":"[redacted]","x":1}')
    expect(redact('set-cookie: raven_unlock=t; Path=/api')).toBe('set-cookie: [redacted]')
    expect(redact('https://raven.example/api/media/7/file')).toBe(
      'https://raven.example/api/media/7/file',
    )
  })

  it('stops a cookie header at the end of its line', () => {
    expect(redact('COOKIE : raven_unlock=x\r\nUser-Agent: mpv')).toBe(
      'COOKIE : [redacted]\r\nUser-Agent: mpv',
    )
  })

  it('blanks every unlock and admin value, quoted or not', () => {
    expect(redact('a raven_unlock=1 b raven_unlock=2,c "raven_admin=3"')).toBe(
      'a raven_unlock=[redacted] b raven_unlock=[redacted],c "raven_admin=[redacted]"',
    )
  })

  it('blanks escaped JSON strings and any letter case', () => {
    expect(redact('{"Password" : "a\\"b\\\\c","pin":"1"}')).toBe(
      '{"Password" : "[redacted]","pin":"[redacted]"}',
    )
  })

  it('blanks PINs and passwords written as objects, numbers or form fields', () => {
    expect(redact("body { pin: '3001', name: 'x' }")).toBe("body { pin: '[redacted]', name: 'x' }")
    expect(redact('{"pin": 3001}')).toBe('{"pin": [redacted]}')
    expect(redact('{"pin":1234}')).toBe('{"pin":[redacted]}')
    expect(redact('password=hunter2&x=1')).toBe('password=[redacted]&x=1')
    expect(redact('/api/lock/unlock?pin=1234&x=1')).toBe('/api/lock/unlock?pin=[redacted]&x=1')
    expect(redact('PIN: "3001"')).toBe('PIN: "[redacted]"')
    expect(redact('Password : p4ss')).toBe('Password : [redacted]')
    expect(redact(inspect({ pin: '1234' }))).toBe("{ pin: '[redacted]' }")
  })

  it('blanks a PIN or password inside a JSON string nested in JSON', () => {
    expect(redact(JSON.stringify({ body: JSON.stringify({ pin: '1234' }) }))).toBe(
      '{"body":"{\\"pin\\":\\"[redacted]\\"}"}',
    )
    expect(redact(JSON.stringify({ body: JSON.stringify({ password: 'p4ss' }) }))).toBe(
      '{"body":"{\\"password\\":\\"[redacted]\\"}"}',
    )
    const quoted = redact(JSON.stringify({ body: JSON.stringify({ password: 'a"b\\c', x: 1 }) }))
    expect(quoted).toBe('{"body":"{\\"password\\":\\"[redacted]\\",\\"x\\":1}"}')
  })

  it('blanks keys that name a PIN or password in camel, snake or kebab case', () => {
    expect(redact('{"newPassword":"p4ss"}')).toBe('{"newPassword":"[redacted]"}')
    expect(redact('{"adminPin":"1234"}')).toBe('{"adminPin":"[redacted]"}')
    expect(redact('password_confirmation=p4ss')).toBe('password_confirmation=[redacted]')
    expect(redact('x-pin: 1234')).toBe('x-pin: [redacted]')
  })

  it('blanks a key of many hyphenated words', () => {
    const key = `${'word-'.repeat(40)}pin`
    expect(redact(`${key}=1234`)).toBe(`${key}=[redacted]`)
  })

  it('blanks the whole value, quotes, backticks and spaces included', () => {
    expect(redact(inspect({ password: `a'b"p4ss` }))).toBe('{ password: `[redacted]` }')
    expect(redact('password=correct horse p4ss')).toBe('password=[redacted]')
    expect(redact('password=correct horse; next=1')).toBe('password=[redacted]; next=1')
    expect(redact('{"pin":"12341234')).toBe('{"pin":"[redacted]"')
  })

  it('blanks our cookies in any case, encoding or spacing', () => {
    expect(redact('raven_unlock%3DSECRETVAL')).toBe('raven_unlock%3D[redacted]')
    expect(redact('h=Cookie%3A%20raven_unlock%3DSECRETVAL')).toBe('h=Cookie%3A[redacted]')
    expect(redact('RAVEN_UNLOCK=SECRETVAL')).toBe('RAVEN_UNLOCK=[redacted]')
    expect(redact('raven_unlock = SECRETVAL')).toBe('raven_unlock = [redacted]')
    expect(redact('a=1; raven_unlock=SECRETVAL; b=2')).toBe('a=1; raven_unlock=[redacted]; b=2')
    expect(redact('Cookie： raven_unlock2=SECRETVAL')).toBe('Cookie： raven_unlock2=[redacted]')
    expect(redact("'raven_admin=SECRETVAL'")).toBe("'raven_admin=[redacted]'")
  })

  it("blanks Electron's cookie objects, inspected or as JSON, escaped or not", () => {
    expect(redact(inspect({ name: 'raven_unlock', value: 'SECRETVAL' }))).toBe(
      "{ name: 'raven_unlock', value: '[redacted]' }",
    )
    expect(redact(JSON.stringify({ name: 'raven_admin', value: 'SECRETVAL' }))).toBe(
      '{"name":"raven_admin","value":"[redacted]"}',
    )
    expect(redact(JSON.stringify({ value: 'SECRETVAL', name: 'raven_unlock' }))).toBe(
      '{"value":"[redacted]","name":"raven_unlock"}',
    )
    expect(
      redact(JSON.stringify({ c: JSON.stringify({ name: 'raven_admin', value: 'S1' }) })),
    ).toBe('{"c":"{\\"name\\":\\"raven_admin\\",\\"value\\":\\"[redacted]\\"}"}')
    const full = inspect({
      name: 'raven_unlock',
      value: 'SECRETVAL',
      domain: 'raven.example',
      path: '/api',
      secure: true,
      httpOnly: true,
      session: false,
      expirationDate: 1_800_000_000,
    })
    expect(full).toContain('\n')
    expect(redact(full)).not.toContain('SECRETVAL')
    expect(redact(JSON.stringify({ name: 'theme', value: 'dark' }))).toBe(
      '{"name":"theme","value":"dark"}',
    )
  })

  it('blanks a cookie written as a JSON field, whatever its name', () => {
    expect(redact('{"Cookie":"raven_unlock=SECRETVAL"}')).toBe('{"Cookie":"[redacted]"}')
    expect(redact('{"cookie":"sid=SECRETVAL"}')).toBe('{"cookie":"[redacted]"}')
    expect(redact('{\\"cookie\\":\\"sid=SECRETVAL\\"}')).toBe('{\\"cookie\\":\\"[redacted]\\"}')
    expect(redact(inspect({ headers: { cookie: 'sid=SECRETVAL' } }))).not.toContain('SECRETVAL')
  })

  it("blanks the cookie in mpv's header options", () => {
    expect(
      redact(
        'start=0,http-header-fields=%45%Cookie: raven_unlock=abc.def; raven_admin=SECRETVAL,network-timeout=30',
      ),
    ).toBe('start=0,http-header-fields=%45%Cookie: [redacted]')
    expect(
      redact('[cplayer] Set property: http-header-fields="Cookie: raven_unlock=SECRETVAL" -> 1'),
    ).toBe('[cplayer] Set property: http-header-fields="Cookie: [redacted]')
  })

  it('changes nothing when run twice', () => {
    const inputs = [
      'Cookie: a raven_admin=b {"pin":"1"} { password: \'2\' } pin=3 "password": 4',
      'raven_admin=b {"pin":"1"} { password: \'2\' } pin=3 "password": 4',
      JSON.stringify({ body: JSON.stringify({ pin: '1234' }) }),
      inspect({ name: 'raven_unlock', value: 'SECRETVAL' }),
      inspect({ password: `a'b"p4ss` }),
      'raven_unlock%3DS RAVEN_ADMIN = T {"cookie":"sid=U"} password=a b c',
      "Cannot open file '/Volumes/a b.mkv': x /Users/c/d",
      '{"file":"/Volumes/a.mkv"} file:///e',
      'open `/m/a b.mkv` ~/c "/m/a"b.mkv" file:/Volumes/d',
      "open '/m/a\nb.mkv' and '/m/c",
    ]
    expect(redact(inputs[1] ?? '')).toBe(
      'raven_admin=[redacted] {"pin":"[redacted]"} { password: \'[redacted]\' } pin=[redacted] "password": [redacted]',
    )
    inputs.forEach((input) => {
      const once = redact(input)
      expect(redact(once)).toBe(once)
    })
  })

  describe('sign-in secrets', () => {
    const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl-_x'
    const TICKET = `account.${'Ab1_-'.repeat(8)}Ab1`
    const RELAY_SECRET = `${'Zz9_-'.repeat(8)}Zz9`
    const EMAIL = 'cj.rivas+raven@example.com'
    const FIELDS: string[] = [
      'authorization',
      'access_token',
      'refresh_token',
      'provider_token',
      'token_hash',
      'token',
      'apikey',
    ]

    // Each secret as plain text, JSON, JSON inside a JSON string, util.inspect and a URL.
    const forms = ({ name, secret }: { name: string; secret: string }): string[] => [
      `${name}=${secret}`,
      `${name}: ${secret}`,
      JSON.stringify({ [name]: secret, x: 1 }),
      JSON.stringify({ body: JSON.stringify({ [name]: secret, x: 1 }) }),
      inspect({ [name]: secret, x: 1 }),
      `https://raven.example/auth/v1/verify?x=1&${name}=${secret}&y=2`,
    ]

    it.each(FIELDS)('blanks the value of %s in every form', (name) => {
      forms({ name, secret: 'SECRETVAL123' }).forEach((input) => {
        const out = redact(input)
        expect(out).not.toContain('SECRETVAL123')
        expect(out).toContain('[redacted]')
        expect(redact(out)).toBe(out)
      })
    })

    it('keeps what surrounds a blanked field', () => {
      expect(redact('/verify?x=1&token_hash=SECRETVAL&y=2')).toBe(
        '/verify?x=1&token_hash=[redacted]&y=2',
      )
      expect(redact('{"access_token":"SECRETVAL","expires_in":3600}')).toBe(
        '{"access_token":"[redacted]","expires_in":3600}',
      )
      expect(redact("{ refresh_token: 'SECRETVAL', user: 1 }")).toBe(
        "{ refresh_token: '[redacted]', user: 1 }",
      )
      expect(redact('{\\"apikey\\":\\"SECRETVAL\\",\\"x\\":1}')).toBe(
        '{\\"apikey\\":\\"[redacted]\\",\\"x\\":1}',
      )
      expect(redact('grant_type=password&refresh_token=SECRETVAL')).toBe(
        'grant_type=password&refresh_token=[redacted]',
      )
    })

    it('blanks an authorization header and any bearer value', () => {
      expect(redact('Authorization: Bearer SECRETVAL')).toBe('Authorization: [redacted]')
      expect(redact('{"Authorization":"Bearer SECRETVAL"}')).toBe('{"Authorization":"[redacted]"}')
      expect(redact('{"authorization":"Basic SECRETVAL"}')).toBe('{"authorization":"[redacted]"}')
      expect(redact(inspect({ headers: { authorization: 'Bearer SECRETVAL' } }))).toBe(
        "{ headers: { authorization: '[redacted]' } }",
      )
      expect(redact('sent bearer SECRETVAL to the server')).toBe(
        'sent bearer [redacted] to the server',
      )
      expect(redact('[http] Bearer SECRETVAL.x-y_z, retry')).toBe('[http] Bearer [redacted], retry')
      expect(redact('{\\"h\\":\\"Bearer SECRETVAL\\"}')).toBe('{\\"h\\":\\"Bearer [redacted]\\"}')
      expect(redact('http-header-fields=Authorization: Bearer SECRETVAL,Accept: */*')).toBe(
        'http-header-fields=Authorization: [redacted],Accept: */*',
      )
    })

    it('blanks a JWT wherever it sits', () => {
      expect(redact(`session ${JWT} ended`)).toBe('session [redacted] ended')
      expect(redact(`{"jwt":"${JWT}"}`)).toBe('{"jwt":"[redacted]"}')
      expect(redact(`{\\"jwt\\":\\"${JWT}\\"}`)).toBe('{\\"jwt\\":\\"[redacted]\\"}')
      expect(redact(inspect({ jwt: JWT }))).toBe("{ jwt: '[redacted]' }")
      expect(redact(`https://raven.example/cb#jwt=${JWT}&x=1`)).toBe(
        'https://raven.example/cb#jwt=[redacted]&x=1',
      )
      expect(redact('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.')).toBe(
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.',
      )
      expect(redact('eyJhbGciOiJIUzI1NiJ9 and eyJ.x')).toBe('eyJhbGciOiJIUzI1NiJ9 and eyJ.x')
    })

    it('blanks the t parameter and any account ticket', () => {
      expect(redact(`https://raven.example/api/media/7/file?t=${TICKET}`)).toBe(
        'https://raven.example/api/media/7/file?t=[redacted]',
      )
      expect(redact('/api/media/7/stream?a=1&t=whatever&b=2')).toBe(
        '/api/media/7/stream?a=1&t=[redacted]&b=2',
      )
      expect(redact(`Opening ${TICKET} for media 7`)).toBe('Opening [redacted] for media 7')
      expect(redact(`{"ticket":"${TICKET}"}`)).toBe('{"ticket":"[redacted]"}')
      expect(redact(`{\\"ticket\\":\\"${TICKET}\\"}`)).toBe('{\\"ticket\\":\\"[redacted]\\"}')
      expect(redact(inspect({ ticket: TICKET }))).toBe("{ ticket: '[redacted]' }")
      expect(redact(JSON.stringify({ url: `http://h/file?t=${TICKET}`, ok: true }))).toBe(
        '{"url":"http://h/file?t=[redacted]","ok":true}',
      )
      expect(redact('/library?sort=t&q=a&start=3')).toBe('/library?sort=t&q=a&start=3')
      expect(redact('the main account.json file and my-account.refreshSettings.x')).toBe(
        'the main account.json file and my-account.refreshSettings.x',
      )
    })

    it('blanks URL encoded secrets', () => {
      const encoded = (text: string): string => encodeURIComponent(text)
      expect(redact(`%3Ft%3D${TICKET}`)).toBe('%3Ft%3D[redacted]')
      expect(redact(`u=${encoded(`http://h/api/media/7/file?t=${TICKET}&x=1`)}`)).toBe(
        'u=http%3A%2F%2Fh%2Fapi%2Fmedia%2F7%2Ffile%3Ft%3D[redacted]%26x%3D1',
      )
      expect(redact(`a%3D${TICKET}`)).toBe('a%3D[redacted]')
      expect(redact(`a%3D${JWT}`)).toBe('a%3D[redacted]')
      expect(redact(`a%3d${JWT}`)).toBe('a%3d[redacted]')
      expect(redact(`token%3D${JWT}`)).toBe('token%3D[redacted]')
      expect(redact(`x%26access_token%3DSECRETVAL%26y%3D1`)).toBe('x%26access_token%3D[redacted]')
      expect(redact(`Authorization%3A%20Bearer%20${JWT}`)).toBe('Authorization%3A%20[redacted]')
      expect(redact(`h%3A%20Bearer%20${JWT}`)).toBe('h%3A%20Bearer%20[redacted]')
      expect(redact(`Bearer%20SECRETVAL`)).toBe('Bearer%20[redacted]')
      expect(redact(`maester-auth.0%3Dbase64-SECRETVAL`)).toBe('maester-auth.0%3D[redacted]')
      expect(redact(`http%3A%2F%2F127.0.0.1%3A5%2F${RELAY_SECRET}%2Ffile`)).toBe(
        'http%3A%2F%2F127.0.0.1%3A5%2F[redacted]%2Ffile',
      )
      expect(redact(`http%3a%2f%2f127.0.0.1%3a5%2f${RELAY_SECRET}%2ffile`)).toBe(
        'http%3a%2f%2f127.0.0.1%3a5%2f[redacted]%2ffile',
      )
      expect(redact(`password%3Dhunter2`)).toBe('password%3D[redacted]')
      expect(redact(`url=${encoded(`http://127.0.0.1:5/${RELAY_SECRET}/file`)}`)).not.toContain(
        RELAY_SECRET,
      )
      const out = redact(`Authorization%3A%20Bearer%20${JWT} ${encoded(`/x?t=${TICKET}`)}`)
      expect(redact(out)).toBe(out)
    })

    it('blanks the Supabase session cookies and their chunks', () => {
      const names = [
        'maester-auth',
        'maester-auth.0',
        'maester-auth.12',
        'sb-abcdefgh-auth-token',
        'sb-abcdefgh-auth-token.1',
      ]
      names.forEach((name) => {
        expect(redact(`${name}=base64-SECRETVAL; Path=/`)).toBe(`${name}=[redacted]; Path=/`)
        expect(redact(`h=${name}%3Dbase64-SECRETVAL`)).toBe(`h=${name}%3D[redacted]`)
        expect(redact(inspect({ name, value: 'SECRETVAL' }))).toBe(
          `{ name: '${name}', value: '[redacted]' }`,
        )
        expect(redact(JSON.stringify({ value: 'SECRETVAL', name }))).toBe(
          `{"value":"[redacted]","name":"${name}"}`,
        )
        expect(redact(JSON.stringify({ c: JSON.stringify({ name, value: 'S1' }) }))).toBe(
          `{"c":"{\\"name\\":\\"${name}\\",\\"value\\":\\"[redacted]\\"}"}`,
        )
        expect(redact(`Cookie: ${name}=SECRETVAL`)).toBe('Cookie: [redacted]')
      })
      expect(redact('Cookie: sb-abc-auth-token.0=x')).toBe('Cookie: [redacted]')
      expect(redact('sb-auth=1 maester=2 author=3')).toBe('sb-auth=1 maester=2 author=3')
    })

    it("blanks a relay URL's secret and keeps the rest", () => {
      expect(redact(`Opening http://127.0.0.1:54321/${RELAY_SECRET}/file`)).toBe(
        'Opening http://127.0.0.1:54321/[redacted]/file',
      )
      expect(redact(`GET http://127.0.0.1:80/${RELAY_SECRET}/subtitles/external-2 failed`)).toBe(
        'GET http://127.0.0.1:80/[redacted]/subtitles/external-2 failed',
      )
      expect(redact(JSON.stringify({ url: `http://127.0.0.1:1/${RELAY_SECRET}/file` }))).toBe(
        '{"url":"http://127.0.0.1:1/[redacted]/file"}',
      )
      expect(redact(`{\\"u\\":\\"http://127.0.0.1:1/${RELAY_SECRET}/file\\"}`)).toBe(
        '{\\"u\\":\\"http://127.0.0.1:1/[redacted]/file\\"}',
      )
      const inspected = redact(inspect({ url: `http://127.0.0.1:9/${RELAY_SECRET}` }))
      expect(inspected).not.toContain(RELAY_SECRET)
      expect(inspected).toContain("'http://127.0.0.1:9/[redacted]'")
    })

    it('leaves other loopback and server URLs alone', () => {
      const urls = [
        'http://127.0.0.1:54321/api/media/7/file',
        'http://127.0.0.1:54321/abc/file',
        `http://127.0.0.1:54321/${RELAY_SECRET}Z/file`,
        `http://127.0.0.1:54321/${RELAY_SECRET.slice(1)}/file`,
        `https://raven.example/${RELAY_SECRET}/file`,
      ]
      urls.forEach((url) => expect(redact(url)).toBe(url))
    })

    it('blanks an email address in every form', () => {
      expect(redact(`signed in as ${EMAIL}.`)).toBe('signed in as <email>.')
      expect(redact(`{"email":"${EMAIL}","x":1}`)).toBe('{"email":"<email>","x":1}')
      expect(redact(`{\\"email\\":\\"${EMAIL}\\"}`)).toBe('{\\"email\\":\\"<email>\\"}')
      expect(redact(inspect({ email: EMAIL }))).toBe("{ email: '<email>' }")
      expect(redact(`/auth/v1/recover?email=${EMAIL}&x=1`)).toBe(
        '/auth/v1/recover?email=<email>&x=1',
      )
      expect(redact('/auth/v1/recover?email=cj%40example.com&x=1')).toBe(
        '/auth/v1/recover?email=<email>&x=1',
      )
      expect(redact('a@b.co, c.d@e-f.g.org; <h@i.io>')).toBe('<email>, <email>; <<email>>')
    })

    it('leaves what is not an email alone', () => {
      const samples = [
        "import { x } from '@raven/core'",
        'resolved @raven/core@1.2.3 and react@19.2.0 and @types/node@22.0.0',
        'bun add @luwin/web @shared/server',
        'Loaded /Users/cj/node_modules/@raven/ui/dist/index.js',
        'asset icon@2x.png and icon@3x.webp',
        '@ alone, a@b, @home, user@localhost, 1 @ 2',
        'timestamps 10:00@host and a @ b.c',
        'git ref main@{upstream}',
      ]
      samples.forEach((line) => {
        const expected = line.replace('/Users/cj/node_modules/@raven/ui/dist/index.js', '<path>')
        expect(redact(line)).toBe(expected)
      })
    })

    it('leaves ordinary words and fields alone', () => {
      const samples = [
        'tokens=5 token_count=3 tokenizer: fine',
        'authority=raven.example author=cj',
        'the api key is missing',
        'Unexpected token } in JSON',
        'bearers of news',
        'e2e: signed in at http://127.0.0.1:5173/library?page=2',
      ]
      samples.forEach((line) => expect(redact(line)).toBe(line))
    })

    it('changes nothing when run twice', () => {
      const inputs = [
        `Authorization: Bearer SECRETVAL ${JWT} Bearer X`,
        `token=A&access_token=B refresh_token: C {"apikey":"D"} { token_hash: 'E' } ${EMAIL}`,
        `http://h/file?t=${TICKET} ${TICKET} http://127.0.0.1:1/${RELAY_SECRET}/file`,
        `%3Ft%3D${TICKET} a%3D${JWT} token%3D${JWT} Authorization%3A%20Bearer%20${JWT} http%3A%2F%2F127.0.0.1%3A5%2F${RELAY_SECRET}%2Ffile`,
        'maester-auth.0=base64-X; sb-abc-auth-token=Y Cookie: maester-auth=Z',
        inspect({ name: 'maester-auth.1', value: 'SECRETVAL', email: EMAIL, token: JWT }),
        JSON.stringify({ body: JSON.stringify({ token: 'T', email: EMAIL, t: 'x' }) }),
        ...FIELDS.flatMap((name) => forms({ name, secret: JWT })),
      ]
      inputs.forEach((input) => {
        const once = redact(input)
        expect(redact(once)).toBe(once)
      })
    })

    it('logs none of them', () => {
      const line = logLine({
        at: 0,
        level: 'warn',
        message: `Bearer ${JWT} ${EMAIL} ?t=${TICKET} http://127.0.0.1:1/${RELAY_SECRET}/file`,
      })
      expect(line).toBe(
        `${STAMP}warn Bearer [redacted] <email> ?t=[redacted] http://127.0.0.1:1/[redacted]/file\n`,
      )
    })
  })

  it('blanks the paths mpv names, quoted or bare', () => {
    expect(
      redact("[file] Cannot open file '/Volumes/Media/Secret Film.mkv': No such file or directory"),
    ).toBe("[file] Cannot open file '<path>': No such file or directory")
    expect(redact("mpv error file: Cannot open file '/Volumes/Media/Director's Cut.mkv': x")).toBe(
      "mpv error file: Cannot open file '<path>': x",
    )
    expect(redact('mpv error stream: Failed to open /private/var/folders/T/Secret Film.mp4.')).toBe(
      'mpv error stream: Failed to open <path>',
    )
    expect(redact('[ffmpeg/demuxer] /Users/cj/Movies/Secret Film.mkv: Invalid data found')).toBe(
      '[ffmpeg/demuxer] <path>',
    )
    expect(redact('Opening file:///Volumes/Media/Secret%20Film.mkv failed')).toBe('Opening <path>')
    expect(redact('sub-add "/Volumes/Media/Secret Film.en.srt" failed')).toBe(
      'sub-add "<path>" failed',
    )
  })

  it('blanks the paths Node names in its errors', () => {
    expect(
      redact("ENOENT: no such file or directory, realpath '/Volumes/Media/Secret Film.mkv'"),
    ).toBe("ENOENT: no such file or directory, realpath '<path>'")
    expect(
      redact(
        "EACCES: permission denied, rename '/Users/cj/Library/Logs/raven/raven.log' -> '/Users/cj/Library/Logs/raven/raven.log.1'",
      ),
    ).toBe("EACCES: permission denied, rename '<path>'")
    expect(
      redact(
        "Error: ENOENT: no such file or directory, scandir '/tmp/raven/Secret'\n    at async readdir (node:internal/fs/promises:950:18)",
      ),
    ).toBe(
      "Error: ENOENT: no such file or directory, scandir '<path>'\n    at async readdir (node:internal/fs/promises:950:18)",
    )
  })

  it('blanks a path mpv names after a protocol prefix', () => {
    expect(redact('mpv warn file:/Volumes/Media/Secret Film.mkv: x')).toBe('mpv warn file:<path>')
    expect(redact('mpv error stream:/Volumes/Media/Secret Film.mkv')).toBe(
      'mpv error stream:<path>',
    )
  })

  it('blanks a path in backticks', () => {
    expect(redact('Cannot open `/Volumes/Media/Secret Film.mkv`: x')).toBe(
      'Cannot open `<path>`: x',
    )
    expect(redact('Cannot open `/m/Secret Film.mkv`')).toBe('Cannot open `<path>`')
  })

  it('blanks a path in the home folder, quoted or bare', () => {
    expect(redact("open '~/Movies/Secret Film.mkv' failed")).toBe("open '<path>' failed")
    expect(redact('open "~/Movies/Secret Film.mkv" failed')).toBe('open "<path>" failed')
    expect(redact('open `~/Movies/Secret Film.mkv` failed')).toBe('open `<path>` failed')
    expect(redact('Failed to open ~/Movies/Secret Film.mkv')).toBe('Failed to open <path>')
    expect(redact('see a~/b and http://x/~/c')).toBe('see a~/b and http://x/~/c')
  })

  it('blanks bare paths under every root that holds files, in any case', () => {
    const roots = [
      '/Media/Secret Film.mkv',
      '/Network/Servers/den/Secret Film.mkv',
      '/System/Volumes/Data/Secret Film.mkv',
      '/users/cj/Secret Film.mkv',
      '/VOLUMES/Media/Secret Film.mkv',
      '/Users/cj/Secret Film.mkv',
    ]
    roots.forEach((path) => expect(redact(`open ${path}`)).toBe('open <path>'))
  })

  it('blanks the whole quoted name when it holds the quote or a line break', () => {
    expect(redact('sub-add "/m/a"Secret Film.mkv" failed')).toBe('sub-add "<path>" failed')
    expect(redact("open '/Volumes/a\nSecret Film.mkv' failed")).toBe("open '<path>' failed")
    expect(redact('open "/m/a\nSecret Film.mkv" failed')).toBe('open "<path>" failed')
    expect(redact('open `/m/a`Secret Film.mkv` failed')).toBe('open `<path>` failed')
    expect(redact("rename '/m/a' -> '/m/b")).toBe("rename '<path>' -> '<path>'")
  })

  it('blanks a quoted path that never closes to the end', () => {
    expect(redact("open '/m/a\nSecret Film")).toBe("open '<path>'")
    expect(redact('open "/m/Secret Film')).toBe('open "<path>"')
  })

  it('leaves a server address and a path inside a URL alone', () => {
    const texts = [
      'mpv warn ffmpeg: http://127.0.0.1:5000/api/media/1/file: Invalid data',
      'http://127.0.0.1:1234/api/media/1',
      'https://raven.example/Users/7/file',
      'https://raven.example/api/Media/7',
      'open file .mkv',
    ]
    texts.forEach((text) => expect(redact(text)).toBe(text))
  })

  it('leaves normal text alone', () => {
    const texts = [
      'pinned 3 items; spin: 2; the password is wrong; open file .mkv',
      'the PIN dialog',
      'password manager',
      'spin: 3',
      'pinned=1',
      'cookie jar',
      'no cookies here',
      'opening pin=',
      'Cookie policy: none',
      'mpv: cookies: off',
      'https://raven.example/api/media/7/file',
      'open server title 7 on Den',
    ]
    texts.forEach((text) => expect(redact(text)).toBe(text))
  })

  it('blanks a word after a PIN label, since it cannot tell it from a PIN', () => {
    expect(redact('PIN: wrong length')).toBe('PIN: [redacted]')
  })
})

describe('logLine', () => {
  it('writes one stamped line per message', () => {
    expect(logLine({ at: 0, level: 'warn', message: 'a\nb\u0007c' })).toBe(
      '1970-01-01T00:00:00.000Z warn a b c\n',
    )
    const long = logLine({ at: 0, level: 'info', message: 'x'.repeat(5000) })
    expect(long).toBe(`${STAMP}info ${'x'.repeat(LOG_LINE_MAX)}\n`)
    expect(long.length).toBe(`${STAMP}info `.length + LOG_LINE_MAX + 1)
  })

  it('turns every control character into a space', () => {
    expect(logLine({ at: 0, level: 'error', message: 'a\r\tb\u0000c\u001bd\u007fe\u0085f' })).toBe(
      `${STAMP}error a  b c d e f\n`,
    )
  })

  it('redacts before it cuts, so a cut never exposes part of a secret', () => {
    const message = `${'x'.repeat(LOG_LINE_MAX - 20)} Cookie: raven_unlock=${'s'.repeat(100)}`
    const line = logLine({ at: 0, level: 'warn', message })
    expect(line).not.toContain('sss')
    expect(line).toContain('Cookie: [redacted]')
  })

  it('turns line and paragraph separators into spaces', () => {
    expect(logLine({ at: 0, level: 'info', message: 'a\u2028b\u2029c' })).toBe(
      `${STAMP}info a b c\n`,
    )
  })

  it('never cuts a surrogate pair in half', () => {
    const line = logLine({
      at: 0,
      level: 'info',
      message: `${'x'.repeat(LOG_LINE_MAX - 1)}\u{1F600}`,
    })
    expect(line).toBe(`${STAMP}info ${'x'.repeat(LOG_LINE_MAX - 1)}\n`)
    const fits = logLine({
      at: 0,
      level: 'info',
      message: `${'x'.repeat(LOG_LINE_MAX - 2)}\u{1F600}`,
    })
    expect(fits).toBe(`${STAMP}info ${'x'.repeat(LOG_LINE_MAX - 2)}\u{1F600}\n`)
  })

  // A few redaction patterns backtrack quadratically; without the cap these take seconds.
  it.each([
    ['a run of hyphenated words', 'a-'.repeat(150_000)],
    ['a run of cookie names', 'raven_unlock '.repeat(23_000)],
    ['a run of secret keys', 'pin='.repeat(75_000)],
    ['a run of quoted path starts', "'/".repeat(150_000)],
    ['a run of quoted path starts across lines', "'/a\n".repeat(75_000)],
    ['a run of double quoted path starts', '"/'.repeat(150_000)],
    ['a run of double quoted path starts across lines', '"/a\n'.repeat(75_000)],
    ['a run of backtick path starts', '`/'.repeat(150_000)],
    ['a run of home folder paths', '~/'.repeat(150_000)],
    ['a run of home folder paths across lines', ' ~/\n'.repeat(75_000)],
    ['a run of protocol prefixed paths', 'file:/Volumes/'.repeat(21_500)],
    ['a run of volumes', '/Volumes/'.repeat(33_400)],
    ['a run of file URLs', 'file://'.repeat(43_000)],
    ['a run of maester cookie names', 'maester-auth'.repeat(25_000)],
    ['a run of Supabase cookie names', 'sb-a-auth-token'.repeat(20_000)],
    ['a run of cookie names with values', 'raven_unlock value '.repeat(16_000)],
    ['a run of encoded separators', 'token%20'.repeat(37_500)],
    ['a run of encoded JWT starts', '%3Deyj'.repeat(50_000)],
    ['a run of encoded t parameters', '%3Ft%3D'.repeat(43_000)],
    ['a run of encoded relay hosts', '127.0.0.1%3A1%2F'.repeat(19_000)],
    ['a run of bearer words', 'Bearer '.repeat(43_000)],
    ['a run of JWT starts', 'eyJ'.repeat(100_000)],
    ['a run of JWT segments', 'eyJ.'.repeat(75_000)],
    ['a run of JWT starts with dots', 'eyJa.b'.repeat(50_000)],
    ['a run of token keys', 'token='.repeat(50_000)],
    ['a run of token keys with quotes', 'token="'.repeat(40_000)],
    ['a run of token keys with escaped quotes', 'token=\\"'.repeat(35_000)],
    ['a run of token key words', 'access_token '.repeat(23_000)],
    ['a run of authorization keys', 'authorization: '.repeat(20_000)],
    ['a run of ticket prefixes', 'account.'.repeat(37_500)],
    ['a run of t parameters', '?t='.repeat(100_000)],
    ['a run of session cookie names', 'maester-auth.0 '.repeat(20_000)],
    ['a run of Supabase cookie prefixes', 'sb-'.repeat(100_000)],
    ['a run of Supabase cookie words', 'sb-a '.repeat(60_000)],
    ['a run of hyphenated Supabase words', 'sb-a-'.repeat(60_000)],
    ['a run of relay hosts', '127.0.0.1:1/'.repeat(25_000)],
    ['a run of email locals', 'a.'.repeat(150_000)],
    ['a run of at signs', 'a@'.repeat(150_000)],
    ['a run of email domains', 'a@a.'.repeat(75_000)],
    ['a run of email hyphens', 'a@a-'.repeat(75_000)],
    ['a run of email labels', 'a@b'.concat('.1'.repeat(150_000))],
  ])('logs 300 KB of %s in under 200 ms', (_name, message) => {
    const { log } = setup()
    const startedAt = performance.now()
    log.warn(message)
    expect(performance.now() - startedAt).toBeLessThan(200)
  })

  // The sign-in patterns are linear on their own, with no help from the cap above.
  it.each([
    ['JWT starts', 'eyJ'.repeat(100_000)],
    ['JWT segments', 'eyJ.'.repeat(75_000)],
    ['bearer words', 'Bearer '.repeat(43_000)],
    ['token keys', 'token='.repeat(50_000)],
    ['token key words', 'access_token '.repeat(23_000)],
    ['ticket prefixes', 'account.'.repeat(37_500)],
    ['t parameters', '?t='.repeat(100_000)],
    ['Supabase cookie prefixes', 'sb-'.repeat(100_000)],
    ['hyphenated Supabase words', 'sb-a-'.repeat(60_000)],
    ['relay hosts', '127.0.0.1:1/'.repeat(25_000)],
    ['email locals', 'a.'.repeat(150_000)],
    ['at signs', 'a@'.repeat(150_000)],
    ['email domains', 'a@a.'.repeat(75_000)],
    ['email hyphens', 'a@a-'.repeat(75_000)],
    ['email labels', `a@b${'.1'.repeat(150_000)}`],
    ['maester cookie names', 'maester-auth'.repeat(25_000)],
    ['Supabase cookie names', 'sb-a-auth-token'.repeat(20_000)],
    ['cookie names with values', 'raven_unlock value '.repeat(16_000)],
    ['encoded separators', 'token%20'.repeat(37_500)],
    ['encoded JWT starts', '%3Deyj'.repeat(50_000)],
    ['encoded JWT segments', '%3Deyj.'.repeat(43_000)],
    ['encoded t parameters', '%3Ft%3D'.repeat(43_000)],
    ['encoded relay hosts', '127.0.0.1%3A1%2F'.repeat(19_000)],
  ])('redacts 300 KB of %s in linear time', (_name, text) => {
    // An eighth of the input of the same shape: linear work takes about 8 times as long on the
    // whole and quadratic work 64 times, so 24 times tells them apart whatever the machine's speed.
    const eighth = text.slice(0, text.length / 8)
    // Milliseconds of this process's CPU, not of the clock, so other work on the machine, as
    // when every project's tests run at once, never counts against either side.
    const timeOf = (inputs: readonly string[]): number => {
      const before = process.cpuUsage()
      inputs.forEach((input) => redact(input))
      const { user, system } = process.cpuUsage(before)
      return (user + system) / 1000
    }
    // The eighth is timed eight times over, back to back with the whole, so both sides of a pair
    // take about as long, and the median pair ignores the odd one a pause fell into. A short run
    // can still be near zero, so the eighth's time has a floor.
    const eighths = Array.from({ length: 8 }, () => eighth)
    const ratios = Array.from({ length: 7 }, () => {
      const perEighth = Math.max(timeOf(eighths) / 8, 5)
      return timeOf([text]) / perEighth
    }).toSorted((a, b) => a - b)
    expect(ratios.at(3) ?? Infinity).toBeLessThanOrEqual(24)
  })

  it('caps a message before redacting it, never between the halves of a surrogate pair', () => {
    // Redaction shortens what it blanks, which pulls text from past LOG_LINE_MAX into the line,
    // but nothing from past the cap.
    const secret = `password=${'s'.repeat(LOG_LINE_MAX * 4 - 40)};`
    const cutInHalf = logLine({
      at: 0,
      level: 'info',
      message: `${secret}${'k'.repeat(29)}\u{1F600}${'z'.repeat(10)}`,
    })
    expect(cutInHalf).toBe(`${STAMP}info password=[redacted];${'k'.repeat(29)}\n`)
    const whole = logLine({
      at: 0,
      level: 'info',
      message: `${secret}${'k'.repeat(28)}\u{1F600}${'z'.repeat(10)}`,
    })
    expect(whole).toBe(`${STAMP}info password=[redacted];${'k'.repeat(28)}\u{1F600}\n`)
  })

  it('drops a quoted path the cap cuts in half', () => {
    const secret = `password=${'s'.repeat(LOG_LINE_MAX * 4 - 40)};`
    const line = logLine({
      at: 0,
      level: 'info',
      message: `${secret}open '/m/${'S'.repeat(40)}.mkv' failed`,
    })
    expect(line).toBe(`${STAMP}info password=[redacted];open '<path>'\n`)
  })

  it('does not throw on a time a Date cannot hold', () => {
    expect(logLine({ at: Number.NaN, level: 'info', message: 'm' })).toBe('invalid-time info m\n')
    expect(logLine({ at: 9e15, level: 'info', message: 'm' })).toBe('invalid-time info m\n')
  })

  it('stamps the time it is given', () => {
    expect(logLine({ at: Date.UTC(2026, 9, 17, 8, 5, 3, 7), level: 'info', message: 'm' })).toBe(
      '2026-10-17T08:05:03.007Z info m\n',
    )
  })
})

describe('rotationMoves', () => {
  it('shifts every kept file up by one, oldest first', () => {
    expect(rotationMoves({ file: '/l/raven.log', files: 5 })).toEqual([
      { from: '/l/raven.log.3', to: '/l/raven.log.4' },
      { from: '/l/raven.log.2', to: '/l/raven.log.3' },
      { from: '/l/raven.log.1', to: '/l/raven.log.2' },
      { from: '/l/raven.log', to: '/l/raven.log.1' },
    ])
  })

  it('moves only the live file when two are kept and nothing when one is', () => {
    expect(rotationMoves({ file: '/l/a', files: 2 })).toEqual([{ from: '/l/a', to: '/l/a.1' }])
    expect(rotationMoves({ file: '/l/a', files: 1 })).toEqual([])
  })
})

describe('createLog', () => {
  it('names its file inside the folder', () => {
    expect(setup().log.file).toBe(FILE)
  })

  it('only queues on a call and drains once on a zero timer', async () => {
    const { log, calls, delays, fire, disk, whenAppended } = setup()
    log.info('one')
    log.info('two')
    expect(calls).toEqual([])
    expect(delays).toEqual([0])
    const appended = whenAppended()
    fire()
    await appended
    expect(lines(disk.get(FILE))).toEqual([`${STAMP}info one`, `${STAMP}info two`])
  })

  it('appends in order and creates the folder private', async () => {
    const { log, calls, disk } = setup()
    log.info('one')
    log.warn('two')
    await log.flush()
    expect(ops({ calls, wanted: [LOG_FS_OPS.mkdir] })).toEqual([
      { op: 'mkdir', args: [DIR, { recursive: true, mode: 0o700 }] },
    ])
    expect(ops({ calls, wanted: [LOG_FS_OPS.appendFile] })).toEqual([
      {
        op: 'appendFile',
        args: [FILE, `${STAMP}info one\n${STAMP}warn two\n`, { mode: 0o600 }],
      },
    ])
    expect(disk.get(FILE)).toBe(`${STAMP}info one\n${STAMP}warn two\n`)
  })

  it('prepares the folder and reads the size on the first drain only', async () => {
    const { log, calls } = setup()
    log.info('one')
    await log.flush()
    log.error('two')
    await log.flush()
    expect(
      ops({ calls, wanted: [LOG_FS_OPS.mkdir, LOG_FS_OPS.size] }).map((call) => call.op),
    ).toEqual(['mkdir', 'size'])
    expect(ops({ calls, wanted: [LOG_FS_OPS.appendFile] })).toHaveLength(2)
  })

  it('never writes a secret it is handed', async () => {
    const { log, disk } = setup()
    log.warn('mpv: http-header-fields Cookie: raven_unlock=SECRET1; raven_admin=SECRET2')
    log.error('request failed raven_admin=SECRET3 {"pin":"SECRET4","password":"SECRET5"}')
    log.info('open server title 7 at https://raven.example/api/media/7/file')
    await log.flush()
    const text = disk.get(FILE) ?? ''
    expect(text).not.toContain('SECRET')
    expect(text).toContain('https://raven.example/api/media/7/file')
    expect(lines(text)).toHaveLength(3)
  })

  it('writes concurrent calls in order, one drain at a time', async () => {
    const { log, disk, inFlight, holdNextAppend, calls } = setup()
    const hold = holdNextAppend()
    log.info('one')
    const first = log.flush()
    await hold.entered
    log.info('two')
    log.warn('three')
    const second = log.flush()
    log.error('four')
    hold.release()
    await Promise.all([first, second, log.flush()])
    expect(inFlight.max).toBe(1)
    expect(lines(disk.get(FILE))).toEqual([
      `${STAMP}info one`,
      `${STAMP}info two`,
      `${STAMP}warn three`,
      `${STAMP}error four`,
    ])
    expect(ops({ calls, wanted: [LOG_FS_OPS.appendFile] }).length).toBeLessThanOrEqual(3)
  })

  it('keeps the timer drain and a flush from overlapping', async () => {
    const { log, disk, inFlight, holdNextAppend, fire, pending } = setup()
    const hold = holdNextAppend()
    log.info('one')
    fire()
    await hold.entered
    log.info('two')
    expect(pending.size).toBe(1)
    const flushed = log.flush()
    expect(pending.size).toBe(0)
    hold.release()
    await flushed
    expect(inFlight.max).toBe(1)
    expect(lines(disk.get(FILE))).toEqual([`${STAMP}info one`, `${STAMP}info two`])
  })

  describe('rotation', () => {
    const line50 = logLine({ at: 0, level: 'info', message: 'r'.repeat(19) })
    const full = (room: number) => 'x'.repeat(LOG_MAX_BYTES - room)
    const kept = {
      [`${FILE}.1`]: 'one',
      [`${FILE}.2`]: 'two',
      [`${FILE}.3`]: 'three',
      [`${FILE}.4`]: 'four',
    }

    it('uses a 50-byte line', () => {
      expect(bytes(line50)).toBe(50)
    })

    it('rotates before a write would pass 1 MiB', async () => {
      const { log, calls, disk, errors } = setup({ files: { [FILE]: full(10), ...kept } })
      log.info('r'.repeat(19))
      await log.flush()
      expect(
        ops({ calls, wanted: [LOG_FS_OPS.remove, LOG_FS_OPS.rename, LOG_FS_OPS.appendFile] }).map(
          (call) => call.args,
        ),
      ).toEqual([
        [`${FILE}.4`],
        [`${FILE}.3`, `${FILE}.4`],
        [`${FILE}.2`, `${FILE}.3`],
        [`${FILE}.1`, `${FILE}.2`],
        [FILE, `${FILE}.1`],
        [FILE, line50, { mode: 0o600 }],
      ])
      expect(disk.get(FILE)).toBe(line50)
      expect(disk.get(`${FILE}.1`)).toBe(full(10))
      expect(disk.get(`${FILE}.2`)).toBe('one')
      expect(disk.get(`${FILE}.3`)).toBe('two')
      expect(disk.get(`${FILE}.4`)).toBe('three')
      expect([...disk.keys()].toSorted()).toEqual([
        FILE,
        `${FILE}.1`,
        `${FILE}.2`,
        `${FILE}.3`,
        `${FILE}.4`,
      ])
      expect(LOG_FILES).toBe(5)
      expect(errors).toEqual([])
    })

    it('fills the file to exactly 1 MiB without rotating', async () => {
      const { log, calls, disk } = setup({ files: { [FILE]: full(50) } })
      log.info('r'.repeat(19))
      await log.flush()
      expect(ops({ calls, wanted: [LOG_FS_OPS.remove, LOG_FS_OPS.rename] })).toEqual([])
      expect(bytes(disk.get(FILE) ?? '')).toBe(LOG_MAX_BYTES)
    })

    it('rotates when one byte more would pass 1 MiB', async () => {
      const { log, disk } = setup({ files: { [FILE]: full(49) } })
      log.info('r'.repeat(19))
      await log.flush()
      expect(disk.get(FILE)).toBe(line50)
      expect(disk.get(`${FILE}.1`)).toBe(full(49))
    })

    it('skips a missing file and still runs the other moves', async () => {
      const { log, calls, disk, errors } = setup({
        files: { [FILE]: full(10), [`${FILE}.1`]: 'one', [`${FILE}.3`]: 'three' },
      })
      log.info('r'.repeat(19))
      await log.flush()
      expect(ops({ calls, wanted: [LOG_FS_OPS.rename] }).map((call) => call.args)).toEqual([
        [`${FILE}.3`, `${FILE}.4`],
        [`${FILE}.2`, `${FILE}.3`],
        [`${FILE}.1`, `${FILE}.2`],
        [FILE, `${FILE}.1`],
      ])
      expect(disk.get(`${FILE}.4`)).toBe('three')
      expect(disk.has(`${FILE}.3`)).toBe(false)
      expect(disk.get(`${FILE}.2`)).toBe('one')
      expect(disk.get(`${FILE}.1`)).toBe(full(10))
      expect(disk.get(FILE)).toBe(line50)
      expect(errors).toEqual([])
    })

    it('counts what it wrote, so the next drains rotate without reading the size again', async () => {
      const { log, calls, disk, time } = setup()
      const message = 'w'.repeat(LOG_LINE_MAX)
      const lineBytes = bytes(logLine({ at: 0, level: 'info', message }))
      const total = Math.floor(LOG_MAX_BYTES / lineBytes) + 1
      await Array.from({ length: total }).reduce<Promise<void>>(async (previous, _, index) => {
        await previous
        time.now = Math.floor(index / LOG_BURST_LINES) * LOG_BURST_MS
        log.info(message)
        if (index % 50 === 0) await log.flush()
      }, Promise.resolve())
      await log.flush()
      expect(ops({ calls, wanted: [LOG_FS_OPS.size] })).toHaveLength(1)
      expect(ops({ calls, wanted: [LOG_FS_OPS.remove] })).toHaveLength(1)
      expect(ops({ calls, wanted: [LOG_FS_OPS.rename] }).at(-1)?.args).toEqual([FILE, `${FILE}.1`])
      expect([...disk.keys()].toSorted()).toEqual([FILE, `${FILE}.1`])
      expect(bytes(disk.get(`${FILE}.1`) ?? '')).toBeLessThanOrEqual(LOG_MAX_BYTES)
      expect(lines(disk.get(`${FILE}.1`))).toHaveLength(total - 1)
      expect(lines(disk.get(FILE))).toHaveLength(1)
    })

    it('splits a batch that crosses the cap so no file passes 1 MiB', async () => {
      const { log, disk, time } = setup()
      const message = 'w'.repeat(LOG_LINE_MAX)
      const lineBytes = bytes(logLine({ at: 0, level: 'info', message }))
      const total = 300
      Array.from({ length: total }).forEach((_, index) => {
        time.now = Math.floor(index / LOG_BURST_LINES) * LOG_BURST_MS
        log.info(message)
      })
      await log.flush()
      const older = lines(disk.get(`${FILE}.1`))
      const newer = lines(disk.get(FILE))
      expect(older).toHaveLength(Math.floor(LOG_MAX_BYTES / lineBytes))
      expect(older.length + newer.length).toBe(total)
      expect(bytes(disk.get(`${FILE}.1`) ?? '')).toBeLessThanOrEqual(LOG_MAX_BYTES)
      expect(bytes(disk.get(FILE) ?? '')).toBeLessThanOrEqual(LOG_MAX_BYTES)
    })

    it('keeps logging when an older file is locked', async () => {
      const { log, disk, errors, state } = setup({ files: { [FILE]: full(10), ...kept } })
      state.refuse = ({ op, path }) =>
        op === LOG_FS_OPS.rename && path === `${FILE}.2` ? 'EACCES' : null
      log.info('r'.repeat(19))
      await log.flush()
      expect(disk.get(FILE)).toBe(line50)
      expect(disk.get(`${FILE}.1`)).toBe(full(10))
      expect(errors).toHaveLength(1)
      expect(disk.size).toBeLessThanOrEqual(LOG_FILES)
    })

    it('drops the batch when the live file cannot move, then rotates once it can', async () => {
      const { log, disk, errors, state } = setup({ files: { [FILE]: full(10) } })
      state.refuse = ({ op, path }) => (op === LOG_FS_OPS.rename && path === FILE ? 'EBUSY' : null)
      log.info('lost')
      await log.flush()
      expect(disk.get(FILE)).toBe(full(10))
      expect(errors).toHaveLength(1)
      state.refuse = () => null
      log.info('r'.repeat(19))
      await log.flush()
      expect(disk.get(FILE)).toBe(line50)
      expect(disk.get(`${FILE}.1`)).toBe(full(10))
    })
  })

  describe('flood', () => {
    it('drops a flood and says how many', async () => {
      const { log, disk, time } = setup()
      Array.from({ length: 250 }).forEach((_, index) => log.info(`line ${index}`))
      time.now = LOG_BURST_MS
      log.info('after')
      await log.flush()
      const written = lines(disk.get(FILE))
      expect(written).toHaveLength(LOG_BURST_LINES + 2)
      expect(written.at(LOG_BURST_LINES - 1)).toBe(`${STAMP}info line 199`)
      expect(written.slice(LOG_BURST_LINES)).toEqual([
        '1970-01-01T00:00:10.000Z warn log: 50 lines dropped',
        '1970-01-01T00:00:10.000Z info after',
      ])
    })

    it('writes the count of a flood still inside its window at flush', async () => {
      const { log, disk, time } = setup()
      Array.from({ length: 230 }).forEach(() => log.info('x'))
      time.now = 4_000
      await log.flush()
      const written = lines(disk.get(FILE))
      expect(written).toHaveLength(LOG_BURST_LINES + 1)
      expect(written.at(-1)).toBe('1970-01-01T00:00:04.000Z warn log: 30 lines dropped')
      log.info('still inside')
      await log.flush()
      time.now = LOG_BURST_MS
      log.info('after')
      await log.flush()
      expect(lines(disk.get(FILE)).slice(LOG_BURST_LINES + 1)).toEqual([
        '1970-01-01T00:00:04.000Z warn log: 1 lines dropped',
        '1970-01-01T00:00:10.000Z info after',
      ])
    })

    it('holds at most LOG_QUEUE_MAX lines while a write hangs and counts the rest', async () => {
      const { log, disk, time, holdNextAppend } = setup()
      const hold = holdNextAppend()
      log.info('first')
      const first = log.flush()
      await hold.entered
      const windows = 7
      Array.from({ length: windows * LOG_BURST_LINES }).forEach((_, index) => {
        time.now = Math.floor(index / LOG_BURST_LINES) * LOG_BURST_MS
        log.info(`line ${index}`)
      })
      expect(log.isDirty()).toBe(true)
      time.now = windows * LOG_BURST_MS
      hold.release()
      await first
      await log.flush()
      const written = lines(disk.get(FILE))
      const dropped = windows * LOG_BURST_LINES - LOG_QUEUE_MAX
      expect(written).toHaveLength(1 + LOG_QUEUE_MAX + 1)
      expect(written.at(LOG_QUEUE_MAX)).toBe(
        `1970-01-01T00:00:40.000Z info line ${LOG_QUEUE_MAX - 1}`,
      )
      expect(written.at(-1)).toBe(`1970-01-01T00:01:10.000Z warn log: ${dropped} lines dropped`)
    })

    it('writes a budget mark through a flood, without spending the flood its slot', async () => {
      const { log, disk, time } = setup()
      Array.from({ length: 150 }).forEach((_, index) => log.warn(`flood ${index}`))
      log.mark('raven-memory-playing-mb 412')
      Array.from({ length: 100 }).forEach((_, index) => log.warn(`flood ${150 + index}`))
      log.mark('raven-quit-ms 104')
      time.now = 4_000
      await log.flush()
      const written = lines(disk.get(FILE))
      expect(written).toContain(`${STAMP}info raven-memory-playing-mb 412`)
      expect(written).toContain(`${STAMP}info raven-quit-ms 104`)
      expect(written.filter((line) => line.includes(' warn flood '))).toHaveLength(LOG_BURST_LINES)
      expect(written.at(-1)).toBe('1970-01-01T00:00:04.000Z warn log: 50 lines dropped')
    })

    it('still holds at most LOG_QUEUE_MAX lines with marks among them', async () => {
      const { log, disk, holdNextAppend } = setup()
      const hold = holdNextAppend()
      log.info('first')
      const first = log.flush()
      await hold.entered
      Array.from({ length: LOG_QUEUE_MAX + 5 }).forEach((_, index) => log.mark(`mark ${index}`))
      hold.release()
      await first
      await log.flush()
      const written = lines(disk.get(FILE))
      expect(written).toHaveLength(1 + LOG_QUEUE_MAX + 1)
      expect(written.at(-1)).toBe(`${STAMP}warn log: 5 lines dropped`)
    })

    it('counts a line just inside the window as dropped', async () => {
      const { log, disk, time } = setup()
      Array.from({ length: LOG_BURST_LINES + 1 }).forEach(() => log.info('x'))
      time.now = LOG_BURST_MS - 1
      log.info('still inside')
      time.now = LOG_BURST_MS
      log.info('after')
      await log.flush()
      const written = lines(disk.get(FILE))
      expect(written).toHaveLength(LOG_BURST_LINES + 2)
      expect(written.at(-2)).toBe('1970-01-01T00:00:10.000Z warn log: 2 lines dropped')
      expect(written.join('\n')).not.toContain('still inside')
    })

    it('says nothing about drops when nothing was dropped', async () => {
      const { log, disk, time } = setup()
      log.info('one')
      time.now = LOG_BURST_MS * 3
      log.info('two')
      await log.flush()
      expect(lines(disk.get(FILE))).toEqual([
        `${STAMP}info one`,
        '1970-01-01T00:00:30.000Z info two',
      ])
    })

    it('starts a new window when the clock moves back', async () => {
      const { log, disk, time } = setup()
      time.now = 50_000
      Array.from({ length: LOG_BURST_LINES + 3 }).forEach(() => log.info('x'))
      time.now = 1_000
      log.info('earlier')
      await log.flush()
      const written = lines(disk.get(FILE))
      expect(written.slice(-2)).toEqual([
        '1970-01-01T00:00:01.000Z warn log: 3 lines dropped',
        '1970-01-01T00:00:01.000Z info earlier',
      ])
    })
  })

  describe('failures', () => {
    it('never throws when the disk refuses', async () => {
      const { log, disk, errors, state } = setup()
      state.refuse = ({ op }) => (op === LOG_FS_OPS.appendFile ? 'ENOSPC' : null)
      expect(() => log.info('one')).not.toThrow()
      await log.flush()
      log.info('two')
      await log.flush()
      expect(errors).toHaveLength(1)
      expect(String(errors[0])).toContain('appendFile')
      expect(log.isDirty()).toBe(false)
      state.refuse = () => null
      log.info('three')
      await log.flush()
      expect(lines(disk.get(FILE))).toEqual([`${STAMP}info three`])
    })

    it('reports each kind of failure once', async () => {
      const { log, errors, state } = setup()
      state.refuse = ({ op }) => (op === LOG_FS_OPS.mkdir ? 'EACCES' : null)
      log.info('one')
      await log.flush()
      log.info('two')
      await log.flush()
      state.refuse = ({ op }) => (op === LOG_FS_OPS.size ? 'EIO' : null)
      log.info('three')
      await log.flush()
      state.refuse = ({ op }) => (op === LOG_FS_OPS.appendFile ? 'EIO' : null)
      log.info('four')
      await log.flush()
      log.info('five')
      await log.flush()
      expect(errors.map(String)).toEqual([
        expect.stringContaining('mkdir'),
        expect.stringContaining('size'),
        expect.stringContaining('appendFile'),
      ])
    })

    it('never reports the same kind twice, even after a recovery', async () => {
      const { log, errors, state, disk } = setup()
      state.refuse = ({ op }) => (op === LOG_FS_OPS.appendFile ? 'ENOSPC' : null)
      log.info('one')
      await log.flush()
      state.refuse = () => null
      log.info('two')
      await log.flush()
      state.refuse = ({ op }) => (op === LOG_FS_OPS.appendFile ? 'ENOSPC' : null)
      log.info('three')
      await log.flush()
      expect(errors).toHaveLength(1)
      expect(lines(disk.get(FILE))).toEqual([`${STAMP}info two`])
    })

    it('prepares the folder again after a failure', async () => {
      const { log, calls, disk, state } = setup()
      state.refuse = ({ op }) => (op === LOG_FS_OPS.mkdir ? 'ENOENT' : null)
      log.info('one')
      await log.flush()
      state.refuse = () => null
      log.info('two')
      await log.flush()
      expect(ops({ calls, wanted: [LOG_FS_OPS.mkdir] })).toHaveLength(2)
      expect(lines(disk.get(FILE))).toEqual([`${STAMP}info two`])
    })

    it('treats a missing file as empty', async () => {
      const { log, disk, calls } = setup()
      log.info('one')
      await log.flush()
      expect(ops({ calls, wanted: [LOG_FS_OPS.remove, LOG_FS_OPS.rename] })).toEqual([])
      expect(disk.get(FILE)).toBe(`${STAMP}info one\n`)
    })

    it('survives a reporter that throws', async () => {
      const { log, disk, state } = setup({
        onError: () => {
          throw new Error('console gone')
        },
      })
      state.refuse = ({ op }) => (op === LOG_FS_OPS.appendFile ? 'EIO' : null)
      log.info('one')
      await log.flush()
      state.refuse = () => null
      log.info('two')
      await log.flush()
      expect(lines(disk.get(FILE))).toEqual([`${STAMP}info two`])
    })

    it('survives a file system call that throws instead of rejecting', async () => {
      const fake = createFakeFs()
      const clock = createFakeTimers()
      const errors: unknown[] = []
      const log = createLog({
        dir: DIR,
        fs: {
          ...fake.fs,
          size: () => {
            throw new Error('sync boom')
          },
        },
        now: () => 0,
        timers: clock.timers,
        onError: (error) => errors.push(error),
      })
      expect(() => log.info('one')).not.toThrow()
      await log.flush()
      expect(errors).toHaveLength(1)
      expect(log.isDirty()).toBe(false)
    })
  })

  it('is dirty until written', async () => {
    const { log, holdNextAppend } = setup()
    expect(log.isDirty()).toBe(false)
    log.info('one')
    expect(log.isDirty()).toBe(true)
    await log.flush()
    expect(log.isDirty()).toBe(false)
    const hold = holdNextAppend()
    log.info('two')
    const flushed = log.flush()
    await hold.entered
    expect(log.isDirty()).toBe(true)
    hold.release()
    await flushed
    expect(log.isDirty()).toBe(false)
  })

  it('resolves a flush with nothing queued', async () => {
    const { log, calls } = setup()
    await log.flush()
    expect(calls).toEqual([])
  })
})

describe('SILENT_LOG', () => {
  it('writes nothing and is never dirty', async () => {
    SILENT_LOG.info('launch raven player')
    SILENT_LOG.warn('w')
    SILENT_LOG.error('e')
    expect(SILENT_LOG.isDirty()).toBe(false)
    await SILENT_LOG.flush()
    expect(SILENT_LOG.isDirty()).toBe(false)
  })
})

describe('logFsFrom over the real file system', () => {
  const folder = { path: '' }

  beforeEach(async () => {
    folder.path = await mkdtemp(join(tmpdir(), 'raven-log-test-'))
  })

  afterEach(async () => {
    await rm(folder.path, { recursive: true, force: true })
  })

  const realFs = () => logFsFrom({ mkdir, stat, appendFile, rename, rm })

  it('rejects a missing file the way the log expects, with ENOENT', async () => {
    const error = await realFs()
      .rename({ from: join(folder.path, 'gone'), to: join(folder.path, 'moved') })
      .then(
        () => null,
        (reason: unknown) => reason,
      )
    expect(isMissingFile(error)).toBe(true)
  })

  it('measures a file, and a missing one as no size', async () => {
    await writeFile(join(folder.path, 'seven'), '1234567')
    expect(await realFs().size(join(folder.path, 'seven'))).toBe(7)
    expect(await realFs().size(join(folder.path, 'gone'))).toBeNull()
  })

  it('removes a missing file without complaint', async () => {
    await realFs().remove(join(folder.path, 'gone'))
    await writeFile(join(folder.path, 'here'), 'x')
    await realFs().remove(join(folder.path, 'here'))
    expect(await realFs().size(join(folder.path, 'here'))).toBeNull()
  })

  it('writes a private folder and file a log can rotate', async () => {
    const dir = join(folder.path, 'logs')
    const timers = createFakeTimers()
    const errors: unknown[] = []
    const log = createLog({
      dir,
      fs: realFs(),
      now: () => 0,
      timers: timers.timers,
      onError: (error) => errors.push(error),
    })
    log.info('one')
    await log.flush()
    const file = join(dir, LOG_FILE)
    expect(await readFile(file, 'utf8')).toBe(`${STAMP}info one\n`)
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(errors).toEqual([])
  })
})
