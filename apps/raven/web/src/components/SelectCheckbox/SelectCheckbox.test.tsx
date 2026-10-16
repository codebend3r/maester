import { describe, expect, it } from 'bun:test'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { SelectionScope, sourceOf } from '@/components/SelectionScope/SelectionScope'
import { useSelectable } from '@/lib/useSelectable'
import { Peek, peeked } from '@/test/selection'

const Card = ({ id, title }: { id: string; title: string }) => {
  const select = useSelectable({ key: id, title })
  return (
    <ul>
      <li data-entry={id} {...select.rootProps}>
        <a href="#open" tabIndex={select.linkTabIndex}>
          {title}
        </a>
        <SelectCheckbox select={select} />
      </li>
    </ul>
  )
}

describe('SelectCheckbox', () => {
  it('is labelled Select with the title', () => {
    render(
      <SelectionScope {...sourceOf([])}>
        <Peek />
        <Card id="a" title="Busboys" />
      </SelectionScope>,
    )
    expect(screen.getByRole('checkbox', { name: 'Select Busboys' })).not.toBeChecked()
  })

  it('is out of the tab order until selecting', async () => {
    render(
      <SelectionScope {...sourceOf([])}>
        <Peek />
        <Card id="a" title="Busboys" />
      </SelectionScope>,
    )
    expect(screen.getByRole('checkbox')).toHaveAttribute('tabindex', '-1')
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Busboys' })).toHaveFocus()
  })

  it("is the card's one tab stop while selecting", async () => {
    render(
      <SelectionScope {...sourceOf([])}>
        <Peek />
        <Card id="a" title="Busboys" />
      </SelectionScope>,
    )
    act(() => peeked.scope?.store.getState().start())
    expect(screen.getByRole('link', { name: 'Busboys' })).toHaveAttribute('tabindex', '-1')
    await userEvent.tab()
    expect(screen.getByRole('checkbox', { name: 'Select Busboys' })).toHaveFocus()
    await userEvent.keyboard(' ')
    expect(screen.getByRole('checkbox')).toBeChecked()
    await userEvent.tab()
    expect(document.body).toHaveFocus()
  })

  it('renders nothing outside a scope', () => {
    render(<Card id="a" title="Busboys" />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})
