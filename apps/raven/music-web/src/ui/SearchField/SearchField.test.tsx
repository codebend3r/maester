import { describe, expect, it, mock } from 'bun:test'
import { SEARCH_DELAY_MS } from '@raven/core'
import { useSearch } from '@raven/ui/headless'
import { KIT_COPY } from '@raven/wren'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchField } from '@/ui/SearchField/SearchField'

type HeldSearchProps = { onCancel?: () => void }

/** The field as a screen holds it: by `useSearch`, which asks only once typing pauses. */
function HeldSearch({ onCancel }: HeldSearchProps) {
  const search = useSearch()
  return (
    <>
      <SearchField
        onCancel={onCancel}
        onChangeText={search.setText}
        onSubmit={search.searchNow}
        value={search.text}
      />
      <output aria-label="Asked for">{search.query}</output>
    </>
  )
}

const field = () => screen.getByRole('searchbox', { name: KIT_COPY.search })
const asked = () => screen.getByRole('status', { name: 'Asked for' })

describe('SearchField', () => {
  it("is a search box with the kit's placeholder", () => {
    render(<HeldSearch />)

    expect(field()).toHaveAttribute('type', 'search')
    expect(field()).toHaveAttribute('placeholder', KIT_COPY.searchPlaceholder)
    expect(field().closest('search')).not.toBeNull()
  })

  it('asks once typing pauses, never on each keystroke', async () => {
    render(<HeldSearch />)

    await userEvent.type(field(), 'radio')

    expect(field()).toHaveValue('radio')
    expect(asked()).toHaveTextContent('')
    await waitFor(() => expect(asked()).toHaveTextContent('radio'), {
      timeout: SEARCH_DELAY_MS * 4,
    })
  })

  it('asks at once on Enter', async () => {
    render(<HeldSearch />)

    await userEvent.type(field(), 'ok computer{Enter}')

    expect(asked()).toHaveTextContent('ok computer')
  })

  it('clears what is typed, and hands the focus back to the field', async () => {
    render(<HeldSearch />)
    expect(screen.queryByRole('button', { name: KIT_COPY.clearSearch })).toBeNull()

    await userEvent.type(field(), 'radio')
    await userEvent.click(screen.getByRole('button', { name: KIT_COPY.clearSearch }))

    expect(field()).toHaveValue('')
    expect(field()).toHaveFocus()
    expect(screen.queryByRole('button', { name: KIT_COPY.clearSearch })).toBeNull()
  })

  it('offers Cancel only where the screen has a search to leave, and leaves it without the focus', async () => {
    const onCancel = mock()
    const { rerender } = render(<HeldSearch />)
    expect(screen.queryByRole('button', { name: KIT_COPY.cancel })).toBeNull()
    rerender(<HeldSearch onCancel={onCancel} />)

    await userEvent.click(field())
    await userEvent.click(screen.getByRole('button', { name: KIT_COPY.cancel }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(document.body).toHaveFocus()
  })
})
