import { describe, expect, it } from 'bun:test'
import { KIT_COPY, LIBRARY_PAGE_COPY, type ListState } from '@raven/wren'
import { screen } from '@testing-library/react'
import { ListNotice } from '@/components/ListNotice/ListNotice'
import { LIST_SHAPES } from '@/components/ListSkeleton/ListSkeleton'
import { renderWithProviders } from '@/test/render'

const READING: ListState = { failure: null, isRead: false, hasNoMusic: false }
const READ: ListState = { failure: null, isRead: true, hasNoMusic: false }
const FAILED: ListState = { failure: new Error('down'), isRead: false, hasNoMusic: false }

describe('ListNotice', () => {
  it('stands in for the entries while the list is read, and says so to a screen reader alone', () => {
    renderWithProviders({
      ui: (
        <ListNotice empty={LIBRARY_PAGE_COPY.noAlbums} listing={READING} shape={LIST_SHAPES.rows} />
      ),
    })
    expect(screen.getByRole('status')).toHaveTextContent(KIT_COPY.loading)
    expect(screen.queryByText(LIBRARY_PAGE_COPY.noAlbums)).toBeNull()
  })

  it('says the list is empty once it is read with nothing in it', () => {
    renderWithProviders({
      ui: (
        <ListNotice empty={LIBRARY_PAGE_COPY.noAlbums} listing={READ} shape={LIST_SHAPES.tiles} />
      ),
    })
    expect(screen.getByText(LIBRARY_PAGE_COPY.noAlbums)).toBeInTheDocument()
  })

  it('says why the list could not be read', () => {
    renderWithProviders({
      ui: (
        <ListNotice empty={LIBRARY_PAGE_COPY.noAlbums} listing={FAILED} shape={LIST_SHAPES.tiles} />
      ),
    })
    expect(screen.getByText(LIBRARY_PAGE_COPY.failed)).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
