import { createRequire } from 'node:module'
import {
  type Infer,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  object,
  oneOf,
  REMOTE_COMMANDS,
  union,
} from '@raven/core'
import {
  MPV_PROPERTIES,
  propertyGuards,
  type MpvProperty,
  type MpvPropertyValue,
} from '@/properties'
import { localAddonPath } from '@/target'

export const MPV_EVENTS = {
  property: 'property',
  fileLoaded: 'file-loaded',
  playbackRestart: 'playback-restart',
  endFile: 'end-file',
  log: 'log',
  shutdown: 'shutdown',
  overflow: 'overflow',
  remote: 'remote',
  error: 'error',
} as const

/** What the addon sends that is not an event: the answer to one request. */
export const NATIVE_MESSAGES = { reply: 'reply' } as const

/** Why a file ended, as the addon names mpv's reasons. */
export const MPV_END_FILE_REASONS = {
  eof: 'eof',
  error: 'error',
  stop: 'stop',
  quit: 'quit',
  redirect: 'redirect',
} as const

/** The mpv commands raven sends, each the first of a command's `args`. */
export const MPV_COMMANDS = {
  loadfile: 'loadfile',
  seek: 'seek',
  subAdd: 'sub-add',
  stop: 'stop',
  scriptBinding: 'script-binding',
  aoReload: 'ao-reload',
  playlistClear: 'playlist-clear',
} as const

/** Where a `loadfile` puts its file: in place of what plays, or after it; `append-play` also starts it when nothing plays. */
export const MPV_LOADFILE_MODES = {
  replace: 'replace',
  append: 'append',
  appendPlay: 'append-play',
} as const

/** `loadfile`'s index argument for the end of the playlist. */
export const MPV_PLAYLIST_END = '-1'

/** How a `seek` reads its time. */
export const MPV_SEEK_MODES = { absolute: 'absolute' } as const

const isUnknown = (_value: unknown): _value is unknown => true
const isReply = object({
  type: oneOf([NATIVE_MESSAGES.reply]),
  id: isNumber,
  error: isNumber,
  data: isUnknown,
})
const isProperty = object({ type: oneOf([MPV_EVENTS.property]), name: isString, data: isUnknown })
const isOtherEvent = union(
  object({
    type: oneOf([
      MPV_EVENTS.fileLoaded,
      MPV_EVENTS.playbackRestart,
      MPV_EVENTS.shutdown,
      MPV_EVENTS.overflow,
    ]),
  }),
  // The addon maps every mpv reason onto these five, with `redirect` for the rest.
  object({
    type: oneOf([MPV_EVENTS.endFile]),
    reason: oneOf(Object.values(MPV_END_FILE_REASONS)),
    error: isNumber,
  }),
  object({ type: oneOf([MPV_EVENTS.log]), level: isString, prefix: isString, text: isString }),
  // The system's transport controls, which the addon takes for an audio surface.
  object({
    type: oneOf([MPV_EVENTS.remote]),
    command: oneOf([
      REMOTE_COMMANDS.play,
      REMOTE_COMMANDS.pause,
      REMOTE_COMMANDS.toggle,
      REMOTE_COMMANDS.next,
      REMOTE_COMMANDS.previous,
      REMOTE_COMMANDS.stop,
    ]),
  }),
  object({
    type: oneOf([MPV_EVENTS.remote]),
    command: oneOf([REMOTE_COMMANDS.seek]),
    time: isNumber,
  }),
)
const isDisplayInfo = object({
  refreshRate: isNumber,
  edrHeadroom: isNumber,
  sortRepairs: isNumber,
})

type MpvPropertyEvent = {
  [K in MpvProperty]: { type: typeof MPV_EVENTS.property; name: K; data: MpvPropertyValue<K> }
}[MpvProperty]
export type MpvEvent =
  | Infer<typeof isOtherEvent>
  | MpvPropertyEvent
  | { type: typeof MPV_EVENTS.error; message: string }

/**
 * `headless` plays to no output at all, for tests; `window` draws into the window; `audio`
 * decodes no video and plays sound alone, owning the system's Now Playing and media keys.
 */
export const MPV_SURFACE_KINDS = { headless: 'headless', window: 'window', audio: 'audio' } as const

export type MpvSurface =
  | { kind: typeof MPV_SURFACE_KINDS.headless }
  | { kind: typeof MPV_SURFACE_KINDS.window; handle: Buffer }
  | { kind: typeof MPV_SURFACE_KINDS.audio }

/** What the system shows for the playing track, with the cover as encoded image bytes. */
export type NowPlaying = {
  title: string
  artist: string
  album: string
  duration: number
  position: number
  isPlaying: boolean
  /** How fast the clock runs while it plays, so the system's elapsed time keeps pace: 1 at normal speed. */
  rate: number
  artwork: Buffer | null
}

type NativeHandle = {
  command: (id: number, args: string[]) => void
  get: (id: number, name: string) => void
  set: (id: number, name: string, value: string | number | boolean) => void
  observe: (name: string) => void
  destroy: () => Promise<void>
  display: () => unknown
  nowPlaying: (info: NowPlaying) => void
  clearNowPlaying: () => void
}
type NativeAddon = {
  apiVersion: number
  create: (surface: MpvSurface, receive: (event: unknown) => void) => NativeHandle
}
const isFunction = (value: unknown): value is (...args: unknown[]) => unknown =>
  typeof value === 'function'
const isNativeAddon = (value: unknown): value is NativeAddon =>
  isRecord(value) && isNumber(value.apiVersion) && isFunction(value.create)
const isNativeHandle = (value: unknown): value is NativeHandle =>
  isRecord(value) &&
  ['command', 'get', 'set', 'observe', 'destroy', 'display', 'nowPlaying', 'clearNowPlaying'].every(
    (key) => isFunction(value[key]),
  )

const isPropertyName = (name: string): name is MpvProperty => Object.hasOwn(propertyGuards, name)
const isMpvPropertyEvent = (value: unknown): value is MpvPropertyEvent =>
  isProperty(value) && isPropertyName(value.name) && propertyGuards[value.name](value.data)
const supportsVersion = (version: string) => {
  const match = /^mpv v?(\d+)\.(\d+)\./.exec(version)
  return !!match && (Number(match[1]) > 0 || Number(match[2]) >= 40)
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  onReply: (reply: MpvReply) => void
}

/** What a reply said, handed to `onReply` before its promise settles. */
export type MpvReply = { isOk: boolean }

const ignoreReply = () => {}

type OpenMpvProps = {
  surface: MpvSurface
  onEvent: (event: MpvEvent) => void
  addonPath?: string
  /** Loads the addon; a test's fake stands in for the whole lookup. */
  loadAddon?: () => unknown
}

/** Main-process API only. The renderer must use the allowlisted PlayerCommand bridge, never this API. */
export const openMpv = async ({
  surface,
  onEvent,
  addonPath,
  // The checkout's own build is looked up only when the host names no path of its own.
  loadAddon = () => createRequire(import.meta.url)(addonPath ?? localAddonPath()),
}: OpenMpvProps) => {
  const addon: unknown = loadAddon()
  if (!isNativeAddon(addon)) throw new Error('Invalid raven mpv addon')
  const major = Math.floor(addon.apiVersion / 65536)
  const minor = addon.apiVersion % 65536
  if (!Number.isSafeInteger(addon.apiVersion) || major !== 2 || minor < 3)
    throw new Error('libmpv client API 2.3 or newer is required')

  const pending = new Map<number, Pending>()
  let nextId = 0
  let isDestroyed = false
  let destruction: Promise<void> | undefined
  const rejectPending = (error: Error) => {
    pending.forEach((request) => {
      clearTimeout(request.timer)
      request.reject(error)
    })
    pending.clear()
  }
  const receive = (value: unknown) => {
    if (isDestroyed) return
    if (isReply(value)) {
      const request = pending.get(value.id)
      if (!request) return
      pending.delete(value.id)
      clearTimeout(request.timer)
      try {
        request.onReply({ isOk: value.error >= 0 })
      } catch (error) {
        request.reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      if (value.error < 0) request.reject(new Error(`mpv request failed (${value.error})`))
      else request.resolve(value.data)
      return
    }
    if (isProperty(value)) {
      if (isMpvPropertyEvent(value)) {
        onEvent(value)
        return
      }
    } else if (isOtherEvent(value)) {
      if (value.type === MPV_EVENTS.overflow || value.type === MPV_EVENTS.shutdown)
        rejectPending(new Error(`mpv ${value.type}`))
      onEvent(value)
      return
    }
    rejectPending(new Error('Invalid native mpv event'))
    onEvent({ type: MPV_EVENTS.error, message: 'Invalid native mpv event' })
  }
  const native: unknown = addon.create(surface, receive)
  if (!isNativeHandle(native)) throw new Error('Invalid raven mpv handle')

  type RequestProps = {
    send: (id: number) => void
    onReply?: (reply: MpvReply) => void
  }

  const request = ({ send, onReply = ignoreReply }: RequestProps) =>
    new Promise<unknown>((resolve, reject) => {
      if (isDestroyed) {
        reject(new Error('mpv is destroyed'))
        return
      }
      const id = ++nextId
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('mpv request timed out'))
      }, 10000)
      pending.set(id, { resolve, reject, timer, onReply })
      try {
        send(id)
      } catch (error) {
        clearTimeout(timer)
        pending.delete(id)
        reject(error)
      }
    })
  type ReadProps<K extends MpvProperty> = {
    name: K
  }

  const read = async <K extends MpvProperty>({
    name,
  }: ReadProps<K>): Promise<MpvPropertyValue<K>> => {
    const value = await request({ send: (id) => native.get(id, name) })
    const guard = propertyGuard(name)
    if (!guard(value)) throw new Error(`Invalid mpv property: ${name}`)
    return value
  }
  const destroy = () => {
    if (destruction) return destruction
    isDestroyed = true
    rejectPending(new Error('mpv is destroyed'))
    destruction = native.destroy()
    return destruction
  }
  try {
    const version = await read({ name: MPV_PROPERTIES.mpvVersion })
    if (!supportsVersion(version)) throw new Error('libmpv 0.40 or newer is required')
    type OpenMpvCommandProps = {
      args: string[]
      onReply?: (reply: MpvReply) => void
    }

    type OpenMpvSetProps = { name: string; value: string | number | boolean }

    type OpenMpvObserveProps = { name: MpvProperty }

    return {
      version,
      read,
      /**
       * `onReply` runs synchronously when mpv's reply arrives, in order with the events
       * around it, whatever the reply says. The promise settles later: the addon delivers
       * up to 256 events a turn, so its continuation runs after the events behind the reply.
       */
      command: async ({ args, onReply }: OpenMpvCommandProps) => {
        await request({ send: (id) => native.command(id, args), onReply })
      },
      set: async ({ name, value }: OpenMpvSetProps) => {
        if (!(isString(value) || isNumber(value) || isBoolean(value)))
          throw new Error('Invalid mpv property value')
        await request({ send: (id) => native.set(id, name, value) })
      },
      observe: ({ name }: OpenMpvObserveProps) => {
        if (isDestroyed) throw new Error('mpv is destroyed')
        native.observe(name)
      },
      display: () => {
        if (isDestroyed) throw new Error('mpv is destroyed')
        const info: unknown = native.display()
        if (!isDisplayInfo(info)) throw new Error('Invalid native display information')
        return info
      },
      /** Tells the system what plays; nothing shows for a surface that is not `audio`. */
      nowPlaying: (info: NowPlaying) => {
        if (isDestroyed) throw new Error('mpv is destroyed')
        native.nowPlaying(info)
      },
      clearNowPlaying: () => {
        if (isDestroyed) return
        native.clearNowPlaying()
      },
      destroy,
    }
  } catch (error) {
    await destroy()
    throw error
  }
}

const propertyGuard =
  <K extends MpvProperty>(name: K) =>
  (value: unknown): value is MpvPropertyValue<K> =>
    propertyGuards[name](value)

export type Mpv = Awaited<ReturnType<typeof openMpv>>
