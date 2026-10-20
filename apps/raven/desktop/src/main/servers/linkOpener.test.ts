import { describe, expect, it } from 'bun:test'
import type { PlayRequest } from '@raven/core'
import { EMPTY_CONFIG, type ConfigStore, type ServerEntry } from '@/main/desktopConfig'
import type { DownloadService } from '@/main/downloads/downloadService'
import { LINK_MESSAGES, createLinkOpener, replyForTrust } from '@/main/servers/linkOpener'
import { PROBE_KINDS } from '@/main/servers/serverCalls'
import {
  TRUST_MESSAGES,
  createServerTrust,
  type ServerTrust,
  type TrustOutcome,
  TRUST_OUTCOME_KINDS,
} from '@/main/servers/serverTrust'
import { isDesktopReply, type DesktopReply } from '@/shared/protocol'
import { fakeTimers } from '@/main/test/playerFakes'

const ORIGIN = 'https://raven.example'

const SERVER: ServerEntry = {
  id: '00000000-0000-4000-8000-000000000001',
  origin: ORIGIN,
  name: 'raven.example',
  addedAt: 1,
  signIn: null,
}

const REQUEST: PlayRequest = { origin: ORIGIN, mediaId: 7, at: 30, next: [8] }

const LINK = 'raven://play?server=https%3A%2F%2Fraven.example&media=7&at=30&next=8'

const ASK_REPLY: DesktopReply = {
  type: 'downloadAsk',
  ask: {
    askId: '00000000-0000-4000-8000-0000000000aa',
    serverId: SERVER.id,
    serverName: SERVER.name,
    autoDelete: false,
    status: { kind: 'locked' },
  },
}

type TrustInput = Parameters<ServerTrust['trust']>[0]
type AskInput = Parameters<DownloadService['ask']>[0]

/** A download service that records each ask and answers `ASK_REPLY`. */
const fakeDownloads = () => {
  const asks: AskInput[] = []
  const downloads: Pick<DownloadService, 'ask'> = {
    ask: async (input) => {
      asks.push(input)
      return ASK_REPLY
    },
  }
  return { asks, downloads }
}

const setup = ({
  outcome = { kind: 'trusted', server: SERVER, isNew: true },
}: { outcome?: TrustOutcome | (() => Promise<TrustOutcome>) } = {}) => {
  const asked: TrustInput[] = []
  const warnings: string[] = []
  const { asks, downloads } = fakeDownloads()
  const opener = createLinkOpener({
    trust: {
      trust: async (input) => {
        asked.push(input)
        return typeof outcome === 'function' ? outcome() : outcome
      },
    },
    downloads,
    warn: (message) => warnings.push(message),
  })
  return { opener, asked, asks, warnings }
}

describe('replyForTrust', () => {
  it('plays a trusted server title by ids', () => {
    const reply = replyForTrust({
      outcome: { kind: 'trusted', server: SERVER, isNew: false },
      request: REQUEST,
    })
    expect(reply).toEqual({
      type: 'playServer',
      target: { serverId: SERVER.id, mediaId: 7, at: 30, next: [8] },
    })
    expect(isDesktopReply(reply)).toBe(true)
  })

  it('carries no origin to the page', () => {
    const reply = replyForTrust({
      outcome: { kind: 'trusted', server: SERVER, isNew: true },
      request: REQUEST,
    })
    expect(JSON.stringify(reply)).not.toContain('raven.example')
  })

  it('is done for a decline', () => {
    expect(replyForTrust({ outcome: { kind: 'declined' }, request: REQUEST })).toEqual({
      type: 'done',
    })
  })

  it.each([
    [{ kind: 'full' } as const, TRUST_MESSAGES.full],
    [{ kind: 'busy' } as const, TRUST_MESSAGES.busy],
    [{ kind: 'unreachable', origin: ORIGIN } as const, TRUST_MESSAGES.unreachable(ORIGIN)],
    [{ kind: TRUST_OUTCOME_KINDS.badSignIn } as const, TRUST_MESSAGES.badSignIn],
    [{ kind: 'invalid' } as const, TRUST_MESSAGES.invalid],
    [{ kind: 'unsaved' } as const, TRUST_MESSAGES.unsaved],
  ])('refuses %j with its message', (outcome, message) => {
    expect(replyForTrust({ outcome, request: REQUEST })).toEqual({ type: 'refused', message })
  })
})

describe('createLinkOpener', () => {
  it('plays a raven link once its server is trusted', async () => {
    const world = setup()
    expect(await world.opener.open({ link: LINK, from: 'link' })).toEqual({
      type: 'playServer',
      target: { serverId: SERVER.id, mediaId: 7, at: 30, next: [8] },
    })
    expect(world.asked).toEqual([{ origin: ORIGIN, from: 'link' }])
  })

  it('passes where the link came from, and reads a pasted watch page', async () => {
    const world = setup()
    const reply = await world.opener.open({
      link: 'https://raven.example/watch/7?t=9#x',
      from: 'app',
    })
    expect(reply).toEqual({
      type: 'playServer',
      target: { serverId: SERVER.id, mediaId: 7, at: 0, next: [] },
    })
    expect(world.asked).toEqual([{ origin: ORIGIN, from: 'app' }])
  })

  it.each([
    ['raven://download?server=https%3A%2F%2Fraven.example&media=7', { kind: 'media', mediaId: 7 }],
    ['raven://download?server=https%3A%2F%2Fraven.example&item=10', { kind: 'item', itemId: 10 }],
    [
      'raven://download?server=https%3A%2F%2Fraven.example&saga=1%3A100',
      { kind: 'saga', libraryId: 1, tmdbId: '100' },
    ],
  ] as const)(
    'trusts the server of %j, then answers what the download ask answered',
    async (link, target) => {
      const world = setup()
      expect(await world.opener.open({ link, from: 'link' })).toEqual(ASK_REPLY)
      expect(world.asked).toEqual([{ origin: ORIGIN, from: 'link' }])
      expect(world.asks).toEqual([{ serverId: SERVER.id, target }])
    },
  )

  it('asks about a pasted download link as from the app', async () => {
    const world = setup()
    await world.opener.open({
      link: 'raven://download?server=https%3A%2F%2Fraven.example&media=7',
      from: 'app',
    })
    expect(world.asked).toEqual([{ origin: ORIGIN, from: 'app' }])
  })

  it('is done when the prompt for a download link was declined, and asks nothing', async () => {
    const world = setup({ outcome: { kind: 'declined' } })
    const link = 'raven://download?server=https%3A%2F%2Fraven.example&media=7'
    expect(await world.opener.open({ link, from: 'link' })).toEqual({ type: 'done' })
    expect(world.asks).toEqual([])
  })

  it.each([
    [{ kind: 'busy' } as const, TRUST_MESSAGES.busy],
    [{ kind: 'unreachable', origin: ORIGIN } as const, TRUST_MESSAGES.unreachable(ORIGIN)],
    [{ kind: TRUST_OUTCOME_KINDS.badSignIn } as const, TRUST_MESSAGES.badSignIn],
  ])('refuses a download link when trust is %j, and asks nothing', async (outcome, message) => {
    const world = setup({ outcome })
    const link = 'raven://download?server=https%3A%2F%2Fraven.example&item=10'
    expect(await world.opener.open({ link, from: 'link' })).toEqual({ type: 'refused', message })
    expect(world.asks).toEqual([])
  })

  it('refuses rather than throws when trust rejects for a download link', async () => {
    const world = setup({ outcome: () => Promise.reject(new Error('dialog crashed')) })
    const link = 'raven://download?server=https%3A%2F%2Fraven.example&item=10'
    expect(await world.opener.open({ link, from: 'link' })).toEqual({
      type: 'refused',
      message: TRUST_MESSAGES.unsaved,
    })
    expect(world.asks).toEqual([])
  })

  it.each([
    ['javascript:alert(1)'],
    ['file:///etc/passwd'],
    [`raven://play?server=${encodeURIComponent(ORIGIN)}&media=1&next=${'1,'.repeat(100)}1`],
    ['raven://play?server=https%3A%2F%2Fraven.example&media=1&media=2'],
    [`raven://play?server=${encodeURIComponent(ORIGIN)}&media=-1`],
    ['x'.repeat(5000)],
  ])('refuses %j as unreadable and never trusts', async (link) => {
    const world = setup()
    expect(await world.opener.open({ link, from: 'link' })).toEqual({
      type: 'refused',
      message: LINK_MESSAGES.unreadable,
    })
    expect(world.asked).toEqual([])
    expect(world.warnings).toHaveLength(1)
  })

  it('warns at most the first 100 characters of an unreadable link, on one line', async () => {
    const world = setup()
    const link = `javascript:${'a'.repeat(200)}`
    await world.opener.open({ link, from: 'link' })
    const [warning] = world.warnings
    expect(warning).toContain(link.slice(0, 100))
    expect(warning).not.toContain(link.slice(0, 101))
  })

  it('escapes line breaks and bidi overrides in what it warns', async () => {
    const world = setup()
    await world.opener.open({ link: 'evil:\nforged log line\u202e', from: 'link' })
    const [warning] = world.warnings
    expect(warning).not.toContain('\n')
    expect(warning).not.toContain('\u202e')
  })

  it.each([
    [{ kind: 'full' } as const, TRUST_MESSAGES.full],
    [{ kind: 'busy' } as const, TRUST_MESSAGES.busy],
    [{ kind: 'unreachable', origin: ORIGIN } as const, TRUST_MESSAGES.unreachable(ORIGIN)],
    [{ kind: TRUST_OUTCOME_KINDS.badSignIn } as const, TRUST_MESSAGES.badSignIn],
  ])('refuses a link when trust is %j', async (outcome, message) => {
    const world = setup({ outcome })
    expect(await world.opener.open({ link: LINK, from: 'link' })).toEqual({
      type: 'refused',
      message,
    })
  })

  it('is done when the prompt was declined', async () => {
    const world = setup({ outcome: { kind: 'declined' } })
    expect(await world.opener.open({ link: LINK, from: 'link' })).toEqual({ type: 'done' })
  })

  it('opens only the first of a batch, from a link, and warns how many it dropped', async () => {
    const world = setup()
    const reply = await world.opener.openBatch([
      LINK,
      'raven://play?server=https%3A%2F%2Fother.example&media=1',
      'raven://play?server=https%3A%2F%2Fthird.example&media=2',
    ])
    expect(reply.type).toBe('playServer')
    expect(world.asked).toEqual([{ origin: ORIGIN, from: 'link' }])
    expect(world.warnings).toHaveLength(1)
    expect(world.warnings[0]).toContain('2')
  })

  it('opens a batch of one without a warning', async () => {
    const world = setup()
    await world.opener.openBatch([LINK])
    expect(world.warnings).toEqual([])
  })

  it('is done for an empty batch and trusts nothing', async () => {
    const world = setup()
    expect(await world.opener.openBatch([])).toEqual({ type: 'done' })
    expect(world.asked).toEqual([])
  })

  it('answers busy to a link racing a prompt, and plays the first once it is answered', async () => {
    const answers: ((outcome: TrustOutcome) => void)[] = []
    const state = { isAsking: false }
    const world = setup({
      outcome: () => {
        if (state.isAsking) return Promise.resolve({ kind: 'busy' })
        state.isAsking = true
        return new Promise((resolve) => {
          answers.push(resolve)
        })
      },
    })
    const first = world.opener.open({ link: LINK, from: 'link' })
    const second = await world.opener.open({ link: LINK, from: 'link' })
    expect(second).toEqual({ type: 'refused', message: TRUST_MESSAGES.busy })
    answers.forEach((answer) => answer({ kind: 'trusted', server: SERVER, isNew: true }))
    expect((await first).type).toBe('playServer')
  })

  it('refuses rather than throws when trust itself rejects', async () => {
    const world = setup({ outcome: () => Promise.reject(new Error('dialog crashed')) })
    expect(await world.opener.open({ link: LINK, from: 'link' })).toEqual({
      type: 'refused',
      message: TRUST_MESSAGES.unsaved,
    })
    expect(world.warnings.join('\n')).toContain('dialog crashed')
  })
})

/** A config held in memory, for the opener over the real trust. */
const memoryConfig = (): ConfigStore => {
  const state = { value: EMPTY_CONFIG }
  return {
    read: () => state.value,
    update: (change) => {
      state.value = change(state.value)
    },
    flush: async () => undefined,
    isDirty: () => false,
  }
}

describe('createLinkOpener over the real trust', () => {
  const realWorld = () => {
    const asked: string[] = []
    const answers: ((isYes: boolean) => void)[] = []
    const probes: string[] = []
    const warnings: string[] = []
    const trust = createServerTrust({
      config: memoryConfig(),
      confirm: (origin) => {
        asked.push(origin)
        return new Promise((resolve) => {
          answers.push(resolve)
        })
      },
      probe: async ({ origin }) => {
        probes.push(origin)
        return { kind: PROBE_KINDS.raven, signIn: null }
      },
      forget: async () => undefined,
      onRemoved: () => undefined,
      newId: () => SERVER.id,
      now: () => 1,
      timers: fakeTimers().timers,
      warn: (message) => warnings.push(message),
    })
    const opener = createLinkOpener({
      trust,
      downloads: fakeDownloads().downloads,
      warn: (message) => warnings.push(message),
    })
    const answer = (isYes: boolean) => answers.splice(0, 1).forEach((resolve) => resolve(isYes))
    return { opener, asked, answer, probes, warnings }
  }

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('asks once for two racing links, answers the second busy, and fetches nothing on a no', async () => {
    const world = realWorld()
    const first = world.opener.open({ link: LINK, from: 'link' })
    const second = await world.opener.open({ link: LINK, from: 'link' })
    expect(second).toEqual({ type: 'refused', message: TRUST_MESSAGES.busy })
    await tick()
    world.answer(false)
    expect(await first).toEqual({ type: 'done' })
    expect(world.asked).toEqual([ORIGIN])
    expect(world.probes).toEqual([])
  })

  it('does not ask a link again after a no, but Open Link asks and then plays', async () => {
    const world = realWorld()
    const first = world.opener.open({ link: LINK, from: 'link' })
    await tick()
    world.answer(false)
    await first
    expect(await world.opener.open({ link: LINK, from: 'link' })).toEqual({ type: 'done' })
    const pasted = world.opener.open({ link: LINK, from: 'app' })
    await tick()
    world.answer(true)
    expect(await pasted).toEqual({
      type: 'playServer',
      target: { serverId: SERVER.id, mediaId: 7, at: 30, next: [8] },
    })
    expect(world.asked).toEqual([ORIGIN, ORIGIN])
    expect(world.probes).toEqual([ORIGIN])
    expect(await world.opener.open({ link: LINK, from: 'link' })).toEqual({
      type: 'playServer',
      target: { serverId: SERVER.id, mediaId: 7, at: 30, next: [8] },
    })
    expect(world.asked).toEqual([ORIGIN, ORIGIN])
  })

  it('refuses a link to a host ending in a dot as unreadable, without asking', async () => {
    const world = realWorld()
    const link = 'raven://play?server=https%3A%2F%2Fraven.example.&media=7'
    expect(await world.opener.open({ link, from: 'link' })).toEqual({
      type: 'refused',
      message: LINK_MESSAGES.unreadable,
    })
    expect(world.asked).toEqual([])
  })
})
