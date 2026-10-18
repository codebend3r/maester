import { join } from 'node:path'
import { isMissingFile, type Timers } from '@/main/stateStore'

export const LOG_FILE = 'raven.log'
export const LOG_MAX_BYTES = 1_048_576
export const LOG_FILES = 5
export const LOG_LINE_MAX = 4096
export const LOG_BURST_LINES = 200
export const LOG_BURST_MS = 10_000

const LOG_LEVELS = { info: 'info', warn: 'warn', error: 'error' } as const

type LogLevel = (typeof LOG_LEVELS)[keyof typeof LOG_LEVELS]

export type LogFs = {
  mkdir: (input: { path: string; options: { recursive: true; mode: number } }) => Promise<unknown>
  size: (path: string) => Promise<number | null>
  appendFile: (input: { path: string; data: string; options: { mode: number } }) => Promise<void>
  rename: (input: { from: string; to: string }) => Promise<void>
  remove: (path: string) => Promise<void>
}

/** The log's file system calls, which also name what failed in a report. */
export const LOG_FS_OPS = {
  mkdir: 'mkdir',
  size: 'size',
  appendFile: 'appendFile',
  rename: 'rename',
  remove: 'remove',
} as const satisfies { [K in keyof LogFs]: K }

/**
 * The log's file system over Node's: a missing file has no size and removing one is no
 * error, while a rename of one rejects with Node's own `ENOENT`, which the log skips.
 */
export const logFsFrom = ({
  mkdir,
  stat,
  appendFile,
  rename,
  rm,
}: {
  mkdir: (path: string, options: { recursive: true; mode: number }) => Promise<unknown>
  stat: (path: string) => Promise<{ size: number }>
  appendFile: (path: string, data: string, options: { mode: number }) => Promise<void>
  rename: (from: string, to: string) => Promise<void>
  rm: (path: string, options: { force: true }) => Promise<void>
}): LogFs => ({
  mkdir: ({ path, options }) => mkdir(path, options),
  size: (path) =>
    stat(path).then(
      ({ size }) => size,
      () => null,
    ),
  appendFile: ({ path, data, options }) => appendFile(path, data, options),
  rename: ({ from, to }) => rename(from, to),
  remove: (path) => rm(path, { force: true }),
})

export type Log = {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
  /** A budget mark, at info: outside the burst limit, so a warning flood cannot drop it. */
  mark: (message: string) => void
  /** Resolves once every line logged so far is on disk, or was dropped because the disk refused it. */
  flush: () => Promise<void>
  isDirty: () => boolean
  file: string
}

/** A log that writes nothing: a second instance hands its files to the first and quits. */
export const SILENT_LOG: Log = {
  info: () => {},
  warn: () => {},
  error: () => {},
  mark: () => {},
  flush: async () => {},
  isDirty: () => false,
  file: '',
}

/** Most lines held in memory while the disk is slow or hung; the rest are counted as dropped. */
export const LOG_QUEUE_MAX = 1000

const COOKIE_HEADER = /(cookie|set-cookie)(\s*(?::|%3A)\s*)[^\r\n]*/gi
// Any letter case, `=` or its URL encoding, spaces around it, and any name that starts with ours.
const SESSION_COOKIE = /(raven_(?:unlock|admin)[\w-]*)(\s*(?:=|%3D)\s*)[^;,\s"'`\\]*/gi
const JSON_SECRET = /("(?:pin|password)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi

// A value as JSON, JSON inside a JSON string (`\"...\"`), util.inspect (`'...'` or a backtick
// string) or a form field writes it. An unclosed quote runs to the line end; a bare value runs
// to a delimiter or the line end, spaces included, so no part of `correct horse battery` stays.
const ESCAPED_STRING = /\\"(?:[^"\\]|\\[^"\\]|\\\\(?:\\.|[^\\]))*\\"/
const DOUBLE_STRING = /"(?:[^"\\]|\\.)*"/
const SINGLE_STRING = /'(?:[^'\\]|\\.)*'/
const BACKTICK_STRING = /`(?:[^`\\]|\\.)*`/
const UNCLOSED_STRING = /\\?["'`][^\r\n]*/
const BARE_VALUE = /[^\s"'`,;&)}\]](?:[^"'`,;&)}\]\r\n]*[^\s"'`,;&)}\]])?/
// Skipping a value already blanked keeps `redact` idempotent.
const NOT_REDACTED = /(?!\\?["'`]?\[redacted\])/
const VALUE = `${NOT_REDACTED.source}(?:${[
  ESCAPED_STRING,
  DOUBLE_STRING,
  SINGLE_STRING,
  BACKTICK_STRING,
  UNCLOSED_STRING,
  BARE_VALUE,
]
  .map((pattern) => pattern.source)
  .join('|')})`
// The key's closing quote, plain or escaped, then `:` or `=`.
const SEPARATOR = /\\?["'`]?\s*[:=]\s*/
// `pin`, `PIN`, `adminPin`, `newPassword`, `password_confirmation`, `x-pin`; never `spin` or `pinned`.
// The prefix words are bounded because every `-` starts a word, so an unbounded run is tried
// from each of them (quadratic on `a-a-a-...`); a longer hyphenated key still matches from a
// later word.
const SECRET_KEY =
  /\b(?:[A-Za-z0-9]*[a-z0-9](?:Pin|PIN|Password|PASSWORD)|(?:[A-Za-z0-9]+[_-]){0,16}(?:[Pp]in|PIN|[Pp]assword|PASSWORD))(?:[_-][A-Za-z0-9]+)*/
const SECRET_FIELD = new RegExp(`(${SECRET_KEY.source}${SEPARATOR.source})(${VALUE})`, 'g')
// A quoted `cookie` key (`{"Cookie":"sid=..."}`); the bare header form is COOKIE_HEADER's.
const COOKIE_FIELD = new RegExp(`(\\b(?:set-)?cookie\\\\?["'\`]\\s*[:=]\\s*)(${VALUE})`, 'gi')
// Electron's cookie shape, `{ name: 'raven_unlock', value: '...' }`, inspected or as JSON.
const COOKIE_PAIR = new RegExp(
  `(raven_(?:unlock|admin)[^{}]*?\\bvalue${SEPARATOR.source})(${VALUE})`,
  'gi',
)
const OBJECT = /\{[^{}]*\}/g
const OUR_COOKIE = /raven_(?:unlock|admin)/i
const VALUE_FIELD = new RegExp(`(\\bvalue${SEPARATOR.source})(${VALUE})`, 'gi')

// A path names a person's files (Ruling 12), and a name may hold the quote around it, a colon,
// spaces or a line break. So a quoted path runs to the last same quote on its line; when its
// line has none, to the next one past the break; and when it never closes (the message cap cut
// it), to the end. A quote that opens another path never closes one, or a second run would
// blank that path and `redact` would not be idempotent. A bare path, or a file URL, runs to the
// line's end.
const quotedPath = (quote: string): RegExp => {
  const start = '(?:file:\\/\\/|~)?\\/'
  const close = `(?:[^\\r\\n]*${quote}|[^${quote}]*${quote}(?:[^\\r\\n]*${quote})?)(?!${start})`
  return new RegExp(`${quote}${start}(?:${close}|[\\s\\S]*)`, 'gi')
}
const QUOTES = ["'", '"', '`'] as const
const QUOTED_PATHS = QUOTES.map((quote) => ({ pattern: quotedPath(quote), quote }))
const FILE_URL = /\bfile:\/\/[^\r\n]*/gi
// Not inside a URL or a longer path: `https://host/Users/7` stays. APFS ignores case.
const BARE_PATH =
  /(?<![\w./~-])(?:~|\/(?:Volumes|Users|private|var|tmp|Media|Network|System))\/[^\r\n]*/gi
const PATH = '<path>'

const blankPaths = (text: string): string =>
  QUOTED_PATHS.reduce(
    (blanked, { pattern, quote }) => blanked.replace(pattern, `${quote}${PATH}${quote}`),
    text,
  )
    .replace(FILE_URL, PATH)
    .replace(BARE_PATH, PATH)

const CONTROL = /[\p{Cc}\u2028\u2029]/gu
const HIGH_SURROGATE_AT_END = /[\uD800-\uDBFF]$/
const LATEST_TIME = 8.64e15

const blank = (value: string): string => {
  const quote = /^\\?["'`]/.exec(value)?.[0] ?? ''
  return `${quote}[redacted]${quote}`
}

const blankValue = (_match: string, key: string, value: string): string => `${key}${blank(value)}`

// An object holding our cookie's name has its value blanked whichever field comes first.
const blankCookieObject = (object: string): string =>
  OUR_COOKIE.test(object) ? object.replace(VALUE_FIELD, blankValue) : object

export const redact = (text: string): string =>
  blankPaths(
    text
      .replace(COOKIE_HEADER, '$1$2[redacted]')
      .replace(SESSION_COOKIE, '$1$2[redacted]')
      .replace(COOKIE_FIELD, blankValue)
      .replace(COOKIE_PAIR, blankValue)
      .replace(OBJECT, blankCookieObject)
      .replace(JSON_SECRET, '$1"[redacted]"')
      .replace(SECRET_FIELD, blankValue),
  )

// toISOString throws on a time Date cannot hold, and a log call must never throw.
const stamp = (at: number): string =>
  Number.isFinite(at) && Math.abs(at) <= LATEST_TIME ? new Date(at).toISOString() : 'invalid-time'

// Cutting between the halves of a surrogate pair would leave a lone half in the file.
const cut = ({ text, max }: { text: string; max: number }): string => {
  const head = text.slice(0, max)
  return HIGH_SURROGATE_AT_END.test(head) ? head.slice(0, -1) : head
}

// A few redaction patterns backtrack quadratically on a long run of near matches, so a huge
// message is cut before `redact` sees it. The line is cut again, shorter, after redaction, so
// whatever this cap leaves of a secret is either blanked or past the line's end.
const MESSAGE_MAX = LOG_LINE_MAX * 4

export const logLine = ({
  at,
  level,
  message,
}: {
  at: number
  level: LogLevel
  message: string
}): string => {
  const redacted = redact(cut({ text: message, max: MESSAGE_MAX }))
  return `${stamp(at)} ${level} ${cut({ text: redacted.replace(CONTROL, ' '), max: LOG_LINE_MAX })}\n`
}

export const rotationMoves = ({
  file,
  files,
}: {
  file: string
  files: number
}): { from: string; to: string }[] =>
  Array.from({ length: Math.max(files - 1, 0) }, (_, index) => files - 1 - index).map((to) => ({
    from: to === 1 ? file : `${file}.${to - 1}`,
    to: `${file}.${to}`,
  }))

type FsOp = keyof LogFs

const errorCode = (error: unknown): string => {
  if (!(error instanceof Error)) return 'unknown'
  if ('code' in error && typeof error.code === 'string') return error.code
  return error.name
}

class LogWriteError extends Error {
  readonly kind: string

  constructor({ op, cause }: { op: FsOp; cause: unknown }) {
    const code = errorCode(cause)
    super(`raven log: ${op} failed (${code})`, { cause })
    this.name = 'LogWriteError'
    this.kind = `${op} ${code}`
  }
}

const failureKind = (error: unknown): string =>
  error instanceof LogWriteError ? error.kind : errorCode(error)

const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8')

const fit = ({ lines, room }: { lines: string[]; room: number }) =>
  lines.reduce(
    (fitted, line) => {
      if (fitted.isFull) return fitted
      const bytes = byteLength(line)
      if (fitted.bytes + bytes > room)
        return { taken: fitted.taken, bytes: fitted.bytes, isFull: true }
      return { taken: fitted.taken + 1, bytes: fitted.bytes + bytes, isFull: false }
    },
    { taken: 0, bytes: 0, isFull: false },
  )

export const createLog = ({
  dir,
  fs,
  now,
  timers,
  onError,
}: {
  dir: string
  fs: LogFs
  now: () => number
  timers: Timers
  onError: (error: unknown) => void
}): Log => {
  const file = join(dir, LOG_FILE)
  const oldest = `${file}.${LOG_FILES - 1}`
  const moves = rotationMoves({ file, files: LOG_FILES })
  const queued: string[] = []
  const reported = new Set<string>()
  let isWriting = false
  let timer: { handle: unknown } | null = null
  let drains: Promise<void> = Promise.resolve()
  // Bytes in the live file; null until the folder is made and the file measured, and again
  // after any failure, since a failed write leaves the file's real size unknown.
  let knownSize: number | null = null
  let windowStart: number | null = null
  let windowCount = 0
  let dropped = 0

  const report = (error: unknown): void => {
    const kind = failureKind(error)
    if (reported.has(kind)) return
    reported.add(kind)
    try {
      onError(error)
    } catch {
      // A throwing reporter must not stop the log.
    }
  }

  const attempt = async <T>({ op, run }: { op: FsOp; run: () => Promise<T> }): Promise<T> => {
    try {
      return await run()
    } catch (cause) {
      throw new LogWriteError({ op, cause })
    }
  }

  const prepare = async (): Promise<number> => {
    await attempt({
      op: LOG_FS_OPS.mkdir,
      run: () => fs.mkdir({ path: dir, options: { recursive: true, mode: 0o700 } }),
    })
    const size = await attempt({ op: LOG_FS_OPS.size, run: () => fs.size(file) })
    return size ?? 0
  }

  const removeOldest = async (): Promise<void> => {
    try {
      await fs.remove(oldest)
    } catch (cause) {
      // The next move replaces it anyway, so a refusal costs nothing but a report.
      if (!isMissingFile(cause)) report(new LogWriteError({ op: LOG_FS_OPS.remove, cause }))
    }
  }

  const move = async ({ from, to }: { from: string; to: string }): Promise<void> => {
    try {
      await fs.rename({ from, to })
    } catch (cause) {
      if (isMissingFile(cause)) return
      const error = new LogWriteError({ op: LOG_FS_OPS.rename, cause })
      // Only the live file has to move. A locked or damaged older file is reported and skipped,
      // which may cost that file's history (the next move replaces its target) but never stops
      // the log; failing to move the live file drops the batch, so it never grows past the cap.
      if (from === file) throw error
      report(error)
    }
  }

  const rotate = async (): Promise<void> => {
    await removeOldest()
    await moves.reduce<Promise<void>>(
      (previous, step) => previous.then(() => move(step)),
      Promise.resolve(),
    )
  }

  // Splits a batch at the cap, so no file ever passes LOG_MAX_BYTES.
  const writeLines = async ({
    lines,
    size,
  }: {
    lines: string[]
    size: number
  }): Promise<number> => {
    if (lines.length === 0) return size
    const fitted = fit({ lines, room: LOG_MAX_BYTES - size })
    if (fitted.taken === 0 && size > 0) {
      await rotate()
      return writeLines({ lines, size: 0 })
    }
    const count = Math.max(fitted.taken, 1)
    const data = lines.slice(0, count).join('')
    await attempt({
      op: LOG_FS_OPS.appendFile,
      run: () => fs.appendFile({ path: file, data, options: { mode: 0o600 } }),
    })
    return writeLines({ lines: lines.slice(count), size: size + byteLength(data) })
  }

  // Never rejects, so the chain of drains never rejects either.
  const drain = async (): Promise<void> => {
    if (queued.length === 0) return
    const batch = queued.splice(0)
    isWriting = true
    try {
      knownSize = await writeLines({ lines: batch, size: knownSize ?? (await prepare()) })
    } catch (error) {
      knownSize = null
      report(error)
    } finally {
      isWriting = false
    }
  }

  const startDrain = (): Promise<void> => {
    drains = drains.then(drain)
    return drains
  }

  const cancelTimer = (): void => {
    if (timer === null) return
    timers.clear(timer.handle)
    timer = null
  }

  const scheduleDrain = (): void => {
    if (timer !== null) return
    timer = {
      handle: timers.set({
        run: () => {
          timer = null
          void startDrain()
        },
        ms: 0,
      }),
    }
  }

  const noteDropped = (at: number): void => {
    if (dropped === 0) return
    queued.push(logLine({ at, level: LOG_LEVELS.warn, message: `log: ${dropped} lines dropped` }))
    dropped = 0
  }

  const openWindow = (at: number): void => {
    const isOpen = windowStart !== null && at >= windowStart && at - windowStart < LOG_BURST_MS
    if (isOpen) return
    // While the queue is full the count keeps growing, and is written once there is room.
    if (queued.length < LOG_QUEUE_MAX) noteDropped(at)
    windowStart = at
    windowCount = 0
  }

  const write =
    ({ level, isCounted }: { level: LogLevel; isCounted: boolean }) =>
    (message: string): void => {
      try {
        const at = now()
        openWindow(at)
        const isOverBurst = isCounted && windowCount >= LOG_BURST_LINES
        if (isOverBurst || queued.length >= LOG_QUEUE_MAX) {
          dropped += 1
          return
        }
        if (isCounted) windowCount += 1
        queued.push(logLine({ at, level, message }))
        scheduleDrain()
      } catch (error) {
        report(error)
      }
    }

  return {
    info: write({ level: LOG_LEVELS.info, isCounted: true }),
    warn: write({ level: LOG_LEVELS.warn, isCounted: true }),
    error: write({ level: LOG_LEVELS.error, isCounted: true }),
    // The marks are the lines the budget table is measured from, and a handful a minute.
    mark: write({ level: LOG_LEVELS.info, isCounted: false }),
    flush: () => {
      // A quit must not lose the count of a flood still inside its window.
      try {
        noteDropped(now())
      } catch (error) {
        report(error)
      }
      cancelTimer()
      return startDrain()
    },
    isDirty: () => queued.length > 0 || isWriting,
    file,
  }
}
