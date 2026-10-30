import { describe, expect, test } from 'bun:test'
import {
  MPV_COMMANDS,
  MPV_END_FILE_REASONS,
  MPV_EVENTS,
  MPV_SURFACE_KINDS,
  NATIVE_MESSAGES,
  openMpv,
  type MpvEvent,
} from '@/mpv'
import { MPV_CHOICES, MPV_PROPERTIES } from '@/properties'
import { REMOTE_COMMANDS } from '@raven/core'

/** Commands only this fake engine knows: each makes it answer, or not, in its own way. */
const FAKE_COMMANDS = { throw: 'throw', pending: 'pending', fail: 'fail', ok: 'ok' } as const

const fixture = ({ version = 'mpv 0.41.0', apiVersion = 131077 } = {}) => {
  let receive = (_event: unknown) => {}
  let destroys = 0
  const calls: unknown[] = []
  const values = new Map<string, unknown>([
    [MPV_PROPERTIES.mpvVersion, version],
    [MPV_PROPERTIES.pause, true],
  ])
  const emit = (event: unknown) => receive(event)
  const native = {
    command: (id: number, args: string[]) => {
      calls.push({ command: args })
      if (args[0] === FAKE_COMMANDS.throw) throw new Error('command refused')
      if (args[0] !== FAKE_COMMANDS.pending)
        emit({
          type: NATIVE_MESSAGES.reply,
          id,
          error: args[0] === FAKE_COMMANDS.fail ? -4 : 0,
          data: null,
        })
    },
    get: (id: number, name: string) => {
      emit({ type: NATIVE_MESSAGES.reply, id, error: 0, data: values.get(name) })
    },
    set: (id: number, name: string, value: string | boolean | number) => {
      calls.push({ name, value })
      emit({ type: NATIVE_MESSAGES.reply, id, error: 0, data: null })
    },
    observe: (name: string) => {
      calls.push({ observe: name })
    },
    display: (): unknown => ({ refreshRate: 60, edrHeadroom: 1, sortRepairs: 2 }),
    nowPlaying: (info: unknown) => {
      calls.push({ nowPlaying: info })
    },
    clearNowPlaying: () => {
      calls.push({ clearNowPlaying: true })
    },
    destroy: async () => {
      destroys += 1
    },
  }
  const events: MpvEvent[] = []
  const loadAddon = () => ({
    apiVersion,
    create: (_surface: unknown, callback: (event: unknown) => void) => {
      receive = callback
      return native
    },
  })
  const open = () =>
    openMpv({
      surface: { kind: MPV_SURFACE_KINDS.headless },
      onEvent: (event) => {
        events.push(event)
      },
      loadAddon,
    })
  return { open, emit, values, events, native, calls, loadAddon, destroyed: () => destroys }
}

describe('mpv wrapper native boundary (no libmpv loaded)', () => {
  test('rejects missing, malformed, incompatible and outdated native engines', async () => {
    await expect(
      openMpv({
        surface: { kind: MPV_SURFACE_KINDS.headless },
        onEvent: () => {},
        loadAddon: () => {
          throw new Error('missing addon')
        },
      }),
    ).rejects.toThrow('missing addon')
    await expect(
      openMpv({
        surface: { kind: MPV_SURFACE_KINDS.headless },
        onEvent: () => {},
        loadAddon: () => ({}),
      }),
    ).rejects.toThrow('Invalid raven mpv addon')
    await expect(fixture({ apiVersion: 65540 }).open()).rejects.toThrow('client API')
    await expect(fixture({ apiVersion: 131077.5 }).open()).rejects.toThrow('client API')
    await expect(fixture({ apiVersion: 131074 }).open()).rejects.toThrow('client API')
    const outdated = fixture({ version: 'mpv 0.39.0' })
    await expect(outdated.open()).rejects.toThrow('0.40')
    expect(outdated.destroyed()).toBe(1)
    await expect(fixture({ version: 'invalid' }).open()).rejects.toThrow('0.40')
    const malformed = fixture()
    malformed.values.set(MPV_PROPERTIES.mpvVersion, 4)
    await expect(malformed.open()).rejects.toThrow('Invalid mpv property')
    expect(malformed.destroyed()).toBe(1)
    await expect(
      openMpv({
        surface: { kind: MPV_SURFACE_KINDS.headless },
        onEvent: () => {},
        loadAddon: () => ({ apiVersion: 131077, create: () => ({}) }),
      }),
    ).rejects.toThrow('Invalid raven mpv handle')
  })

  test('accepts upstream release version strings with and without the v prefix', async () => {
    await ['mpv v0.41.0', 'mpv 0.40.0', 'mpv v0.41.0-dev-g123456789'].reduce(
      async (previous, version) => {
        await previous
        const value = fixture({ version })
        const player = await value.open()
        expect(player.version).toBe(version)
        await player.destroy()
      },
      Promise.resolve(),
    )
  })

  test('correlates async commands/properties, validates values and reports command failures', async () => {
    const value = fixture()
    const player = await value.open()
    try {
      expect(player.version).toBe('mpv 0.41.0')
      expect(await player.read({ name: MPV_PROPERTIES.pause })).toBe(true)
      await player.command({ args: [MPV_COMMANDS.seek, '4', 'absolute'] })
      await player.set({ name: MPV_PROPERTIES.speed, value: 2 })
      player.observe({ name: MPV_PROPERTIES.pause })
      expect(value.calls).toEqual([
        { command: [MPV_COMMANDS.seek, '4', 'absolute'] },
        { name: MPV_PROPERTIES.speed, value: 2 },
        { observe: MPV_PROPERTIES.pause },
      ])
      await expect(player.command({ args: [FAKE_COMMANDS.fail] })).rejects.toThrow('-4')
      await expect(player.command({ args: [FAKE_COMMANDS.throw] })).rejects.toThrow('refused')
      value.values.set(MPV_PROPERTIES.pause, 'yes')
      await expect(player.read({ name: MPV_PROPERTIES.pause })).rejects.toThrow(
        'Invalid mpv property: pause',
      )
      await expect(player.set({ name: MPV_PROPERTIES.speed, value: Number.NaN })).rejects.toThrow(
        'Invalid mpv property value',
      )
      expect(player.display()).toEqual({ refreshRate: 60, edrHeadroom: 1, sortRepairs: 2 })
      value.native.display = () => ({ refreshRate: '60', edrHeadroom: 1, sortRepairs: 0 })
      expect(() => player.display()).toThrow('Invalid native display information')
    } finally {
      await player.destroy()
    }
  })

  test('guards all event variants, rejects malformed events and ignores late/unknown replies', async () => {
    const value = fixture()
    const player = await value.open()
    try {
      const events: MpvEvent[] = [
        { type: MPV_EVENTS.property, name: MPV_PROPERTIES.pause, data: true },
        { type: MPV_EVENTS.fileLoaded },
        { type: MPV_EVENTS.playbackRestart },
        { type: MPV_EVENTS.endFile, reason: MPV_END_FILE_REASONS.eof, error: 0 },
        { type: MPV_EVENTS.log, level: 'warn', prefix: 'demux', text: 'warning' },
        { type: MPV_EVENTS.remote, command: REMOTE_COMMANDS.toggle },
        { type: MPV_EVENTS.remote, command: REMOTE_COMMANDS.seek, time: 12.5 },
      ]
      events.forEach(value.emit)
      value.emit({ type: NATIVE_MESSAGES.reply, id: 999, error: 0, data: null })
      expect(value.events).toEqual(events)
      const waiting = player.command({ args: [FAKE_COMMANDS.pending] })
      const rejected = waiting.then(
        () => null,
        (error: unknown) => error,
      )
      value.emit({ type: MPV_EVENTS.property, name: MPV_PROPERTIES.pause, data: 'yes' })
      expect(await rejected).toEqual(new Error('Invalid native mpv event'))
      value.emit({ type: MPV_EVENTS.property, name: 'unknown', data: 1 })
      value.emit({ type: MPV_EVENTS.endFile, reason: MPV_END_FILE_REASONS.eof, error: 'no' })
      value.emit({ type: MPV_EVENTS.endFile, reason: 'unplugged', error: 0 })
      value.emit({ type: MPV_EVENTS.remote, command: 'rewind' })
      value.emit({ type: MPV_EVENTS.remote, command: REMOTE_COMMANDS.seek })
      expect(value.events.slice(-6)).toEqual(
        Array.from({ length: 6 }, () => ({
          type: MPV_EVENTS.error,
          message: 'Invalid native mpv event',
        })),
      )
    } finally {
      await player.destroy()
    }
  })

  test('native choice NODE reads and observations preserve unrelated outstanding requests', async () => {
    const value = fixture()
    const player = await value.open()
    try {
      const waiting = player.command({ args: [FAKE_COMMANDS.pending] }).then(
        () => null,
        (error: unknown) => error,
      )
      const choices = [
        { type: MPV_EVENTS.property, name: MPV_PROPERTIES.aid, data: MPV_CHOICES.auto },
        { type: MPV_EVENTS.property, name: MPV_PROPERTIES.sid, data: MPV_CHOICES.auto },
        { type: MPV_EVENTS.property, name: MPV_PROPERTIES.aid, data: false },
        { type: MPV_EVENTS.property, name: MPV_PROPERTIES.sid, data: false },
        { type: MPV_EVENTS.property, name: MPV_PROPERTIES.targetColorspaceHint, data: false },
        { type: MPV_EVENTS.property, name: MPV_PROPERTIES.targetColorspaceHint, data: true },
        {
          type: MPV_EVENTS.property,
          name: MPV_PROPERTIES.targetColorspaceHint,
          data: MPV_CHOICES.auto,
        },
      ] as const
      await choices.reduce(async (previous, choice) => {
        await previous
        value.values.set(choice.name, choice.data)
        value.emit(choice)
        expect(await player.read({ name: choice.name })).toBe(choice.data)
      }, Promise.resolve())
      // The version read uses id 1. Only this explicit reply should resolve id 2.
      value.emit({ type: NATIVE_MESSAGES.reply, id: 2, error: 0, data: null })
      expect(await waiting).toBeNull()
      expect(value.events).toEqual([...choices])
    } finally {
      await player.destroy()
    }
  })

  test('a command reply calls onReply in stream order, before its promise settles', async () => {
    const value = fixture()
    const player = await value.open()
    const order: string[] = []
    value.events.splice(0)
    const pending = player
      .command({
        args: [FAKE_COMMANDS.pending],
        onReply: ({ isOk }) => order.push(`reply ${isOk}`),
      })
      .then(() => order.push('settled'))
    const sent = value.calls.at(-1)
    expect(sent).toEqual({ command: [FAKE_COMMANDS.pending] })
    // The version read at open took id 1, so this command is id 2.
    value.emit({ type: MPV_EVENTS.fileLoaded })
    order.push(`events ${value.events.length}`)
    value.emit({ type: NATIVE_MESSAGES.reply, id: 2, error: 0, data: null })
    value.emit({ type: MPV_EVENTS.playbackRestart })
    order.push(`events ${value.events.length}`)
    await pending
    expect(order).toEqual(['events 1', 'reply true', 'events 2', 'settled'])

    const failing: string[] = []
    await expect(
      player.command({
        args: [FAKE_COMMANDS.fail],
        onReply: ({ isOk }) => failing.push(`reply ${isOk}`),
      }),
    ).rejects.toThrow('mpv request failed (-4)')
    expect(failing).toEqual(['reply false'])

    await expect(
      player.command({
        args: [FAKE_COMMANDS.ok],
        onReply: () => {
          throw new Error('listener broke')
        },
      }),
    ).rejects.toThrow('listener broke')
    // Still answers commands without a hook, as before.
    await player.command({ args: [FAKE_COMMANDS.ok] })
    await player.destroy()
  })

  test('overflow and shutdown reject outstanding requests; destruction is idempotent', async () => {
    const value = fixture()
    const player = await value.open()
    await [MPV_EVENTS.overflow, MPV_EVENTS.shutdown].reduce(async (previous, type) => {
      await previous
      const rejected = player.command({ args: [FAKE_COMMANDS.pending] }).then(
        () => null,
        (error: unknown) => error,
      )
      value.emit({ type })
      expect(await rejected).toEqual(new Error(`mpv ${type}`))
    }, Promise.resolve())
    const rejected = player.command({ args: [FAKE_COMMANDS.pending] }).then(
      () => null,
      (error: unknown) => error,
    )
    const first = player.destroy()
    expect(player.destroy()).toBe(first)
    await first
    expect(await rejected).toEqual(new Error('mpv is destroyed'))
    expect(value.destroyed()).toBe(1)
    await expect(player.read({ name: MPV_PROPERTIES.pause })).rejects.toThrow('destroyed')
    expect(() => player.observe({ name: MPV_PROPERTIES.pause })).toThrow('destroyed')
    expect(() => player.display()).toThrow('destroyed')
    const before = value.events.length
    value.emit({ type: MPV_EVENTS.fileLoaded })
    expect(value.events).toHaveLength(before)
  })
})

describe('now playing', () => {
  test('passes what the system shows to the addon, and clears it, while the engine lives', async () => {
    const value = fixture()
    const player = await value.open()
    const info = {
      title: 'Blue',
      artist: 'Joni Mitchell',
      album: 'Blue',
      duration: 200,
      position: 12,
      isPlaying: true,
      rate: 1,
      artwork: null,
    }
    player.nowPlaying(info)
    player.clearNowPlaying()
    expect(value.calls.slice(-2)).toEqual([{ nowPlaying: info }, { clearNowPlaying: true }])
    await player.destroy()
    expect(() => player.nowPlaying(info)).toThrow('mpv is destroyed')
    player.clearNowPlaying()
    expect(value.calls.slice(-2)).toEqual([{ nowPlaying: info }, { clearNowPlaying: true }])
  })

  test('an audio surface is handed to the addon as it is', async () => {
    const surfaces: unknown[] = []
    const value = fixture()
    const player = await openMpv({
      surface: { kind: MPV_SURFACE_KINDS.audio },
      onEvent: () => {},
      loadAddon: () => ({
        apiVersion: 131077,
        create: (surface: unknown, callback: (event: unknown) => void) => {
          surfaces.push(surface)
          return value.loadAddon().create(surface, callback)
        },
      }),
    })
    expect(surfaces).toEqual([{ kind: MPV_SURFACE_KINDS.audio }])
    await player.destroy()
  })
})
