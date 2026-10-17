import { describe, expect, test } from 'bun:test'
import { openMpv, type MpvEvent } from '@/mpv'

const fixture = ({ version = 'mpv 0.41.0', apiVersion = 131077 } = {}) => {
  let receive = (_event: unknown) => {}
  let destroys = 0
  const calls: unknown[] = []
  const values = new Map<string, unknown>([
    ['mpv-version', version],
    ['pause', true],
  ])
  const emit = (event: unknown) => receive(event)
  const native = {
    command: (id: number, args: string[]) => {
      calls.push({ command: args })
      if (args[0] === 'throw') throw new Error('command refused')
      if (args[0] !== 'pending')
        emit({ type: 'reply', id, error: args[0] === 'fail' ? -4 : 0, data: null })
    },
    get: (id: number, name: string) => {
      emit({ type: 'reply', id, error: 0, data: values.get(name) })
    },
    set: (id: number, name: string, value: string | boolean | number) => {
      calls.push({ name, value })
      emit({ type: 'reply', id, error: 0, data: null })
    },
    observe: (name: string) => {
      calls.push({ observe: name })
    },
    display: (): unknown => ({ refreshRate: 60, edrHeadroom: 1, sortRepairs: 2 }),
    destroy: async () => {
      destroys += 1
    },
  }
  const events: MpvEvent[] = []
  const loadAddon = (_path: string) => ({
    apiVersion,
    create: (_surface: unknown, callback: (event: unknown) => void) => {
      receive = callback
      return native
    },
  })
  const open = () =>
    openMpv({
      surface: { kind: 'headless' },
      onEvent: (event) => {
        events.push(event)
      },
      loadAddon,
    })
  return { open, emit, values, events, native, calls, destroyed: () => destroys }
}

describe('mpv wrapper native boundary (no libmpv loaded)', () => {
  test('rejects missing, malformed, incompatible and outdated native engines', async () => {
    await expect(
      openMpv({
        surface: { kind: 'headless' },
        onEvent: () => {},
        loadAddon: () => {
          throw new Error('missing addon')
        },
      }),
    ).rejects.toThrow('missing addon')
    await expect(
      openMpv({ surface: { kind: 'headless' }, onEvent: () => {}, loadAddon: () => ({}) }),
    ).rejects.toThrow('Invalid raven mpv addon')
    await expect(fixture({ apiVersion: 65540 }).open()).rejects.toThrow('client API')
    await expect(fixture({ apiVersion: 131077.5 }).open()).rejects.toThrow('client API')
    await expect(fixture({ apiVersion: 131074 }).open()).rejects.toThrow('client API')
    const outdated = fixture({ version: 'mpv 0.39.0' })
    await expect(outdated.open()).rejects.toThrow('0.40')
    expect(outdated.destroyed()).toBe(1)
    await expect(fixture({ version: 'invalid' }).open()).rejects.toThrow('0.40')
    const malformed = fixture()
    malformed.values.set('mpv-version', 4)
    await expect(malformed.open()).rejects.toThrow('Invalid mpv property')
    expect(malformed.destroyed()).toBe(1)
    await expect(
      openMpv({
        surface: { kind: 'headless' },
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
      expect(await player.read({ name: 'pause' })).toBe(true)
      await player.command({ args: ['seek', '4', 'absolute'] })
      await player.set({ name: 'volume', value: 50 })
      player.observe({ name: 'pause' })
      expect(value.calls).toEqual([
        { command: ['seek', '4', 'absolute'] },
        { name: 'volume', value: 50 },
        { observe: 'pause' },
      ])
      await expect(player.command({ args: ['fail'] })).rejects.toThrow('-4')
      await expect(player.command({ args: ['throw'] })).rejects.toThrow('refused')
      value.values.set('pause', 'yes')
      await expect(player.read({ name: 'pause' })).rejects.toThrow('Invalid mpv property: pause')
      await expect(player.set({ name: 'volume', value: Number.NaN })).rejects.toThrow(
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
        { type: 'property', name: 'pause', data: true },
        { type: 'file-loaded' },
        { type: 'playback-restart' },
        { type: 'end-file', reason: 'eof', error: 0 },
        { type: 'log', level: 'warn', prefix: 'demux', text: 'warning' },
      ]
      events.forEach(value.emit)
      value.emit({ type: 'reply', id: 999, error: 0, data: null })
      expect(value.events).toEqual(events)
      const waiting = player.command({ args: ['pending'] })
      const rejected = waiting.then(
        () => null,
        (error: unknown) => error,
      )
      value.emit({ type: 'property', name: 'pause', data: 'yes' })
      expect(await rejected).toEqual(new Error('Invalid native mpv event'))
      value.emit({ type: 'property', name: 'unknown', data: 1 })
      value.emit({ type: 'end-file', reason: 'eof', error: 'no' })
      expect(value.events.slice(-3)).toEqual(
        Array.from({ length: 3 }, () => ({ type: 'error', message: 'Invalid native mpv event' })),
      )
    } finally {
      await player.destroy()
    }
  })

  test('native choice NODE reads and observations preserve unrelated outstanding requests', async () => {
    const value = fixture()
    const player = await value.open()
    try {
      const waiting = player.command({ args: ['pending'] }).then(
        () => null,
        (error: unknown) => error,
      )
      const choices = [
        { type: 'property', name: 'aid', data: 'auto' },
        { type: 'property', name: 'sid', data: 'auto' },
        { type: 'property', name: 'aid', data: false },
        { type: 'property', name: 'sid', data: false },
        { type: 'property', name: 'target-colorspace-hint', data: false },
        { type: 'property', name: 'target-colorspace-hint', data: true },
        { type: 'property', name: 'target-colorspace-hint', data: 'auto' },
      ] as const
      await choices.reduce(async (previous, choice) => {
        await previous
        value.values.set(choice.name, choice.data)
        value.emit(choice)
        expect(await player.read({ name: choice.name })).toBe(choice.data)
      }, Promise.resolve())
      // The version read uses id 1. Only this explicit reply should resolve id 2.
      value.emit({ type: 'reply', id: 2, error: 0, data: null })
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
      .command({ args: ['pending'], onReply: ({ isOk }) => order.push(`reply ${isOk}`) })
      .then(() => order.push('settled'))
    const sent = value.calls.at(-1)
    expect(sent).toEqual({ command: ['pending'] })
    // The version read at open took id 1, so this command is id 2.
    value.emit({ type: 'file-loaded' })
    order.push(`events ${value.events.length}`)
    value.emit({ type: 'reply', id: 2, error: 0, data: null })
    value.emit({ type: 'playback-restart' })
    order.push(`events ${value.events.length}`)
    await pending
    expect(order).toEqual(['events 1', 'reply true', 'events 2', 'settled'])

    const failing: string[] = []
    await expect(
      player.command({ args: ['fail'], onReply: ({ isOk }) => failing.push(`reply ${isOk}`) }),
    ).rejects.toThrow('mpv request failed (-4)')
    expect(failing).toEqual(['reply false'])

    await expect(
      player.command({
        args: ['ok'],
        onReply: () => {
          throw new Error('listener broke')
        },
      }),
    ).rejects.toThrow('listener broke')
    // Still answers commands without a hook, as before.
    await player.command({ args: ['ok'] })
    await player.destroy()
  })

  test('overflow and shutdown reject outstanding requests; destruction is idempotent', async () => {
    const value = fixture()
    const player = await value.open()
    await ['overflow', 'shutdown'].reduce(async (previous, type) => {
      await previous
      const rejected = player.command({ args: ['pending'] }).then(
        () => null,
        (error: unknown) => error,
      )
      value.emit({ type })
      expect(await rejected).toEqual(new Error(`mpv ${type}`))
    }, Promise.resolve())
    const rejected = player.command({ args: ['pending'] }).then(
      () => null,
      (error: unknown) => error,
    )
    const first = player.destroy()
    expect(player.destroy()).toBe(first)
    await first
    expect(await rejected).toEqual(new Error('mpv is destroyed'))
    expect(value.destroyed()).toBe(1)
    await expect(player.read({ name: 'pause' })).rejects.toThrow('destroyed')
    expect(() => player.observe({ name: 'pause' })).toThrow('destroyed')
    expect(() => player.display()).toThrow('destroyed')
    const before = value.events.length
    value.emit({ type: 'file-loaded' })
    expect(value.events).toHaveLength(before)
  })
})
