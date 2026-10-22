import { type DesktopReply, isDesktopReply, watchPathFor, DESKTOP_REPLIES } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import type { DownloadService } from '@/main/downloads/downloadService'
import { LINK_MESSAGES, createLinkOpener } from '@/main/servers/linkOpener'

const ORIGIN = 'https://raven.example'
const ALIAS = 'http://192.168.50.6:8484'
const SERVER_ID = '00000000-0000-4000-8000-000000000001'

const LINK = 'raven://play?server=https%3A%2F%2Fraven.example&media=7&at=30&next=8'

const ASK_REPLY: DesktopReply = {
  type: 'downloadAsk',
  ask: {
    askId: '00000000-0000-4000-8000-0000000000aa',
    serverId: SERVER_ID,
    serverName: 'raven',
    autoDelete: false,
    status: { kind: 'locked' },
  },
}

type AskInput = Parameters<DownloadService['ask']>[0]

const setup = () => {
  const warnings: string[] = []
  const asks: AskInput[] = []
  const opener = createLinkOpener({
    isServerOrigin: (origin) => origin === ORIGIN || origin === ALIAS,
    serverId: () => SERVER_ID,
    downloads: {
      ask: async (input) => {
        asks.push(input)
        return ASK_REPLY
      },
    },
    warn: (message) => warnings.push(message),
  })
  return { opener, asks, warnings }
}

const refused = (message: string): DesktopReply => ({ type: DESKTOP_REPLIES.refused, message })

describe('createLinkOpener', () => {
  it("sends a play link to the web's watch page, with where to start and what follows", async () => {
    const world = setup()
    const reply = await world.opener.open({ link: LINK })
    expect(reply).toEqual({ type: DESKTOP_REPLIES.navigate, to: '/watch/7?at=30&next=8' })
    expect(isDesktopReply(reply)).toBe(true)
    expect(world.asks).toEqual([])
  })

  it('reads a link that names the server by an alias, and a pasted watch page', async () => {
    const world = setup()
    expect(
      await world.opener.open({
        link: 'raven://play?server=http%3A%2F%2F192.168.50.6%3A8484&media=7',
      }),
    ).toEqual({ type: DESKTOP_REPLIES.navigate, to: watchPathFor({ mediaId: 7, at: 0, next: [] }) })
    expect(await world.opener.open({ link: 'https://raven.example/watch/7?t=9#x' })).toEqual({
      type: DESKTOP_REPLIES.navigate,
      to: '/watch/7',
    })
  })

  it.each([
    ['raven://download?server=https%3A%2F%2Fraven.example&media=7', { kind: 'media', mediaId: 7 }],
    ['raven://download?server=https%3A%2F%2Fraven.example&item=10', { kind: 'item', itemId: 10 }],
    [
      'raven://download?server=http%3A%2F%2F192.168.50.6%3A8484&saga=1%3A100',
      { kind: 'saga', libraryId: 1, tmdbId: '100' },
    ],
  ] as const)('answers %j with the download ask for the server', async (link, target) => {
    const world = setup()
    expect(await world.opener.open({ link })).toEqual(ASK_REPLY)
    expect(world.asks).toEqual([{ serverId: SERVER_ID, target }])
  })

  it.each([
    ['a play link', 'raven://play?server=https%3A%2F%2Fother.example&media=7'],
    ['a watch page', 'https://other.example/watch/7'],
    ['a download link', 'raven://download?server=https%3A%2F%2Fother.example&media=7'],
  ])('refuses %s to another server, asking nothing', async (_name, link) => {
    const world = setup()
    expect(await world.opener.open({ link })).toEqual(refused(LINK_MESSAGES.otherServer))
    expect(world.asks).toEqual([])
    expect(world.warnings).toEqual(['raven player refused a link to another server'])
  })

  it('refuses a link to a host ending in a dot as unreadable', async () => {
    const world = setup()
    const link = 'raven://play?server=https%3A%2F%2Fraven.example.&media=7'
    expect(await world.opener.open({ link })).toEqual(refused(LINK_MESSAGES.unreadable))
    expect(world.warnings).toHaveLength(1)
  })

  it('warns at most the first 100 characters of an unreadable link, on one line', async () => {
    const world = setup()
    const link = `javascript:${'a'.repeat(200)}`
    expect(await world.opener.open({ link })).toEqual(refused(LINK_MESSAGES.unreadable))
    const [warning] = world.warnings
    expect(warning).toContain(link.slice(0, 100))
    expect(warning).not.toContain(link.slice(0, 101))
  })

  it('escapes line breaks and bidi overrides in what it warns', async () => {
    const world = setup()
    await world.opener.open({ link: 'evil:\nforged log line‮' })
    const [warning] = world.warnings
    expect(warning).not.toContain('\n')
    expect(warning).not.toContain('‮')
  })

  it('opens only the first of a batch and warns how many it dropped', async () => {
    const world = setup()
    expect(await world.opener.openBatch([LINK, 'raven://play?server=x&media=8'])).toEqual({
      type: DESKTOP_REPLIES.navigate,
      to: '/watch/7?at=30&next=8',
    })
    expect(world.warnings).toEqual(['raven player opened the first of 2 links and dropped 1'])
  })

  it('opens a batch of one without a warning, and is done for an empty one', async () => {
    const world = setup()
    expect((await world.opener.openBatch([LINK])).type).toBe(DESKTOP_REPLIES.navigate)
    expect(await world.opener.openBatch([])).toEqual({ type: 'done' })
    expect(world.warnings).toEqual([])
  })
})
