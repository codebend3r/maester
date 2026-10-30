import { MPV_PROPERTIES } from '@raven/mpv'
import { BOUNDED_OUTCOMES, within } from '@/main/bounded'
import { ENGINE_WORDS, ENGINE_MODES, ENGINE_STATUSES, type EngineMode } from '@/main/player/engine'

type DisplayInfo = { refreshRate: number; edrHeadroom: number }

export type EngineDiagnostics =
  | {
      kind: typeof ENGINE_STATUSES.native
      mpv: string
      ffmpeg: string | null
      hwdecCurrent: string | null
      display: DisplayInfo | null
    }
  | { kind: typeof ENGINE_STATUSES.unavailable; reason: string }

export type DiagnosticsInput = {
  app: { version: string; isPackaged: boolean; arch: string }
  /** The system's name and version, as `SYSTEM_NAMES` gives the name. */
  system: { name: string; version: string }
  versions: { electron: string; chrome: string; node: string }
  engine: EngineDiagnostics
  displayHz: number | null
}

type ReadProps = {
  name: typeof MPV_PROPERTIES.ffmpegVersion | typeof MPV_PROPERTIES.hwdecCurrent
}

/**
 * The part of `Mpv` the diagnostics read, written out so a test can fake it: a real `Mpv`
 * fits it. Only properties the wrapper already guards (Ruling 14).
 */
type DiagnosableMpv = {
  version: string
  read: (input: ReadProps) => Promise<string>
  display: () => DisplayInfo
}

/** How long Copy Diagnostics waits for each mpv reading, so a hung core cannot hold it. */
export const DIAGNOSTICS_READ_MS = 1000

const UNKNOWN = 'unknown'

type ReadWithinProps = {
  read: () => Promise<string>
  ms: number
}

// A reading that rejects is absent (nothing playing); one that never answers is unknown.
const readWithin = async ({ read, ms }: ReadWithinProps): Promise<string | null> => {
  // Through `then`, so a read that throws before returning its promise is a rejection too.
  const bounded = await within({ task: Promise.resolve().then(read), ms })
  switch (bounded.outcome) {
    case BOUNDED_OUTCOMES.answered:
      return bounded.result
    case BOUNDED_OUTCOMES.failed:
      return null
    case BOUNDED_OUTCOMES.late:
      return UNKNOWN
    default: {
      const unreachable: never = bounded
      return unreachable
    }
  }
}

// A headless mpv has no surface to read, and a destroyed one throws.
const displayOrNull = (mpv: DiagnosableMpv): DisplayInfo | null => {
  try {
    const { refreshRate, edrHeadroom } = mpv.display()
    return { refreshRate, edrHeadroom }
  } catch {
    return null
  }
}

type ReadEngineDiagnosticsProps = {
  mpv: DiagnosableMpv
  readMs?: number
}

export const readEngineDiagnostics = async ({
  mpv,
  readMs = DIAGNOSTICS_READ_MS,
}: ReadEngineDiagnosticsProps): Promise<
  Extract<EngineDiagnostics, { kind: typeof ENGINE_STATUSES.native }>
> => {
  const [ffmpeg, hwdecCurrent] = await Promise.all([
    readWithin({ read: () => mpv.read({ name: MPV_PROPERTIES.ffmpegVersion }), ms: readMs }),
    readWithin({ read: () => mpv.read({ name: MPV_PROPERTIES.hwdecCurrent }), ms: readMs }),
  ])
  return {
    kind: ENGINE_STATUSES.native,
    mpv: mpv.version,
    ffmpeg,
    hwdecCurrent,
    display: displayOrNull(mpv),
  }
}

const STILL_OPENING = 'still opening'

type UnavailableReasonProps = {
  mode: EngineMode
  note: string | null
}

/** Why there is no engine to read: off for this run, what the engine said as it fell back, or not yet open. */
export const unavailableReason = ({ mode, note }: UnavailableReasonProps): string =>
  mode === ENGINE_MODES.off ? ENGINE_WORDS.video.off : (note ?? STILL_OPENING)

type EngineLinesProps = {
  engine: EngineDiagnostics
  displayHz: number | null
}

const engineLines = ({ engine, displayHz }: EngineLinesProps): string[] => {
  // Electron reports 0 for a display whose rate it does not know.
  const hz = displayHz !== null && displayHz > 0 ? displayHz : 'unknown'
  switch (engine.kind) {
    case ENGINE_STATUSES.native:
      return [
        `Video engine: ${engine.mpv}, FFmpeg ${engine.ffmpeg ?? 'unknown'}`,
        // The profile the addon sets, not a reading (Ruling 14).
        `Hardware decoding: hwdec=auto, hwdec-current=${engine.hwdecCurrent ?? 'none (nothing playing)'}`,
        engine.display === null
          ? `Display: ${hz} Hz, EDR headroom unknown`
          : `Display: ${hz} Hz (mpv ${engine.display.refreshRate} Hz), EDR headroom ${engine.display.edrHeadroom.toFixed(1)}`,
      ]
    case ENGINE_STATUSES.unavailable:
      return [
        `Video engine: unavailable (${engine.reason})`,
        'Hardware decoding: unknown',
        `Display: ${hz} Hz, EDR headroom unknown`,
      ]
    default: {
      const unreachable: never = engine
      return unreachable
    }
  }
}

/** What Copy Diagnostics puts on the clipboard (Ruling 15): versions and readings, never a path, origin or cookie. */
export const diagnosticsText = ({
  app,
  system,
  versions,
  engine,
  displayHz,
}: DiagnosticsInput): string =>
  [
    `Raven ${app.version} (${app.isPackaged ? 'packaged' : 'unpackaged'}, ${app.arch})`,
    `${system.name} ${system.version}`,
    `Electron ${versions.electron}, Chromium ${versions.chrome}, Node ${versions.node}`,
    ...engineLines({ engine, displayHz }),
    '',
  ].join('\n')
