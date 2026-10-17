import { describe, expect, it } from 'bun:test'
import { createSelectionStore } from '@/stores/selection'

const keys = (store: ReturnType<typeof createSelectionStore>): string[] => [
  ...store.getState().keys,
]

describe('the selection store', () => {
  it('starts with a card selected', () => {
    const store = createSelectionStore()
    store.getState().start('media:1')
    expect(store.getState()).toMatchObject({ selecting: true, anchor: 'media:1' })
    expect(keys(store)).toEqual(['media:1'])
  })

  it('starts empty without a card', () => {
    const store = createSelectionStore()
    store.getState().start()
    expect(store.getState()).toMatchObject({ selecting: true, anchor: null })
    expect(keys(store)).toEqual([])
  })

  it('toggles a key and moves the anchor', () => {
    const store = createSelectionStore()
    store.getState().start('a')
    store.getState().toggle('b')
    expect(keys(store)).toEqual(['a', 'b'])
    expect(store.getState().anchor).toBe('b')
    store.getState().toggle('a')
    expect(keys(store)).toEqual(['b'])
  })

  it('selects a range between the anchor and a key, either direction', () => {
    const ordered = ['a', 'b', 'c', 'd', 'e']
    const down = createSelectionStore()
    down.getState().start('b')
    down.getState().range({ to: 'd', ordered })
    expect(keys(down).toSorted()).toEqual(['b', 'c', 'd'])
    expect(down.getState().anchor).toBe('d')

    const up = createSelectionStore()
    up.getState().start('d')
    up.getState().range({ to: 'b', ordered })
    expect(keys(up).toSorted()).toEqual(['b', 'c', 'd'])
  })

  it('selects the one key when there is no anchor to reach from', () => {
    const store = createSelectionStore()
    store.getState().start()
    store.getState().range({ to: 'c', ordered: ['a', 'b', 'c'] })
    expect(keys(store)).toEqual(['c'])
  })

  it('selects the one key when the anchor is not among those in order', () => {
    const store = createSelectionStore()
    store.getState().start('gone')
    store.getState().range({ to: 'c', ordered: ['a', 'b', 'c'] })
    expect(keys(store).toSorted()).toEqual(['c', 'gone'])
  })

  it('keeps what was selected before a range', () => {
    const store = createSelectionStore()
    store.getState().start('a')
    store.getState().toggle('e')
    store.getState().range({ to: 'c', ordered: ['a', 'b', 'c', 'd', 'e'] })
    expect(keys(store).toSorted()).toEqual(['a', 'c', 'd', 'e'])
  })

  it('select all replaces the selection', () => {
    const store = createSelectionStore()
    store.getState().start('z')
    store.getState().selectAll(['a', 'b'])
    expect(keys(store)).toEqual(['a', 'b'])
    expect(store.getState().selecting).toBe(true)
  })

  it('clear empties it and stays in select mode', () => {
    const store = createSelectionStore()
    store.getState().start('a')
    store.getState().clear()
    expect(store.getState()).toMatchObject({ selecting: true, anchor: null })
    expect(keys(store)).toEqual([])
  })

  it('end empties it and leaves select mode', () => {
    const store = createSelectionStore()
    store.getState().start('a')
    store.getState().end()
    expect(store.getState()).toMatchObject({ selecting: false, anchor: null })
    expect(keys(store)).toEqual([])
  })

  it('gives a new set on every change, so subscribers redraw', () => {
    const store = createSelectionStore()
    store.getState().start('a')
    const before = store.getState().keys
    store.getState().toggle('b')
    expect(store.getState().keys).not.toBe(before)
    expect(before.has('b')).toBe(false)
  })
})
