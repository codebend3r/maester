import { describe, expect, it } from 'bun:test'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { SelectionScope, sourceOf } from '@/components/SelectionScope/SelectionScope'
import { useSelectable } from '@/lib/useSelectable'
import { Peek, peeked } from '@/test/selection'

type CardProps = { id: string; opened: string[] }

const Card = ({ id, opened }: CardProps) => {
  const select = useSelectable({ key: id, title: id })
  return (
    <li data-entry={id} {...select.rootProps}>
      <a href="#open" tabIndex={select.linkTabIndex} onClick={() => opened.push(id)}>
        {id}
      </a>
      <SelectCheckbox select={select} />
    </li>
  )
}

const inScope = (children: ReactNode) => (
  <SelectionScope {...sourceOf([])}>
    <Peek />
    {children}
  </SelectionScope>
)

const picked = (): string[] => [...(peeked.scope?.store.getState().keys ?? [])].toSorted()

describe('useSelectable', () => {
  it('leaves a click alone outside select mode', async () => {
    const opened: string[] = []
    render(inScope(<Card id="a" opened={opened} />))
    await userEvent.click(screen.getByRole('link', { name: 'a' }))
    expect(opened).toEqual(['a'])
    expect(picked()).toEqual([])
  })

  it('toggles on a click while selecting, and is prevented', async () => {
    const opened: string[] = []
    render(inScope(<Card id="a" opened={opened} />))
    act(() => peeked.scope?.store.getState().start())
    await userEvent.click(screen.getByRole('link', { name: 'a' }))
    expect(picked()).toEqual(['a'])
    expect(opened).toEqual([])
    await userEvent.click(screen.getByRole('link', { name: 'a' }))
    expect(picked()).toEqual([])
  })

  it('starts select mode with the card when its hover checkbox is ticked', async () => {
    render(inScope(<Card id="a" opened={[]} />))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select a' }))
    expect(peeked.scope?.store.getState().selecting).toBe(true)
    expect(picked()).toEqual(['a'])
    expect(screen.getByRole('checkbox', { name: 'Select a' })).toBeChecked()
  })

  it('selects a range in the order shown, though the data is sorted the other way', async () => {
    const data = ['a', 'b', 'c', 'd']
    render(
      inScope(
        <ul>
          {data.toReversed().map((id) => (
            <Card key={id} id={id} opened={[]} />
          ))}
        </ul>,
      ),
    )
    act(() => peeked.scope?.store.getState().start('d'))
    // Shown d, c, b, a: the range from d to b is d, c, b.
    const user = userEvent.setup()
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('link', { name: 'b' }))
    await user.keyboard('{/Shift}')
    expect(picked()).toEqual(['b', 'c', 'd'])
  })

  it('skips cards inside a closed details when it ranges', async () => {
    render(
      inScope(
        <>
          <ul>
            <Card id="a" opened={[]} />
          </ul>
          <details>
            <summary>Folded</summary>
            <ul>
              <Card id="b" opened={[]} />
            </ul>
          </details>
          <ul>
            <Card id="c" opened={[]} />
          </ul>
        </>,
      ),
    )
    act(() => peeked.scope?.store.getState().start('a'))
    const user = userEvent.setup()
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('link', { name: 'c' }))
    await user.keyboard('{/Shift}')
    expect(picked()).toEqual(['a', 'c'])
  })

  it('marks its card selecting and selected for the styles', () => {
    const { container } = render(inScope(<Card id="a" opened={[]} />))
    act(() => peeked.scope?.store.getState().start('a'))
    const card = container.querySelector('li')
    expect(card).toHaveAttribute('data-selecting', 'true')
    expect(card).toHaveAttribute('data-selected', 'true')
  })

  it('has no checkbox and never selects outside a scope', async () => {
    const opened: string[] = []
    render(<Card id="a" opened={opened} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'a' }))
    expect(opened).toEqual(['a'])
  })
})
