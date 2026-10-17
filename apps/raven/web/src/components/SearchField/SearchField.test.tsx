import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchField } from '@/components/SearchField/SearchField'
import { useSearch } from '@/lib/useSearch'

/** A search box with its query shown beside it, as a page would act on it. */
const Box = () => {
  const search = useSearch()
  return (
    <>
      <label htmlFor="box">Search</label>
      <SearchField id="box" search={search} className="callers" placeholder="Search Movies" />
      <output>{search.query}</output>
    </>
  )
}

describe('SearchField', () => {
  it('keeps the caller’s class and props beside its own', () => {
    render(<Box />)
    const box = screen.getByRole('searchbox', { name: 'Search' })
    expect(box).toHaveClass('callers')
    expect(box.classList.length).toBe(2)
    expect(box).toHaveAttribute('placeholder', 'Search Movies')
  })

  it('searches at once on Enter rather than on each keystroke', async () => {
    render(<Box />)
    const box = screen.getByRole('searchbox', { name: 'Search' })
    await userEvent.type(box, 'heat')
    expect(box).toHaveValue('heat')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    await userEvent.type(box, '{Enter}')
    expect(screen.getByRole('status')).toHaveTextContent('heat')
  })
})
