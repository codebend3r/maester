import { ENGINE_MESSAGES, type EngineMode } from '@/main/player/engine'

type DisplayInfo = { refreshRate: number; edrHeadroom: number }

export type EngineDiagnostics =
  | {
      kind: 'native'
      mpv: string
      ffmpeg: string | null
      hwdecCurrent: string | null
      display: DisplayInfo | null
    }
  | { kind: 'unavailable'; reason: string }

export type DiagnosticsInput = {
  app: { version: string; isPackaged: boolean; arch: string }
  os: string
  versions: { electron: string; chrome: string; node: string }
  engine: EngineDiagnostics
  displayHz: number | null
}

/**
 * The part of `Mpv` the diagnostics read, written out so a test can fake it: a real `Mpv`
 * fits it. Only properties the wrapper already guards (Ruling 14).
 */
export type DiagnosableMpv = {
  version: string
  read: (input: { name: 'ffmpeg-version' | 'hwdec-current' }) => Promise<string>
  display: () => DisplayInfo
}

/** How long Copy Diagnostics waits for each mpv reading, so a hung core cannot hold it. */
export const DIAGNOSTICS_READ_MS = 1000

const UNKNOWN = 'unknown'

// A reading that rejects is absent (nothing playing); one that never answers is unknown.
const readWithin = async ({
  read,
  ms,
}: {
  read: () => Promise<string>
  ms: number
}): Promise<string | null> => {
  const deadline = Promise.withResolvers<string>()
  const timer = setTimeout(() => deadline.resolve(UNKNOWN), ms)
  // Through `then`, so a read that throws before returning its promise is a rejection too.
  const reading = Promise.resolve()
    .then(read)
    .catch(() => null)
  try {
    return await Promise.race([reading, deadline.promise])
  } finally {
    clearTimeout(timer)
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

export const readEngineDiagnostics = async ({
  mpv,
  readMs = DIAGNOSTICS_READ_MS,
}: {
  mpv: DiagnosableMpv
  readMs?: number
}): Promise<Extract<EngineDiagnostics, { kind: 'native' }>> => {
  const [ffmpeg, hwdecCurrent] = await Promise.all([
    readWithin({ read: () => mpv.read({ name: 'ffmpeg-version' }), ms: readMs }),
    readWithin({ read: () => mpv.read({ name: 'hwdec-current' }), ms: readMs }),
  ])
  return { kind: 'native', mpv: mpv.version, ffmpeg, hwdecCurrent, display: displayOrNull(mpv) }
}

export const STILL_OPENING = 'still opening'

/** Why there is no engine to read: off for this run, what the engine said as it fell back, or not yet open. */
export const unavailableReason = ({
  mode,
  note,
}: {
  mode: EngineMode
  note: string | null
}): string => (mode === 'off' ? ENGINE_MESSAGES.off : (note ?? STILL_OPENING))

const engineLines = ({
  engine,
  displayHz,
}: {
  engine: EngineDiagnostics
  displayHz: number | null
}): string[] => {
  // Electron reports 0 for a display whose rate it does not know.
  const hz = displayHz !== null && displayHz > 0 ? displayHz : 'unknown'
  switch (engine.kind) {
    case 'native':
      return [
        `Video engine: ${engine.mpv}, FFmpeg ${engine.ffmpeg ?? 'unknown'}`,
        // The profile the addon sets, not a reading (Ruling 14).
        `Hardware decoding: hwdec=auto, hwdec-current=${engine.hwdecCurrent ?? 'none (nothing playing)'}`,
        engine.display === null
          ? `Display: ${hz} Hz, EDR headroom unknown`
          : `Display: ${hz} Hz (mpv ${engine.display.refreshRate} Hz), EDR headroom ${engine.display.edrHeadroom.toFixed(1)}`,
      ]
    case 'unavailable':
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
  os,
  versions,
  engine,
  displayHz,
}: DiagnosticsInput): string =>
  [
    `raven player ${app.version} (${app.isPackaged ? 'packaged' : 'unpackaged'}, ${app.arch})`,
    `macOS ${os}`,
    `Electron ${versions.electron}, Chromium ${versions.chrome}, Node ${versions.node}`,
    ...engineLines({ engine, displayHz }),
    '',
  ].join('\n')
