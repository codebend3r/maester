import { join } from 'node:path'
import { MPV_SURFACE_KINDS, type MpvSurface } from '@raven/mpv'
import { MPV_OPTIONS, type MpvOption } from '@/main/player/outputOptions'
import { messageOf } from '@/shared/messageOf'

/** A surface's kind, or `off` for the test hook's run with no native engine at all. */
export const ENGINE_MODES = { ...MPV_SURFACE_KINDS, off: 'off' } as const

export type EngineMode = (typeof ENGINE_MODES)[keyof typeof ENGINE_MODES]

const ENGINE_HOOK = 'RAVEN_DESKTOP_MPV'

export const engineModeFrom = ({
  isPackaged,
  env,
}: {
  isPackaged: boolean
  env: Readonly<Record<string, string | undefined>>
}): EngineMode => {
  if (isPackaged) return ENGINE_MODES.window
  const requested = env[ENGINE_HOOK]
  if (requested === ENGINE_MODES.headless || requested === ENGINE_MODES.off) return requested
  return ENGINE_MODES.window
}

const ADDON = 'raven_mpv.node'

export const addonPathFor = ({
  isPackaged,
  appPath,
  resourcesPath,
}: {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
}) => {
  if (isPackaged) return join(resourcesPath, 'mpv', 'darwin-arm64', ADDON)
  return join(appPath, '..', '..', '..', 'libs', 'raven', 'mpv', 'resources', 'darwin-arm64', ADDON)
}

/**
 * Set before any file opens, on top of the addon's own init options. A granted file is
 * only a name: without this, one holding a playlist or an mpv EDL opens whatever path or
 * URL it names. The cost, accepted: MKV ordered chapters, mov reference files and
 * archives that point at other files stop working.
 */
export const HARDENED_OPTIONS = [
  { name: MPV_OPTIONS.accessReferences, value: false },
] as const satisfies readonly MpvOption[]

/**
 * For the headless test hook only. `vo=null` takes frames as fast as mpv decodes them, so
 * under the profile's `video-sync=display-resample` a video plays many times faster than
 * real time; pacing the null output like a 60 Hz display keeps the clock real. Set before
 * the first load, since the output reads it when it is made.
 */
export const HEADLESS_OPTIONS = [
  { name: MPV_OPTIONS.voNullFps, value: 60 },
] as const satisfies readonly MpvOption[]

/**
 * What main sets on a surface's mpv as it opens, before the service exists. The hardened
 * options are not among them: the service sets those itself and refuses every load when
 * it cannot, whatever the surface.
 */
export const engineOptionsFor = ({ surface }: { surface: MpvSurface }): readonly MpvOption[] => {
  switch (surface.kind) {
    case MPV_SURFACE_KINDS.headless:
      return HEADLESS_OPTIONS
    case MPV_SURFACE_KINDS.window:
      return []
    default: {
      const unreachable: never = surface
      return unreachable
    }
  }
}

export const ENGINE_MESSAGES = {
  unavailable: 'Raven could not start its video engine, so it plays only the videos Chromium can.',
  off: 'The video engine is off for this run.',
} as const

export const ENGINE_STATUSES = { native: 'native', unavailable: 'unavailable' } as const

export type OpenedEngine<T> =
  | { status: typeof ENGINE_STATUSES.native; engine: T }
  | { status: typeof ENGINE_STATUSES.unavailable; message: string }

export const openEngine = async <T>({
  mode,
  surfaceFor,
  open,
  warn,
}: {
  mode: EngineMode
  surfaceFor: (mode: Exclude<EngineMode, typeof ENGINE_MODES.off>) => MpvSurface
  open: (surface: MpvSurface) => Promise<T>
  warn: (message: string) => void
}): Promise<OpenedEngine<T>> => {
  if (mode === ENGINE_MODES.off) {
    return { status: ENGINE_STATUSES.unavailable, message: ENGINE_MESSAGES.off }
  }
  try {
    return { status: ENGINE_STATUSES.native, engine: await open(surfaceFor(mode)) }
  } catch (error) {
    warn(messageOf(error))
    return { status: ENGINE_STATUSES.unavailable, message: ENGINE_MESSAGES.unavailable }
  }
}
