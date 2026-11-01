import type { MediaTracks, SubtitleTrack } from '@raven/core'
import type { QueueFs } from '@/main/downloads/downloadQueue'
import type { PartFile, StreamFetch } from '@/main/downloads/fetchFile'
import { type AccessOutcome, type MediaAccess } from '@/main/downloads/mediaAccess'
import { HTTP_HEADERS } from '@/shared/httpHeaders'

export const ORIGIN = 'http://192.168.1.5:3000'
export const MINUTE = 60_000

type FsErrorProps = { code: string; syscall?: string }

/** A Node file system error, as `errorText` reads one. */
export const fsError = ({ code, syscall = 'open' }: FsErrorProps): Error =>
  Object.assign(new Error(`${code}: failed, ${syscall} '/data/downloads/secret'`), {
    code,
    syscall,
  })

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Waits a turn of the event loop at a time until `check` holds, and fails the test if it never does. */
export const until = async (check: () => boolean, tries = 200): Promise<void> => {
  if (check()) return
  if (tries === 0) throw new Error('what the test waited for never happened')
  await tick()
  return until(check, tries - 1)
}

/** Lets `count` turns of the event loop go by, for a test that checks something did not happen. */
export const ticks = async (count: number): Promise<void> => {
  if (count === 0) return
  await tick()
  return ticks(count - 1)
}

const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))

type IsUnderProps = { path: string; dir: string }

const isUnder = ({ path, dir }: IsUnderProps): boolean => path === dir || path.startsWith(`${dir}/`)

/**
 * The downloads folder in memory: binary files as chunks, subtitles as text, folders as
 * made. A file opens or writes only in a folder that was made, as on disk. `seed` maps a
 * path to a size, and its folder counts as made.
 */
export const fakeDisk = (seed: Record<string, number> = {}) => {
  const files = new Map<string, Uint8Array[]>(
    Object.entries(seed).map(([path, size]) => [path, size === 0 ? [] : [new Uint8Array(size)]]),
  )
  const texts = new Map<string, string>()
  const dirs = new Set<string>(Object.keys(seed).map(parentOf))
  const removed: string[] = []
  const appendError: { value: unknown } = { value: undefined }
  /** Folders whose making fails. */
  const unmakeable = new Set<string>()
  /** Folders whose removal fails, as Windows fails one holding a file still open. */
  const unremovable = new Set<string>()
  /** What a listing waits on before it answers, so a test can hold one. */
  const listing: { hold: Promise<void> } = { hold: Promise.resolve() }

  const sizeOf = (path: string): number =>
    (files.get(path) ?? []).reduce((sum, chunk) => sum + chunk.length, 0)

  const needsFolder = (path: string): void => {
    if (!dirs.has(parentOf(path))) throw fsError({ code: 'ENOENT' })
  }

  const partAt = (path: string): PartFile => ({
    size: async () => sizeOf(path),
    append: async (chunk) => {
      if (appendError.value !== undefined) throw appendError.value
      files.set(path, [...(files.get(path) ?? []), chunk])
    },
    truncate: async () => {
      files.set(path, [])
    },
    close: async () => undefined,
  })

  const fs: QueueFs = {
    mkdir: async (path) => {
      if (unmakeable.has(path)) throw fsError({ code: 'EACCES', syscall: 'mkdir' })
      dirs.add(path)
    },
    rename: async ({ from, to }) => {
      const chunks = files.get(from)
      if (chunks === undefined) throw fsError({ code: 'ENOENT', syscall: 'rename' })
      files.delete(from)
      files.set(to, chunks)
    },
    rm: async (path) => {
      if (unremovable.has(path)) throw fsError({ code: 'EBUSY', syscall: 'rm' })
      removed.push(path)
      const isGone = (key: string): boolean => isUnder({ path: key, dir: path })
      const goneFiles = [...files.keys()].filter(isGone)
      const goneTexts = [...texts.keys()].filter(isGone)
      const goneDirs = [...dirs].filter(isGone)
      goneFiles.forEach((key) => files.delete(key))
      goneTexts.forEach((key) => texts.delete(key))
      goneDirs.forEach((key) => dirs.delete(key))
    },
    readdir: async (dir) => {
      await listing.hold
      const names = [...files.keys(), ...texts.keys(), ...dirs]
        .filter((path) => path.startsWith(`${dir}/`))
        .map((path) => path.slice(dir.length + 1).split('/')[0] ?? '')
      if (names.length === 0 && !dirs.has(dir))
        throw fsError({ code: 'ENOENT', syscall: 'scandir' })
      return [...new Set(names)]
    },
    openPart: async (path) => {
      needsFolder(path)
      if (!files.has(path)) files.set(path, [])
      return partAt(path)
    },
    writeFile: async ({ path, text }) => {
      needsFolder(path)
      texts.set(path, text)
    },
    size: async (path) => sizeOf(path),
  }

  return {
    fs,
    files,
    texts,
    dirs,
    removed,
    appendError,
    unmakeable,
    unremovable,
    listing,
    sizeOf,
  }
}

export type Answer = {
  status: number
  headers?: Record<string, string>
  body: ReadableStream<Uint8Array> | null
}

export type FetchRequest = {
  url: string
  headers: Record<string, string>
  signal: AbortSignal
}

/** A body that sends `chunks` and then waits, the way a long download does. */
export const held = (chunks: Uint8Array[] = []): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk))
    },
  })

/** A body that sends `chunks` and ends. */
export const whole = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk))
      controller.close()
    },
  })

/** A body that sends `chunks` and then breaks, the way a response the server ends mid-file does. */
export const brokenBody = (chunks: Uint8Array[]): ReadableStream<Uint8Array> => {
  const sent = { count: 0 }
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[sent.count]
      if (next === undefined) {
        controller.error(new TypeError('terminated'))
        return
      }
      sent.count += 1
      controller.enqueue(next)
    },
  })
}

const rangeStartOf = (headers: Record<string, string>): number =>
  Number(/^bytes=(\d+)-$/u.exec(headers.Range ?? '')?.[1] ?? 0)

type AnswerFromProps = {
  request: FetchRequest
  size: number
  sent: number
  bodyOf: (chunks: Uint8Array[]) => ReadableStream<Uint8Array>
}

/**
 * A file of `size` bytes served from the request's `Range`, 206 for a range and 200 for the
 * whole, with the length of the rest promised: `sent` of the bytes asked for go into the body
 * `bodyOf` makes.
 */
const answerFrom = ({ request, size, sent, bodyOf }: AnswerFromProps): Answer => {
  const from = rangeStartOf(request.headers)
  const length = Math.min(sent, size - from)
  const body = bodyOf(length > 0 ? [new Uint8Array(length)] : [])
  const promised = { [HTTP_HEADERS.contentLength]: String(size - from) }
  return from === 0
    ? { status: 200, headers: promised, body }
    : {
        status: 206,
        headers: { ...promised, [HTTP_HEADERS.contentRange]: `bytes ${from}-${size - 1}/${size}` },
        body,
      }
}

type ServingProps = { size: number; sent?: number; isEnding?: boolean }

/** `sent` of the bytes asked for arrive, then the body ends when `isEnding`, or waits. */
export const serving =
  ({ size, sent = size, isEnding = true }: ServingProps) =>
  (request: FetchRequest): Answer =>
    answerFrom({ request, size, sent, bodyOf: isEnding ? whole : held })

type CuttingProps = { size: number; sent: number }

/** `sent` of the bytes asked for arrive, then the server ends the response mid-file. */
export const cutting =
  ({ size, sent }: CuttingProps) =>
  (request: FetchRequest): Answer =>
    answerFrom({ request, size, sent, bodyOf: brokenBody })

/** Answers each call with the next of `answers`, the last one for every call after. */
export const inTurn = <T>(answers: readonly T[]): (() => T) => {
  const next = { index: 0 }
  return () => {
    const answer = answers[Math.min(next.index, answers.length - 1)]
    next.index += 1
    if (answer === undefined) throw new Error('no answer to give')
    return answer
  }
}

const isSidecar = (url: string): boolean => url.includes('/subtitles/')

/** The title a fetch asked for, read off its URL's `/api/media/<id>/`. */
export const mediaOfRequest = ({ url }: Pick<FetchRequest, 'url'>): number | null => {
  const digits = /\/api\/media\/(\d+)\//u.exec(url)?.[1] ?? null
  return digits === null ? null : Number(digits)
}

/**
 * Fetches recorded as they went out. A file waits by default; a subtitle answers `WEBVTT`. `answers` is read at each call, so a test can change it.
 */
export const fakeNetwork = () => {
  const requests: FetchRequest[] = []
  const answers: {
    file: (request: FetchRequest) => Answer
    sidecar: (request: FetchRequest) => Answer
  } = {
    file: () => ({ status: 200, body: held() }),
    sidecar: () => ({ status: 200, body: whole([new TextEncoder().encode('WEBVTT')]) }),
  }
  const fetch: StreamFetch = async ({ url, headers, signal }) => {
    const request = { url, headers, signal }
    requests.push(request)
    const answer = isSidecar(url) ? answers.sidecar(request) : answers.file(request)
    const named = new Map(Object.entries(answer.headers ?? {}))
    return {
      status: answer.status,
      headers: { get: (name) => named.get(name) ?? null },
      body: answer.body,
    }
  }
  const fileRequests = (): FetchRequest[] => requests.filter(({ url }) => !isSidecar(url))
  const sidecarRequests = (): FetchRequest[] => requests.filter(({ url }) => isSidecar(url))
  return { fetch, requests, answers, fileRequests, sidecarRequests }
}

/** An account ticket on the media origin. */
export const accountTicket = (ticket = 'account.one'): AccessOutcome => ({
  ok: true,
  access: { url: ORIGIN, ticket },
})

/** Media access answered by `answer`; every read and every forget is recorded. */
export const fakeAccess = (answer: MediaAccess['accessFor']) => {
  const asked: { serverId: string; mediaId: number }[] = []
  const forgotten: string[] = []
  const access: MediaAccess = {
    accessFor: async (input) => {
      asked.push({ serverId: input.serverId, mediaId: input.mediaId })
      return answer(input)
    },
    forget: (serverId) => {
      forgotten.push(serverId)
    },
  }
  return { access, asked, forgotten }
}

export const subtitleTrack = (overrides: Partial<SubtitleTrack>): SubtitleTrack => ({
  id: 'external-0',
  source: 'external',
  codec: 'subrip',
  language: 'en',
  title: 'English',
  default: false,
  forced: false,
  hearingImpaired: false,
  supported: true,
  ...overrides,
})

export const tracksWith = (subtitles: SubtitleTrack[]): MediaTracks => ({
  audio: [],
  subtitles,
  defaultAudio: null,
  frameRate: null,
})
