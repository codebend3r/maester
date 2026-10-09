import { describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import { HomePage } from '@/pages/HomePage/HomePage'
import { renderAt } from '@/test/render'

describe('HomePage', () => {
  it('shows who is signed in and a way out', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ user: { id: 'u1', display_name: 'alice', email: null, thumb: null } }),
        { status: 200 },
      ),
    )
    renderAt(<HomePage />)

    expect(await screen.findByRole('heading', { name: 'Signed in as alice' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign out' })).toHaveAttribute('href', '/logout')
  })

  it('sends anyone without a session to /login', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }))
    renderAt(<HomePage />)
    expect(await screen.findByText('login page')).toBeInTheDocument()
  })
})
