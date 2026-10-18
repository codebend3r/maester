import { describe, expect, it } from 'bun:test'
import { toSavedChat } from '@/lib/entries'

const reply = {
  kind: 'reply',
  id: 1,
  state: 'running',
  chunks: [],
  tools: [{ name: 'search_library', input: { title: 'Dune' }, ok: true, result: '[]' }],
  confirmations: [],
  choices: [],
  notices: [{ kind: 'approval', text: 'Dune in 4K?', pendingId: 3, to: null }],
  titles: [],
  failure: null,
  cause: null,
  expected: null,
}

describe('toSavedChat', () => {
  it('reads a saved chat back, marking a reply the reload cut off', () => {
    const saved = toSavedChat({
      owner: 'w1',
      entries: [{ kind: 'said', id: 0, text: 'is Dune here?' }, reply],
      settled: [3],
    })
    expect(saved?.owner).toBe('w1')
    expect(saved?.settled).toEqual([3])
    expect(saved?.entries[1]).toMatchObject({
      state: 'failed',
      failure: 'The page was reloaded before this reply arrived.',
    })
  })

  it('drops anything that is not a chat this page wrote', () => {
    expect(toSavedChat(null)).toBeNull()
    expect(toSavedChat({ owner: 'w1', entries: [], settled: ['3'] })).toBeNull()
    expect(
      toSavedChat({ owner: 'w1', entries: [{ ...reply, id: 0, tools: [{}] }], settled: [] }),
    ).toBeNull()
    // Ids are indexes; a gap means the entries were tampered with.
    expect(
      toSavedChat({ owner: 'w1', entries: [{ kind: 'said', id: 4, text: 'x' }], settled: [] }),
    ).toBeNull()
  })
})
