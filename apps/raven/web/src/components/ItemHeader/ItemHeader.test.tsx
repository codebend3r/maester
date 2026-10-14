import { describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ItemHeader } from '@/components/ItemHeader/ItemHeader'

const header = (logo: string | null) => (
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
      back={{ to: '/libraries/4', label: '4k Movies' }}
    />
  </MemoryRouter>
)

describe('ItemHeader', () => {
  it('shows the logo in place of the title, still named by the title', () => {
    render(header('/api/items/835/images/logo?v=l1'))
    const heading = screen.getByRole('heading', { level: 1, name: 'Saving Private Ryan' })
    expect(heading.querySelector('img')).toHaveAttribute('src', '/api/items/835/images/logo?v=l1')
  })

  it('falls back to the words when the logo will not load', () => {
    render(header('/api/items/835/images/logo?v=l1'))
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
          backdrop={{ type: 'picture', url: '/api/items/835/images/backdrop?v=b1' }}
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
})
