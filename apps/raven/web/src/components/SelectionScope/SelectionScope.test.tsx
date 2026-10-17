import { describe, expect, it } from 'bun:test'
import { act, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import {
  SelectionScope,
  sourceOf,
  useSelection,
  useSelectionScope,
} from '@/components/SelectionScope/SelectionScope'
import { Peek, peeked } from '@/test/selection'
import { useSelectionScopes } from '@/stores/selectionScope'

const NOTHING = sourceOf([])

const Probe = () => {
  const selecting = useSelection((state) => state.selecting)
  return <p>{selecting ? 'selecting' : 'idle'}</p>
}

const Starter = () => {
  const scope = useSelectionScope()
  return <button onClick={() => scope?.store.getState().start('a')}>start</button>
}

describe('SelectionScope', () => {
  it('reads as not selecting for a card outside any scope', () => {
    render(<Probe />)
    expect(screen.getByText('idle')).toBeInTheDocument()
  })

  it('gives no scope outside one', () => {
    render(<Peek />)
    expect(peeked.scope).toBeNull()
  })

  it('ends select mode when it mounts afresh', () => {
    const tree = (key: string) => (
      <SelectionScope key={key} {...NOTHING}>
        <Starter />
        <Probe />
      </SelectionScope>
    )
    const { rerender } = render(tree('all'))
    act(() => screen.getByRole('button', { name: 'start' }).click())
    expect(screen.getByText('selecting')).toBeInTheDocument()
    rerender(tree('favourites'))
    expect(screen.getByText('idle')).toBeInTheDocument()
  })

  it('answers with what the latest render of the section gave', () => {
    const tree = (id: number) => (
      <SelectionScope {...sourceOf([['a', [{ kind: 'media', id }]]])}>
        <Peek />
      </SelectionScope>
    )
    const { rerender } = render(tree(1))
    rerender(tree(2))
    expect(peeked.scope?.resolve('a')).toEqual([{ kind: 'media', id: 2 }])
    expect(peeked.scope?.allKeys()).toEqual(['a'])
    expect(peeked.scope?.resolve('missing')).toEqual([])
  })

  it('draws its cards once as it opens, with the scope already there', () => {
    const drawn: boolean[] = []
    const Card = () => {
      drawn.push(useSelectionScope() !== null)
      return null
    }
    render(
      <SelectionScope {...NOTHING}>
        <Card />
      </SelectionScope>,
    )
    expect(drawn).toEqual([true])
  })

  it('keeps an earlier scope drawn while a later one overlaps it, and opens it again after', () => {
    const tree = (isLaterThere: boolean) => (
      <>
        <SelectionScope {...sourceOf([['a', []]])}>
          <p>earlier</p>
        </SelectionScope>
        {isLaterThere && (
          <SelectionScope {...sourceOf([['b', []]])}>
            <Peek />
          </SelectionScope>
        )}
      </>
    )
    const { rerender } = render(tree(true))
    expect(peeked.scope?.allKeys()).toEqual(['b'])
    rerender(tree(false))
    expect(screen.getByText('earlier')).toBeInTheDocument()
    expect(useSelectionScopes.getState().scopes.map((scope) => scope.allKeys())).toEqual([['a']])
  })

  it('redraws a card only for its own key', () => {
    const renders: Record<string, number> = { a: 0, b: 0 }
    const Card = ({ id }: { id: string }) => {
      const selected = useSelection((state) => state.keys.has(id))
      useEffect(() => {
        renders[id] = (renders[id] ?? 0) + 1
      })
      return <p>{selected ? `${id} on` : `${id} off`}</p>
    }
    render(
      <SelectionScope {...NOTHING}>
        <Peek />
        <Card id="a" />
        <Card id="b" />
      </SelectionScope>,
    )
    const before = { ...renders }
    act(() => peeked.scope?.store.getState().toggle('a'))
    expect(screen.getByText('a on')).toBeInTheDocument()
    expect(renders.a).toBe((before.a ?? 0) + 1)
    expect(renders.b).toBe(before.b ?? 0)
  })
})
