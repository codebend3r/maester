import { describe, expect, it } from 'bun:test'
import { ENTRY_KINDS, toSavedChat } from '@/lib/entries'
import { CHAT_EVENTS, NOTICE_KINDS } from '@/lib/events'
import { noticesOf, REPLY_STATES, toReply } from '@/lib/reply'

type EventProps = { name: string; data: unknown }

const event = ({ name, data }: EventProps) => ({ name, data: JSON.stringify(data) })

const reply = {
  kind: ENTRY_KINDS.reply,
  id: 1,
  events: [
    event({
      name: CHAT_EVENTS.tool,
      data: { name: 'search_library', input: { title: 'Dune' }, ok: true, result: '[]' },
    }),
    event({
      name: CHAT_EVENTS.notice,
      data: { kind: NOTICE_KINDS.adminPost, text: 'Dune in 4K?' },
    }),
  ],
  failure: null,
  expected: null,
}

describe('toSavedChat', () => {
  it('reads a saved chat back, marking a reply the reload cut off', () => {
    const saved = toSavedChat({
      owner: 'w1',
      entries: [{ kind: ENTRY_KINDS.said, id: 0, text: 'is Dune here?' }, reply],
      settled: [3],
    })
    expect(saved?.owner).toBe('w1')
    expect(saved?.settled).toEqual([3])
    const cut = saved?.entries[1]
    expect(cut).toMatchObject({ failure: 'The page was reloaded before this reply arrived.' })
  })

  it('drops anything that is not a chat this page wrote', () => {
    expect(toSavedChat(null)).toBeNull()
    expect(toSavedChat({ owner: 'w1', entries: [], settled: ['3'] })).toBeNull()
    expect(
      toSavedChat({ owner: 'w1', entries: [{ ...reply, id: 0, events: [{}] }], settled: [] }),
    ).toBeNull()
    // Ids are indexes; a gap means the entries were tampered with.
    expect(
      toSavedChat({
        owner: 'w1',
        entries: [{ kind: ENTRY_KINDS.said, id: 4, text: 'x' }],
        settled: [],
      }),
    ).toBeNull()
  })

  it('drops a reply saved in the shape before replies kept their events', () => {
    // A reply as the page saved it before replies kept their events, raw as it was written.
    const before = {
      kind: 'reply',
      id: 0,
      state: 'done',
      chunks: ['Hello.'],
      tools: [],
      confirmations: [],
      choices: [],
      notices: [{ kind: 'approval', text: 'Dune in 4K?', pendingId: 3, to: null }],
      titles: [],
      failure: null,
      cause: null,
      expected: null,
    }
    expect(toSavedChat({ owner: 'w1', entries: [before], settled: [] })).toBeNull()
  })
})

describe('toReply', () => {
  it('rebuilds a reply from its events, skipping what no guard accepts', () => {
    const built = toReply({
      entry: {
        kind: ENTRY_KINDS.reply,
        id: 1,
        events: [
          event({ name: CHAT_EVENTS.text, data: { text: 'Hi.' } }),
          event({ name: 'mystery', data: {} }),
          event({ name: CHAT_EVENTS.done, data: {} }),
        ],
        failure: null,
        expected: null,
      },
    })
    expect(built).toMatchObject({ state: REPLY_STATES.done, chunks: ['Hi.'], failure: null })
  })

  it("puts the page's own failure last", () => {
    const built = toReply({
      entry: {
        kind: ENTRY_KINDS.reply,
        id: 1,
        events: [],
        failure: 'The reply was cut off.',
        expected: null,
      },
    })
    expect(built).toMatchObject({ state: REPLY_STATES.failed, failure: 'The reply was cut off.' })
  })
})

describe('noticesOf', () => {
  it('reads the notice events and nothing else', () => {
    expect(
      noticesOf([
        event({
          name: CHAT_EVENTS.notice,
          data: { kind: NOTICE_KINDS.directMessage, text: 'Hi', to: 'u1' },
        }),
        event({ name: CHAT_EVENTS.done, data: {} }),
      ]),
    ).toEqual([{ kind: NOTICE_KINDS.directMessage, text: 'Hi', to: 'u1' }])
  })
})
