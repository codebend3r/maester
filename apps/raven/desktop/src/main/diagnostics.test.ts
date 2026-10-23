import { describe, expect, it } from 'bun:test'
import {
  DIAGNOSTICS_READ_MS,
  type DiagnosticsInput,
  diagnosticsText,
  readEngineDiagnostics,
  unavailableReason,
} from '@/main/diagnostics'
import { MPV_PROPERTIES } from '@raven/mpv'
import { ENGINE_MESSAGES } from '@/main/player/engine'

const NATIVE = {
  app: { version: '0.5.4', isPackaged: true, arch: 'arm64' },
  os: '26.0.1',
  versions: { electron: '44.7.0', chrome: '146.0.7680.65', node: '24.11.1' },
  engine: {
    kind: 'native',
    mpv: 'mpv v0.41.0',
    ffmpeg: '8.1.2',
    hwdecCurrent: 'videotoolbox',
    display: { refreshRate: 120, edrHeadroom: 16 },
  },
  displayHz: 120,
} as const satisfies DiagnosticsInput

const UNAVAILABLE = {
  ...NATIVE,
  app: { version: '0.5.4', isPackaged: false, arch: 'arm64' },
  engine: { kind: 'unavailable', reason: ENGINE_MESSAGES.unavailable },
  displayHz: 60,
} as const satisfies DiagnosticsInput

describe('diagnosticsText', () => {
  it('lists the app, the system and a native engine in six lines', () => {
    expect(diagnosticsText(NATIVE)).toBe(
      [
        'Raven 0.5.4 (packaged, arm64)',
        'macOS 26.0.1',
        'Electron 44.7.0, Chromium 146.0.7680.65, Node 24.11.1',
        'Video engine: mpv v0.41.0, FFmpeg 8.1.2',
        'Hardware decoding: hwdec=auto, hwdec-current=videotoolbox',
        'Display: 120 Hz (mpv 120 Hz), EDR headroom 16.0',
        '',
      ].join('\n'),
    )
  })

  it('says nothing is playing when mpv decodes nothing', () => {
    const text = diagnosticsText({ ...NATIVE, engine: { ...NATIVE.engine, hwdecCurrent: null } })
    expect(text).toContain('Hardware decoding: hwdec=auto, hwdec-current=none (nothing playing)\n')
  })

  it('says what it does not know of a native engine', () => {
    const text = diagnosticsText({
      ...NATIVE,
      engine: { ...NATIVE.engine, ffmpeg: null, display: null },
      displayHz: null,
    })
    expect(text).toContain('Video engine: mpv v0.41.0, FFmpeg unknown\n')
    expect(text).toContain('Display: unknown Hz, EDR headroom unknown\n')
  })

  it('says the display rate is unknown when Electron reports 0', () => {
    expect(diagnosticsText({ ...NATIVE, displayHz: 0 })).toContain(
      'Display: unknown Hz (mpv 120 Hz), EDR headroom 16.0\n',
    )
    expect(diagnosticsText({ ...UNAVAILABLE, displayHz: 0 })).toContain(
      'Display: unknown Hz, EDR headroom unknown\n',
    )
  })

  it('says why the engine is unavailable', () => {
    expect(diagnosticsText(UNAVAILABLE)).toBe(
      [
        'Raven 0.5.4 (unpackaged, arm64)',
        'macOS 26.0.1',
        'Electron 44.7.0, Chromium 146.0.7680.65, Node 24.11.1',
        'Video engine: unavailable (Raven could not start its video engine, so it plays only the videos Chromium can.)',
        'Hardware decoding: unknown',
        'Display: 60 Hz, EDR headroom unknown',
        '',
      ].join('\n'),
    )
  })

  it('holds no paths, origins or cookies', () => {
    ;[NATIVE, UNAVAILABLE].forEach((input) => {
      const text = diagnosticsText(input)
      expect(text).not.toContain('/')
      expect(text).not.toContain('http')
      expect(text).not.toContain('raven_')
    })
  })
})

describe('readEngineDiagnostics', () => {
  it('reads the versions, what decodes and the display', async () => {
    const values = { 'ffmpeg-version': '8.1.2', 'hwdec-current': 'videotoolbox' }
    expect(
      await readEngineDiagnostics({
        mpv: {
          version: 'mpv v0.41.0',
          read: async ({ name }) => values[name],
          display: () => ({ refreshRate: 120, edrHeadroom: 16, sortRepairs: 2 }),
        },
      }),
    ).toEqual({
      kind: 'native',
      mpv: 'mpv v0.41.0',
      ffmpeg: '8.1.2',
      hwdecCurrent: 'videotoolbox',
      display: { refreshRate: 120, edrHeadroom: 16 },
    })
  })

  it('answers null for a read that rejects and a display that throws', async () => {
    expect(
      await readEngineDiagnostics({
        mpv: {
          version: 'mpv v0.41.0',
          read: async ({ name }) => {
            if (name === MPV_PROPERTIES.hwdecCurrent) throw new Error('property unavailable')
            return '8.1.2'
          },
          display: () => {
            throw new Error('no surface')
          },
        },
      }),
    ).toEqual({
      kind: 'native',
      mpv: 'mpv v0.41.0',
      ffmpeg: '8.1.2',
      hwdecCurrent: null,
      display: null,
    })
  })
})

describe('readEngineDiagnostics with a hung engine', () => {
  it('waits about a second for each reading by default', () => {
    expect(DIAGNOSTICS_READ_MS).toBe(1000)
  })

  it('reports a reading that never answers as unknown, and still finishes', async () => {
    const engine = await readEngineDiagnostics({
      mpv: {
        version: 'mpv v0.41.0',
        read: ({ name }) =>
          name === MPV_PROPERTIES.ffmpegVersion
            ? Promise.resolve('8.1.2')
            : new Promise<string>(() => {}),
        display: () => ({ refreshRate: 60, edrHeadroom: 1 }),
      },
      readMs: 20,
    })
    expect(engine).toEqual({
      kind: 'native',
      mpv: 'mpv v0.41.0',
      ffmpeg: '8.1.2',
      hwdecCurrent: 'unknown',
      display: { refreshRate: 60, edrHeadroom: 1 },
    })
    expect(diagnosticsText({ ...NATIVE, engine })).toContain(
      'Hardware decoding: hwdec=auto, hwdec-current=unknown',
    )
  })

  it('reports both as unknown when neither answers', async () => {
    const engine = await readEngineDiagnostics({
      mpv: {
        version: 'mpv v0.41.0',
        read: () => new Promise<string>(() => {}),
        display: () => ({ refreshRate: 60, edrHeadroom: 1 }),
      },
      readMs: 20,
    })
    expect(engine).toMatchObject({ ffmpeg: 'unknown', hwdecCurrent: 'unknown' })
    expect(diagnosticsText({ ...NATIVE, engine })).toContain('FFmpeg unknown')
  })
})

describe('unavailableReason', () => {
  it('is the off message in off mode, whatever was noted', () => {
    expect(unavailableReason({ mode: 'off', note: ENGINE_MESSAGES.unavailable })).toBe(
      ENGINE_MESSAGES.off,
    )
  })

  it('is what was noted, else that the engine is still opening', () => {
    expect(unavailableReason({ mode: 'headless', note: ENGINE_MESSAGES.unavailable })).toBe(
      ENGINE_MESSAGES.unavailable,
    )
    expect(unavailableReason({ mode: 'window', note: null })).toBe('still opening')
  })
})
