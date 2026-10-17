import { strict as assert } from 'node:assert'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { basename, join, resolve } from 'node:path'
import { after, describe, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import {
  isNumber,
  isRecord,
  object,
  type OutputSettings,
  type PlayerCommand,
  type PlayerEvent,
} from '@raven/core'
import { type MpvEvent, openMpv } from '@raven/mpv'
import { makeTrackClip } from '@/e2e/clips'
import { addonPathFor } from '@/main/player/engine'
import {
  createPlayerService,
  PLAYER_MESSAGES,
  type PlayerOutcome,
  resolveSourceWith,
} from '@/main/player/playerService'
import { tracksFromMpv } from '@/main/player/tracksFromMpv'
import { createNodeTimers } from '@/main/timers'

const WAIT_MS = 10000
const DESTROY_MS = 5000
/** How long a test lets late events land before it says none came. */
const SETTLE_MS = 300

const project = resolve(import.meta.dirname, '..')
const addonPath = addonPathFor({ isPackaged: false, appPath: project, resourcesPath: '' })

const isFunction = (value: unknown): value is (...args: unknown[]) => unknown =>
  typeof value === 'function'
const isCounts = object({ owners: isNumber, callbacks: isNumber, handles: isNumber })
// The same module instance `openMpv` loads, so its process-wide counters cover every engine here.
const addon: unknown = createRequire(import.meta.url)(addonPath)
const lifecycleCounts = () => {
  if (!isRecord(addon) || !isFunction(addon.lifecycleCounts))
    throw new Error('The raven mpv addon has no lifecycle counters')
  const counts: unknown = addon.lifecycleCounts()
  if (!isCounts(counts)) throw new Error('Invalid native lifecycle counts')
  return counts
}

setFlagsFromString('--expose-gc')
const gc: unknown = runInNewContext('gc')
const collectUntil = async ({
  matches,
  deadline = Date.now() + 15000,
}: {
  matches: () => boolean
  deadline?: number
}): Promise<void> => {
  if (!isFunction(gc)) throw new Error('No garbage collector to reclaim native owners with')
  gc()
  await sleep(10)
  if (matches()) return
  if (Date.now() > deadline)
    throw new Error(`Native owners were never reclaimed: ${JSON.stringify(lifecycleCounts())}`)
  await collectUntil({ matches, deadline })
}

/** Waits until no engine holds a libmpv handle or an event callback; both go on destroy. */
const released = async ({ deadline }: { deadline: number }): Promise<void> => {
  const { handles, callbacks } = lifecycleCounts()
  if (handles === 0 && callbacks === 0) return
  if (Date.now() > deadline)
    throw new Error(`Native handles leaked: ${JSON.stringify(lifecycleCounts())}`)
  await sleep(20)
  await released({ deadline })
}

// Counts every request, so a test can prove mpv never fetched what a granted file names.
const requests: string[] = []
const server = createServer((request, response) => {
  requests.push(request.url ?? '')
  response.statusCode = 404
  response.end()
})
await new Promise<void>((resolveListen) => {
  server.listen(0, '127.0.0.1', () => resolveListen())
})
const address = server.address()
if (address === null || typeof address === 'string') throw new Error('No local server port')
const beacon = `http://127.0.0.1:${address.port}`
after(() => {
  server.close()
})

const clip = await makeTrackClip()
const nested = join(clip.folder, 'nested')
/** Files named like videos whose contents name another file or a URL for mpv to open. */
const references = {
  empty: '#EXTM3U\n',
  single: `#EXTM3U\n${clip.path}\n`,
  several: `#EXTM3U\n${clip.path}\n${clip.path}\n${clip.path}\n`,
  relative: `#EXTM3U\n../${basename(clip.path)}\n`,
  fileUrl: `#EXTM3U\nfile://${clip.path}\n`,
  bare: `${clip.path}\n`,
  web: `#EXTM3U\n${beacon}/playlist.mkv\n`,
  edl: `# mpv EDL v0\n${clip.path}\n`,
  edlWeb: `# mpv EDL v0\n${beacon}/edl.mkv\n`,
} as const
type Reference = keyof typeof references
const REFERENCES = Object.keys(references).filter((key): key is Reference =>
  Object.hasOwn(references, key),
)
const referencePath = (reference: Reference) => join(nested, `${reference} 01.mkv`)
const paths = {
  t1: clip.path,
  t2: join(clip.folder, 'Sidecar 01.mkv'),
  bad: join(clip.folder, 'notes.mkv'),
  missing: join(clip.folder, 'Gone 01.mkv'),
  damaged: join(clip.folder, 'Damaged 01.mkv'),
  cut: join(clip.folder, 'Cut 01.mkv'),
} as const
type FileId = keyof typeof paths | Reference
const whole = await readFile(clip.path)
await Promise.all([
  copyFile(clip.path, paths.t2),
  writeFile(
    join(clip.folder, 'Sidecar 01.srt'),
    '1\n00:00:00,000 --> 00:00:29,000\nraven sidecar fixture\n',
  ),
  // A Matroska signature over bytes that are nothing at all.
  writeFile(paths.damaged, Buffer.concat([whole.subarray(0, 4), Buffer.alloc(65536, 7)])),
  // The first 30% of the clip, as a volume that stops reading mid-play leaves it.
  writeFile(paths.cut, whole.subarray(0, Math.floor(whole.length * 0.3))),
  mkdir(nested).then(() =>
    Promise.all(
      REFERENCES.map((reference) => writeFile(referencePath(reference), references[reference])),
    ),
  ),
])
after(async () => {
  await rm(clip.folder, { recursive: true, force: true })
})

const isPathId = (fileId: string): fileId is keyof typeof paths => Object.hasOwn(paths, fileId)
const isReference = (fileId: string): fileId is Reference => Object.hasOwn(references, fileId)
const pathOf = (fileId: string) => {
  if (isPathId(fileId)) return paths[fileId]
  if (isReference(fileId)) return referencePath(fileId)
  return null
}
const fileOf = (fileId: string) => {
  const path = pathOf(fileId)
  if (path === null) return null
  return { fileId, path, name: fileId, size: 0, mtimeMs: 0 }
}

type EventOf<K extends PlayerEvent['type']> = Extract<PlayerEvent, { type: K }>

const isOf =
  <K extends PlayerEvent['type']>(type: K) =>
  (event: PlayerEvent): event is EventOf<K> =>
    event.type === type

const where =
  <K extends PlayerEvent['type']>({
    type,
    holds = () => true,
  }: {
    type: K
    holds?: (event: EventOf<K>) => boolean
  }) =>
  (event: PlayerEvent): event is EventOf<K> =>
    isOf(type)(event) && holds(event)

const near = ({ value, target, within }: { value: number; target: number; within: number }) =>
  Math.abs(value - target) <= within

const openHarness = async () => {
  const events: PlayerEvent[] = []
  // What mpv itself said, in stream order, without the property changes.
  const raw: MpvEvent[] = []
  const warnings: string[] = []
  const listeners = new Set<(event: PlayerEvent) => void>()
  const relay: { receive: (event: MpvEvent) => void } = { receive: () => {} }
  const mpv = await openMpv({
    surface: { kind: 'headless' },
    addonPath,
    onEvent: (event) => {
      if (event.type !== 'property' && event.type !== 'log') raw.push(event)
      relay.receive(event)
    },
  })
  const service = createPlayerService({
    mpv,
    resolveSource: resolveSourceWith({ grants: { fileOf } }),
    canChooseAo: false,
    timers: createNodeTimers(),
    onActivity: () => {},
    onFirstFrame: () => {},
    warn: (message) => {
      warnings.push(message)
    },
  })
  relay.receive = (event) => service.receive(event)
  service.subscribe((event) => {
    events.push(event)
    Array.from(listeners).forEach((listener) => listener(event))
  })

  /** Registers now and resolves with the first matching event, or fails after `timeoutMs`. */
  const nextEvent = <T extends PlayerEvent>({
    matches,
    label,
    timeoutMs = WAIT_MS,
  }: {
    matches: (event: PlayerEvent) => event is T
    label: string
    timeoutMs?: number
  }): Promise<T> => {
    const pending = new Promise<T>((resolveEvent, reject) => {
      const listener = (event: PlayerEvent) => {
        if (!matches(event)) return
        clearTimeout(timer)
        listeners.delete(listener)
        resolveEvent(event)
      }
      const timer = setTimeout(() => {
        listeners.delete(listener)
        reject(new Error(`Timed out after ${timeoutMs} ms waiting for ${label}`))
      }, timeoutMs)
      listeners.add(listener)
    })
    // Marked handled, so a test that fails before awaiting it reports its own failure.
    pending.catch(() => {})
    return pending
  }

  const eventAfter = async <T extends PlayerEvent>({
    action,
    ...wait
  }: {
    action: () => Promise<unknown>
    matches: (event: PlayerEvent) => event is T
    label: string
    timeoutMs?: number
  }): Promise<T> => {
    const pending = nextEvent(wait)
    await action()
    return pending
  }

  const send = async (command: PlayerCommand): Promise<PlayerOutcome> => service.handle(command)
  const sendOk = async (command: PlayerCommand) => {
    assert.deepEqual(await send(command), { ok: true }, `${command.type} was refused`)
  }
  const load = ({
    fileId,
    start = 0,
    audio = null,
    subtitle = null,
  }: {
    fileId: FileId
    start?: number
    audio?: number | null
    subtitle?: string | null
  }) => sendOk({ type: 'load', source: { kind: 'file', fileId }, start, audio, subtitle })

  /** Polls observable state until it holds, so nothing here waits on a fixed sleep. */
  const waitFor = async ({
    label,
    check,
    deadline = Date.now() + WAIT_MS,
  }: {
    label: string
    check: () => Promise<boolean>
    deadline?: number
  }): Promise<void> => {
    if (await check()) return
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`)
    await sleep(20)
    await waitFor({ label, check, deadline })
  }

  const playing = ({ fileId, start = 0 }: { fileId: FileId; start?: number }) =>
    eventAfter({
      label: `${fileId} playing`,
      matches: where({ type: 'paused', holds: (event) => !event.paused }),
      action: () => load({ fileId, start }),
    })

  const errorsOf = () => events.filter(where({ type: 'error' }))
  const endingsOf = () => events.filter(where({ type: 'ended' }))

  return {
    mpv,
    service,
    events,
    raw,
    warnings,
    nextEvent,
    eventAfter,
    send,
    sendOk,
    load,
    waitFor,
    playing,
    errorsOf,
    endingsOf,
  }
}
type Harness = Awaited<ReturnType<typeof openHarness>>

const withHarness = async (run: (harness: Harness) => Promise<void>) => {
  const harness = await openHarness()
  try {
    await run(harness)
  } finally {
    await harness.mpv.destroy()
  }
}

const destroyWithin = async ({ harness, ms }: { harness: Harness; ms: number }) => {
  const started = Date.now()
  const outcome = await Promise.race([
    harness.mpv.destroy().then(() => 'destroyed' as const),
    sleep(ms).then(() => 'hung' as const),
  ])
  assert.equal(outcome, 'destroyed', `destroy took longer than ${ms} ms`)
  return Date.now() - started
}

const PCM: OutputSettings = { profile: 'pcm', device: 'auto', passthrough: [], spatial: false }
const PROFILES: readonly OutputSettings[] = [
  PCM,
  { ...PCM, profile: 'passthrough', passthrough: ['ac3', 'dts'] },
  { ...PCM, profile: 'headphones', spatial: false },
  { ...PCM, profile: 'headphones', spatial: true },
]

describe('the desktop player service against headless libmpv', () => {
  test('loads and reports the clip tracks', async () => {
    await withHarness(async ({ mpv, events, nextEvent, load }) => {
      const tracks = nextEvent({
        label: 'two audio tracks',
        matches: where({ type: 'tracks', holds: (event) => event.tracks.audio.length === 2 }),
      })
      const duration = nextEvent({
        label: 'the duration',
        matches: where({
          type: 'duration',
          holds: (event) =>
            event.duration !== null && near({ value: event.duration, target: 30, within: 0.5 }),
        }),
      })
      const playing = nextEvent({
        label: 'paused: false',
        matches: where({ type: 'paused', holds: (event) => !event.paused }),
      })
      await load({ fileId: 't1' })
      const [{ tracks: first }] = await Promise.all([tracks, duration, playing])
      assert.deepEqual(
        first.audio.map((track) => track.language),
        ['en', 'fr'],
      )
      assert.deepEqual(
        first.subtitles.map((track) => track.id),
        ['embedded-0'],
      )
      // The snapshot emits its tracks right after `paused`, once every field is known.
      const settled = events.findLast(where({ type: 'tracks' }))?.tracks ?? null
      assert.ok(settled, 'no tracks after the snapshot')
      assert.deepEqual(
        settled.audio.map(({ codec, channels, language, default: isDefault }) => ({
          codec,
          channels,
          language,
          isDefault,
        })),
        [
          { codec: 'aac', channels: 1, language: 'en', isDefault: true },
          { codec: 'aac', channels: 1, language: 'fr', isDefault: false },
        ],
      )
      assert.deepEqual(
        settled.subtitles.map(({ id, source, language, codec }) => ({
          id,
          source,
          language,
          codec,
        })),
        [{ id: 'embedded-0', source: 'embedded', language: 'en', codec: 'subrip' }],
      )
      assert.equal(settled.defaultAudio, 0)
      assert.equal(settled.frameRate, 24)
      // The event is the mapping of what mpv itself lists now.
      assert.deepEqual(
        settled,
        tracksFromMpv({
          list: await mpv.read({ name: 'track-list' }),
          frameRate: await mpv.read({ name: 'container-fps' }),
        }),
      )
    })
  })

  test('lists a sidecar beside the embedded subtitle and switches to it', async () => {
    await withHarness(async ({ mpv, events, playing, sendOk }) => {
      await playing({ fileId: 't2' })
      const settled = events.findLast(where({ type: 'tracks' }))?.tracks ?? null
      assert.ok(settled, 'no tracks after the snapshot')
      assert.deepEqual(
        settled.subtitles.map(({ id, source }) => ({ id, source })),
        [
          { id: 'embedded-0', source: 'embedded' },
          { id: 'external-0', source: 'external' },
        ],
      )
      const list = await mpv.read({ name: 'track-list' })
      assert.deepEqual(
        settled,
        tracksFromMpv({ list, frameRate: await mpv.read({ name: 'container-fps' }) }),
      )
      const external = list.find((track) => track.type === 'sub' && track.external === true)
      assert.ok(external, 'mpv did not load the sidecar')
      await sendOk({ type: 'subtitle', id: 'external-0' })
      assert.equal(await mpv.read({ name: 'sid' }), external.id)
    })
  })

  test('pauses, seeks and clamps a seek past the end', async () => {
    await withHarness(async ({ mpv, events, eventAfter, playing, sendOk, nextEvent, errorsOf }) => {
      await playing({ fileId: 't1' })
      await eventAfter({
        label: 'paused: true',
        matches: where({ type: 'paused', holds: (event) => event.paused }),
        action: () => sendOk({ type: 'pause' }),
      })
      await eventAfter({
        label: 'time near 4',
        matches: where({
          type: 'time',
          holds: (event) => near({ value: event.time, target: 4, within: 0.5 }),
        }),
        action: () => sendOk({ type: 'seek', time: 4 }),
      })
      const length = (await mpv.read({ name: 'duration' })) ?? Number.NaN
      const ended = nextEvent({ label: 'ended', matches: where({ type: 'ended' }) })
      await sendOk({ type: 'seek', time: 9999 })
      const landed = (await mpv.read({ name: 'time-pos' })) ?? Number.NaN
      assert.ok(landed <= length, `the seek landed at ${landed}, past the ${length} s clip`)
      await sendOk({ type: 'play' })
      await ended
      const times = events.filter(where({ type: 'time' })).map((event) => event.time)
      assert.ok(
        times.every((time) => time <= length),
        `a time past the ${length} s clip reached the page: ${Math.max(...times)}`,
      )
      assert.deepEqual(errorsOf(), [])
      // mpv empties the track list as the file closes; that must not reach the page.
      assert.ok(
        events.filter(where({ type: 'tracks' })).every((event) => event.tracks.audio.length === 2),
        'an emptied track list reached the page',
      )
      assert.ok(
        events.filter(where({ type: 'duration' })).every((event) => event.duration !== null),
        'an emptied duration reached the page',
      )
    })
  })

  test('reads where a pause and a paused seek inside the time-pos throttle land', async () => {
    await withHarness(async ({ mpv, events, eventAfter, playing, sendOk, waitFor }) => {
      await playing({ fileId: 't1' })
      await eventAfter({
        label: 'a second of play',
        matches: where({ type: 'time', holds: (event) => event.time >= 1 }),
        action: async () => {},
      })
      // A few frames on, but inside the 250 ms the addon's throttle drops time-pos for.
      await sleep(120)
      const lastTime = () => events.findLast(where({ type: 'time' }))?.time ?? null
      const shows = async (target: number) => {
        const time = lastTime()
        return time !== null && near({ value: time, target, within: 0.001 })
      }
      await sendOk({ type: 'pause' })
      const paused = (await mpv.read({ name: 'time-pos' })) ?? Number.NaN
      await waitFor({ label: `the clock at the pause (${paused})`, check: () => shows(paused) })
      await eventAfter({
        label: 'time near 4',
        matches: where({
          type: 'time',
          holds: (event) => near({ value: event.time, target: 4, within: 0.25 }),
        }),
        action: () => sendOk({ type: 'seek', time: 4 }),
      })
      // Within 250 ms of the last time-pos, which the addon's throttle drops, so only the
      // read on playback-restart can report it.
      await eventAfter({
        label: 'time near 8',
        matches: where({
          type: 'time',
          holds: (event) => near({ value: event.time, target: 8, within: 0.25 }),
        }),
        action: () => sendOk({ type: 'seek', time: 8 }),
      })
      const landed = (await mpv.read({ name: 'time-pos' })) ?? Number.NaN
      await waitFor({
        label: `the clock where the seek landed (${landed})`,
        check: () => shows(landed),
      })
    })
  })

  test('a load that starts near the end reports ended, not an error', async () => {
    await withHarness(async ({ events, eventAfter, load, errorsOf }) => {
      await eventAfter({
        label: 'ended',
        matches: where({ type: 'ended' }),
        action: () => load({ fileId: 't1', start: 29 }),
      })
      assert.deepEqual(errorsOf(), [])
      assert.ok(
        events.filter(where({ type: 'time' })).every((event) => event.time >= 28.5),
        'the clip did not start where it was asked to',
      )
    })
  })

  test('a file cut short mid-play is a decode error, not ended', async () => {
    await withHarness(async ({ eventAfter, load, endingsOf }) => {
      const error = await eventAfter({
        label: 'a decode error',
        matches: where({ type: 'error' }),
        action: () => load({ fileId: 'cut', start: 6 }),
      })
      assert.deepEqual(error, {
        type: 'error',
        reason: 'decode',
        message: PLAYER_MESSAGES.stopped,
      })
      assert.deepEqual(endingsOf(), [])
    })
  })

  test('switches audio by index and subtitles by id', async () => {
    await withHarness(async ({ mpv, playing, sendOk }) => {
      await playing({ fileId: 't1' })
      const list = await mpv.read({ name: 'track-list' })
      const second = list.filter((track) => track.type === 'audio')[1]
      const subtitle = list.find((track) => track.type === 'sub')
      assert.ok(second && subtitle, 'the clip lacks its second audio track or its subtitle')
      await sendOk({ type: 'audio', index: 1 })
      assert.equal(await mpv.read({ name: 'aid' }), second.id)
      await sendOk({ type: 'subtitle', id: 'embedded-0' })
      assert.equal(await mpv.read({ name: 'sid' }), subtitle.id)
      await sendOk({ type: 'subtitle', id: null })
      assert.equal(await mpv.read({ name: 'sid' }), false)
    })
  })

  test('applies picks sent with the load', async () => {
    await withHarness(async ({ mpv, eventAfter, load }) => {
      // The snapshot sets the picks before it emits `paused`, so they hold by then.
      await eventAfter({
        label: 'the snapshot',
        matches: where({ type: 'paused' }),
        action: () => load({ fileId: 't1', audio: 1, subtitle: 'embedded-0' }),
      })
      const list = await mpv.read({ name: 'track-list' })
      assert.equal(
        await mpv.read({ name: 'aid' }),
        list.filter((track) => track.type === 'audio')[1]?.id ?? null,
      )
      assert.equal(
        await mpv.read({ name: 'sid' }),
        list.find((track) => track.type === 'sub')?.id ?? null,
      )
    })
  })

  test('reports an open error for a file it cannot read, then plays the next', async () => {
    await withHarness(async ({ eventAfter, load, playing, endingsOf }) => {
      await (['bad', 'missing', 'damaged'] as const).reduce(async (previous, fileId) => {
        await previous
        const error = await eventAfter({
          label: `${fileId} failing to open`,
          matches: where({ type: 'error' }),
          action: () => load({ fileId }),
        })
        assert.deepEqual(
          error,
          { type: 'error', reason: 'open', message: PLAYER_MESSAGES.cannotOpen },
          fileId,
        )
      }, Promise.resolve())
      await playing({ fileId: 't1' })
      assert.deepEqual(endingsOf(), [])
    })
  })

  test('a granted file that names other files or URLs is an open error and opens none of them', async () => {
    await withHarness(async ({ mpv, events, raw, eventAfter, load, waitFor }) => {
      await REFERENCES.reduce(async (previous, fileId) => {
        await previous
        events.splice(0)
        const mark = raw.length
        const error = await eventAfter({
          label: `${fileId} failing to open`,
          matches: where({ type: 'error' }),
          action: () => load({ fileId }),
        })
        assert.deepEqual(
          error,
          { type: 'error', reason: 'open', message: PLAYER_MESSAGES.cannotOpen },
          fileId,
        )
        await waitFor({
          label: `${fileId} closing in mpv`,
          check: async () =>
            raw.slice(mark).some((event) => event.type === 'end-file' && event.reason === 'error'),
        })
        await sleep(SETTLE_MS)
        const said = raw.slice(mark)
        // `access-references=no`: mpv refuses the reference itself, so nothing expands.
        assert.deepEqual(
          said.filter((event) => event.type === 'file-loaded'),
          [],
          `${fileId} opened what it names`,
        )
        assert.deepEqual(
          said.filter((event) => event.type === 'end-file' && event.reason === 'redirect'),
          [],
          `${fileId} expanded`,
        )
        assert.deepEqual(events, [error], `${fileId} reached the page beyond its error`)
        assert.equal((await mpv.read({ name: 'track-list' })).length, 0, fileId)
      }, Promise.resolve())
      assert.deepEqual(requests, [], 'mpv fetched a URL a granted file named')
    })
  })

  test('a playlist loaded right after a video never plays what it names', async () => {
    await withHarness(async ({ mpv, events, raw, eventAfter, load }) => {
      // The video's late file-loaded lands around the playlist's loadfile, the window a
      // stale event once used to slip the playlist's entry past the guard.
      await Array.from({ length: 80 }, (_value, index) => (index % 20) * 0.5).reduce(
        async (previous, gap) => {
          await previous
          await load({ fileId: 't1' })
          await sleep(gap)
          events.splice(0)
          const mark = raw.length
          const error = await eventAfter({
            label: `the playlist failing after a ${gap} ms gap`,
            matches: where({ type: 'error' }),
            action: () => load({ fileId: 'single' }),
          })
          await sleep(100)
          assert.deepEqual(
            events,
            [{ type: 'error', reason: 'open', message: PLAYER_MESSAGES.cannotOpen }],
            `the page heard more than the playlist's error after a ${gap} ms gap`,
          )
          assert.equal(error.reason, 'open')
          const said = raw.slice(mark)
          const closed = said.findIndex(
            (event) => event.type === 'end-file' && event.reason === 'error',
          )
          assert.ok(closed >= 0, `mpv never refused the playlist after a ${gap} ms gap`)
          assert.ok(
            said.slice(closed).every((event) => event.type !== 'file-loaded'),
            `mpv opened a file after refusing the playlist (${gap} ms gap)`,
          )
        },
        Promise.resolve(),
      )
      assert.equal((await mpv.read({ name: 'track-list' })).length, 0)
    })
  })

  test('toggles the stats overlay and reads the device list', async () => {
    await withHarness(async ({ mpv, playing, send }) => {
      await playing({ fileId: 't1' })
      assert.deepEqual(await send({ type: 'stats' }), { ok: true })
      assert.deepEqual(await send({ type: 'stats' }), { ok: true })
      const devices = await mpv.read({ name: 'audio-device-list' })
      assert.ok(Array.isArray(devices))
    })
  })

  test('applies output settings without touching ao', async () => {
    await withHarness(async ({ mpv, service, playing, eventAfter, errorsOf }) => {
      const devices = await mpv.read({ name: 'audio-device-list' })
      await PROFILES.reduce(async (previous, output) => {
        await previous
        await service.applyOutput({ output, devices })
      }, Promise.resolve())
      assert.match(await mpv.read({ name: 'mpv-version' }), /^mpv /)
      await playing({ fileId: 't1' })
      // While loaded, each profile also reloads the audio output.
      await PROFILES.reduce(async (previous, output) => {
        await previous
        await service.applyOutput({ output, devices })
      }, Promise.resolve())
      const played = await mpv.read({ name: 'time-pos' })
      await eventAfter({
        label: 'the clock moving after the output changed',
        matches: where({ type: 'time', holds: (event) => event.time > (played ?? 0) }),
        action: async () => {},
      })
      assert.match(await mpv.read({ name: 'mpv-version' }), /^mpv /)
      assert.deepEqual(errorsOf(), [])
    })
  })

  test('survives twenty load, stop and load cycles', async () => {
    const harness = await openHarness()
    const { eventAfter, load, sendOk, nextEvent, errorsOf, endingsOf } = harness
    try {
      await Array.from({ length: 19 }).reduce(async (previous) => {
        await previous
        await load({ fileId: 't1' })
        await sendOk({ type: 'stop' })
        await load({ fileId: 't2' })
      }, Promise.resolve())
      await load({ fileId: 't1' })
      await sendOk({ type: 'stop' })
      const tracks = nextEvent({
        label: 'the last load tracks',
        matches: where({ type: 'tracks', holds: (event) => event.tracks.subtitles.length === 2 }),
      })
      await eventAfter({
        label: 'the last load playing',
        matches: where({ type: 'paused', holds: (event) => !event.paused }),
        action: () => load({ fileId: 't2' }),
      })
      await tracks
      await sleep(SETTLE_MS)
      assert.deepEqual(errorsOf(), [])
      assert.deepEqual(endingsOf(), [])
    } finally {
      await destroyWithin({ harness, ms: DESTROY_MS })
    }
  })

  test('a load sent right after another plays the second file', async () => {
    await withHarness(async ({ mpv, events, load, waitFor, errorsOf, endingsOf }) => {
      const hasSidecar = async () =>
        (await mpv.read({ name: 'track-list' })).some((track) => track.external === true)
      // Gaps of a few milliseconds land the first file's file-loaded while the second load
      // is still waiting on mpv, which once made the second load skip its loadfile.
      await Array.from({ length: 40 }, (_value, index) => (index % 20) * 0.5).reduce(
        async (previous, gap) => {
          await previous
          await load({ fileId: 't1' })
          await sleep(gap)
          events.splice(0)
          await load({ fileId: 't2' })
          await waitFor({
            label: `the second file playing after a ${gap} ms gap`,
            check: hasSidecar,
          })
          await waitFor({
            label: `the second file's snapshot after a ${gap} ms gap`,
            check: async () =>
              (events.findLast(where({ type: 'tracks' }))?.tracks.subtitles.length ?? 0) === 2,
          })
          await sleep(100)
          // The page counts every event after the load's reply as the second file's.
          assert.ok(
            events
              .filter(where({ type: 'tracks' }))
              .every((event) => event.tracks.subtitles.length === 2),
            `the first file's tracks reached the page after a ${gap} ms gap`,
          )
          assert.ok(
            events
              .filter(where({ type: 'duration' }))
              .every(
                (event) =>
                  event.duration !== null &&
                  near({ value: event.duration, target: 30, within: 0.5 }),
              ),
            `an emptied duration reached the page after a ${gap} ms gap`,
          )
        },
        Promise.resolve(),
      )
      await sleep(SETTLE_MS)
      assert.deepEqual(errorsOf(), [])
      assert.deepEqual(endingsOf(), [])
    })
  })

  test('stops on reset and destroys cleanly, leaking no native handle', async () => {
    await released({ deadline: Date.now() + DESTROY_MS })
    const harness = await openHarness()
    assert.deepEqual(
      { handles: lifecycleCounts().handles, callbacks: lifecycleCounts().callbacks },
      { handles: 1, callbacks: 1 },
    )
    await harness.playing({ fileId: 't1' })
    await harness.service.reset()
    const heard = harness.events.length
    await harness.waitFor({
      label: 'mpv idle after the reset',
      check: async () => (await harness.mpv.read({ name: 'track-list' })).length === 0,
    })
    const elapsed = await destroyWithin({ harness, ms: DESTROY_MS })
    assert.ok(elapsed < DESTROY_MS)
    assert.equal(harness.events.length, heard, 'events arrived after the reset')
    await released({ deadline: Date.now() + DESTROY_MS })
    assert.deepEqual(await harness.send({ type: 'play' }), {
      ok: false,
      reason: 'refused',
      message: PLAYER_MESSAGES.failed,
    })
  })
})

after(async () => {
  // Every engine above is destroyed; its owner goes once nothing in JavaScript holds it.
  await collectUntil({
    matches: () => {
      const counts = lifecycleCounts()
      return counts.owners === 0 && counts.callbacks === 0 && counts.handles === 0
    },
  })
})
