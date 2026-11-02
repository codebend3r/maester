import { describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ItemHeader } from '@/components/ItemHeader/ItemHeader'
import styles from '@/components/ItemHeader/ItemHeader.module.scss'

const header = (logo: string | null, pullUp = false) => (
  <MemoryRouter>
    <ItemHeader
      titleId="title"
      title="Saving Private Ryan"
      byline={null}
      contentRating={null}
      facts={[]}
      ratings={[]}
      backdrop={null}
      logo={logo}
      pullUp={pullUp}
      back={{ to: '/libraries/4', label: '4k Movies' }}
    />
  </MemoryRouter>
)

describe('ItemHeader', () => {
  it('shows the logo in place of the title, still named by the title', () => {
    render(header('/api/pictures/items/835/logo/l1'))
    const heading = screen.getByRole('heading', { level: 1, name: 'Saving Private Ryan' })
    expect(heading.querySelector('img')).toHaveAttribute('src', '/api/pictures/items/835/logo/l1')
  })

  it('pulls movie and show content closer to the way back when requested', () => {
    render(header(null, true))
    expect(screen.getByRole('banner')).toHaveClass(styles.pullUp)
  })

  it('falls back to the words when the logo will not load', () => {
    render(header('/api/pictures/items/835/logo/l1'))
    fireEvent.error(screen.getByRole('img', { name: 'Saving Private Ryan' }))
    const heading = screen.getByRole('heading', { level: 1, name: 'Saving Private Ryan' })
    expect(heading.querySelector('img')).toBeNull()
    expect(heading).toHaveTextContent('Saving Private Ryan')
  })

  it('lays the way back over the top of the backdrop', () => {
    render(
      <MemoryRouter>
        <ItemHeader
          titleId="title"
          title="Saving Private Ryan"
          byline={null}
          contentRating={null}
          facts={[]}
          ratings={[]}
          backdrop={{
            type: 'picture',
            url: '/api/pictures/items/835/backdrop/b1',
            srcSet: null,
          }}
          back={{ to: '/libraries/4', label: '4k Movies' }}
        />
      </MemoryRouter>,
    )
    const back = screen.getByRole('link', { name: '4k Movies' })
    expect(back).toHaveAttribute('href', '/libraries/4')
    expect(back.closest('header')).toBe(screen.getByRole('banner'))
  })

  it('writes the title out when there is no logo', () => {
    render(header(null))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Saving Private Ryan')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('says what the item is over its title, how far through it is, and its actions in two rows', () => {
    render(
      <MemoryRouter>
        <ItemHeader
          titleId="title"
          eyebrow={['Saga', '3 movies']}
          title="The Lord of the Rings Collection"
          byline={null}
          contentRating="PG-13"
          facts={['2001 to 2003', '8h 54m in all']}
          ratings={[]}
          backdrop={null}
          progress={{ fraction: 2 / 3, label: '2 of 3 watched' }}
          back={{ to: '/libraries/4/sagas', label: 'Sagas' }}
          manage={<button type="button">Edit backdrop</button>}
        >
          <button type="button">Play all</button>
        </ItemHeader>
      </MemoryRouter>,
    )
    expect(screen.getByText('Saga')).toBeInTheDocument()
    expect(screen.getByText('3 movies')).toBeInTheDocument()
    expect(screen.getByText('PG-13')).toHaveTextContent('Rated PG-13')
    expect(screen.getByText('8h 54m in all')).toBeInTheDocument()
    expect(screen.getByText('2 of 3 watched')).toBeInTheDocument()
    const play = screen.getByRole('button', { name: 'Play all' })
    const edit = screen.getByRole('button', { name: 'Edit backdrop' })
    expect(play.parentElement).not.toBe(edit.parentElement)
    expect(play.parentElement?.parentElement).toBe(edit.parentElement?.parentElement)
  })
})
