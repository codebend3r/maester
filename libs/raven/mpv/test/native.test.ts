import { after, test } from 'node:test'
import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  MPV_COMMANDS,
  MPV_END_FILE_REASONS,
  MPV_EVENTS,
  MPV_SURFACE_KINDS,
  openMpv,
  type Mpv,
  type MpvEvent,
} from '@/mpv'
import { MPV_CHOICES, MPV_PROPERTIES, MPV_TRACK_TYPES, propertyGuards } from '@/properties'
import { isWindows, project } from '@/build/context'
import { isCleanupMode } from '@/test/cleanupModes'

/** Options this file sets that the wrapper does not name: the audio output, and mpv's silent one. */
const TEST_OPTIONS = { ao: 'ao' } as const
const TEST_AUDIO_OUTPUTS = { null: 'null' } as const

const directory = await mkdtemp(resolve(tmpdir(), 'raven-mpv-native-'))
const clip = resolve(directory, 'tracks.mkv')
const sidecar = resolve(directory, 'sidecar.srt')
await writeFile(sidecar, '1\n00:00:00,000 --> 00:00:10,000\nNative subtitle fixture\n')
// macOS tests use the source-built ffmpeg; Windows has no source build and takes the runner's.
const ffmpeg = spawn(
  isWindows() ? 'ffmpeg' : resolve(project, 'native-build/prefix/bin/ffmpeg'),
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=24',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=880:sample_rate=48000',
    '-i',
    sidecar,
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-map',
    '2:a',
    '-map',
    '3:s',
    '-t',
    '12',
    '-c:v',
    'mpeg4',
    '-c:a',
    'aac',
    '-c:s',
    'srt',
    '-metadata:s:a:0',
    'language=eng',
    '-metadata:s:a:1',
    'language=fra',
    clip,
  ],
  { stdio: 'inherit' },
)
const exitCode = await new Promise<number | null>((resolveExit, reject) => {
  ffmpeg.once('error', reject)
  ffmpeg.once('close', resolveExit)
})
if (exitCode !== 0) throw new Error('ffmpeg could not generate native fixtures')
after(async () => {
  await rm(directory, { recursive: true, force: true })
})

const harness = async () => {
  const listeners = new Set<(event: MpvEvent) => void>()
  const errors: MpvEvent[] = []
  const player = await openMpv({
    surface: { kind: MPV_SURFACE_KINDS.headless },
    onEvent: (event) => {
      if (event.type === MPV_EVENTS.error || event.type === MPV_EVENTS.overflow) errors.push(event)
      listeners.forEach((listener) => listener(event))
    },
  })
  type EventAfterProps = {
    type: MpvEvent['type']
    action: () => Promise<void>
    matches?: (event: MpvEvent) => boolean
  }

  const eventAfter = async ({ type, action, matches = () => true }: EventAfterProps) => {
    let remove = () => {}
    const event = new Promise<MpvEvent>((resolveEvent, reject) => {
      const timer = setTimeout(() => {
        remove()
        reject(new Error(`Timed out waiting for ${type}`))
      }, 10000)
      const listener = (value: MpvEvent) => {
        if (value.type !== type || !matches(value)) return
        clearTimeout(timer)
        remove()
        resolveEvent(value)
      }
      remove = () => {
        clearTimeout(timer)
        listeners.delete(listener)
      }
      listeners.add(listener)
    })
    // Attach rejection handling before action, so even an action failure cleans up its waiter.
    const handled = event.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    )
    try {
      await action()
      const result = await handled
      if ('error' in result) throw result.error
      return result.value
    } finally {
      remove()
    }
  }
  return { player, eventAfter, errors }
}
const load = async (value: Awaited<ReturnType<typeof harness>>) => {
  await value.player.set({ name: MPV_PROPERTIES.pause, value: true })
  await value.eventAfter({
    type: MPV_EVENTS.fileLoaded,
    action: () => value.player.command({ args: [MPV_COMMANDS.loadfile, clip] }),
  })
}
type PositionNearProps = {
  player: Mpv
  remaining?: number
}

const positionNear = async ({ player, remaining = 100 }: PositionNearProps): Promise<number> => {
  const position = await player.read({ name: MPV_PROPERTIES.timePos })
  if (position !== null && Math.abs(position - 4) < 0.25) return position
  if (remaining === 0) throw new Error('Seek never reached target')
  await sleep(20)
  return positionNear({ player, remaining: remaining - 1 })
}

test('real libmpv loads generated MKV, observes, seeks, switches audio/subtitles and stops', async () => {
  const value = await harness()
  const { player } = value
  try {
    console.warn(
      `Native runtime: ${player.version}; FFmpeg ${await player.read({ name: MPV_PROPERTIES.ffmpegVersion })}`,
    )
    await Promise.all(
      [
        MPV_PROPERTIES.optionsConfig,
        MPV_PROPERTIES.optionsLoadScripts,
        MPV_PROPERTIES.optionsYtdl,
        MPV_PROPERTIES.optionsOsc,
        MPV_PROPERTIES.optionsInputDefaultBindings,
        MPV_PROPERTIES.optionsInputVoKeyboard,
      ].map(async (name) => {
        assert.equal(await player.read({ name }), false)
      }),
    )
    // The addon forces the cache on with its own sizes, whatever the stream.
    assert.equal(await player.read({ name: MPV_PROPERTIES.optionsCache }), true)
    assert.equal(await player.read({ name: MPV_PROPERTIES.optionsDemuxerMaxBytes }), 1_073_741_824)
    assert.equal(
      await player.read({ name: MPV_PROPERTIES.optionsDemuxerMaxBackBytes }),
      268_435_456,
    )
    await [MPV_PROPERTIES.aid, MPV_PROPERTIES.sid].reduce(async (previous, name) => {
      await previous
      await value.eventAfter({
        type: MPV_EVENTS.property,
        matches: (event) =>
          event.type === MPV_EVENTS.property &&
          event.name === name &&
          event.data === MPV_CHOICES.auto,
        action: async () => player.observe({ name }),
      })
      assert.equal(await player.read({ name }), MPV_CHOICES.auto)
    }, Promise.resolve())
    await player.set({ name: MPV_PROPERTIES.speed, value: 1.25 })
    assert.equal(await player.read({ name: MPV_PROPERTIES.speed }), 1.25)
    await player.set({ name: MPV_PROPERTIES.speed, value: 1 })
    await [false, true].reduce(async (previous, hint) => {
      await previous
      const observation = await value.eventAfter({
        type: MPV_EVENTS.property,
        matches: (event) =>
          event.type === MPV_EVENTS.property &&
          event.name === MPV_PROPERTIES.targetColorspaceHint &&
          event.data === hint,
        action: async () => {
          player.observe({ name: MPV_PROPERTIES.targetColorspaceHint })
          await player.set({ name: MPV_PROPERTIES.targetColorspaceHint, value: hint })
        },
      })
      assert.equal(observation.type, MPV_EVENTS.property)
      assert.equal(await player.read({ name: MPV_PROPERTIES.targetColorspaceHint }), hint)
    }, Promise.resolve())
    await load(value)
    assert.ok(((await player.read({ name: MPV_PROPERTIES.duration })) ?? 0) > 11)
    const tracks = await player.read({ name: MPV_PROPERTIES.trackList })
    const audio = tracks.filter((track) => track.type === MPV_TRACK_TYPES.audio)
    assert.equal(audio.length, 2)
    assert.equal(tracks.filter((track) => track.type === MPV_TRACK_TYPES.sub).length, 1)
    const second = audio[1]
    if (!second) throw new Error('Missing generated audio track')
    await player.set({ name: MPV_PROPERTIES.aid, value: second.id })
    assert.equal(await player.read({ name: MPV_PROPERTIES.aid }), second.id)
    await player.command({ args: [MPV_COMMANDS.subAdd, sidecar, 'select'] })
    const subtitles = (await player.read({ name: MPV_PROPERTIES.trackList })).filter(
      (track) => track.type === MPV_TRACK_TYPES.sub,
    )
    assert.equal(subtitles.length, 2)
    const external = subtitles.find((track) => track.external)
    if (!external) throw new Error('Sidecar was not loaded')
    await player.set({ name: MPV_PROPERTIES.sid, value: external.id })
    assert.equal(await player.read({ name: MPV_PROPERTIES.sid }), external.id)
    await [MPV_PROPERTIES.aid, MPV_PROPERTIES.sid].reduce(async (previous, name) => {
      await previous
      const observation = await value.eventAfter({
        type: MPV_EVENTS.property,
        matches: (event) =>
          event.type === MPV_EVENTS.property && event.name === name && event.data === false,
        action: async () => {
          player.observe({ name })
          await player.set({ name, value: false })
        },
      })
      assert.equal(observation.type, MPV_EVENTS.property)
      assert.equal(await player.read({ name }), false)
    }, Promise.resolve())
    player.observe({ name: MPV_PROPERTIES.pause })
    const paused = await value.eventAfter({
      type: MPV_EVENTS.property,
      matches: (event) =>
        event.type === MPV_EVENTS.property &&
        event.name === MPV_PROPERTIES.pause &&
        event.data === false,
      action: () => player.set({ name: MPV_PROPERTIES.pause, value: false }),
    })
    assert.equal(paused.type, MPV_EVENTS.property)
    await player.set({ name: MPV_PROPERTIES.pause, value: true })
    await player.command({ args: [MPV_COMMANDS.seek, '4', 'absolute+exact'] })
    assert.ok(Math.abs((await positionNear({ player })) - 4) < 0.25)
    const ended = await value.eventAfter({
      type: MPV_EVENTS.endFile,
      action: () => player.command({ args: [MPV_COMMANDS.stop] }),
    })
    assert.deepEqual(ended, {
      type: MPV_EVENTS.endFile,
      reason: MPV_END_FILE_REASONS.stop,
      error: 0,
    })
    assert.ok(
      propertyGuards[MPV_PROPERTIES.trackList](
        await player.read({ name: MPV_PROPERTIES.trackList }),
      ),
    )
    assert.deepEqual(value.errors, [])
  } finally {
    await player.destroy()
  }
  await assert.rejects(player.read({ name: MPV_PROPERTIES.pause }), /destroyed/)
  await player.destroy()
})

test(
  '100 real load/stop/destroy cycles finish without hanging while the event loop remains live',
  { timeout: 120000 },
  async () => {
    let ticks = 0
    const timer = setInterval(() => {
      ticks += 1
    }, 1)
    try {
      await Array.from({ length: 100 }).reduce(async (previous) => {
        await previous
        const value = await harness()
        try {
          await load(value)
          await value.player.command({ args: [MPV_COMMANDS.stop] })
          assert.deepEqual(value.errors, [])
        } finally {
          await value.player.destroy()
        }
      }, Promise.resolve())
    } finally {
      clearInterval(timer)
    }
    assert.ok(ticks > 0)
  },
)

test(
  'native wake/teardown races reclaim owners, handles and callbacks across environments',
  { timeout: 120000 },
  async () => {
    await isCleanupMode.values.reduce(async (previous, mode) => {
      await previous
      const child = spawn(
        process.execPath,
        ['--expose-gc', '--import', 'tsx', 'test/cleanup.ts', clip, mode],
        {
          cwd: project,
          stdio: 'inherit',
          timeout: 35000,
        },
      )
      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolveExit, reject) => {
          child.once('error', reject)
          child.once('close', (code, signal) => resolveExit({ code, signal }))
        },
      )
      assert.equal(
        exit.code,
        0,
        `${mode} cleanup failed or timed out (code ${exit.code}, signal ${exit.signal})`,
      )
    }, Promise.resolve())
  },
)

test('native initialization rejects an invalid window handle without substituting a headless surface', async () => {
  await assert.rejects(
    openMpv({
      surface: { kind: MPV_SURFACE_KINDS.window, handle: Buffer.alloc(0) },
      onEvent: () => {},
    }),
    /window handle size/,
  )
})

test('real file-open errors arrive as guarded end-file events', async () => {
  const value = await harness()
  try {
    const event = await value.eventAfter({
      type: MPV_EVENTS.endFile,
      action: () =>
        value.player.command({
          args: [MPV_COMMANDS.loadfile, resolve(directory, 'absent.mkv')],
        }),
    })
    assert.equal(event.type, MPV_EVENTS.endFile)
    if (event.type !== MPV_EVENTS.endFile) throw new Error('Missing end-file error')
    assert.equal(event.reason, MPV_END_FILE_REASONS.error)
    assert.ok(event.error < 0)
    assert.deepEqual(value.errors, [])
  } finally {
    await value.player.destroy()
  }
})

test('an audio surface plays sound alone: no video track is picked, and nothing is drawn', async () => {
  const listeners = new Set<(event: MpvEvent) => void>()
  const player = await openMpv({
    surface: { kind: MPV_SURFACE_KINDS.audio },
    onEvent: (event) => listeners.forEach((listener) => listener(event)),
  })
  try {
    await player.set({ name: MPV_PROPERTIES.pause, value: true })
    // CI runners have no sound card: with video off too, a failed device leaves nothing to play.
    await player.set({ name: TEST_OPTIONS.ao, value: TEST_AUDIO_OUTPUTS.null })
    const logs: string[] = []
    const opened = new Promise<void>((resolveOpen, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`The audio surface never opened the clip: ${logs.join('; ')}`))
      }, 10000)
      listeners.add((event) => {
        if (event.type === MPV_EVENTS.log) {
          logs.push(`${event.prefix}: ${event.text.trim()}`)
          return
        }
        if (event.type === MPV_EVENTS.fileLoaded) {
          clearTimeout(timer)
          resolveOpen()
          return
        }
        if (event.type !== MPV_EVENTS.endFile) return
        clearTimeout(timer)
        reject(new Error(`The audio surface ended the clip unopened: ${logs.join('; ')}`))
      })
    })
    await Promise.all([player.command({ args: [MPV_COMMANDS.loadfile, clip] }), opened])
    assert.equal(await player.read({ name: MPV_PROPERTIES.vid }), false)
    assert.notEqual(await player.read({ name: MPV_PROPERTIES.aid }), false)
    player.nowPlaying({
      title: 'Native fixture',
      artist: 'raven',
      album: 'Tests',
      duration: 12,
      position: 0,
      isPlaying: false,
      artwork: null,
    })
    player.clearNowPlaying()
  } finally {
    await player.destroy()
  }
})
