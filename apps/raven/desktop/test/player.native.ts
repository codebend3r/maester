import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import {
  ADMIN_LOCK_STATES,
  AUTH_HEADERS,
  AUTH_PARAMS,
  AUTH_PATHS,
  isNumber,
  isRecord,
  MEMBER_STATUSES,
  object,
  type OutputSettings,
  PLAYER_COMMANDS,
  PLAYER_ERROR_REASONS,
  PLAYER_EVENTS,
  PLAYER_REFUSAL_REASONS,
  PLAYER_SOURCE_KINDS,
  type PlayerCommand,
  type PlayerEvent,
} from '@raven/core'
import {
  MPV_END_FILE_REASONS,
  MPV_EVENTS,
  MPV_PROPERTIES,
  MPV_TRACK_TYPES,
  type MpvEvent,
  openMpv,
} from '@raven/mpv'
import { CLIP_SECONDS, type Clips, makeClips, makeTrackClip } from '@/e2e/clips'
import {
  AUTH_V1,
  FIXTURE_ACCOUNT,
  FIXTURE_ACCOUNT_KINDS,
  FIXTURE_PUBLISHABLE_KEY,
  GRANT_PARAM,
  GRANTS,
} from '@/e2e/fixtureAuth'
import {
  FIXTURE_ADMIN_KINDS,
  FIXTURE_MEDIA,
  type FixtureAdmin,
  type FixtureMode,
  type FixtureRequest,
  type FixtureServer,
  isRelayed,
  startFixtureServer,
} from '@/e2e/fixtureServer'
import { SERVER_METHODS } from '@/shared/protocol'
import { HTTP_HEADERS } from '@/shared/httpHeaders'
import { createAccountSessions, SIGN_IN_OUTCOMES } from '@/main/accounts/accountSessions'
import { authorizeWith } from '@/main/accounts/accountService'
import { AUTH_STATES, type AuthState } from '@/main/accounts/authConfigs'
import type { SignInConfig } from '@/main/accounts/authEndpoints'
import type { SessionStorage } from '@/main/accounts/sessionStore'
import type { ServerEntry } from '@/main/desktopConfig'
import { addonPathFor } from '@/main/player/engine'
import {
  type AccountRefusalReader,
  createPlayerService,
  type FailureExplainer,
  PLAYER_MESSAGES,
  type LocalSidecar,
  type PlayerOutcome,
  type ResolvedSource,
  resolveSourceWith,
  SIDECAR_BUDGET_MS,
  type ServerTarget,
} from '@/main/player/playerService'
import { tracksFromMpv } from '@/main/player/tracksFromMpv'
import { createAccountTickets } from '@/main/servers/accountTickets'
import { API_PATHS } from '@/main/servers/allowlist'
import {
  createMediaRelay,
  listenOnLoopback,
  RELAY_HOST,
  RELAY_SECRET_BYTES,
} from '@/main/servers/mediaRelay'
import { createServerCalls, fetchThrough, NO_BEARER } from '@/main/servers/serverCalls'
import {
  createServerSources,
  SOURCE_MESSAGES,
  TRACKS_TIMEOUT_MS,
} from '@/main/servers/serverSources'
import { ACCOUNTS_OFF, NO_SERVERS, noExplanation, noRefusedAccount } from '@/main/test/playerFakes'
import { createNodeTimers } from '@/main/timers'

/** The id the server gives a title's first sidecar (Ruling 18). */
const SIDECAR_ID = 'external-0'

const sidecarOfMedia = (mediaId: number) => `/api/media/${mediaId}/subtitles/${SIDECAR_ID}`

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
  local: join(clip.folder, 'Local 01.mkv'),
  bad: join(clip.folder, 'notes.mkv'),
  missing: join(clip.folder, 'Gone 01.mkv'),
  damaged: join(clip.folder, 'Damaged 01.mkv'),
  cut: join(clip.folder, 'Cut 01.mkv'),
} as const
type FileId = keyof typeof paths | Reference
// Beside no clip's name and outside mpv's subtitle search folders, so only `sub-add` can find it.
const LOCAL_SIDECAR: LocalSidecar = {
  path: join(clip.folder, 'vtt', 'English.vtt'),
  title: 'Local English',
  language: 'en',
}
const sidecarsOf = (fileId: string): readonly LocalSidecar[] =>
  fileId === 'local' ? [LOCAL_SIDECAR] : []
const whole = await readFile(clip.path)
await Promise.all([
  copyFile(clip.path, paths.t2),
  copyFile(clip.path, paths.local),
  mkdir(dirname(LOCAL_SIDECAR.path)).then(() =>
    writeFile(LOCAL_SIDECAR.path, 'WEBVTT\n\n00:00.000 --> 00:29.000\nraven local sidecar\n'),
  ),
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

type Servers = Parameters<typeof resolveSourceWith>[0]['servers']

const openHarness = async ({
  servers = NO_SERVERS,
  explain = noExplanation,
  refusedAccount = noRefusedAccount,
  serverStallMs,
}: {
  servers?: Servers
  explain?: FailureExplainer
  refusedAccount?: AccountRefusalReader
  serverStallMs?: number
} = {}) => {
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
      if (event.type !== MPV_EVENTS.property && event.type !== MPV_EVENTS.log) raw.push(event)
      relay.receive(event)
    },
  })
  const service = createPlayerService({
    mpv,
    resolveSource: resolveSourceWith({ grants: { fileOf }, servers, sidecarsOf }),
    explain,
    refusedAccount,
    canChooseAo: false,
    timers: createNodeTimers(),
    ...(serverStallMs === undefined ? {} : { serverStallMs }),
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

  /** As main tears an engine down: the service forgets its timers, then mpv goes. */
  const destroy = () => {
    service.dispose()
    return mpv.destroy()
  }

  return {
    mpv,
    service,
    destroy,
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
    await harness.destroy()
  }
}

const destroyWithin = async ({ harness, ms }: { harness: Harness; ms: number }) => {
  const started = Date.now()
  const outcome = await Promise.race([
    harness.destroy().then(() => 'destroyed' as const),
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
          { id: SIDECAR_ID, source: 'external' },
        ],
      )
      const list = await mpv.read({ name: 'track-list' })
      assert.deepEqual(
        settled,
        tracksFromMpv({ list, frameRate: await mpv.read({ name: 'container-fps' }) }),
      )
      const external = list.find(
        (track) => track.type === MPV_TRACK_TYPES.sub && track.external === true,
      )
      assert.ok(external, 'mpv did not load the sidecar')
      await sendOk({ type: 'subtitle', id: SIDECAR_ID })
      assert.equal(await mpv.read({ name: 'sid' }), external.id)
    })
  })

  test("adds a local file's sidecar by path, titled, and it can be picked", async () => {
    await withHarness(async ({ mpv, events, playing, sendOk }) => {
      await playing({ fileId: 'local' })
      const settled = events.findLast(where({ type: 'tracks' }))?.tracks ?? null
      assert.ok(settled, 'no tracks after the snapshot')
      assert.deepEqual(
        settled.subtitles.map(({ id, source }) => ({ id, source })),
        [
          { id: 'embedded-0', source: 'embedded' },
          { id: 'external-0', source: 'external' },
        ],
      )
      assert.equal(settled.subtitles[1]?.title, LOCAL_SIDECAR.title)
      const list = await mpv.read({ name: 'track-list' })
      const external = list.find((track) => track.type === 'sub' && track.external === true)
      assert.ok(external, 'mpv did not load the local sidecar')
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
      const second = list.filter((track) => track.type === MPV_TRACK_TYPES.audio)[1]
      const subtitle = list.find((track) => track.type === MPV_TRACK_TYPES.sub)
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
        list.filter((track) => track.type === MPV_TRACK_TYPES.audio)[1]?.id ?? null,
      )
      assert.equal(
        await mpv.read({ name: 'sid' }),
        list.find((track) => track.type === MPV_TRACK_TYPES.sub)?.id ?? null,
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
            raw
              .slice(mark)
              .some(
                (event) =>
                  event.type === MPV_EVENTS.endFile && event.reason === MPV_END_FILE_REASONS.error,
              ),
        })
        await sleep(SETTLE_MS)
        const said = raw.slice(mark)
        // `access-references=no`: mpv refuses the reference itself, so nothing expands.
        assert.deepEqual(
          said.filter((event) => event.type === MPV_EVENTS.fileLoaded),
          [],
          `${fileId} opened what it names`,
        )
        assert.deepEqual(
          said.filter(
            (event) =>
              event.type === MPV_EVENTS.endFile && event.reason === MPV_END_FILE_REASONS.redirect,
          ),
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
            (event) =>
              event.type === MPV_EVENTS.endFile && event.reason === MPV_END_FILE_REASONS.error,
          )
          assert.ok(closed >= 0, `mpv never refused the playlist after a ${gap} ms gap`)
          assert.ok(
            said.slice(closed).every((event) => event.type !== MPV_EVENTS.fileLoaded),
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
    // `dispose` latches the service as dead, so nothing is asked of the destroyed mpv.
    assert.deepEqual(await harness.send({ type: 'play' }), {
      ok: false,
      reason: 'engine',
      message: PLAYER_MESSAGES.engineStopped,
    })
  })
})

/** A request a fixture listener heard: its path and the `Cookie` header it carried. */
type Seen = { path: string; cookie: string | null }

const SIDECAR_VTT = 'WEBVTT\n\n00:00.000 --> 00:29.000\nraven server sidecar\n'

/** Serves `bytes` with byte ranges, as raven's media controller does. */
const serveBytes = ({
  request,
  response,
  bytes,
}: {
  request: IncomingMessage
  response: ServerResponse
  bytes: Buffer
}) => {
  const range = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range ?? '')
  if (range === null) {
    response.writeHead(200, {
      [HTTP_HEADERS.contentType]: 'video/x-matroska',
      [HTTP_HEADERS.acceptRanges]: 'bytes',
      [HTTP_HEADERS.contentLength]: bytes.length,
    })
    response.end(bytes)
    return
  }
  const start = Number(range[1] ?? 0)
  const last = range[2] ?? ''
  const end = last === '' ? bytes.length - 1 : Math.min(Number(last), bytes.length - 1)
  if (start >= bytes.length) {
    response.writeHead(416, { 'content-range': `bytes */${bytes.length}` })
    response.end()
    return
  }
  response.writeHead(206, {
    [HTTP_HEADERS.contentType]: 'video/x-matroska',
    [HTTP_HEADERS.acceptRanges]: 'bytes',
    [HTTP_HEADERS.contentRange]: `bytes ${start}-${end}/${bytes.length}`,
    [HTTP_HEADERS.contentLength]: end - start + 1,
  })
  response.end(bytes.subarray(start, end + 1))
}

/** The redirecting title: media 3's file answers 302 to `redirectTo` when one is given. */
const REDIRECTING = 3

/**
 * A stand-in raven server: every `/api/media/<id>/file` is the track clip, its
 * `external-0` sidecar a short WebVTT, and media 3 may redirect to another listener.
 */
const listenFixture = async ({ redirectTo }: { redirectTo: string | null }) => {
  const seen: Seen[] = []
  const fixture = createServer((request, response) => {
    const path = request.url ?? ''
    seen.push({ path, cookie: request.headers.cookie ?? null })
    if (redirectTo !== null && path === `/api/media/${REDIRECTING}/file`) {
      response.writeHead(302, { location: `${redirectTo}${path}` })
      response.end()
      return
    }
    if (/^\/api\/media\/\d+\/file$/u.test(path)) {
      serveBytes({ request, response, bytes: whole })
      return
    }
    if (/^\/api\/media\/\d+\/subtitles\/external-0$/u.test(path)) {
      response.writeHead(200, { 'content-type': 'text/vtt' })
      response.end(SIDECAR_VTT)
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise<void>((resolveListen) => {
    fixture.listen(0, '127.0.0.1', () => resolveListen())
  })
  const bound = fixture.address()
  if (bound === null || typeof bound === 'string') throw new Error('No fixture port')
  return {
    origin: `http://127.0.0.1:${bound.port}`,
    seen,
    close: () =>
      new Promise<void>((resolveClose) => {
        fixture.closeAllConnections()
        fixture.close(() => resolveClose())
      }),
  }
}

const SERVER_IDS = {
  home: '00000000-0000-4000-8000-0000000000a1',
  elsewhere: '00000000-0000-4000-8000-0000000000b2',
} as const

const targetFor = ({
  serverId,
  origin,
  mediaId,
  cookie,
  hasSidecar = false,
}: {
  serverId: string
  origin: string
  mediaId: number
  cookie: string | null
  hasSidecar?: boolean
}): ServerTarget => ({
  kind: 'server',
  serverId,
  mediaId,
  url: `${origin}/api/media/${mediaId}/file`,
  headerFields: cookie === null ? '' : `Cookie: raven_unlock=${cookie}`,
  sidecars: hasSidecar
    ? [
        {
          url: `${origin}/api/media/${mediaId}/subtitles/${SIDECAR_ID}`,
          title: 'English',
          language: 'en',
        },
      ]
    : [],
  relay: null,
})

const serversOf = (targets: readonly ServerTarget[]): Servers => ({
  resolve: async ({ serverId, mediaId }): Promise<ResolvedSource> => {
    const target = targets.find(
      (candidate) => candidate.serverId === serverId && candidate.mediaId === mediaId,
    )
    return target === undefined ? { ok: false, message: 'Unknown title' } : { ok: true, target }
  },
})

const serverLoad = ({ target }: { target: ServerTarget }): PlayerCommand => ({
  type: 'load',
  source: { kind: 'server', serverId: target.serverId, mediaId: target.mediaId },
  start: 0,
  audio: null,
  subtitle: null,
})

/**
 * Two servers, `elsewhere` being where the redirecting title on `home` points, and the
 * titles the tests load from them.
 */
const startServers = async () => {
  const elsewhere = await listenFixture({ redirectTo: null })
  const home = await listenFixture({ redirectTo: elsewhere.origin })
  const titles = {
    home: targetFor({
      serverId: SERVER_IDS.home,
      origin: home.origin,
      mediaId: 1,
      cookie: 'home.secret',
      hasSidecar: true,
    }),
    elsewhere: targetFor({
      serverId: SERVER_IDS.elsewhere,
      origin: elsewhere.origin,
      mediaId: 2,
      cookie: 'elsewhere.secret',
      hasSidecar: true,
    }),
    redirecting: targetFor({
      serverId: SERVER_IDS.home,
      origin: home.origin,
      mediaId: REDIRECTING,
      cookie: 'home.secret',
    }),
    bare: targetFor({
      serverId: SERVER_IDS.elsewhere,
      origin: elsewhere.origin,
      mediaId: 4,
      cookie: null,
    }),
  } as const
  return {
    home,
    elsewhere,
    titles,
    servers: serversOf(Object.values(titles)),
    close: async () => {
      await Promise.all([home.close(), elsewhere.close()])
    },
  }
}
type ServerFixture = Awaited<ReturnType<typeof startServers>>

// Started and closed by the describe that uses it, so its tests also run one at a time.
const serverFixture: { current: ServerFixture | null } = { current: null }

/** Runs `run` on a harness that knows the fixture servers, from fresh request logs. */
const withServers = async ({
  explain = noExplanation,
  run,
}: {
  explain?: FailureExplainer
  run: (input: { harness: Harness; fixture: ServerFixture }) => Promise<void>
}) => {
  const fixture = serverFixture.current
  if (fixture === null) throw new Error('The fixture servers are not running')
  fixture.home.seen.splice(0)
  fixture.elsewhere.seen.splice(0)
  const harness = await openHarness({ servers: fixture.servers, explain })
  try {
    await run({ harness, fixture })
  } finally {
    await harness.destroy()
  }
}

const cookiesSeen = ({ seen }: { seen: readonly Seen[] }) =>
  Array.from(new Set(seen.map(({ cookie }) => cookie)))

const playingServer = ({ harness, target }: { harness: Harness; target: ServerTarget }) =>
  harness.eventAfter({
    label: `${target.url} playing`,
    matches: where({ type: 'paused', holds: (event) => !event.paused }),
    action: () => harness.sendOk(serverLoad({ target })),
  })

describe('server titles against headless libmpv', () => {
  before(async () => {
    serverFixture.current = await startServers()
  })
  after(async () => {
    const fixture = serverFixture.current
    serverFixture.current = null
    if (fixture !== null) await fixture.close()
  })

  test("load A then at once load B: A's origin never sees B's cookie", async () => {
    await withServers({
      run: async ({ harness, fixture }) => {
        await Array.from({ length: 6 }, (_value, index) => index).reduce(async (previous) => {
          await previous
          const heard = fixture.home.seen.length
          await harness.sendOk(serverLoad({ target: fixture.titles.home }))
          // mpv opens a file on its own thread after it takes the loadfile, so a B sent
          // before then replaces A before A asks for anything, leaving nothing to check.
          await harness.waitFor({
            label: 'the first server asked for its title',
            check: async () => fixture.home.seen.length > heard,
          })
          await playingServer({ harness, target: fixture.titles.elsewhere })
          // A's sidecar request may still be in flight as B replaces it.
          await sleep(100)
        }, Promise.resolve())
        await sleep(SETTLE_MS)
        assert.ok(fixture.home.seen.length > 0, 'the first server was never asked for its title')
        assert.deepEqual(cookiesSeen({ seen: fixture.home.seen }), ['raven_unlock=home.secret'])
        assert.deepEqual(cookiesSeen({ seen: fixture.elsewhere.seen }), [
          'raven_unlock=elsewhere.secret',
        ])
        assert.ok(
          fixture.elsewhere.seen.some(
            ({ path }) => path === sidecarOfMedia(fixture.titles.elsewhere.mediaId),
          ),
          "B's sidecar was never fetched",
        )
        assert.deepEqual(harness.errorsOf(), [])
      },
    })
  })

  test('a server file that redirects to another origin is an error, and that origin hears nothing', async () => {
    const asked: Parameters<FailureExplainer>[0][] = []
    await withServers({
      explain: async (input) => {
        asked.push(input)
        return { reason: 'open', message: 'The server sent raven player elsewhere.' }
      },
      run: async ({ harness, fixture }) => {
        const failure = await harness.eventAfter({
          label: 'the redirect refused',
          matches: where({ type: 'error' }),
          action: () => harness.sendOk(serverLoad({ target: fixture.titles.redirecting })),
        })
        assert.deepEqual(failure, {
          type: 'error',
          reason: 'open',
          message: 'The server sent raven player elsewhere.',
        })
        assert.deepEqual(
          asked.map(({ phase }) => phase),
          ['loading'],
        )
        await sleep(SETTLE_MS)
        assert.ok(
          fixture.home.seen.some(({ path }) => path === `/api/media/${REDIRECTING}/file`),
          'the redirecting title was never asked for',
        )
        assert.deepEqual(fixture.elsewhere.seen, [])
      },
    })
  })

  test('a local file, then a title with no cookie, after a server title send no Cookie header', async () => {
    await withServers({
      run: async ({ harness, fixture }) => {
        await playingServer({ harness, target: fixture.titles.home })
        await harness.playing({ fileId: 't1' })
        await sleep(SETTLE_MS)
        const heard = fixture.home.seen.length + fixture.elsewhere.seen.length
        await harness.waitFor({
          label: 'the local file reading on',
          check: async () => ((await harness.mpv.read({ name: 'time-pos' })) ?? 0) > 0.2,
        })
        assert.equal(fixture.home.seen.length + fixture.elsewhere.seen.length, heard)
        await playingServer({ harness, target: fixture.titles.bare })
        await sleep(SETTLE_MS)
        assert.ok(fixture.elsewhere.seen.length > 0, 'the cookie-less title was never asked for')
        assert.deepEqual(cookiesSeen({ seen: fixture.elsewhere.seen }), [null])
        assert.deepEqual(harness.errorsOf(), [])
      },
    })
  })
})

const FIXTURE_PIN = '2468'
const FIXTURE_PASSWORD = 'Fixture-Admin-2026!'
const FIXTURE_SERVER = {
  id: '00000000-0000-4000-8000-0000000000c3',
  name: 'Fixture',
} as const
/** Where the fixture starts to trickle a file: past either clip's first second, short of its end. */
const THROTTLE_SHARE = 0.1
/**
 * A server title's `reconnect_delay_max=3` lets FFmpeg retry a dropped stream after 0, 1
 * and 3 s, so a title whose server went away or restarted stops about 4 s after mpv ran
 * out of what it had (4.5 s measured).
 */
const RECONNECT_DELAYS_MS = 4000
const LOST_BOUND_MS = RECONNECT_DELAYS_MS + 4000
const LOST_WAIT_MS = 10_000
/**
 * A server that accepts and then sends nothing would hold a title for about two minutes
 * of lavf timeouts and reconnects; the service's stall budget stops it first. This suite
 * shortens the budget, and a hung title stops once mpv has played what it had (at most
 * the throttled share of the clip) and then waited the budget.
 */
const STALL_TEST_MS = 3000
const HUNG_BOUND_MS = STALL_TEST_MS + CLIP_SECONDS * THROTTLE_SHARE * 1000 + 3000
/** How far past the budget a title that never opens may stop: the track list and mpv's stop. */
const OPENING_SLACK_MS = 3000
/** How long the throttled clip takes to use up what came at full speed, on a busy runner. */
const DRAIN_WAIT_MS = 20_000
/** How far past a budget a title may start: opening the clip over loopback, on a busy runner. */
const BUDGET_SLACK_MS = 3000

const mp4Clips: { pending: Promise<Clips> | null } = { pending: null }
/** The MP4 clips the fixture serves as its second title, made once by the first fixture. */
const fixtureClips = () => {
  mp4Clips.pending ??= makeClips()
  return mp4Clips.pending
}
after(async () => {
  if (mp4Clips.pending === null) return
  const { folder } = await mp4Clips.pending
  await rm(folder, { recursive: true, force: true })
})

const startFixture = async ({ mode }: { mode: FixtureMode }) => {
  const { first, second } = await fixtureClips()
  return startFixtureServer({ clips: { first, second, tracks: clip.path }, mode })
}

type Jar = readonly { name: string; value: string }[]

/** The account parts of server sources: what a server's accounts are, its tickets and its relay. */
type AccountDeps = Pick<
  Parameters<typeof createServerSources>[0],
  'authConfigs' | 'tickets' | 'relay' | 'accountChanged'
>

/** The `name=value` of each `Set-Cookie`, as a session would keep them. */
const cookiesFrom = (response: Response): Jar =>
  response.headers.getSetCookie().flatMap((line) => {
    const [pair = ''] = line.split(';')
    const split = pair.indexOf('=')
    if (split <= 0) return []
    return [{ name: pair.slice(0, split).trim(), value: pair.slice(split + 1).trim() }]
  })

const unlockWith = async ({
  fixture,
  path,
  body,
}: {
  fixture: FixtureServer
  path: string
  body: Record<string, string>
}): Promise<Jar> => {
  const response = await fetch(`${fixture.origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  assert.equal(response.status, 200, `${path} answered ${response.status}`)
  return cookiesFrom(response)
}

const unlockPin = ({ fixture }: { fixture: FixtureServer }) =>
  unlockWith({ fixture, path: '/api/lock/unlock', body: { pin: FIXTURE_PIN } })

/**
 * The server sources main builds, over the fixture: `jar` stands in for the server's
 * session, which sends its cookies with main's own calls and hands them to `cookiesFor`.
 */
const sourcesFor = ({
  fixture,
  jar,
  accounts = ACCOUNTS_OFF,
}: {
  fixture: FixtureServer
  jar: Jar
  accounts?: AccountDeps
}) => {
  const warnings: string[] = []
  const entry: ServerEntry = { ...FIXTURE_SERVER, origin: fixture.origin, addedAt: 0, signIn: null }
  const serverOf = (serverId: string) => (serverId === entry.id ? entry : null)
  const warn = (message: string) => {
    warnings.push(message)
  }
  const sent = jar.map(({ name, value }) => `${name}=${value}`).join('; ')
  const calls = createServerCalls({
    serverOf,
    fetchFor: () =>
      fetchThrough((url, init) => {
        const headers = new Headers(init.headers)
        if (sent !== '') headers.set('cookie', sent)
        return fetch(url, { ...init, headers })
      }),
    ...NO_BEARER,
    warn,
  })
  return {
    sources: createServerSources({
      serverOf,
      cookiesFor: async () => jar,
      calls,
      ...accounts,
      warn,
    }),
    warnings,
  }
}

type Asked = Parameters<FailureExplainer>[0]

/** Runs `run` on a harness whose server titles resolve and explain through the fixture. */
const withFixtureTitles = async ({
  fixture,
  jar,
  accounts,
  serverStallMs,
  run,
}: {
  fixture: FixtureServer
  jar: Jar
  accounts?: AccountDeps
  serverStallMs?: number
  run: (input: {
    harness: Harness
    asked: readonly Asked[]
    sourceWarnings: readonly string[]
  }) => Promise<void>
}) => {
  const asked: Asked[] = []
  const { sources, warnings: sourceWarnings } = sourcesFor({ fixture, jar, accounts })
  const harness = await openHarness({
    servers: sources,
    explain: async (input) => {
      asked.push(input)
      return sources.explain(input)
    },
    serverStallMs,
  })
  try {
    await run({ harness, asked, sourceWarnings })
  } finally {
    await harness.destroy()
  }
}

const titleLoad = ({
  mediaId,
  subtitle = null,
}: {
  mediaId: number
  subtitle?: string | null
}): PlayerCommand => ({
  type: 'load',
  source: { kind: 'server', serverId: FIXTURE_SERVER.id, mediaId },
  start: 0,
  audio: null,
  subtitle,
})

const playingTitle = ({
  harness,
  mediaId,
  subtitle = null,
  timeoutMs = WAIT_MS,
}: {
  harness: Harness
  mediaId: number
  subtitle?: string | null
  timeoutMs?: number
}) =>
  harness.eventAfter({
    label: `media ${mediaId} playing`,
    matches: where({ type: 'paused', holds: (event) => !event.paused }),
    action: () => harness.sendOk(titleLoad({ mediaId, subtitle })),
    timeoutMs,
  })

const requestsTo = ({
  log,
  path,
  from = 0,
}: {
  log: readonly FixtureRequest[]
  path: string
  from?: number
}) => log.slice(from).filter((request) => request.path === path)

const fileOfMedia = (mediaId: number) => `/api/media/${mediaId}/file`
const SIDECAR_PATH = sidecarOfMedia(FIXTURE_MEDIA.first)

/** The first byte a `Range: bytes=<n>-` header asks for, or null for a whole file. */
const rangeStart = (range: string | null) => {
  const match = /^bytes=(\d+)-/u.exec(range ?? '')
  return match === null ? null : Number(match[1])
}

const externalTrackId = async ({ harness }: { harness: Harness }) =>
  (await harness.mpv.read({ name: 'track-list' })).find(
    (track) => track.type === MPV_TRACK_TYPES.sub && track.external === true,
  )?.id ?? null

/**
 * Plays a title until mpv has read what the throttle lets through and waits on the rest,
 * and answers the byte the fixture holds it at.
 */
const playingUpToThrottle = async ({
  harness,
  fixture,
  mediaId,
}: {
  harness: Harness
  fixture: FixtureServer
  mediaId: number
}) => {
  const path = mediaId === FIXTURE_MEDIA.second ? (await fixtureClips()).second : clip.path
  const held = Math.floor((await stat(path)).size * THROTTLE_SHARE)
  fixture.throttle({ byte: held })
  await playingTitle({ harness, mediaId })
  await harness.nextEvent({
    label: 'the clock moving past a second',
    matches: where({ type: 'time', holds: (event) => event.time >= 1 }),
  })
  return held
}

/**
 * Plays the track clip until mpv has used up what the throttle let through and waits on
 * the trickle, then runs `action` and answers the error that follows and how long after
 * `action` it came, so a test can pin how long the page waits.
 */
const failingWhenDrained = async ({
  harness,
  fixture,
  label,
  action,
  timeoutMs,
}: {
  harness: Harness
  fixture: FixtureServer
  label: string
  action: () => Promise<void>
  timeoutMs: number
}) => {
  await playingUpToThrottle({ harness, fixture, mediaId: FIXTURE_MEDIA.first })
  await harness.waitFor({
    label: 'mpv waiting on the trickle',
    check: async () => (await harness.mpv.read({ name: 'paused-for-cache' })) === true,
    deadline: Date.now() + DRAIN_WAIT_MS,
  })
  const started = Date.now()
  const failure = await harness.eventAfter({
    label,
    matches: where({ type: 'error' }),
    action,
    timeoutMs,
  })
  return { failure, elapsed: Date.now() - started }
}

describe('server titles from a raven fixture server', () => {
  const holder: { fixture: FixtureServer | null } = { fixture: null }
  const fixtureNow = () => {
    if (holder.fixture === null) throw new Error('The fixture server is not running')
    return holder.fixture
  }
  before(async () => {
    holder.fixture = await startFixture({
      mode: { pin: FIXTURE_PIN, isLocked: true, admin: { kind: 'off' } },
    })
  })
  after(async () => {
    const fixture = holder.fixture
    holder.fixture = null
    if (fixture !== null) await fixture.close()
  })

  test('plays a server title with its unlock cookie on every file request', async () => {
    const fixture = fixtureNow()
    const jar = await unlockPin({ fixture })
    await withFixtureTitles({
      fixture,
      jar,
      run: async ({ harness }) => {
        const mark = fixture.requests.length
        await playingTitle({ harness, mediaId: FIXTURE_MEDIA.first })
        const files = requestsTo({
          log: fixture.requests,
          path: fileOfMedia(FIXTURE_MEDIA.first),
          from: mark,
        })
        assert.ok(files.length > 0, 'mpv never asked for the file')
        assert.ok(
          files.every(({ hasUnlock }) => hasUnlock),
          'a file request went without the unlock cookie',
        )
        assert.ok(
          files.some(({ range }) => range !== null),
          'mpv never asked for a byte range',
        )
        assert.ok(
          files.every(({ hasOtherCookie, hasAdmin }) => !hasOtherCookie && !hasAdmin),
          'a file request carried a cookie the session does not hold',
        )
        assert.deepEqual(harness.errorsOf(), [])
      },
    })
  })

  test("adds the server's sidecar through the same cookie, and it can be picked", async () => {
    const fixture = fixtureNow()
    const jar = await unlockPin({ fixture })
    await withFixtureTitles({
      fixture,
      jar,
      run: async ({ harness }) => {
        const mark = fixture.requests.length
        await playingTitle({ harness, mediaId: FIXTURE_MEDIA.first })
        // The first snapshot waits for the sidecar, so its tracks already hold it.
        const settled = harness.events.findLast(where({ type: 'tracks' }))?.tracks ?? null
        assert.ok(settled, 'no tracks after the snapshot')
        assert.deepEqual(
          settled.subtitles.map(({ id, source, language }) => ({ id, source, language })),
          [
            { id: 'embedded-0', source: 'embedded', language: 'en' },
            { id: SIDECAR_ID, source: 'external', language: 'en' },
          ],
        )
        assert.deepEqual(
          settled,
          tracksFromMpv({
            list: await harness.mpv.read({ name: 'track-list' }),
            frameRate: await harness.mpv.read({ name: 'container-fps' }),
          }),
        )
        const sidecars = requestsTo({ log: fixture.requests, path: SIDECAR_PATH, from: mark })
        assert.ok(sidecars.length > 0, 'mpv never asked for the sidecar')
        assert.ok(
          sidecars.every(({ method, hasUnlock }) => method === SERVER_METHODS.get && hasUnlock),
          'the sidecar request went without the unlock cookie',
        )
        const external = await externalTrackId({ harness })
        assert.ok(external !== null, 'mpv did not list the sidecar')
        await harness.sendOk({ type: 'subtitle', id: SIDECAR_ID })
        assert.equal(await harness.mpv.read({ name: 'sid' }), external)
      },
    })
  })

  test('a title the server refuses is an open error the source explains', async () => {
    const fixture = fixtureNow()
    await withFixtureTitles({
      fixture,
      jar: [],
      run: async ({ harness, asked, sourceWarnings }) => {
        const mark = fixture.requests.length
        const failure = await harness.eventAfter({
          label: 'the locked title refused',
          matches: where({ type: 'error' }),
          action: () => harness.sendOk(titleLoad({ mediaId: FIXTURE_MEDIA.first })),
        })
        assert.deepEqual(failure, {
          type: 'error',
          reason: 'locked',
          message: SOURCE_MESSAGES.relocked(FIXTURE_SERVER.name),
        })
        assert.deepEqual(
          asked.map(({ phase }) => phase),
          ['loading'],
        )
        const files = requestsTo({
          log: fixture.requests,
          path: fileOfMedia(FIXTURE_MEDIA.first),
          from: mark,
        })
        assert.ok(files.length > 0, 'mpv never asked for the file')
        assert.ok(files.every(({ hasUnlock }) => !hasUnlock))
        assert.deepEqual(
          sourceWarnings.filter((warning) => warning.includes('its tracks answered 423')),
          [`no sidecars from ${FIXTURE_SERVER.name}: its tracks answered 423`],
        )
        assert.deepEqual(
          harness.raw.filter((event) => event.type === MPV_EVENTS.fileLoaded),
          [],
          'mpv opened the locked title',
        )
      },
    })
  })

  test('a title that is not on the server is an open error that says it is gone', async () => {
    const fixture = fixtureNow()
    const jar = await unlockPin({ fixture })
    await withFixtureTitles({
      fixture,
      jar,
      run: async ({ harness, asked }) => {
        const failure = await harness.eventAfter({
          label: 'the missing title refused',
          matches: where({ type: 'error' }),
          action: () => harness.sendOk(titleLoad({ mediaId: 9 })),
        })
        assert.deepEqual(failure, {
          type: 'error',
          reason: 'open',
          message: SOURCE_MESSAGES.gone(FIXTURE_SERVER.name),
        })
        assert.deepEqual(
          asked.map(({ phase }) => phase),
          ['loading'],
        )
      },
    })
  })

  test('an HTML page where the file should be is an open error, not a playlist', async () => {
    const fixture = fixtureNow()
    const jar = await unlockPin({ fixture })
    await withFixtureTitles({
      fixture,
      jar,
      run: async ({ harness, asked }) => {
        const failure = await harness.eventAfter({
          label: 'the page refused',
          matches: where({ type: 'error' }),
          action: () => harness.sendOk(titleLoad({ mediaId: FIXTURE_MEDIA.page })),
        })
        assert.deepEqual(failure, {
          type: 'error',
          reason: 'open',
          message: SOURCE_MESSAGES.cannotOpen(FIXTURE_SERVER.name),
        })
        assert.deepEqual(
          asked.map(({ phase }) => phase),
          ['loading'],
        )
        assert.deepEqual(
          harness.raw.filter((event) => event.type === MPV_EVENTS.fileLoaded),
          [],
          'mpv opened the page',
        )
      },
    })
  })

  test('a title that redirects is an open error, and the place it points hears nothing', async () => {
    const fixture = fixtureNow()
    const jar = await unlockPin({ fixture })
    const elsewhere = fixture.elsewhere.requests.length
    await withFixtureTitles({
      fixture,
      jar,
      run: async ({ harness, asked }) => {
        const mark = fixture.requests.length
        const failure = await harness.eventAfter({
          label: 'the redirect refused',
          matches: where({ type: 'error' }),
          action: () => harness.sendOk(titleLoad({ mediaId: FIXTURE_MEDIA.redirecting })),
        })
        assert.deepEqual(failure, {
          type: 'error',
          reason: 'open',
          message: SOURCE_MESSAGES.cannotOpen(FIXTURE_SERVER.name),
        })
        assert.deepEqual(
          asked.map(({ phase }) => phase),
          ['loading'],
        )
        await sleep(SETTLE_MS)
        assert.ok(
          requestsTo({
            log: fixture.requests,
            path: fileOfMedia(FIXTURE_MEDIA.redirecting),
            from: mark,
          }).some(({ hasUnlock }) => hasUnlock),
          'the redirecting title was never asked for',
        )
        assert.deepEqual(fixture.elsewhere.requests.slice(elsewhere), [])
      },
    })
  })

  test('reads a server title ahead into the cache while it is paused', async () => {
    const fixture = fixtureNow()
    const jar = await unlockPin({ fixture })
    await withFixtureTitles({
      fixture,
      jar,
      run: async ({ harness }) => {
        await playingTitle({ harness, mediaId: FIXTURE_MEDIA.first })
        await harness.sendOk({ type: 'pause' })
        const paused = (await harness.mpv.read({ name: 'time-pos' })) ?? Number.NaN
        // The addon's own cache options, which a server title runs under too.
        assert.equal(await harness.mpv.read({ name: 'options/cache' }), true)
        assert.equal(await harness.mpv.read({ name: 'options/demuxer-max-bytes' }), 1_073_741_824)
        assert.equal(
          await harness.mpv.read({ name: 'options/demuxer-max-back-bytes' }),
          268_435_456,
        )
        // mpv's own read-ahead without the cache is a second; the cache holds the whole clip.
        // Any range heard so far counts, the snapshot's included.
        await harness.waitFor({
          label: `the cache running from ${paused} to the end of the clip`,
          check: async () =>
            harness.events
              .filter(where({ type: 'buffered' }))
              .some((event) => event.ranges.some(({ start, end }) => start <= paused && end >= 29)),
        })
      },
    })
  })

  test('removing the server stops its title and says only that the server is gone', async () => {
    const fixture = fixtureNow()
    const jar = await unlockPin({ fixture })
    await withFixtureTitles({
      fixture,
      jar,
      run: async ({ harness }) => {
        await playingTitle({ harness, mediaId: FIXTURE_MEDIA.first })
        const heard = harness.events.length
        await harness.service.resetIfServer(FIXTURE_SERVER.id)
        await harness.waitFor({
          label: 'mpv idle after the removal',
          check: async () => (await harness.mpv.read({ name: 'track-list' })).length === 0,
        })
        await sleep(SETTLE_MS)
        // Only the service's own word: nothing mpv's stop could be mistaken for.
        assert.deepEqual(
          harness.events.slice(heard),
          [{ type: 'error', reason: 'open', message: PLAYER_MESSAGES.serverGone }],
          'the page heard more than that the server is gone',
        )
      },
    })
  })
})

describe('a slow raven fixture server', () => {
  const holder: { fixture: FixtureServer | null } = { fixture: null }
  const fixtureNow = () => {
    if (holder.fixture === null) throw new Error('The fixture server is not running')
    return holder.fixture
  }
  before(async () => {
    holder.fixture = await startFixture({
      mode: { pin: FIXTURE_PIN, isLocked: true, admin: { kind: 'off' } },
    })
  })
  after(async () => {
    const fixture = holder.fixture
    holder.fixture = null
    if (fixture !== null) await fixture.close()
  })

  test('seeks past what has arrived with a byte range from there', async () => {
    const fixture = fixtureNow()
    const jar = await unlockPin({ fixture })
    try {
      await withFixtureTitles({
        fixture,
        jar,
        run: async ({ harness }) => {
          // The MP4: the track clip's embedded subtitle spans the whole clip, so mpv seeks
          // back to its first cluster to show it, through the bytes the fixture holds.
          const held = await playingUpToThrottle({
            harness,
            fixture,
            mediaId: FIXTURE_MEDIA.second,
          })
          const mark = fixture.requests.length
          await harness.eventAfter({
            label: 'time near 25',
            matches: where({
              type: 'time',
              holds: (event) => near({ value: event.time, target: 25, within: 1 }),
            }),
            action: () => harness.sendOk({ type: 'seek', time: 25 }),
          })
          const ranged = requestsTo({
            log: fixture.requests,
            path: fileOfMedia(FIXTURE_MEDIA.second),
            from: mark,
          })
          assert.ok(
            ranged.some(({ range, hasUnlock }) => hasUnlock && (rangeStart(range) ?? 0) > held),
            `no range past byte ${held}: ${JSON.stringify(ranged.map(({ range }) => range))}`,
          )
          assert.deepEqual(harness.errorsOf(), [])
        },
      })
    } finally {
      fixture.throttle({ byte: null })
    }
  })

  test('a server restart mid-film is a lock the page can answer', async () => {
    const fixture = fixtureNow()
    const jar = await unlockPin({ fixture })
    try {
      await withFixtureTitles({
        fixture,
        jar,
        run: async ({ harness, asked }) => {
          const { failure, elapsed } = await failingWhenDrained({
            harness,
            fixture,
            label: 'the relocked title stopping',
            action: async () => {
              fixture.relock()
              fixture.disconnect()
            },
            timeoutMs: LOST_WAIT_MS,
          })
          assert.ok(elapsed < LOST_BOUND_MS, `the relocked title stopped after ${elapsed} ms`)
          assert.deepEqual(failure, {
            type: 'error',
            reason: 'locked',
            message: SOURCE_MESSAGES.relocked(FIXTURE_SERVER.name),
          })
          assert.deepEqual(
            asked.map(({ phase }) => phase),
            ['loaded'],
          )
          assert.deepEqual(harness.endingsOf(), [])
        },
      })
    } finally {
      fixture.throttle({ byte: null })
    }
  })

  test('a slow track list holds the title no longer than its budget', async () => {
    const fixture = fixtureNow()
    const jar = await unlockPin({ fixture })
    const release = fixture.stall({ path: /\/tracks$/u })
    try {
      await withFixtureTitles({
        fixture,
        jar,
        run: async ({ harness, sourceWarnings }) => {
          const mark = fixture.requests.length
          const started = Date.now()
          await playingTitle({ harness, mediaId: FIXTURE_MEDIA.first })
          const elapsed = Date.now() - started
          assert.ok(elapsed >= TRACKS_TIMEOUT_MS, `played after ${elapsed} ms`)
          assert.ok(elapsed < TRACKS_TIMEOUT_MS + BUDGET_SLACK_MS, `played after ${elapsed} ms`)
          assert.deepEqual(
            (harness.events.findLast(where({ type: 'tracks' }))?.tracks.subtitles ?? []).map(
              ({ id }) => id,
            ),
            ['embedded-0'],
          )
          assert.ok(
            sourceWarnings.includes(
              `no sidecars from ${FIXTURE_SERVER.name}: its tracks did not answer in time`,
            ),
            JSON.stringify(sourceWarnings),
          )
          assert.deepEqual(
            requestsTo({ log: fixture.requests, path: SIDECAR_PATH, from: mark }),
            [],
          )
          assert.deepEqual(harness.errorsOf(), [])
        },
      })
    } finally {
      release()
    }
  })

  test('a slow sidecar starts the title without it, then selects it as it lands', async () => {
    const fixture = fixtureNow()
    const jar = await unlockPin({ fixture })
    const release = fixture.stall({ path: /\/subtitles\/external-0$/u })
    try {
      await withFixtureTitles({
        fixture,
        jar,
        run: async ({ harness }) => {
          const started = Date.now()
          await playingTitle({
            harness,
            mediaId: FIXTURE_MEDIA.first,
            subtitle: SIDECAR_ID,
            timeoutMs: SIDECAR_BUDGET_MS + WAIT_MS,
          })
          const elapsed = Date.now() - started
          assert.ok(elapsed >= SIDECAR_BUDGET_MS, `played after ${elapsed} ms`)
          assert.ok(elapsed < SIDECAR_BUDGET_MS + BUDGET_SLACK_MS, `played after ${elapsed} ms`)
          assert.deepEqual(
            (harness.events.findLast(where({ type: 'tracks' }))?.tracks.subtitles ?? []).map(
              ({ id }) => id,
            ),
            ['embedded-0'],
          )
          assert.ok(
            harness.warnings.includes('server sidecars are slow; the title starts without them'),
          )
          assert.equal(await harness.mpv.read({ name: 'sid' }), false)
          const landed = harness.nextEvent({
            label: 'the late sidecar listed',
            matches: where({
              type: 'tracks',
              holds: (event) => event.tracks.subtitles.some(({ id }) => id === SIDECAR_ID),
            }),
          })
          release()
          await landed
          await harness.waitFor({
            label: 'the late sidecar selected',
            check: async () => {
              const external = await externalTrackId({ harness })
              return external !== null && (await harness.mpv.read({ name: 'sid' })) === external
            },
          })
        },
      })
    } finally {
      release()
    }
  })

  test('a load still resolving when its server goes is refused and fetches nothing', async () => {
    const fixture = fixtureNow()
    const jar = await unlockPin({ fixture })
    const release = fixture.stall({ path: /\/tracks$/u })
    try {
      await withFixtureTitles({
        fixture,
        jar,
        run: async ({ harness }) => {
          const mark = fixture.requests.length
          const outcome = harness.send(titleLoad({ mediaId: FIXTURE_MEDIA.first }))
          await harness.waitFor({
            label: 'the track list asked for',
            check: async () =>
              requestsTo({
                log: fixture.requests,
                path: `/api/media/${FIXTURE_MEDIA.first}/tracks`,
                from: mark,
              }).length > 0,
          })
          await harness.service.resetIfServer(FIXTURE_SERVER.id)
          release()
          assert.deepEqual(await outcome, {
            ok: false,
            reason: 'refused',
            message: PLAYER_MESSAGES.serverGone,
          })
          await sleep(SETTLE_MS)
          assert.deepEqual(
            requestsTo({
              log: fixture.requests,
              path: fileOfMedia(FIXTURE_MEDIA.first),
              from: mark,
            }),
            [],
          )
          assert.deepEqual(harness.events, [])
        },
      })
    } finally {
      release()
    }
  })
})

const ACCOUNT_SERVER = {
  id: '00000000-0000-4000-8000-0000000000d4',
  name: 'Accounts',
} as const
/** The real server's ticket life. */
const ACCOUNT_TICKET_MS = 300_000
/** Shorter than Supabase's hour, so the film of seeks below outlives the first JWT. */
const ACCOUNT_JWT_SECONDS = 1800
/** Past a ticket's life, and past the four minutes raven player reuses one for. */
const TICKET_STEP_MS = 310_000
/**
 * Where the seeks land, latest first, so each lands where mpv has read nothing yet. Six steps
 * past a ticket's life are half an hour on the clock, past the JWT's end.
 */
const SEEK_TARGETS = [27, 23, 19, 15, 11, 7] as const
/** What the fixture sends at full speed before it trickles: several seconds of the track clip. */
const BUFFER_SHARE = 0.3
/** `eyJ`, the base64url of `{"`, opens every JWT. */
const JWT_HEAD = 'eyJ'
/** Long enough for a request mpv still had to make to reach the relay. */
const QUIET_MS = 1500
const REFRESH_PATH = `${AUTH_V1.token}?${GRANT_PARAM}=${GRANTS.refresh}`
const ACCOUNT_TICKET_PATH = AUTH_PATHS.ticket.replace(
  `:${AUTH_PARAMS.id}`,
  String(FIXTURE_MEDIA.first),
)

/** The clock the fixture and raven player's account parts share, which a test moves on. */
type Clock = { skewMs: number }

const startAccountFixture = async ({
  clock,
  admin = { kind: FIXTURE_ADMIN_KINDS.off },
}: {
  clock: Clock
  admin?: FixtureAdmin
}) => {
  const { first, second } = await fixtureClips()
  return startFixtureServer({
    clips: { first, second, tracks: clip.path },
    mode: {
      pin: FIXTURE_PIN,
      isLocked: true,
      admin,
      accounts: {
        kind: FIXTURE_ACCOUNT_KINDS.ready,
        status: MEMBER_STATUSES.approved,
        ticketMs: ACCOUNT_TICKET_MS,
        jwtSeconds: ACCOUNT_JWT_SECONDS,
      },
    },
    now: () => Date.now() + clock.skewMs,
  })
}

/**
 * The account parts main builds for a server whose accounts are ready, over the fixture: auth-js
 * signed in at the fixture's stub Auth, the Bearer on main's calls, the tickets and the loopback
 * relay, all on `clock`. `jar` stands in for the server's session, which holds the PIN's cookie.
 */
const accountPartsFor = async ({
  fixture,
  jar,
  clock,
}: {
  fixture: FixtureServer
  jar: Jar
  clock: Clock
}) => {
  const warnings: string[] = []
  const warn = (message: string) => {
    warnings.push(message)
  }
  const now = () => Date.now() + clock.skewMs
  const signIn: SignInConfig = {
    supabaseUrl: fixture.origin,
    publishableKey: FIXTURE_PUBLISHABLE_KEY,
    webUrl: fixture.origin,
  }
  const entry: ServerEntry = { ...ACCOUNT_SERVER, origin: fixture.origin, addedAt: 0, signIn }
  const serverOf = (serverId: string) => (serverId === entry.id ? entry : null)
  const authConfigs = {
    stateOf: async (): Promise<AuthState> => ({ kind: AUTH_STATES.ready, signIn }),
    readyOf: () => signIn,
  }
  // auth-js's storage, in memory, as `RAVEN_DESKTOP_SAFE_STORAGE=off` keeps it.
  const kept: { items: ReadonlyMap<string, string> } = { items: new Map() }
  const storage: SessionStorage = {
    getItem: async (key) => kept.items.get(key) ?? null,
    setItem: async (key, value) => {
      kept.items = new Map([...kept.items, [key, value]])
    },
    removeItem: async (key) => {
      kept.items = new Map([...kept.items].filter(([name]) => name !== key))
    },
  }
  const sessions = createAccountSessions({
    storageFor: () => storage,
    configOf: authConfigs.readyOf,
    fetch: ({ url, init }) => fetch(url, init),
    now,
    timers: createNodeTimers(),
    onEnded: () => undefined,
    warn,
  })
  const sent = jar.map(({ name, value }) => `${name}=${value}`).join('; ')
  const calls = createServerCalls({
    serverOf,
    fetchFor: () =>
      fetchThrough((url, init) => {
        const headers = new Headers(init.headers)
        if (sent !== '') headers.set(AUTH_HEADERS.cookie, sent)
        return fetch(url, { ...init, headers })
      }),
    authorize: authorizeWith({ authConfigs, sessions }),
    refresh: ({ serverId }) => sessions.refresh(serverId),
    onRefusal: () => undefined,
    hasAccounts: () => true,
    warn,
  })
  const tickets = createAccountTickets({ calls, sessions, now })
  // Every request the relay heard, as mpv sent it, and the listener, to close after.
  const heard: string[] = []
  const listeners: Server[] = []
  // The servers whose account the relay or the sources asked main to read again.
  const changed: string[] = []
  const relay = createMediaRelay({
    listen: listenOnLoopback({
      createServer: (handler) => {
        const listener = createServer((request, response) => {
          heard.push(`${request.method ?? ''} ${request.url ?? ''}`)
          handler(request, response)
        })
        listeners.push(listener)
        return listener
      },
      warn,
    }),
    fetchUpstream: ({ url, method, headers, signal }) =>
      fetch(url, { method, headers, signal, redirect: 'error', cache: 'no-store' }),
    tickets,
    newSecret: (bytes) => randomBytes(bytes).toString('base64url'),
    accountChanged: async ({ serverId }) => {
      changed.push(serverId)
    },
    warn,
  })
  const sources = createServerSources({
    serverOf,
    cookiesFor: async () => jar,
    calls,
    authConfigs,
    tickets,
    relay,
    accountChanged: async (serverId) => {
      changed.push(serverId)
    },
    warn,
  })
  const outcome = await sessions.signIn({
    serverId: entry.id,
    email: FIXTURE_ACCOUNT.email,
    password: FIXTURE_ACCOUNT.password,
    config: signIn,
  })
  assert.equal(outcome.kind, SIGN_IN_OUTCOMES.signedIn, 'the fixture did not sign the account in')
  const close = async () => {
    relay.closeAll()
    await Promise.all(
      listeners.map(
        (listener) =>
          new Promise<void>((resolveClose) => {
            listener.closeAllConnections()
            listener.close(() => resolveClose())
          }),
      ),
    )
  }
  return { sources, relay, heard, changed, warnings, close }
}

type AccountParts = Awaited<ReturnType<typeof accountPartsFor>>

/**
 * Runs `run` on a harness whose server titles resolve, explain and read their refusals through
 * the account parts, and answers the targets each load resolved to, the relay's URLs included.
 */
const withAccountTitles = async ({
  fixture,
  jar,
  clock,
  run,
}: {
  fixture: FixtureServer
  jar: Jar
  clock: Clock
  run: (input: {
    harness: Harness
    parts: AccountParts
    targets: readonly ServerTarget[]
  }) => Promise<void>
}) => {
  const parts = await accountPartsFor({ fixture, jar, clock })
  const targets: ServerTarget[] = []
  const harness = await openHarness({
    servers: {
      resolve: async (source) => {
        const resolved = await parts.sources.resolve(source)
        if (resolved.ok && resolved.target.kind === PLAYER_SOURCE_KINDS.server) {
          targets.push(resolved.target)
        }
        return resolved
      },
    },
    explain: parts.sources.explain,
    refusedAccount: parts.sources.refusedAccount,
  })
  try {
    await run({ harness, parts, targets })
  } finally {
    await harness.destroy()
    await parts.close()
  }
}

const accountLoad = ({ mediaId }: { mediaId: number }): PlayerCommand => ({
  type: PLAYER_COMMANDS.load,
  source: { kind: PLAYER_SOURCE_KINDS.server, serverId: ACCOUNT_SERVER.id, mediaId },
  start: 0,
  audio: null,
  subtitle: null,
})

const playingAccountTitle = ({ harness }: { harness: Harness }) =>
  harness.eventAfter({
    label: 'the account title playing',
    matches: where({ type: PLAYER_EVENTS.paused, holds: (event) => !event.paused }),
    action: () => harness.sendOk(accountLoad({ mediaId: FIXTURE_MEDIA.first })),
  })

/** The secret of a relayed load, the path segment its file URL opens with. */
const secretOf = (target: ServerTarget | undefined) =>
  new URL(target?.url ?? `http://${RELAY_HOST}/`).pathname.split('/')[1] ?? ''

/** Holds the track clip at a share of its bytes, so mpv reads only what a seek asks for past it. */
const throttleClip = async ({ fixture }: { fixture: FixtureServer }) => {
  const { size } = await stat(clip.path)
  fixture.throttle({ byte: Math.floor(size * THROTTLE_SHARE) })
}

const timeOf = async ({ harness }: { harness: Harness }) =>
  (await harness.mpv.read({ name: MPV_PROPERTIES.timePos })) ?? Number.NaN

describe('account titles through the relay against headless libmpv', () => {
  test('seeks past many ticket lives and a JWT refresh, plays on, and reads the sidecar once', async () => {
    const clock: Clock = { skewMs: 0 }
    const fixture = await startAccountFixture({ clock })
    try {
      const jar = await unlockPin({ fixture })
      await withAccountTitles({
        fixture,
        jar,
        clock,
        run: async ({ harness, parts, targets }) => {
          await throttleClip({ fixture })
          const from = fixture.requests.length
          await playingAccountTitle({ harness })
          await harness.sendOk({ type: PLAYER_COMMANDS.pause })
          await SEEK_TARGETS.reduce(async (previous, target) => {
            await previous
            clock.skewMs += TICKET_STEP_MS
            const mark = fixture.requests.length
            await harness.sendOk({ type: PLAYER_COMMANDS.seek, time: target })
            await harness.waitFor({
              label: `the clock at ${target}`,
              check: async () => near({ value: await timeOf({ harness }), target, within: 1 }),
            })
            await harness.waitFor({
              label: `a request for the stretch at ${target}`,
              check: async () =>
                requestsTo({
                  log: fixture.requests,
                  path: fileOfMedia(FIXTURE_MEDIA.first),
                  from: mark,
                }).length > 0,
            })
          }, Promise.resolve())
          fixture.throttle({ byte: null })
          const last = SEEK_TARGETS.at(-1) ?? 0
          await harness.eventAfter({
            label: 'the clock moving on after the last seek',
            matches: where({ type: PLAYER_EVENTS.time, holds: (event) => event.time >= last + 1 }),
            action: () => harness.sendOk({ type: PLAYER_COMMANDS.play }),
          })

          const played = fixture.requests.slice(from)
          const files = requestsTo({ log: played, path: fileOfMedia(FIXTURE_MEDIA.first) })
          assert.ok(files.length > SEEK_TARGETS.length, 'mpv made a request for fewer seeks')
          assert.ok(files.every(isRelayed), 'a file request went without its ticket alone')
          const mints = played.filter(
            ({ method, path }) => method === SERVER_METHODS.post && path === ACCOUNT_TICKET_PATH,
          )
          assert.ok(
            mints.length > SEEK_TARGETS.length,
            `only ${mints.length} tickets for the seeks`,
          )
          assert.ok(
            mints.every(({ hasBearer }) => hasBearer),
            'a ticket was asked for without the Bearer',
          )
          assert.ok(
            played.some(
              ({ method, path }) => method === SERVER_METHODS.post && path === REFRESH_PATH,
            ),
            'the JWT was never refreshed',
          )
          const sidecars = requestsTo({ log: played, path: SIDECAR_PATH })
          assert.equal(sidecars.length, 1, 'mpv read the sidecar more than once')
          assert.ok(sidecars.every(isRelayed), 'the sidecar went without its ticket alone')
          assert.deepEqual(harness.errorsOf(), [])
          assert.deepEqual(parts.changed, [])
          const secret = secretOf(targets.at(0))
          assert.equal(
            secret.length,
            Buffer.alloc(RELAY_SECRET_BYTES).toString('base64url').length,
            'the title did not go through the relay',
          )
          const tokens = fixture.issuedTokens()
          assert.ok(tokens.length > SEEK_TARGETS.length, 'the fixture issued too few tokens')
          const unsaid = [secret, RELAY_HOST, JWT_HEAD, ...tokens]
          assert.deepEqual(
            [...harness.warnings, ...parts.warnings].filter((warning) =>
              unsaid.some((secretText) => warning.includes(secretText)),
            ).length,
            0,
            'a warning holds the relay, a token or a ticket',
          )
        },
      })
    } finally {
      fixture.throttle({ byte: null })
      await fixture.close()
    }
  })

  test("an audio switch past a ticket's life refreshes through the relay and plays on", async () => {
    const clock: Clock = { skewMs: 0 }
    const fixture = await startAccountFixture({ clock })
    try {
      const jar = await unlockPin({ fixture })
      await withAccountTitles({
        fixture,
        jar,
        clock,
        run: async ({ harness }) => {
          await playingAccountTitle({ harness })
          await harness.nextEvent({
            label: 'the clock past a second',
            matches: where({ type: PLAYER_EVENTS.time, holds: (event) => event.time >= 1 }),
          })
          const list = await harness.mpv.read({ name: MPV_PROPERTIES.trackList })
          const second = list.filter((track) => track.type === MPV_TRACK_TYPES.audio)[1]
          assert.ok(second, 'the clip lacks its second audio track')
          clock.skewMs += TICKET_STEP_MS
          const mark = fixture.requests.length
          const at = await timeOf({ harness })
          await harness.sendOk({ type: PLAYER_COMMANDS.audio, index: 1 })
          assert.equal(await harness.mpv.read({ name: MPV_PROPERTIES.aid }), second.id)
          await harness.waitFor({
            label: "the refresh seek's request",
            check: async () =>
              requestsTo({
                log: fixture.requests,
                path: fileOfMedia(FIXTURE_MEDIA.first),
                from: mark,
              }).length > 0,
          })
          await harness.nextEvent({
            label: 'the clock moving on after the switch',
            matches: where({ type: PLAYER_EVENTS.time, holds: (event) => event.time >= at + 1 }),
          })
          const switched = fixture.requests.slice(mark)
          assert.ok(
            requestsTo({ log: switched, path: fileOfMedia(FIXTURE_MEDIA.first) }).every(isRelayed),
            'the refresh seek went without its ticket alone',
          )
          assert.ok(
            switched.some(
              ({ method, path }) => method === SERVER_METHODS.post && path === ACCOUNT_TICKET_PATH,
            ),
            'the refresh seek reused a ticket past its life',
          )
          assert.deepEqual(harness.errorsOf(), [])
        },
      })
    } finally {
      await fixture.close()
    }
  })

  test('removing the account mid-play is an account error, and mpv opens nothing more', async () => {
    const clock: Clock = { skewMs: 0 }
    const fixture = await startAccountFixture({ clock })
    try {
      const jar = await unlockPin({ fixture })
      await withAccountTitles({
        fixture,
        jar,
        clock,
        run: async ({ harness, parts }) => {
          await throttleClip({ fixture })
          await playingAccountTitle({ harness })
          fixture.setStatus(MEMBER_STATUSES.revoked)
          const failure = await harness.eventAfter({
            label: 'the removed account stopping the title',
            matches: where({ type: PLAYER_EVENTS.error }),
            // A seek past what mpv holds is the next request the server hears. Near the end,
            // where mpv runs a refused seek out as if the title had ended.
            action: () => harness.sendOk({ type: PLAYER_COMMANDS.seek, time: SEEK_TARGETS[0] }),
          })
          assert.deepEqual(failure, {
            type: PLAYER_EVENTS.error,
            reason: PLAYER_ERROR_REASONS.account,
            message: SOURCE_MESSAGES.removed(ACCOUNT_SERVER.name),
          })
          assert.ok(
            parts.changed.includes(ACCOUNT_SERVER.id),
            'main was not told to read the account',
          )
          await sleep(SETTLE_MS)
          const asked = fixture.requests.length
          const relayed = parts.heard.length
          await sleep(QUIET_MS)
          assert.equal(fixture.requests.length, asked, 'the server heard more after the error')
          assert.equal(parts.heard.length, relayed, 'mpv asked the relay for more after the error')
        },
      })
    } finally {
      fixture.throttle({ byte: null })
      await fixture.close()
    }
  })

  test('removed mid-play, the title plays on from what mpv holds, then ends as the account error', async () => {
    const clock: Clock = { skewMs: 0 }
    const fixture = await startAccountFixture({ clock })
    try {
      const jar = await unlockPin({ fixture })
      await withAccountTitles({
        fixture,
        jar,
        clock,
        run: async ({ harness }) => {
          const { size } = await stat(clip.path)
          fixture.throttle({ byte: Math.floor(size * BUFFER_SHARE) })
          await playingAccountTitle({ harness })
          await harness.nextEvent({
            label: 'the clock past a second',
            matches: where({ type: PLAYER_EVENTS.time, holds: (event) => event.time >= 1 }),
          })
          fixture.setStatus(MEMBER_STATUSES.revoked)
          const ending = harness.nextEvent({
            label: 'the account error once the buffer ran out',
            matches: where({ type: PLAYER_EVENTS.error }),
            timeoutMs: DRAIN_WAIT_MS,
          })
          // A dropped link: mpv reconnects through the relay, and the server refuses that request.
          fixture.disconnect()
          const at = await timeOf({ harness })
          await harness.waitFor({
            label: 'the buffer playing on after the removal',
            check: async () => (await timeOf({ harness })) >= at + 1,
          })
          assert.deepEqual(harness.errorsOf(), [], 'the title stopped before its buffer ran out')
          assert.deepEqual(await ending, {
            type: PLAYER_EVENTS.error,
            reason: PLAYER_ERROR_REASONS.account,
            message: SOURCE_MESSAGES.removed(ACCOUNT_SERVER.name),
          })
        },
      })
    } finally {
      fixture.throttle({ byte: null })
      await fixture.close()
    }
  })

  test('the relay hears nothing once the load ends, and its secret opens nothing after', async () => {
    const clock: Clock = { skewMs: 0 }
    const fixture = await startAccountFixture({ clock })
    try {
      const jar = await unlockPin({ fixture })
      await withAccountTitles({
        fixture,
        jar,
        clock,
        run: async ({ harness, parts, targets }) => {
          await playingAccountTitle({ harness })
          await harness.sendOk({ type: PLAYER_COMMANDS.stop })
          await harness.waitFor({
            label: 'mpv idle after the stop',
            check: async () =>
              (await harness.mpv.read({ name: MPV_PROPERTIES.trackList })).length === 0,
          })
          await sleep(SETTLE_MS)
          const relayed = parts.heard.length
          await sleep(QUIET_MS)
          assert.equal(parts.heard.length, relayed, 'mpv asked the relay for more after the stop')

          // As main retires it when the player stops showing: then the URL mpv had is a 404.
          parts.relay.closeAll()
          const asked = fixture.requests.length
          const target = targets.at(0)
          assert.ok(target, 'the title never resolved')
          assert.equal((await fetch(target.url)).status, 404)
          assert.equal(fixture.requests.length, asked, 'a retired secret reached the server')
        },
      })
    } finally {
      await fixture.close()
    }
  })
})

describe('a raven fixture server under the admin lock', () => {
  const holder: { fixture: FixtureServer | null } = { fixture: null }
  before(async () => {
    holder.fixture = await startFixture({
      mode: {
        pin: FIXTURE_PIN,
        isLocked: true,
        admin: { kind: 'password', password: FIXTURE_PASSWORD },
      },
    })
  })
  after(async () => {
    const fixture = holder.fixture
    holder.fixture = null
    if (fixture !== null) await fixture.close()
  })

  test('plays once both cookies are in, and every file request carries both', async () => {
    const fixture = holder.fixture
    if (fixture === null) throw new Error('The fixture server is not running')
    const admin = await unlockWith({
      fixture,
      path: '/api/admin/unlock',
      body: { password: FIXTURE_PASSWORD },
    })
    const jar = [...admin, ...(await unlockPin({ fixture }))]
    await withFixtureTitles({
      fixture,
      jar,
      run: async ({ harness }) => {
        const mark = fixture.requests.length
        await playingTitle({ harness, mediaId: FIXTURE_MEDIA.first })
        const files = requestsTo({
          log: fixture.requests,
          path: fileOfMedia(FIXTURE_MEDIA.first),
          from: mark,
        })
        assert.ok(files.length > 0, 'mpv never asked for the file')
        assert.ok(
          files.every(
            ({ hasUnlock, hasAdmin, hasOtherCookie }) => hasUnlock && hasAdmin && !hasOtherCookie,
          ),
          'a file request went without both cookies',
        )
        assert.deepEqual(harness.errorsOf(), [])
      },
    })
  })

  test('a server older than accounts hides the title until the admin password, whose unlock lifts it', async () => {
    const fixture = await startFixture({
      mode: {
        pin: FIXTURE_PIN,
        isLocked: true,
        admin: { kind: FIXTURE_ADMIN_KINDS.password, password: FIXTURE_PASSWORD },
        accounts: { kind: FIXTURE_ACCOUNT_KINDS.legacy },
      },
    })
    const legacy: AccountDeps = {
      ...ACCOUNTS_OFF,
      authConfigs: { stateOf: async (): Promise<AuthState> => ({ kind: AUTH_STATES.legacy }) },
    }
    try {
      assert.equal((await fetch(`${fixture.origin}${AUTH_PATHS.config}`)).status, 404)
      const pin = await unlockPin({ fixture })
      await withFixtureTitles({
        fixture,
        jar: pin,
        accounts: legacy,
        run: async ({ harness }) => {
          const failure = await harness.eventAfter({
            label: 'the hidden title refused',
            matches: where({ type: PLAYER_EVENTS.error }),
            action: () => harness.sendOk(titleLoad({ mediaId: FIXTURE_MEDIA.first })),
          })
          assert.deepEqual(failure, {
            type: PLAYER_EVENTS.error,
            reason: PLAYER_ERROR_REASONS.open,
            message: SOURCE_MESSAGES.gone(FIXTURE_SERVER.name),
          })
        },
      })
      // What the page reads on that 404 before it asks for the admin password.
      const lock = await fetch(`${fixture.origin}${API_PATHS.admin}`, {
        headers: {
          [AUTH_HEADERS.cookie]: pin.map(({ name, value }) => `${name}=${value}`).join('; '),
        },
      })
      assert.deepEqual(await lock.json(), { state: ADMIN_LOCK_STATES.on, available: true })
      const admin = await unlockWith({
        fixture,
        path: API_PATHS.adminUnlock,
        body: { password: FIXTURE_PASSWORD },
      })
      await withFixtureTitles({
        fixture,
        jar: [...admin, ...pin],
        accounts: legacy,
        run: async ({ harness }) => {
          const mark = fixture.requests.length
          await playingTitle({ harness, mediaId: FIXTURE_MEDIA.first })
          const files = requestsTo({
            log: fixture.requests,
            path: fileOfMedia(FIXTURE_MEDIA.first),
            from: mark,
          })
          assert.ok(files.length > 0, 'mpv never asked for the file')
          assert.ok(
            files.every(
              ({ hasUnlock, hasAdmin, hasBearer, hasAccountTicket }) =>
                hasUnlock && hasAdmin && !hasBearer && !hasAccountTicket,
            ),
            'a file request left the cookie path',
          )
          assert.deepEqual(harness.errorsOf(), [])
        },
      })
    } finally {
      await fixture.close()
    }
  })

  test('a server whose accounts are ready never asks the admin lock: the hidden title is gone', async () => {
    const clock: Clock = { skewMs: 0 }
    const fixture = await startAccountFixture({
      clock,
      admin: { kind: FIXTURE_ADMIN_KINDS.password, password: FIXTURE_PASSWORD },
    })
    try {
      const jar = await unlockPin({ fixture })
      await withAccountTitles({
        fixture,
        jar,
        clock,
        run: async ({ harness, parts }) => {
          const outcome = await harness.send(accountLoad({ mediaId: FIXTURE_MEDIA.first }))
          assert.deepEqual(outcome, {
            ok: false,
            reason: PLAYER_REFUSAL_REASONS.refused,
            message: SOURCE_MESSAGES.gone(ACCOUNT_SERVER.name),
          })
          assert.deepEqual(
            fixture.requests.filter(({ path }) => path.startsWith(API_PATHS.admin)),
            [],
            'the admin lock was asked about',
          )
          assert.deepEqual(parts.heard, [], 'the relay opened for a hidden title')
          assert.deepEqual(
            harness.raw.filter((event) => event.type === MPV_EVENTS.fileLoaded),
            [],
            'mpv opened the hidden title',
          )
        },
      })
    } finally {
      await fixture.close()
    }
  })
})

describe('a raven fixture server with no admin password', () => {
  test('hides a locked title whatever PIN went in, and the page hears it is gone', async () => {
    const fixture = await startFixture({
      mode: { pin: FIXTURE_PIN, isLocked: true, admin: { kind: 'noPassword' } },
    })
    try {
      const admin = await fetch(`${fixture.origin}/api/admin`)
      assert.deepEqual(await admin.json(), { state: 'on', available: false })
      const jar = await unlockPin({ fixture })
      await withFixtureTitles({
        fixture,
        jar,
        run: async ({ harness, asked }) => {
          const failure = await harness.eventAfter({
            label: 'the hidden title refused',
            matches: where({ type: 'error' }),
            action: () => harness.sendOk(titleLoad({ mediaId: FIXTURE_MEDIA.first })),
          })
          assert.deepEqual(failure, {
            type: 'error',
            reason: 'open',
            message: SOURCE_MESSAGES.gone(FIXTURE_SERVER.name),
          })
          assert.deepEqual(
            asked.map(({ phase }) => phase),
            ['loading'],
          )
        },
      })
    } finally {
      await fixture.close()
    }
  })
})

describe("the raven fixture server's wrong PINs", () => {
  test('answer 429 after five in a row, the right PIN too, for a minute', async () => {
    const clock = { now: 1_000_000 }
    const { first, second } = await fixtureClips()
    const fixture = await startFixtureServer({
      clips: { first, second, tracks: clip.path },
      mode: { pin: FIXTURE_PIN, isLocked: true, admin: { kind: 'off' } },
      now: () => clock.now,
    })
    const tryPin = async (pin: string) => {
      const response = await fetch(`${fixture.origin}/api/lock/unlock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      return response.status
    }
    try {
      const wrong = await Array.from({ length: 5 }).reduce<Promise<number[]>>(
        async (previous) => [...(await previous), await tryPin('0000')],
        Promise.resolve([]),
      )
      assert.deepEqual(wrong, [401, 401, 401, 401, 401])
      assert.equal(await tryPin(FIXTURE_PIN), 429)
      clock.now += 59_999
      assert.equal(await tryPin(FIXTURE_PIN), 429)
      clock.now += 1
      assert.equal(await tryPin(FIXTURE_PIN), 200)
    } finally {
      await fixture.close()
    }
  })
})

describe('a raven fixture server that goes away mid-film', () => {
  test('is a lost connection, and the clock stays where it stopped', async () => {
    const fixture = await startFixture({
      mode: { pin: FIXTURE_PIN, isLocked: true, admin: { kind: 'off' } },
    })
    try {
      const jar = await unlockPin({ fixture })
      await withFixtureTitles({
        fixture,
        jar,
        run: async ({ harness, asked }) => {
          const { failure, elapsed } = await failingWhenDrained({
            harness,
            fixture,
            label: 'the lost title stopping',
            action: () => fixture.close(),
            timeoutMs: LOST_WAIT_MS,
          })
          assert.ok(elapsed < LOST_BOUND_MS, `the lost title stopped after ${elapsed} ms`)
          assert.deepEqual(failure, {
            type: 'error',
            reason: 'network',
            message: SOURCE_MESSAGES.lost(FIXTURE_SERVER.name),
          })
          assert.deepEqual(
            asked.map(({ phase }) => phase),
            ['loaded'],
          )
          const at = harness.events.indexOf(failure)
          const times = harness.events.filter(where({ type: 'time' }))
          assert.ok(
            harness.events.slice(at).every((event) => event.type !== PLAYER_EVENTS.time),
            'the clock moved after the title stopped',
          )
          assert.ok(
            (times.at(-1)?.time ?? 0) >= 1,
            `the clock stopped at ${times.at(-1)?.time ?? 'nothing'}`,
          )
          assert.deepEqual(harness.endingsOf(), [])
        },
      })
    } finally {
      await fixture.close()
    }
  })

  test('a server that sends the headers of a file and then nothing is a lost connection within the budget', async () => {
    const fixture = await startFixture({
      mode: { pin: FIXTURE_PIN, isLocked: true, admin: { kind: 'off' } },
    })
    try {
      const jar = await unlockPin({ fixture })
      fixture.stallFiles()
      await withFixtureTitles({
        fixture,
        jar,
        serverStallMs: STALL_TEST_MS,
        run: async ({ harness, asked }) => {
          const mark = fixture.requests.length
          const started = Date.now()
          const failure = await harness.eventAfter({
            label: 'the stalled title stopping',
            matches: where({ type: 'error' }),
            action: () => harness.sendOk(titleLoad({ mediaId: FIXTURE_MEDIA.first })),
            timeoutMs: STALL_TEST_MS + WAIT_MS,
          })
          const elapsed = Date.now() - started
          assert.ok(elapsed >= STALL_TEST_MS, `the stalled title stopped after ${elapsed} ms`)
          assert.ok(
            elapsed < STALL_TEST_MS + OPENING_SLACK_MS,
            `the stalled title stopped after ${elapsed} ms`,
          )
          assert.deepEqual(failure, {
            type: 'error',
            reason: 'network',
            message: PLAYER_MESSAGES.lost,
          })
          assert.deepEqual(asked, [])
          assert.ok(
            requestsTo({
              log: fixture.requests,
              path: fileOfMedia(FIXTURE_MEDIA.first),
              from: mark,
            }).length > 0,
            'mpv never asked for the file',
          )
          assert.deepEqual(
            harness.raw.filter((event) => event.type === MPV_EVENTS.fileLoaded),
            [],
            'mpv opened the stalled file',
          )
          await sleep(SETTLE_MS)
          assert.deepEqual(harness.errorsOf(), [failure])
        },
      })
    } finally {
      await fixture.close()
    }
  })

  test('a server that hangs is a lost connection once the title has waited its budget', async () => {
    const fixture = await startFixture({
      mode: { pin: FIXTURE_PIN, isLocked: true, admin: { kind: 'off' } },
    })
    try {
      const jar = await unlockPin({ fixture })
      await withFixtureTitles({
        fixture,
        jar,
        serverStallMs: STALL_TEST_MS,
        run: async ({ harness, asked }) => {
          await playingUpToThrottle({ harness, fixture, mediaId: FIXTURE_MEDIA.first })
          const started = Date.now()
          const failure = await harness.eventAfter({
            label: 'the hung title stopping',
            matches: where({ type: 'error' }),
            action: async () => {
              fixture.hang()
            },
            timeoutMs: HUNG_BOUND_MS + WAIT_MS,
          })
          const elapsed = Date.now() - started
          assert.ok(elapsed >= STALL_TEST_MS, `the hung title stopped after ${elapsed} ms`)
          assert.ok(elapsed < HUNG_BOUND_MS, `the hung title stopped after ${elapsed} ms`)
          assert.deepEqual(failure, {
            type: 'error',
            reason: 'network',
            message: PLAYER_MESSAGES.lost,
          })
          assert.deepEqual(asked, [])
          await harness.waitFor({
            label: 'mpv idle after the stall',
            check: async () => (await harness.mpv.read({ name: 'track-list' })).length === 0,
          })
          const at = harness.events.indexOf(failure)
          assert.ok(
            harness.events.slice(at).every((event) => event.type !== PLAYER_EVENTS.time),
            'the clock moved after the title stopped',
          )
        },
      })
    } finally {
      await fixture.close()
    }
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
