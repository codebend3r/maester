import { after, test } from 'node:test'
import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { openMpv, type Mpv, type MpvEvent } from '@/mpv'
import { propertyGuards } from '@/properties'
import { project } from '@/build/context'

const directory = await mkdtemp(resolve(tmpdir(), 'raven-mpv-native-'))
const clip = resolve(directory, 'tracks.mkv')
const sidecar = resolve(directory, 'sidecar.srt')
await writeFile(sidecar, '1\n00:00:00,000 --> 00:00:10,000\nNative subtitle fixture\n')
const ffmpeg = spawn(
  resolve(project, 'native-build/prefix/bin/ffmpeg'),
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
if (exitCode !== 0) throw new Error('Source-built ffmpeg could not generate native fixtures')
after(async () => {
  await rm(directory, { recursive: true, force: true })
})

const harness = async () => {
  const listeners = new Set<(event: MpvEvent) => void>()
  const errors: MpvEvent[] = []
  const player = await openMpv({
    surface: { kind: 'headless' },
    onEvent: (event) => {
      if (event.type === 'error' || event.type === 'overflow') errors.push(event)
      listeners.forEach((listener) => listener(event))
    },
  })
  const eventAfter = async ({
    type,
    action,
    matches = () => true,
  }: {
    type: MpvEvent['type']
    action: () => Promise<void>
    matches?: (event: MpvEvent) => boolean
  }) => {
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
  await value.player.set({ name: 'pause', value: true })
  await value.eventAfter({
    type: 'file-loaded',
    action: () => value.player.command({ args: ['loadfile', clip] }),
  })
}
const positionNear = async ({
  player,
  remaining = 100,
}: {
  player: Mpv
  remaining?: number
}): Promise<number> => {
  const position = await player.read({ name: 'time-pos' })
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
      `Native runtime: ${player.version}; FFmpeg ${await player.read({ name: 'ffmpeg-version' })}`,
    )
    await Promise.all(
      (
        [
          'options/config',
          'options/load-scripts',
          'options/ytdl',
          'options/osc',
          'options/input-default-bindings',
          'options/input-vo-keyboard',
        ] as const
      ).map(async (name) => {
        assert.equal(await player.read({ name }), false)
      }),
    )
    await (['aid', 'sid'] as const).reduce(async (previous, name) => {
      await previous
      await value.eventAfter({
        type: 'property',
        matches: (event) =>
          event.type === 'property' && event.name === name && event.data === 'auto',
        action: async () => player.observe({ name }),
      })
      assert.equal(await player.read({ name }), 'auto')
    }, Promise.resolve())
    await player.set({ name: 'speed', value: 1.25 })
    assert.equal(await player.read({ name: 'speed' }), 1.25)
    await player.set({ name: 'speed', value: 1 })
    await [false, true].reduce(async (previous, hint) => {
      await previous
      const observation = await value.eventAfter({
        type: 'property',
        matches: (event) =>
          event.type === 'property' &&
          event.name === 'target-colorspace-hint' &&
          event.data === hint,
        action: async () => {
          player.observe({ name: 'target-colorspace-hint' })
          await player.set({ name: 'target-colorspace-hint', value: hint })
        },
      })
      assert.equal(observation.type, 'property')
      assert.equal(await player.read({ name: 'target-colorspace-hint' }), hint)
    }, Promise.resolve())
    await load(value)
    assert.ok(((await player.read({ name: 'duration' })) ?? 0) > 11)
    const tracks = await player.read({ name: 'track-list' })
    const audio = tracks.filter((track) => track.type === 'audio')
    assert.equal(audio.length, 2)
    assert.equal(tracks.filter((track) => track.type === 'sub').length, 1)
    const second = audio[1]
    if (!second) throw new Error('Missing generated audio track')
    await player.set({ name: 'aid', value: second.id })
    assert.equal(await player.read({ name: 'aid' }), second.id)
    await player.command({ args: ['sub-add', sidecar, 'select'] })
    const subtitles = (await player.read({ name: 'track-list' })).filter(
      (track) => track.type === 'sub',
    )
    assert.equal(subtitles.length, 2)
    const external = subtitles.find((track) => track.external)
    if (!external) throw new Error('Sidecar was not loaded')
    await player.set({ name: 'sid', value: external.id })
    assert.equal(await player.read({ name: 'sid' }), external.id)
    await (['aid', 'sid'] as const).reduce(async (previous, name) => {
      await previous
      const observation = await value.eventAfter({
        type: 'property',
        matches: (event) =>
          event.type === 'property' && event.name === name && event.data === false,
        action: async () => {
          player.observe({ name })
          await player.set({ name, value: false })
        },
      })
      assert.equal(observation.type, 'property')
      assert.equal(await player.read({ name }), false)
    }, Promise.resolve())
    player.observe({ name: 'pause' })
    const paused = await value.eventAfter({
      type: 'property',
      matches: (event) =>
        event.type === 'property' && event.name === 'pause' && event.data === false,
      action: () => player.set({ name: 'pause', value: false }),
    })
    assert.equal(paused.type, 'property')
    await player.set({ name: 'pause', value: true })
    await player.command({ args: ['seek', '4', 'absolute+exact'] })
    assert.ok(Math.abs((await positionNear({ player })) - 4) < 0.25)
    const ended = await value.eventAfter({
      type: 'end-file',
      action: () => player.command({ args: ['stop'] }),
    })
    assert.deepEqual(ended, { type: 'end-file', reason: 'stop', error: 0 })
    assert.ok(propertyGuards['track-list'](await player.read({ name: 'track-list' })))
    assert.deepEqual(value.errors, [])
  } finally {
    await player.destroy()
  }
  await assert.rejects(player.read({ name: 'pause' }), /destroyed/)
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
          await value.player.command({ args: ['stop'] })
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
    await ['explicit', 'environment', 'gc'].reduce(async (previous, mode) => {
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
      const code = await new Promise<number | null>((resolveExit, reject) => {
        child.once('error', reject)
        child.once('close', resolveExit)
      })
      assert.equal(code, 0, `${mode} cleanup failed or timed out`)
    }, Promise.resolve())
  },
)

test('native initialization rejects an invalid window handle without substituting a headless surface', async () => {
  await assert.rejects(
    openMpv({ surface: { kind: 'window', handle: Buffer.alloc(0) }, onEvent: () => {} }),
    /window handle size/,
  )
})

test('real file-open errors arrive as guarded end-file events', async () => {
  const value = await harness()
  try {
    const event = await value.eventAfter({
      type: 'end-file',
      action: () => value.player.command({ args: ['loadfile', resolve(directory, 'absent.mkv')] }),
    })
    assert.equal(event.type, 'end-file')
    if (event.type !== 'end-file') throw new Error('Missing end-file error')
    assert.equal(event.reason, 'error')
    assert.ok(event.error < 0)
    assert.deepEqual(value.errors, [])
  } finally {
    await value.player.destroy()
  }
})
